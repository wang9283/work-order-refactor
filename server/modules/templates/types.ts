import type {
  FormTemplate,
  FormVersion,
  TicketType,
  TicketTypeVersion,
  WorkProfile,
} from '../../../packages/contracts/src'

export interface FormTemplateRow {
  id: string
  code: string
  name: string
  owner_type: 'group' | 'company'
  owner_id: string
  source: 'native' | 'excel'
  locked: number
  current_published_version_id: string | null
  revision: number
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

export interface FormVersionRow {
  id: string
  template_id: string
  version_no: number
  status: 'draft' | 'published' | 'retired'
  schema_json: string
  published_at: string | null
  published_by: string | null
  revision: number
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

export interface TicketTypeRow {
  id: string
  code: string
  name: string
  category_id: string
  owner_type: 'group' | 'company'
  owner_id: string
  origin: 'group_standard' | 'local'
  status: 'draft' | 'published' | 'retired' | 'archived'
  locked: number
  current_version_id: string | null
  revision: number
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
  system_managed: number
  business_kind: 'production' | 'loading' | null
}

export interface TicketCategoryRow {
  id: string
  code: string
  name: string
  owner_type: 'group' | 'company'
  owner_id: string
  status: 'active' | 'inactive' | 'archived'
  locked: number
  revision: number
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

export interface TicketTypeVersionRow {
  id: string
  ticket_type_id: string
  version_no: number
  status: 'draft' | 'published' | 'retired'
  form_version_id: string
  published_at: string | null
  published_by: string | null
  revision: number
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

export interface WorkProfileRow {
  id: string
  ticket_type_version_id: string
  name: string
  site_id: string
  factory_id: string | null
  work_area_id: string | null
  production_line_id: string | null
  crew_id: string | null
  shift_template_id: string | null
  generation_mode: 'manual' | 'api' | 'schedule'
  handover_grouping: 'none' | 'shift' | 'day'
  handover_required: number
  time_window_start: string | null
  time_window_end: string | null
  early_start_minutes: number
  late_end_minutes: number
  assignment_mode: 'roster_first' | 'qualification' | 'manual'
  status: 'draft' | 'published' | 'retired'
  created_at: string
  updated_at: string
}

export interface FormTemplateDetail extends FormTemplate {
  versions: FormVersion[]
}

export interface TicketTypeDetail extends TicketType {
  canEdit: boolean
  versions: TicketTypeVersion[]
}

export function mapFormTemplate(row: FormTemplateRow): FormTemplate {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    source: row.source,
    locked: row.locked === 1,
    currentPublishedVersionId: row.current_published_version_id,
    revision: row.revision,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export function mapFormVersion(row: FormVersionRow): FormVersion {
  return {
    id: row.id,
    templateId: row.template_id,
    versionNo: row.version_no,
    status: row.status,
    schema: JSON.parse(row.schema_json),
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    revision: row.revision,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export function mapTicketType(row: TicketTypeRow): TicketType {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    categoryId: row.category_id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    origin: row.origin,
    status: row.status,
    locked: row.locked === 1,
    currentVersionId: row.current_version_id,
    systemManaged: row.system_managed === 1,
    businessKind: row.business_kind ?? null,
    revision: row.revision,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export function mapTicketCategory(row: TicketCategoryRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    status: row.status,
    locked: row.locked === 1,
    revision: row.revision,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

export function mapWorkProfile(row: WorkProfileRow): WorkProfile {
  return {
    id: row.id,
    ticketTypeVersionId: row.ticket_type_version_id,
    name: row.name,
    siteId: row.site_id,
    factoryId: row.factory_id,
    workAreaId: row.work_area_id,
    productionLineId: row.production_line_id,
    crewId: row.crew_id,
    shiftTemplateId: row.shift_template_id,
    generationMode: row.generation_mode,
    handoverGrouping: row.handover_grouping,
    handoverRequired: row.handover_required === 1,
    timeWindowStart: row.time_window_start,
    timeWindowEnd: row.time_window_end,
    earlyStartMinutes: row.early_start_minutes,
    lateEndMinutes: row.late_end_minutes,
    assignmentMode: row.assignment_mode,
    status: row.status,
  }
}

export function mapTicketTypeVersion(row: TicketTypeVersionRow, workProfiles: WorkProfile[]): TicketTypeVersion {
  return {
    id: row.id,
    ticketTypeId: row.ticket_type_id,
    versionNo: row.version_no,
    status: row.status,
    formVersionId: row.form_version_id,
    formSchema: { mainFields: [], subForms: [], conditionRules: [] },
    workProfiles,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    revision: row.revision,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}
