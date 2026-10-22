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
}

export interface TicketType extends AuditFields {
  id: Id
  code: string
  name: string
  categoryId: Id
  ownerType: 'group' | 'company'
  ownerId: Id
  origin: 'group_standard' | 'local'
  status: 'draft' | 'published' | 'retired' | 'archived'
  currentVersionId: Id | null
}

export interface WorkProfile {
  id: Id
  ticketTypeVersionId: Id
  siteId: Id
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
}

export interface Ticket extends AuditFields {
  id: Id
  ticketNo: string
  ticketTypeId: Id
  ticketTypeVersionId: Id
  formVersionId: Id
  siteId: Id
  siteName: string
  workAreaId: Id | null
  productionLineId: Id | null
  crewId: Id | null
  shiftTemplateId: Id | null
  status: TicketStatus
  workDate: string
  eventTime: string
  deadlineAt: string | null
  values: FormValues
  subFormValues: Record<string, Array<Record<string, unknown>>>
  assignments: TicketAssignment[]
  priceRuleVersionId: Id | null
  quantity: number | null
  amountMicros: number | null
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
  personId: Id
  workSiteId: Id
  priceRuleVersionId: Id
  quantity: number
  amountMicros: number
  workMonth: string
  payrollCompanyId: Id | null
  settlementStatus: 'open' | 'locked' | 'adjusted'
}

export interface PayrollPeriod {
  id: Id
  workMonth: string
  status: 'open' | 'closing' | 'closed' | 'reopened'
  closedAt: string | null
  closedBy: Id | null
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
  siteId: z.string().min(1),
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
  siteId: z.string().min(1),
  workAreaId: z.string().nullable().default(null),
  productionLineId: z.string().nullable().default(null),
  eventTime: z.string().min(16),
  workDate: z.string().min(10),
  assignments: z.array(z.object({
    personId: z.string().min(1),
    role: z.enum(['lead', 'member']).default('member'),
  })).default([]),
})

export const ticketValuesSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  subFormValues: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
  revision: z.number().int().nonnegative().optional(),
})

export type TicketCreateInput = z.infer<typeof ticketCreateSchema>
export type TicketValuesInput = z.infer<typeof ticketValuesSchema>

export interface ScopeDescriptor {
  type: ScopeType
  id: Id
}
