import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  CurrentUser,
  DemoBaseOption,
  DemoIdentityId,
  DemoIdentityOption,
  DemoOrgOption,
  DemoSessionResult,
} from '@contracts/index'
import {
  api,
  errorMessage,
  getToken,
  setToken,
  setUnauthorizedHandler,
  waitForPendingMutations,
  type ClientSurface,
} from './api'
import { confirmDiscardUnsavedChanges, hasUnsavedChanges } from './unsaved-changes'

interface AuthValue {
  user: CurrentUser | null
  identities: DemoIdentityOption[]
  activeIdentity: DemoIdentityOption | null
  orgs: DemoOrgOption[]
  activeOrg: DemoOrgOption | null
  bases: DemoBaseOption[]
  activeBase: DemoBaseOption | null
  loading: boolean
  switching: boolean
  error: string
  contextVersion: number
  switchIdentity: (identityId: DemoIdentityId) => Promise<void>
  switchOrg: (orgId: string) => Promise<void>
  switchBase: (baseId: string) => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)
const IDENTITY_KEYS: Record<ClientSurface, string> = {
  admin: 'feed.group-work-order.identity.v1.admin',
  mobile: 'feed.group-work-order.identity.v1.mobile',
}
const ORG_KEYS: Record<ClientSurface, string> = {
  admin: 'feed.group-work-order.org.v1.admin',
  mobile: 'feed.group-work-order.org.v1.mobile',
}
const BASE_KEYS: Record<ClientSurface, string> = {
  admin: 'feed.group-work-order.base.v1.admin',
  mobile: 'feed.group-work-order.base.v1.mobile',
}

export function AuthProvider({ children, surface = 'admin' }: { children: ReactNode; surface?: ClientSurface }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [identities, setIdentities] = useState<DemoIdentityOption[]>([])
  const [activeIdentity, setActiveIdentity] = useState<DemoIdentityOption | null>(null)
  const [orgs, setOrgs] = useState<DemoOrgOption[]>([])
  const [activeOrg, setActiveOrg] = useState<DemoOrgOption | null>(null)
  const [bases, setBases] = useState<DemoBaseOption[]>([])
  const [activeBase, setActiveBase] = useState<DemoBaseOption | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
  const [contextVersion, setContextVersion] = useState(0)
  const identityKey = IDENTITY_KEYS[surface]
  const orgKey = ORG_KEYS[surface]
  const baseKey = BASE_KEYS[surface]
  const activeIdentityRef = useRef<DemoIdentityId | null>(null)
  const activeOrgRef = useRef<string | null>(null)
  const activeBaseRef = useRef<string | null>(null)
  const userRef = useRef<CurrentUser | null>(null)
  const mountedRef = useRef(true)
  const recoveringRef = useRef(false)
  const initializedRef = useRef(false)
  const operationRef = useRef(0)
  const transitionIntentRef = useRef(0)

  const prepareSwitch = useCallback(async (): Promise<boolean> => {
    const intent = ++transitionIntentRef.current
    await waitForPendingMutations()
    if (intent !== transitionIntentRef.current) return false
    return !hasUnsavedChanges() || confirmDiscardUnsavedChanges()
  }, [])

  const applyScope = useCallback((result: DemoSessionResult, token?: string) => {
    if (token) setToken(token)
    activeIdentityRef.current = result.identity.id
    activeOrgRef.current = result.activeOrg.id
    activeBaseRef.current = result.activeBase.id
    userRef.current = result.user
    localStorage.setItem(identityKey, result.identity.id)
    localStorage.setItem(orgKey, result.activeOrg.id)
    localStorage.setItem(baseKey, result.activeBase.id)
    setIdentities((current) => {
      if (!current.length) return current
      return current.map((identity) => identity.id === result.identity.id ? result.identity : identity)
    })
    setActiveIdentity(result.identity)
    setOrgs(result.orgs)
    setActiveOrg(result.activeOrg)
    setBases(result.bases)
    setActiveBase(result.activeBase)
    setUser(result.user)
    setContextVersion((current) => current + 1)
  }, [baseKey, identityKey, orgKey])

  const login = useCallback(async (
    requestedIdentity?: DemoIdentityId,
    requestedOrg?: string | null,
  ): Promise<void> => {
    const operation = ++operationRef.current
    setSwitching(Boolean(userRef.current))
    setError('')
    if (!userRef.current) setLoading(true)
    try {
      const options = await api.auth.demoOptions()
      if (!options.enabled) throw new Error('免登录演示入口未开启，请联系管理员检查演示运行配置')
      const stored = localStorage.getItem(identityKey) as DemoIdentityId | null
      const requested = requestedIdentity || activeIdentityRef.current || stored
      const selected = options.identities.find((identity) => identity.id === requested && identity.available)
        || options.identities.find((identity) => (
          surface === 'admin' ? identity.defaultForAdmin : identity.defaultForMobile
        ) && identity.available)
        || options.identities.find((identity) => identity.available)
      if (!selected) throw new Error('当前演示数据中没有可用身份')
      const preferredOrg = requestedOrg === undefined
        ? activeOrgRef.current || localStorage.getItem(orgKey)
        : requestedOrg
      const result = await api.auth.demoLogin(selected.id, undefined, preferredOrg)
      if (!mountedRef.current || operation !== operationRef.current) return
      setIdentities(options.identities)
      applyScope(result, result.token)
    } catch (reason) {
      if (!mountedRef.current || operation !== operationRef.current) return
      setError(errorMessage(reason))
      if (!userRef.current) setUser(null)
    } finally {
      if (mountedRef.current && operation === operationRef.current) {
        setLoading(false)
        setSwitching(false)
      }
    }
  }, [applyScope, identityKey, orgKey, surface])

  const restore = useCallback(async (): Promise<void> => {
    const operation = ++operationRef.current
    setError('')
    try {
      if (!getToken()) {
        await login()
        return
      }
      const options = await api.auth.demoOptions()
      if (!options.enabled) throw new Error('免登录演示入口未开启，请联系管理员检查演示运行配置')
      const result = await api.auth.demoSession()
      if (!mountedRef.current || operation !== operationRef.current) return
      setIdentities(options.identities)
      applyScope(result)
      setLoading(false)
    } catch (reason) {
      if (!mountedRef.current || operation !== operationRef.current) return
      if (recoveringRef.current) return
      // An expired or malformed session is replaced once from the stored
      // demo identity; other failures retain the explicit retry screen.
      await login(
        activeIdentityRef.current
          || (localStorage.getItem(identityKey) as DemoIdentityId | null)
          || undefined,
        activeOrgRef.current || localStorage.getItem(orgKey),
      )
      if (reason instanceof Error && !userRef.current) setError(errorMessage(reason))
    }
  }, [applyScope, identityKey, login, orgKey])

  useEffect(() => {
    mountedRef.current = true
    if (!initializedRef.current) {
      initializedRef.current = true
      void restore()
    }
    return () => {
      mountedRef.current = false
      setUnauthorizedHandler(null)
    }
  }, [restore])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (recoveringRef.current || !activeIdentityRef.current) return
      recoveringRef.current = true
      void login(activeIdentityRef.current, activeOrgRef.current).finally(() => {
        recoveringRef.current = false
      })
    })
    return () => setUnauthorizedHandler(null)
  }, [login])

  const refresh = useCallback(async (): Promise<void> => {
    await restore()
  }, [restore])

  const switchIdentity = useCallback(async (identityId: DemoIdentityId): Promise<void> => {
    if (identityId === activeIdentityRef.current && userRef.current) return
    if (!(await prepareSwitch())) return
    await login(identityId, activeOrgRef.current)
  }, [login, prepareSwitch])

  const switchOrg = useCallback(async (orgId: string): Promise<void> => {
    if (orgId === activeOrgRef.current || switching) return
    if (!(await prepareSwitch())) return
    const operation = ++operationRef.current
    setSwitching(true)
    setError('')
    try {
      const result = await api.auth.demoOrg(orgId)
      if (!mountedRef.current || operation !== operationRef.current) return
      applyScope(result)
    } catch (reason) {
      if (!mountedRef.current || operation !== operationRef.current) return
      setError(errorMessage(reason))
      throw reason
    } finally {
      if (mountedRef.current && operation === operationRef.current) setSwitching(false)
    }
  }, [applyScope, prepareSwitch, switching])

  const switchBase = useCallback(async (baseId: string): Promise<void> => {
    if (baseId === activeBaseRef.current || switching) return
    if (!(await prepareSwitch())) return
    const operation = ++operationRef.current
    setSwitching(true)
    setError('')
    try {
      const result = await api.auth.demoBase(baseId)
      if (!mountedRef.current || operation !== operationRef.current) return
      applyScope(result)
    } catch (reason) {
      if (!mountedRef.current || operation !== operationRef.current) return
      setError(errorMessage(reason))
      throw reason
    } finally {
      if (mountedRef.current && operation === operationRef.current) setSwitching(false)
    }
  }, [applyScope, prepareSwitch, switching])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  return (
    <AuthContext.Provider value={{
      user,
      identities,
      activeIdentity,
      orgs,
      activeOrg,
      bases,
      activeBase,
      loading,
      switching,
      error,
      contextVersion,
      switchIdentity,
      switchOrg,
      switchBase,
      refresh,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
