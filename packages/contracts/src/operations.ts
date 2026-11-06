import type { FormVersionSchema } from './form'
import type { TicketCatalog } from './work-order'

/** Shared, persisted scheduling and piecework workflow. Ratios use 1/10000. */
export interface OperationsPerson { id: string; name: string; employeeCode: string; crewIds: string[] }
export interface OperationsCrew { id: string; name: string; siteId: string; factoryId: string; canManage: boolean; canPlanMonth: boolean; qualificationId: string | null }
export interface OperationsOption { id: string; name: string }
export interface OperationsContext {
  today: string
  personId: string | null
  crews: OperationsCrew[]
  people: OperationsPerson[]
  shifts: Array<OperationsOption & { siteId: string; startTime: string; endTime: string; crossDay: boolean; revision: number; status: 'active' | 'inactive' }>
  posts: OperationsOption[]
  loadingTypes: OperationsOption[]
  materials: Array<OperationsOption & { materialTypeId: string; postIds: string[] }>
  ticketCatalog: TicketCatalog
  selfCreateTemplates: Array<OperationsOption & { code: string; formSchema: FormVersionSchema; sanitationKind: SanitationKind | null }>
}
export type SanitationKind = 'vehicle' | 'facility'
export interface RosterAssignment { personId: string; postId: string | null; personName?: string; postName?: string | null; temporary?: boolean; qualified?: boolean; homeCrewName?: string }
export interface OperationsRoster {
  id: string; workDate: string; shiftTemplateId: string; shiftName: string; crewId: string; crewName: string
  revision: number; source: 'monthly' | 'daily'; note: string; assignments: RosterAssignment[]; updatedAt: string
  attributionDate: string; shiftStartDate: string; shiftStartTime: string; shiftEndTime: string; crossDay: boolean
}
export interface SaveRosterInput {
  mode: 'monthly' | 'daily'
  records: Array<{ workDate: string; shiftTemplateId: string; crewId: string; revision: number; assignments: RosterAssignment[]; note?: string }>
}
export interface OperationsQuery { dateFrom?: string; dateTo?: string; crewId?: string; scope?: 'mine' | 'managed'; ticketTypeId?: string; status?: string; plateNumber?: string }
export interface OperationsAllocation {
  personId: string; personName: string; shareBasisPoints: number; quantity: number
  confirmedAt: string | null
}
export interface OperationsWorkItem {
  id: string; catalogId: string | null; name: string; unit: string; unitPriceMicros: number | null
  revision: number; assignments: OperationsAllocation[]
}
export interface OperationsTicket {
  id: string; ticketNo: string; title: string; businessKind: 'generic' | 'production' | 'loading'
  ticketTypeId: string; ticketTypeName: string; ticketCategoryName: string
  workDate: string; crewId: string | null; crewName: string; shiftTemplateId: string | null; shiftName: string
  status: string; completed: boolean; quantity: number | null; revision: number
  source: 'self' | 'demo_sync' | 'legacy'; sourceKey: string | null; createdByMe: boolean; canManage: boolean; canComplete: boolean
  values: Record<string, unknown>; subFormValues: Record<string, Array<Record<string, unknown>>>; formSchema: FormVersionSchema; workItems: OperationsWorkItem[]
  assignmentIssue: string | null; sanitation: SanitationDetail | null
}
export interface SanitationEvidence { id: string; pointKey: string; pointName: string; assetId: string; url: string; createdAt: string; operatorName: string }
export interface SanitationArea { key: 'production' | 'living' | 'office'; name: string; startedAt: string | null; startedByName: string; completedAt: string | null; completedByName: string }
export interface SanitationDetail {
  kind: SanitationKind; plateNumber: string | null; publishedAt: string; publishedByName: string; startedAt: string | null; startedByName: string; endedAt: string | null; endedByName: string
  dryingRequired: boolean | null; dryingStartedAt: string | null; dryingEndedAt: string | null; dryingMinutes: number | null
  evidence: SanitationEvidence[]; areas: SanitationArea[]
}
export interface WorkloadResult {
  tickets: OperationsTicket[]
  /** Production main-order quantity is counted once, separately from per-post piecework. */
  totals: { ticketCount: number; orderQuantity: number; personalQuantity: number; confirmedTicketCount: number }
}
export interface AdjustAssignmentsInput { revision: number; assignments: Array<{ personId: string; shareBasisPoints: number }>; reason: string }
export interface OperationsFeedback {
  id: string; ticketId: string; ticketNo: string; personId: string; personName: string; crewId: string | null
  message: string; status: 'open' | 'resolved'; response: string; createdAt: string; resolvedAt: string | null; revision: number
}
export interface SelfCreateInput {
  ticketTypeId: string; crewId: string; shiftTemplateId?: string | null; workDate: string
  values: Record<string, unknown>; subFormValues?: Record<string, Array<Record<string, unknown>>>; quantity?: number | null; clientRequestId: string
}
export interface CompleteSelfInput { revision: number; quantity: number; values: Record<string, unknown>; subFormValues?: Record<string, Array<Record<string, unknown>>> }
export interface DemoSyncInput {
  sourceKey: string; businessKind: 'production' | 'loading'; workDate: string; crewId: string; shiftTemplateId: string
  quantity: number; materialId?: string; loadingTypeId?: string
}
export interface AssignmentRule { siteId: string; ticketTypeId: string; ticketTypeName: string; crewId: string; crewName: string; revision: number }
export interface SanitationSummary { ticketId: string; ticketNo: string; workDate: string; kind: SanitationKind; status: string; plateNumber: string | null; assignmentIssue: string | null }
export interface RosterCandidate { personId: string; personName: string; employeeCode: string; homeCrewName: string; temporary: boolean; qualified: boolean; qualificationName: string }
export interface CreateSanitationInput { kind: SanitationKind; workDate: string; plateNumber?: string; clientRequestId: string }
export interface AddSanitationEvidenceInput { revision: number; pointKey: string; assetId: string }
export interface SanitationAreaInput { revision: number; areaKey: 'production' | 'living' | 'office' }
export interface CompleteSanitationInput { revision: number; dryingRequired?: boolean; dryingStartedAt?: string; dryingEndedAt?: string }
export interface WorkloadExport {
  generatedAt: string; simulated: true; totals: WorkloadResult['totals']
  rows: Array<{ ticketId: string; ticketNo: string; workDate: string; businessKind: string; crewId: string | null
    workItemId: string; workItemName: string; personId: string; personName: string; quantity: number; unit: string
    shareBasisPoints: number; confirmedAt: string | null; ticketRevision: number }>
}
