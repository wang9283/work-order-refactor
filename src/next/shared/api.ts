import type {
  ApiError,
  ApiErrorBody,
  Capability,
  CurrentUser,
  DemoAuthOptions,
  DemoBaseOption,
  DemoIdentityId,
  DemoLoginResult,
  DemoSessionResult,
  LoginInput,
  LoginResult,
  PageMeta,
  PagedResult,
  ScopeRef,
} from '@contracts/index'

export type ClientSurface = 'admin' | 'mobile'

const LEGACY_TOKEN_KEY = 'feed.group-work-order.token.v3'
const TOKEN_KEYS: Record<ClientSurface, string> = {
  admin: 'feed.group-work-order.token.v4.admin',
  mobile: 'feed.group-work-order.token.v4.mobile',
}

let clientSurface: ClientSurface = window.location.pathname.includes('app.html') ? 'mobile' : 'admin'

interface ApiEnvelope<T> {
  data: T
  meta?: PageMeta
  requestId: string
}

export class ApiRequestError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: unknown
  readonly requestId: string

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = body.code
    this.details = body.details
    this.requestId = body.requestId
  }
}

export function configureApiSurface(surface: ClientSurface): void {
  clientSurface = surface
  localStorage.removeItem(LEGACY_TOKEN_KEY)
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEYS[clientSurface])
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEYS[clientSurface], token)
  else localStorage.removeItem(TOKEN_KEYS[clientSurface])
}

let unauthorizedHandler: (() => void) | null = null
let pendingMutations = 0
const mutationIdleWaiters = new Set<() => void>()

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

export function hasPendingMutations(): boolean {
  return pendingMutations > 0
}

export function waitForPendingMutations(): Promise<void> {
  if (!hasPendingMutations()) return Promise.resolve()
  return new Promise((resolve) => mutationIdleWaiters.add(resolve))
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const token = getToken()
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`/api${path}`, { ...init, headers })
  if (!response.ok) {
    let body: ApiErrorBody
    try {
      body = ((await response.json()) as { error: ApiErrorBody }).error
    } catch {
      body = {
        code: 'INTERNAL_ERROR',
        message: `请求失败（${response.status}）`,
        requestId: response.headers.get('x-request-id') || '',
      }
    }
    if (response.status === 401) {
      setToken(null)
      unauthorizedHandler?.()
    }
    throw new ApiRequestError(response.status, body)
  }
  if (response.status === 204) {
    return { data: undefined as T, requestId: response.headers.get('x-request-id') || '' }
  }
  return (await response.json()) as ApiEnvelope<T>
}

async function mutate<T>(operation: () => Promise<T>): Promise<T> {
  pendingMutations += 1
  try {
    return await operation()
  } finally {
    pendingMutations -= 1
    if (!pendingMutations) {
      for (const resolve of mutationIdleWaiters) resolve()
      mutationIdleWaiters.clear()
    }
  }
}

function queryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}

export const api = {
  auth: {
    demoOptions: async (): Promise<DemoAuthOptions> => (
      await request<DemoAuthOptions>('/auth/demo-options')
    ).data,
    demoLogin: async (identityId: DemoIdentityId, baseId?: string | null): Promise<DemoLoginResult> => (
      await request<DemoLoginResult>('/auth/demo-login', {
        method: 'POST',
        body: JSON.stringify({ identityId, ...(baseId ? { baseId } : {}) }),
      })
    ).data,
    demoSession: async (): Promise<DemoSessionResult> => (
      await request<DemoSessionResult>('/auth/demo-session')
    ).data,
    demoBase: async (baseId: DemoBaseOption['id']): Promise<DemoSessionResult> => (
      await request<DemoSessionResult>('/auth/demo-base', {
        method: 'POST',
        body: JSON.stringify({ baseId }),
      })
    ).data,
    login: async (input: LoginInput): Promise<LoginResult> => {
      const result = await request<LoginResult>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      setToken(result.data.token)
      return result.data
    },
    me: async (): Promise<CurrentUser> => (await request<CurrentUser>('/auth/me')).data,
    logout: async (): Promise<void> => {
      try {
        await request<void>('/auth/logout', { method: 'POST' })
      } finally {
        setToken(null)
      }
    },
  },
  reference: async <T>(): Promise<T> => (await request<T>('/reference-data')).data,
  get: async <T>(path: string): Promise<T> => (await request<T>(path)).data,
  getPage: async <T>(path: string, params: Record<string, string | number | boolean | null | undefined> = {}): Promise<PagedResult<T>> => {
    const result = await request<T[]>(`${path}${queryString(params)}`)
    const meta = result.meta ?? { page: 1, pageSize: result.data.length, total: result.data.length, totalPages: 1 }
    return { items: result.data, meta }
  },
  post: async <T>(path: string, body?: unknown): Promise<T> => (
    await mutate(() => request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }))
  ).data,
  put: async <T>(path: string, body: unknown): Promise<T> => (
    await mutate(() => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }))
  ).data,
  patch: async <T>(path: string, body: unknown): Promise<T> => (
    await mutate(() => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }))
  ).data,
  delete: async <T>(path: string): Promise<T> => (
    await mutate(() => request<T>(path, { method: 'DELETE' }))
  ).data,
  upload: async <T>(path: string, formData: FormData, headers: Record<string, string> = {}): Promise<T> => (
    await mutate(() => request<T>(path, { method: 'POST', body: formData, headers }))
  ).data,
}

export function hasAnyCapability(user: CurrentUser | null, capabilities: Capability[]): boolean {
  if (!user) return false
  const capabilitySet = new Set(capabilities)
  return user.grants.some((grant) => capabilitySet.has(grant.capability))
}

export function can(user: CurrentUser | null, capability: Capability, scope: ScopeRef): boolean {
  if (!user) return false
  return user.grants.some((grant) => {
    if (grant.capability !== capability) return false
    return grant.type === 'group' || (grant.type === scope.type && grant.id === scope.id)
  })
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof Error) return error.message
  return '操作失败，请稍后重试'
}
