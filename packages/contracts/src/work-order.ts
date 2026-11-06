import { z } from 'zod'
import type { AuditFields, Id, PagedResult, ScopeType } from './common'
import type { FormValues, FormVersionSchema } from './form'

export const ticketStatuses = [
  'pending_assignment',
  'pending_start',
  'in_progress',
  'pending_data',
  'overdue',
  'completed',
  'closed',
  'cancelled',
] as const

export type TicketStatus = (typeof ticketStatuses)[number]

export interface TicketCategory extends AuditFields {
  id: Id
  code: string
  name: string
  ownerType: 'group' | 'company'
  ownerId: Id
  status: 'active' | 'inactive' | 'archived'
  locked: boolean
}

export interface TicketType extends AuditFields {
  id: Id
  code: string
  name: string
  categoryId: Id
  categoryName?: string
  ownerType: 'group' | 'company'
  ownerId: Id
  origin: 'group_standard' | 'local'
  status: 'draft' | 'published' | 'retired' | 'archived'
  locked: boolean
  currentVersionId: Id | null
  systemManaged: boolean
  businessKind: BusinessKind | null
}

export interface TicketCatalogItem extends TicketType {
  categoryCode: string
  categoryName: string
  sanitationKind: 'vehicle' | 'facility' | null
}

export interface TicketCatalogGroup extends AuditFields {
  id: Id
  code: string
  name: string
  ownerType: 'group' | 'company'
  ownerId: Id
  status: 'active' | 'inactive' | 'archived'
  locked: boolean
  types: TicketCatalogItem[]
}

export interface TicketCatalog {
  groups: TicketCatalogGroup[]
  types: TicketCatalogItem[]
}

export interface WorkProfile {
  id: Id
  ticketTypeVersionId: Id
  name: string
  siteId: Id
  factoryId: Id | null
  workAreaId: Id | null
  productionLineId: Id | null
  crewId: Id | null
  shiftTemplateId: Id | null
  generationMode: 'manual' | 'api' | 'schedule'
  handoverGrouping: 'none' | 'shift' | 'day'
  handoverRequired: boolean
  timeWindowStart: string | null
  timeWindowEnd: string | null
  earlyStartMinutes: number
  lateEndMinutes: number
  assignmentMode: 'roster_first' | 'qualification' | 'manual'
  status: 'draft' | 'published' | 'retired'
}

export interface TicketTypeVersion extends AuditFields {
  id: Id
  ticketTypeId: Id
  versionNo: number
  status: 'draft' | 'published' | 'retired'
  formVersionId: Id
  formSchema: FormVersionSchema
  workProfiles: WorkProfile[]
  publishedAt: string | null
  publishedBy: Id | null
}

export interface TicketTypeDetail extends TicketType {
  versions: TicketTypeVersion[]
}

export interface TicketAssignment {
  id: Id
  personId: Id
  personName: string
  role: 'lead' | 'member'
  assignmentSource: 'roster' | 'manual' | 'secondment'
  plannedQuantity: number | null
  actualQuantity: number | null
  personSnapshot: Record<string, unknown>
}

export type BusinessKind = 'generic' | 'production' | 'loading'
export type BusinessCatalogKind = 'material_type' | 'production_post' | 'loading_type'
export const businessTicketTypeIds = {
  production: 'type_builtin_production',
  loading: 'type_builtin_loading',
} as const

export interface BusinessCatalogItem extends AuditFields {
  id: Id
  kind: BusinessCatalogKind
  code: string
  name: string
  status: 'active' | 'inactive'
}

export interface Material extends AuditFields {
  id: Id
  code: string
  name: string
  abbr: string | null
  spec: string | null
  model: string | null
  materialTypeId: Id
  materialTypeName: string | null
  smallPack: boolean
  postCatalogIds: Id[]
  status: 'active' | 'inactive'
}

export interface SiteBusinessConfig {
  siteId: Id
  revision: number
  items: Array<{ catalogId: Id; kind: BusinessCatalogKind; enabled: boolean }>
}

export interface BusinessPriceRuleVersion {
  id: Id
  siteId: Id
  kind: 'production' | 'loading'
  catalogId: Id
  materialTypeId: Id | null
  versionNo: number
  unit: string
  unitPriceMicros: number
  effectiveFrom: string
  effectiveTo: string | null
  status: 'published' | 'retired'
}

export interface TicketBusinessWorkItem {
  id: Id
  kind: 'production_post' | 'loading_type'
  catalogId: Id
  priceRuleVersionId: Id | null
  name: string
  priceStatus: 'pending' | 'confirmed'
  unit: string
  unitPriceMicros: number | null
  amountMicros: number | null
  quantity: number | null
  assignments: Array<{
    assignmentId: Id
    personId: Id
    personName: string
    shareBasisPoints: number
    quantity: number | null
    amountMicros: number | null
  }>
}

export interface Ticket extends AuditFields {
  id: Id
  businessKind: BusinessKind
  materialId: Id | null
  materialName: string | null
  materialTypeId: Id | null
  materialTypeName: string | null
  businessWorkItems: TicketBusinessWorkItem[]
  ticketNo: string
  ticketTypeId: Id
  ticketTypeVersionId: Id
  formVersionId: Id
  siteId: Id
  siteName: string
  factoryId: Id | null
  factoryName: string | null
  workAreaId: Id | null
  productionLineId: Id | null
  crewId: Id | null
  shiftTemplateId: Id | null
  handoverShiftProfileId: Id | null
  status: TicketStatus
  workDate: string
  eventTime: string
  deadlineAt: string | null
  values: FormValues
  subFormValues: Record<string, Array<Record<string, unknown>>>
  assignments: TicketAssignment[]
  formSchema: FormVersionSchema
  ticketTypeSnapshot: Record<string, unknown>
  siteSnapshot: Record<string, unknown>
  priceSnapshot: Record<string, unknown>
  priceRuleVersionId: Id | null
  pricing: TicketPricing | null
  quantity: number | null
  amountMicros: number | null
}

export interface TicketPricing {
  status: 'pending' | 'confirmed'
  method: 'quantity_unit' | 'lump_sum' | null
  unit: string | null
  unitPriceMicros: number | null
  lumpSumCents: number | null
  sourcePriceId: Id | null
  revision: number
}

export interface PriceRuleVersion {
  id: Id
  ticketTypeId: Id
  siteId: Id
  versionNo: number
  unit: string
  unitPriceMicros: number
  effectiveFrom: string
  effectiveTo: string | null
  status: 'draft' | 'published' | 'retired'
}

export interface PayrollAccrual {
  id: Id
  ticketId: Id
  businessWorkItemId: Id | null
  personId: Id
  workSiteId: Id
  priceRuleVersionId: Id | null
  quantity: number | null
  amountMicros: number
  workMonth: string
  payrollCompanyId: Id | null
  settlementStatus: 'open' | 'locked' | 'adjusted'
}

export interface PayrollConfirmCandidate {
  personId: Id
  personName: string
  ticketIds: Id[]
  ticketStatuses: TicketStatus[]
  payrollCompanyId: Id | null
}

export interface PayrollPeriod {
  id: Id
  workMonth: string
  status: 'open' | 'closing' | 'closed' | 'reopened'
  closedAt: string | null
  closedBy: Id | null
  revision: number
}

export interface AuditLogEntry {
  id: Id
  accountId: Id | null
  accountName: string | null
  action: string
  entityType: string
  entityId: Id
  scopeType: ScopeType | null
  scopeId: Id | null
  before: unknown
  after: unknown
  ipAddress: string
  createdAt: string
}

export interface PayrollSummary {
  workMonth: string
  payrollCompanyId: Id
  personCount: number
  ticketCount: number
  amountMicros: number
  items: PayrollAccrual[]
}

export interface TicketSearchResult extends PagedResult<Ticket> {
  counts: Record<TicketStatus | 'all', number>
}

export const ticketTypeSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(100),
  categoryId: z.string().min(1),
  ownerType: z.enum(['group', 'company']),
  ownerId: z.string().min(1),
  formTemplateId: z.string().min(1),
  revision: z.number().int().nonnegative().optional(),
})

export const workProfileSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().max(100).default(''),
  siteId: z.string().min(1),
  factoryId: z.string().nullable().default(null),
  workAreaId: z.string().nullable().default(null),
  productionLineId: z.string().nullable().default(null),
  crewId: z.string().nullable().default(null),
  shiftTemplateId: z.string().nullable().default(null),
  generationMode: z.enum(['manual', 'api', 'schedule']).default('manual'),
  handoverGrouping: z.enum(['none', 'shift', 'day']).default('shift'),
  handoverRequired: z.boolean().default(true),
  timeWindowStart: z.string().nullable().default(null),
  timeWindowEnd: z.string().nullable().default(null),
  earlyStartMinutes: z.number().int().nonnegative().default(0),
  lateEndMinutes: z.number().int().nonnegative().default(0),
  assignmentMode: z.enum(['roster_first', 'qualification', 'manual']).default('roster_first'),
})

export const ticketCreateSchema = z.object({
  ticketTypeId: z.string().min(1),
  businessKind: z.enum(['generic', 'production', 'loading']).default('generic'),
  materialId: z.string().nullable().default(null),
  materialTypeId: z.string().nullable().default(null),
  businessItems: z.array(z.object({
    catalogId: z.string().min(1),
    kind: z.enum(['production_post', 'loading_type']),
  })).max(30).default([]),
  siteId: z.string().min(1),
  factoryId: z.string().nullable().default(null),
  workAreaId: z.string().nullable().default(null),
  productionLineId: z.string().nullable().default(null),
  crewId: z.string().nullable().default(null),
  shiftTemplateId: z.string().nullable().default(null),
  eventTime: z.string().min(16),
  workDate: z.string().min(10),
  assignments: z.array(z.object({
    personId: z.string().min(1),
    role: z.enum(['lead', 'member']).default('member'),
  })).default([]),
  handoverShiftProfileId: z.string().nullable().default(null),
})

export const ticketValuesSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  subFormValues: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
  assignmentQuantities: z.record(z.string(), z.number().nonnegative()).optional(),
  revision: z.number().int().nonnegative().optional(),
})

export type TicketCreateInput = z.infer<typeof ticketCreateSchema>
export type TicketValuesInput = z.infer<typeof ticketValuesSchema>

export interface ScopeDescriptor {
  type: ScopeType
  id: Id
}
