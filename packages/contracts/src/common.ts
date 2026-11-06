import { z } from 'zod'

export type Id = string

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().optional(),
  status: z.string().trim().optional(),
  companyId: z.string().trim().optional(),
  siteId: z.string().trim().optional(),
  factoryId: z.string().trim().optional(),
  crewId: z.string().trim().optional(),
  workAreaId: z.string().trim().optional(),
  sortBy: z.string().trim().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export type PageQuery = z.infer<typeof pageQuerySchema>

export interface PageMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PagedResult<T> {
  items: T[]
  meta: PageMeta
}

export const activeStatuses = ['active', 'inactive', 'archived'] as const
export type ActiveStatus = (typeof activeStatuses)[number]

export const scopeTypes = ['group', 'company', 'base', 'factory', 'work_area'] as const
export type ScopeType = (typeof scopeTypes)[number]

export interface ScopeRef {
  type: ScopeType
  id: Id
}

export interface AuditFields {
  createdAt: string
  createdBy: Id | null
  updatedAt: string
  updatedBy: Id | null
  revision: number
}

export interface ApiErrorBody {
  code: string
  message: string
  details?: unknown
  requestId: string
}

export interface ApiSuccess<T> {
  data: T
  meta?: PageMeta
  requestId: string
}

export interface ApiFailure {
  error: ApiErrorBody
}

export interface ApiError {
  code: string
  message: string
  status: number
  details?: unknown
}

export const apiErrorCodes = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONFLICT: 'CONFLICT',
  REFERENCE_CONFLICT: 'REFERENCE_CONFLICT',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  STATE_CONFLICT: 'STATE_CONFLICT',
  IMPORT_FAILED: 'IMPORT_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ApiErrorCode = (typeof apiErrorCodes)[keyof typeof apiErrorCodes]

export interface DateRange {
  start: string
  end: string
}

export interface SelectOption {
  label: string
  value: string
}

export function toPageMeta(total: number, page: number, pageSize: number): PageMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  }
}
