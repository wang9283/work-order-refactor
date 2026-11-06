import type {
  PayrollAccrual,
  PayrollPeriod,
  PriceRuleVersion,
  Ticket,
  TicketAssignment,
  TicketStatus,
} from '../../../packages/contracts/src'

export interface TicketRow {
  id: string
  business_kind?: 'generic' | 'production' | 'loading'
  material_type_id?: string | null
  material_type_name_snapshot?: string | null
  material_id?: string | null
  material_name_snapshot?: string | null
  business_config_snapshot_json?: string
  ticket_no: string
  ticket_type_id: string
  ticket_type_version_id: string
  form_version_id: string
  site_id: string
  site_name: string
  factory_name: string | null
  factory_id: string | null
  work_area_id: string | null
  production_line_id: string | null
  crew_id: string | null
  shift_template_id: string | null
  handover_shift_profile_id: string | null
  status: TicketStatus
  work_date: string
  event_time: string
  deadline_at: string | null
  values_json: string
  sub_form_values_json: string
  ticket_type_snapshot_json?: string
  form_snapshot_json?: string
  site_snapshot_json?: string
  price_snapshot_json?: string
  price_rule_version_id: string | null
  quantity: number | null
  amount_micros: number | null
  revision: number
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

export interface AssignmentRow {
  id: string
  ticket_id: string
  person_id: string
  person_name: string
  role: 'lead' | 'member'
  assignment_source: 'roster' | 'manual' | 'secondment'
  planned_quantity: number | null
  actual_quantity: number | null
  person_snapshot_json?: string
}

export interface PriceRuleRow {
  id: string
  ticket_type_id: string
  site_id: string
  version_no: number
  unit: string
  unit_price_micros: number
  effective_from: string
  effective_to: string | null
  status: 'draft' | 'published' | 'retired'
}

export interface AccrualRow {
  id: string
  ticket_id: string
  business_work_item_id?: string | null
  person_id: string
  work_site_id: string
  price_rule_version_id: string | null
  quantity: number | null
  amount_micros: number
  work_month: string
  payroll_company_id: string | null
  settlement_status: 'open' | 'locked' | 'adjusted'
  revision: number
  adjustment_of_id: string | null
  adjustment_reason: string | null
  created_at: string
  updated_at: string
}

export interface PayrollPeriodRow {
  id: string
  work_month: string
  status: 'open' | 'closing' | 'closed' | 'reopened'
  closed_at: string | null
  closed_by: string | null
  revision: number
  created_at: string
  updated_at: string
}

export interface FormVersionRow {
  id: string
  template_id: string
  version_no: number
  status: 'draft' | 'published' | 'retired'
  schema_json: string
}

export interface TicketTypeVersionRow {
  id: string
  ticket_type_id: string
  version_no: number
  status: 'draft' | 'published' | 'retired'
  form_version_id: string
}

export interface CandidateRow {
  person_id: string
  person_name: string
  crew_id: string
  crew_name: string
  membership_role: 'leader' | 'operator' | 'support'
  assignment_source: 'roster' | 'secondment' | 'manual'
}

export function mapAssignment(row: AssignmentRow): TicketAssignment {
  return {
    id: row.id,
    personId: row.person_id,
    personName: row.person_name,
    role: row.role,
    assignmentSource: row.assignment_source,
    plannedQuantity: row.planned_quantity,
    actualQuantity: row.actual_quantity,
    personSnapshot: JSON.parse(row.person_snapshot_json || '{}'),
  }
}

export function mapTicket(row: TicketRow, assignments: TicketAssignment[]): Ticket {
  return {
    id: row.id,
    businessKind: row.business_kind ?? 'generic',
    materialTypeId: row.material_type_id ?? null,
    materialTypeName: row.material_type_name_snapshot ?? null,
    materialId: row.material_id ?? null,
    materialName: row.material_name_snapshot ?? null,
    businessWorkItems: [],
    ticketNo: row.ticket_no,
    ticketTypeId: row.ticket_type_id,
    ticketTypeVersionId: row.ticket_type_version_id,
    formVersionId: row.form_version_id,
    siteId: row.site_id,
    siteName: row.site_name,
    factoryId: row.factory_id,
    factoryName: row.factory_name,
    workAreaId: row.work_area_id,
    productionLineId: row.production_line_id,
    crewId: row.crew_id,
    shiftTemplateId: row.shift_template_id,
    handoverShiftProfileId: row.handover_shift_profile_id,
    status: row.status,
    workDate: row.work_date,
    eventTime: row.event_time,
    deadlineAt: row.deadline_at,
    values: JSON.parse(row.values_json),
    subFormValues: JSON.parse(row.sub_form_values_json),
    assignments,
    formSchema: JSON.parse(row.form_snapshot_json || '{"mainFields":[],"subForms":[],"conditionRules":[]}'),
    ticketTypeSnapshot: JSON.parse(row.ticket_type_snapshot_json || '{}'),
    siteSnapshot: JSON.parse(row.site_snapshot_json || '{}'),
    priceSnapshot: JSON.parse(row.price_snapshot_json || '{}'),
    priceRuleVersionId: row.price_rule_version_id,
    pricing: null,
    quantity: row.quantity,
    amountMicros: row.amount_micros,
    revision: row.revision,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export function mapPriceRule(row: PriceRuleRow): PriceRuleVersion {
  return {
    id: row.id,
    ticketTypeId: row.ticket_type_id,
    siteId: row.site_id,
    versionNo: row.version_no,
    unit: row.unit,
    unitPriceMicros: row.unit_price_micros,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    status: row.status,
  }
}

export function mapAccrual(row: AccrualRow): PayrollAccrual & {
  adjustmentOfId: string | null
  adjustmentReason: string | null
} {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    businessWorkItemId: row.business_work_item_id ?? null,
    personId: row.person_id,
    workSiteId: row.work_site_id,
    priceRuleVersionId: row.price_rule_version_id,
    quantity: row.quantity,
    amountMicros: row.amount_micros,
    workMonth: row.work_month,
    payrollCompanyId: row.payroll_company_id,
    settlementStatus: row.settlement_status,
    adjustmentOfId: row.adjustment_of_id,
    adjustmentReason: row.adjustment_reason,
  }
}

export function mapPeriod(row: PayrollPeriodRow): PayrollPeriod {
  return {
    id: row.id,
    workMonth: row.work_month,
    status: row.status,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    revision: row.revision,
  }
}
