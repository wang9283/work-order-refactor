import type {
  BusinessKind,
  FormVersionSchema,
  PageQuery,
  PayrollAccrual,
  PayrollConfirmCandidate,
  PayrollPeriod,
  PagedResult,
  PriceRuleVersion,
  ScopeRef,
  Ticket,
  TicketAssignment,
  TicketStatus,
  TicketType,
} from '../../../packages/contracts/src'
import { toPageMeta } from '../../../packages/contracts/src'
import { writeAudit } from '../../core/audit'
import { AppError } from '../../core/errors'
import { requireScopedBase, requireScopedFactory, scopedBaseId, scopedFactoryId, withinScopedBase, withinScopedFactory } from '../../core/base-scope'
import { all, newId, nowIso, one, run, transaction } from '../../db/database'
import { SqlitePriceContext, SqliteRosterContext, SqliteTicketContext } from './adapters'
import { validateFrozenForm } from './form-validator'
import { splitLumpSum } from './settlement-calculation'
import {
  businessWorkItemShareTotals,
  createBusinessWorkItems,
  listBusinessWorkItems,
  resolveProductionMaterialScope,
  setBusinessWorkItemAssignments,
  setBusinessWorkItemPriceSnapshot,
} from '../business/service'
import type { AccrualRow, PriceRuleRow, TicketRow } from './types'
import type { CandidateResolution } from './ports'

type SqlValue = string | number | null
type IdRow = { id: string }
type RevisionRow = { revision: number }
type AuditAuth = {
  accountId: string
  ipAddress: string
  grants: Array<{ capability: string; type: string; id: string }>
  demoIdentityId?: string | null
  selectedBaseId?: string | null
}
type ScopeGrant = AuditAuth['grants'][number]
type TicketScopeAuth = {
  demoIdentityId?: string | null
  selectedBaseId?: string | null
}

const ticketContext = new SqliteTicketContext()
const rosterContext = new SqliteRosterContext()
const priceContext = new SqlitePriceContext()

const transitions: Record<TicketStatus, TicketStatus[]> = {
  pending_assignment: ['pending_start', 'cancelled'],
  pending_start: ['in_progress', 'pending_assignment', 'cancelled'],
  in_progress: ['pending_data', 'completed', 'cancelled'],
  pending_data: ['in_progress', 'completed', 'cancelled'],
  overdue: ['pending_data', 'completed', 'cancelled'],
  completed: ['closed'],
  closed: [],
  cancelled: [],
}

export interface TicketListFilter {
  page: number
  pageSize: number
  q?: string
  status?: TicketStatus
  siteId?: string
  factoryId?: string
  workAreaId?: string
  statusGroup?: 'all' | 'todo' | 'doing' | 'waiting' | 'done'
  workDateFrom?: string
  workDateTo?: string
  personId?: string
  ticketTypeId?: string
  ticketCategoryId?: string
  materialId?: string
  materialTypeId?: string
  productionPostId?: string
  productionLineId?: string
  loadingTypeId?: string
  plateNumber?: string
  crewId?: string
  shiftTemplateId?: string
  source?: 'self' | 'demo_sync' | 'legacy'
}

function pageResult<T>(items: T[], query: { page: number; pageSize: number }): PagedResult<T> {
  return {
    items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    meta: toPageMeta(items.length, query.page, query.pageSize),
  }
}

function requireRevision(row: RevisionRow, revision: number, entity: string): void {
  if (row.revision !== revision) throw AppError.revisionConflict()
  void entity
}

function getAssignments(ticketId: string): TicketAssignment[] {
  const row = one<{ assignments_json: string }>(
    `SELECT json_group_array(json_object(
       'id', ta.id,
       'personId', ta.person_id,
       'personName', COALESCE(NULLIF(ta.person_name_snapshot, ''), p.name),
       'personSnapshot', json(CASE WHEN json_valid(ta.person_snapshot_json) THEN ta.person_snapshot_json ELSE '{}' END),
       'role', ta.role,
       'assignmentSource', ta.assignment_source,
       'plannedQuantity', ta.planned_quantity,
       'actualQuantity', ta.actual_quantity
     )) AS assignments_json
     FROM ticket_assignments ta
     JOIN people p ON p.id = ta.person_id
     WHERE ta.ticket_id = ?`,
    [ticketId],
  )
  return row?.assignments_json ? JSON.parse(row.assignments_json) as TicketAssignment[] : []
}

function mapTicket(row: TicketRow): Ticket {
  const siteSnapshot = JSON.parse(row.site_snapshot_json || '{}') as Record<string, unknown>
  const priceSnapshot = JSON.parse(row.price_snapshot_json || '{}') as Record<string, unknown>
  const pricing = one<{ status: 'pending' | 'confirmed'; method: 'quantity_unit' | 'lump_sum' | null; unit: string | null; unitPriceMicros: number | null; lumpSumCents: number | null; sourcePriceId: string | null; revision: number }>(
    `SELECT status, method, unit, unit_price_micros AS unitPriceMicros, lump_sum_cents AS lumpSumCents,
      source_price_id AS sourcePriceId, revision FROM ticket_pricing WHERE ticket_id = ?`, [row.id],
  )
  return {
    id: row.id,
    businessKind: row.business_kind || 'generic',
    materialTypeId: row.material_type_id ?? null,
    materialTypeName: row.material_type_name_snapshot ?? null,
    materialId: row.material_id ?? null,
    materialName: row.material_name_snapshot ?? null,
    businessWorkItems: listBusinessWorkItems(row.id, row.quantity),
    ticketNo: row.ticket_no,
    ticketTypeId: row.ticket_type_id,
    ticketTypeVersionId: row.ticket_type_version_id,
    formVersionId: row.form_version_id,
    siteId: row.site_id,
    siteName: String(siteSnapshot.siteName || row.site_name),
    factoryId: row.factory_id,
    factoryName: typeof siteSnapshot.factoryName === 'string' ? siteSnapshot.factoryName : row.factory_name,
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
    assignments: getAssignments(row.id),
    formSchema: JSON.parse(row.form_snapshot_json || '{"mainFields":[],"subForms":[],"conditionRules":[]}'),
    ticketTypeSnapshot: JSON.parse(row.ticket_type_snapshot_json || '{}'),
    siteSnapshot,
    priceSnapshot,
    priceRuleVersionId: row.price_rule_version_id,
    pricing: pricing ?? (typeof priceSnapshot.unitPriceMicros === 'number' && typeof priceSnapshot.unit === 'string'
      ? { status: 'confirmed', method: 'quantity_unit', unit: priceSnapshot.unit,
          unitPriceMicros: priceSnapshot.unitPriceMicros, lumpSumCents: null,
          sourcePriceId: row.price_rule_version_id, revision: 1 }
      : null),
    quantity: row.quantity,
    amountMicros: row.amount_micros,
    revision: row.revision,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

function ticketRow(id: string): TicketRow
function ticketRow(auth: TicketScopeAuth, id: string): TicketRow
function ticketRow(authOrId: TicketScopeAuth | string, id?: string): TicketRow {
  const ticketId = typeof authOrId === 'string' ? authOrId : id
  if (!ticketId) throw AppError.notFound('工单')
  const row = one<TicketRow>(
    `SELECT t.*, b.name AS site_name, f.name AS factory_name
     FROM tickets t
     JOIN production_bases b ON b.id = t.site_id
     LEFT JOIN factories f ON f.id = t.factory_id
     WHERE t.id = ?`,
    [ticketId],
  )
  if (!row) throw AppError.notFound('工单')
  if (typeof authOrId !== 'string') {
    requireScopedBase(authOrId, row.site_id)
    requireScopedFactory(authOrId, row.factory_id)
  }
  return row
}

function canAccessSite(
  grants: Array<{ capability: string; type: string; id: string }>,
  capability: string,
  siteId: string,
): boolean {
  const base = one<{ company_id: string }>('SELECT company_id FROM production_bases WHERE id = ?', [siteId])
  if (!base) return false
  return grants.some((grant) => {
    if (grant.capability !== capability) return false
    if (grant.type === 'group') return true
    if (grant.type === 'base') return grant.id === siteId
    if (grant.type === 'factory') {
      const factory = one<{ base_id: string }>('SELECT base_id FROM factories WHERE id = ?', [grant.id])
      return factory?.base_id === siteId
    }
    if (grant.type === 'company') return grant.id === base.company_id
    const area = one<{ base_id: string }>('SELECT base_id FROM work_areas WHERE id = ?', [grant.id])
    return area?.base_id === siteId
  })
}

function canAccessFactoryScope(
  grants: Array<{ capability: string; type: string; id: string }>,
  capability: string,
  siteId: string,
  factoryId: string | null,
): boolean {
  if (!canAccessSite(grants, capability, siteId)) return false
  const base = one<{ company_id: string }>('SELECT company_id FROM production_bases WHERE id = ?', [siteId])
  return grants.some((grant) => grant.capability === capability && (
    grant.type === 'group'
    || (grant.type === 'company' && grant.id === base?.company_id)
    || (grant.type === 'base' && grant.id === siteId)
    || (grant.type === 'factory' && Boolean(factoryId) && grant.id === factoryId)
  ))
}

export function listTickets(
  auth: {
    personId: string | null
    grants: Array<{ capability: string; type: string; id: string }>
    demoIdentityId?: string | null
    selectedBaseId?: string | null
  },
  query: TicketListFilter,
): PagedResult<Ticket> & { counts: Record<string, number> } {
  const rows = one<{ rows_json: string }>(
    `SELECT json_group_array(json_object(
       'id', t.id, 'ticket_no', t.ticket_no, 'ticket_type_id', t.ticket_type_id,
       'business_kind', t.business_kind, 'material_type_id', t.material_type_id,
       'material_type_name_snapshot', t.material_type_name_snapshot,
       'material_id', t.material_id, 'material_name_snapshot', t.material_name_snapshot,
       'business_config_snapshot_json', t.business_config_snapshot_json,
       'ticket_type_version_id', t.ticket_type_version_id, 'form_version_id', t.form_version_id,
       'site_id', t.site_id, 'site_name', b.name,
       'factory_id', t.factory_id, 'factory_name', f.name, 'work_area_id', t.work_area_id,
       'production_line_id', t.production_line_id, 'crew_id', t.crew_id,
       'shift_template_id', t.shift_template_id,
       'handover_shift_profile_id', t.handover_shift_profile_id, 'status', t.status,
       'work_date', t.work_date, 'event_time', t.event_time, 'deadline_at', t.deadline_at,
       'values_json', t.values_json, 'sub_form_values_json', t.sub_form_values_json,
       'ticket_type_snapshot_json', t.ticket_type_snapshot_json,
       'form_snapshot_json', t.form_snapshot_json,
       'site_snapshot_json', t.site_snapshot_json,
       'price_snapshot_json', t.price_snapshot_json,
       'price_rule_version_id', t.price_rule_version_id, 'quantity', t.quantity,
       'amount_micros', t.amount_micros, 'revision', t.revision,
       'created_at', t.created_at, 'created_by', t.created_by,
       'updated_at', t.updated_at, 'updated_by', t.updated_by
     )) AS rows_json
     FROM tickets t
     JOIN production_bases b ON b.id = t.site_id
     LEFT JOIN factories f ON f.id = t.factory_id
     ORDER BY t.event_time DESC`,
  )
  const allRows = rows?.rows_json ? JSON.parse(rows.rows_json) as TicketRow[] : []
  const typeCategories = new Map(
    all<{ id: string; category_id: string }>('SELECT id, category_id FROM ticket_types')
      .map((type) => [type.id, type.category_id]),
  )
  const visible = allRows.filter((row) => {
    if (!withinScopedBase(auth, row.site_id)) return false
    if (!withinScopedFactory(auth, row.factory_id)) return false
    if (!canAccessFactoryScope(auth.grants, 'ticket.view', row.site_id, row.factory_id)) return false
    if (auth.personId && !canAccessFactoryScope(auth.grants, 'ticket.assign', row.site_id, row.factory_id)) {
      return getAssignments(row.id).some((assignment) => assignment.personId === auth.personId)
    }
    return true
  })
  const hasWorkItem = (ticketId: string, catalogId: string) => Boolean(one<IdRow>(
    'SELECT id FROM ticket_business_work_items WHERE ticket_id = ? AND catalog_id = ? LIMIT 1',
    [ticketId, catalogId],
  ))
  const sourceOf = (ticketId: string) => one<{ source: 'self' | 'demo_sync'; source_key: string | null }>(
    'SELECT source, source_key FROM operations_ticket_sources WHERE ticket_id = ?',
    [ticketId],
  )
  const filtered = visible.filter((row) => {
    if (query.status && row.status !== query.status) return false
    if (query.siteId && row.site_id !== query.siteId) return false
    if (query.factoryId && row.factory_id !== query.factoryId) return false
    if (query.workAreaId && row.work_area_id !== query.workAreaId) return false
    if (query.ticketTypeId && row.ticket_type_id !== query.ticketTypeId) return false
    if (query.ticketCategoryId && typeCategories.get(row.ticket_type_id) !== query.ticketCategoryId) return false
    if (query.materialId && row.material_id !== query.materialId) return false
    if (query.materialTypeId && row.material_type_id !== query.materialTypeId) return false
    if (query.productionLineId && row.production_line_id !== query.productionLineId) return false
    if (query.crewId && row.crew_id !== query.crewId) return false
    if (query.shiftTemplateId && row.shift_template_id !== query.shiftTemplateId) return false
    if (query.productionPostId && !hasWorkItem(row.id, query.productionPostId)) return false
    if (query.loadingTypeId && !hasWorkItem(row.id, query.loadingTypeId)) return false
    if (query.plateNumber && !one<{ ticket_id: string }>(
      'SELECT ticket_id FROM operations_sanitation WHERE ticket_id = ? AND plate_number LIKE ? LIMIT 1',
      [row.id, `%${query.plateNumber}%`],
    )) return false
    const source = sourceOf(row.id)
    if (query.source) {
      const sourceValue = source?.source || 'legacy'
      if (sourceValue !== query.source) return false
    }
    if (query.workDateFrom && row.work_date < query.workDateFrom) return false
    if (query.workDateTo && row.work_date > query.workDateTo) return false
    if (query.q) {
      const keyword = query.q.toLowerCase()
      if (!row.ticket_no.toLowerCase().includes(keyword)
        && !(source?.source_key || '').toLowerCase().includes(keyword)) return false
    }
    if (query.personId && !getAssignments(row.id).some((item) => item.personId === query.personId)) return false
    if (query.statusGroup === 'todo' && !['pending_assignment', 'pending_start'].includes(row.status)) return false
    if (query.statusGroup === 'doing' && !['in_progress', 'pending_data', 'overdue'].includes(row.status)) return false
    if (query.statusGroup === 'waiting' && row.status !== 'completed') return false
    if (query.statusGroup === 'done' && !['closed', 'cancelled'].includes(row.status)) return false
    return true
  })
  const counts: Record<string, number> = { all: filtered.length }
  for (const status of [
    'pending_assignment', 'pending_start', 'in_progress', 'pending_data',
    'overdue', 'completed', 'closed', 'cancelled',
  ]) counts[status] = filtered.filter((row) => row.status === status).length
  const mapped = filtered.map(mapTicket)
  return { ...pageResult(mapped, query), counts }
}

export function readTicket(auth: {
  personId: string | null
  grants: Array<{ capability: string; type: string; id: string }>
  demoIdentityId?: string | null
  selectedBaseId?: string | null
}, id: string): Ticket {
  const row = ticketRow(auth, id)
  if (!canAccessFactoryScope(auth.grants, 'ticket.view', row.site_id, row.factory_id)) throw AppError.forbidden()
  if (auth.personId && !canAccessFactoryScope(auth.grants, 'ticket.assign', row.site_id, row.factory_id)) {
    const assigned = getAssignments(id).some((assignment) => assignment.personId === auth.personId)
    if (!assigned) throw AppError.forbidden()
  }
  return mapTicket(row)
}

export interface CreateTicketInput {
  ticketTypeId: string
  businessKind?: BusinessKind
  materialId?: string | null
  materialTypeId?: string | null
  businessItems?: Array<{ catalogId: string; kind: 'production_post' | 'loading_type' }>
  siteId: string
  factoryId: string | null
  workAreaId: string | null
  productionLineId: string | null
  crewId: string | null
  shiftTemplateId: string | null
  eventTime: string
  workDate: string
  assignments: Array<{ personId: string; role: 'lead' | 'member' }>
  quantity: number | null
  clientRequestId?: string
  handoverShiftProfileId?: string | null
}

function assertCrewLocation(crewId: string, workAreaId: string | null, productionLineId: string | null): void {
  if (!workAreaId && !productionLineId) return
  const lineArea = productionLineId ? one<{ work_area_id: string }>(
    'SELECT work_area_id FROM production_lines WHERE id = ? AND status = ?', [productionLineId, 'active'],
  )?.work_area_id : undefined
  if (productionLineId && !lineArea) throw AppError.badRequest('产线不存在或未启用')
  if (lineArea && workAreaId && lineArea !== workAreaId) throw AppError.badRequest('产线不属于所选工区')
  const effectiveArea = workAreaId || lineArea || null
  const scopes = all<{ work_area_id: string | null; production_line_id: string | null }>(
    'SELECT work_area_id, production_line_id FROM crew_scopes WHERE crew_id = ?', [crewId])
  const ancestors = new Set(effectiveArea ? all<{id:string}>(`WITH RECURSIVE path AS (SELECT id,parent_id FROM work_areas WHERE id=? UNION ALL SELECT a.id,a.parent_id FROM work_areas a JOIN path p ON a.id=p.parent_id) SELECT id FROM path`,[effectiveArea]).map(a=>a.id) : [])
  if (scopes.length && !scopes.some((scope) =>
    (scope.work_area_id && ancestors.has(scope.work_area_id))
    || (scope.production_line_id && scope.production_line_id === productionLineId),
  )) throw AppError.badRequest('所选工区或产线不在班组适用范围内')
}

function assignmentSnapshot(candidate: CandidateResolution, siteId: string, factoryId: string | null, date: string) {
  const personFactory = one<{ factory_id: string | null }>('SELECT factory_id FROM people WHERE id = ?', [candidate.person.id])?.factory_id ?? null
  const secondment = candidate.source === 'secondment' ? one<{ id: string; start_date: string; end_date: string }>(
    `SELECT id, start_date, end_date FROM secondments WHERE person_id = ? AND to_base_id = ? AND to_factory_id = ?
      AND status IN ('planned', 'active') AND start_date <= ? AND end_date >= ? ORDER BY start_date DESC LIMIT 1`,
    [candidate.person.id, siteId, factoryId, date, date],
  ) : undefined
  return { ...candidate.person, factoryId: personFactory, crewId: candidate.crewId, crewName: candidate.crewName,
    source: candidate.source, secondmentId: secondment?.id ?? null, secondmentStartDate: secondment?.start_date ?? null, secondmentEndDate: secondment?.end_date ?? null }
}

export function createTicket(
  auth: AuditAuth,
  input: CreateTicketInput,
): Ticket {
  requireScopedBase(auth, input.siteId)
  // Demo sessions always write into the selected work organization; a missing
  // factory would otherwise create tickets invisible to every organization view.
  const scopedFactory = scopedFactoryId(auth)
  if (scopedFactory && !input.factoryId) input.factoryId = scopedFactory
  requireScopedFactory(auth, input.factoryId)
  if (!canAccessSite(auth.grants, 'ticket.create', input.siteId)) throw AppError.forbidden()
  if (!one<IdRow>('SELECT id FROM production_bases WHERE id = ? AND site_confirmed = 1 AND status = ?', [input.siteId, 'active'])) {
    throw AppError.badRequest('实际作业基地尚未确认或未启用')
  }
  let effectiveCrewId = input.crewId
  let effectiveShiftTemplateId = input.shiftTemplateId
  if (input.handoverShiftProfileId) {
    const profile = one<{
      id: string
      factory_id: string
      shift_template_id: string
      handover_required: number
      early_start_minutes: number
      late_end_minutes: number
    }>(
      `SELECT id, factory_id, shift_template_id, handover_required,
              early_start_minutes, late_end_minutes
         FROM handover_shift_profiles
        WHERE id = ? AND status = 'active'`,
      [input.handoverShiftProfileId],
    )
    if (!profile) throw AppError.notFound('交接班作业配置')
    if (input.factoryId && input.factoryId !== profile.factory_id) {
      throw AppError.badRequest('交接班配置与饲料厂不一致')
    }
    input.factoryId = profile.factory_id
    effectiveShiftTemplateId = profile.shift_template_id
    if (!effectiveCrewId) {
      effectiveCrewId = one<{ crew_id: string }>(
        `SELECT crew_id FROM handover_shift_profile_crews
          WHERE profile_id = ? ORDER BY rowid LIMIT 1`,
        [profile.id],
      )?.crew_id ?? null
    }
    if (effectiveCrewId) {
      const member = one<IdRow>(
        `SELECT crew_id AS id FROM handover_shift_profile_crews
          WHERE profile_id = ? AND crew_id = ?`,
        [profile.id, effectiveCrewId],
      )
      if (!member) throw AppError.badRequest('班组不属于所选交接班配置')
    }
  }
  if (input.factoryId) {
    const factory = one<IdRow>(
      'SELECT id FROM factories WHERE id = ? AND base_id = ? AND status = ?',
      [input.factoryId, input.siteId, 'active'],
    )
    if (!factory) throw AppError.badRequest('饲料厂必须属于实际作业基地')
  }
  if (!input.factoryId) throw AppError.badRequest('工单必须选择饲料厂')
  if (input.workAreaId) {
    const area = one<IdRow>(
      'SELECT id FROM work_areas WHERE id = ? AND base_id = ? AND factory_id = ? AND status = ?',
      [input.workAreaId, input.siteId, input.factoryId, 'active'],
    )
    if (!area) throw AppError.badRequest('工区必须属于实际作业工厂')
  }
  if (input.productionLineId) {
    const line = one<IdRow & { work_area_id: string }>(
      `SELECT l.id, l.work_area_id FROM production_lines l JOIN work_areas a ON a.id = l.work_area_id
       WHERE l.id = ? AND l.base_id = ? AND a.factory_id = ? AND l.status = 'active'
         AND a.status = 'active' AND (? IS NULL OR a.id = ?)`,
      [input.productionLineId, input.siteId, input.factoryId, input.workAreaId, input.workAreaId],
    )
    if (!line) throw AppError.badRequest('产线必须属于实际作业工厂和所选工区')
    if (!input.workAreaId) input.workAreaId = line.work_area_id
  }
  if (!canAccessFactoryScope(auth.grants, 'ticket.create', input.siteId, input.factoryId)) {
    throw AppError.forbidden()
  }
  if (effectiveCrewId) {
    const crew = one<{ base_id: string; factory_id: string | null }>(
      'SELECT base_id, factory_id FROM crews WHERE id = ? AND status = ?',
      [effectiveCrewId, 'active'],
    )
    if (!crew || crew.base_id !== input.siteId) {
      throw AppError.badRequest('生产班必须属于实际作业基地')
    }
    if (input.factoryId && crew.factory_id !== input.factoryId) {
      throw AppError.badRequest('生产班必须属于所选饲料厂')
    }
    if (!crew.factory_id) throw AppError.badRequest('生产班必须归属饲料厂')
    assertCrewLocation(effectiveCrewId, input.workAreaId, input.productionLineId)
  }
  if (effectiveShiftTemplateId) {
    const shift = one<{ base_id: string }>(
      'SELECT base_id FROM shift_templates WHERE id = ? AND status = ?',
      [effectiveShiftTemplateId, 'active'],
    )
    if (!shift || shift.base_id !== input.siteId) {
      throw AppError.badRequest('班次必须属于实际作业基地')
    }
  }
  const resolved = ticketContext.resolveTicketTypeVersion(input.ticketTypeId)
  const businessKind = input.businessKind ?? 'generic'
  const typeBusinessKind = one<{ business_kind: BusinessKind | null; system_managed: number }>(
    'SELECT business_kind, system_managed FROM ticket_types WHERE id = ?', [input.ticketTypeId],
  )
  if (!typeBusinessKind || (businessKind === 'generic' && typeBusinessKind.business_kind)
    || (businessKind !== 'generic' && typeBusinessKind.business_kind !== businessKind)) {
    throw AppError.badRequest('工单类型与业务类别不匹配')
  }
  const siteCompany = one<{ company_id: string }>(
    'SELECT company_id FROM production_bases WHERE id = ?',
    [input.siteId],
  )?.company_id
  if (!siteCompany) throw AppError.notFound('作业基地')
  if (resolved.ownerType === 'company' && resolved.ownerId !== siteCompany) {
    throw AppError.forbidden('本地工单类型只能在实际作业公司使用')
  }
  const materialScope = businessKind === 'production'
    ? resolveProductionMaterialScope({
      siteId: input.siteId,
      materialId: input.materialId ?? null,
      materialTypeId: input.materialTypeId ?? null,
      items: input.businessItems ?? [],
    })
    : { materialId: null, materialName: null, materialTypeId: null, items: input.businessItems ?? [] }
  const price = businessKind === 'generic' ? priceContext.findPublishedPrice({
    ticketTypeId: input.ticketTypeId,
    siteId: input.siteId,
    eventTime: input.eventTime,
  }) : undefined
  if (new Set(input.assignments.map((assignment) => assignment.personId)).size !== input.assignments.length) {
    throw AppError.badRequest('执行人员不能重复')
  }
  const validated = input.assignments.map((assignment) => ({ assignment, candidate: rosterContext.validateAssignment({
    personId: assignment.personId,
    siteId: input.siteId,
    factoryId: input.factoryId,
    crewId: effectiveCrewId,
    eventTime: input.eventTime,
    workDate: input.workDate,
  }) }))
  const id = newId('ticket')
  const ticketNo = `WO-${input.workDate.replaceAll('-', '')}-${id.slice(-6).toUpperCase()}`
  const timestamp = nowIso()
  const status: TicketStatus = validated.length ? 'pending_start' : 'pending_assignment'
  transaction(() => {
    run(
      `INSERT INTO tickets
        (id, ticket_no, ticket_type_id, ticket_type_version_id, form_version_id, site_id,
         factory_id, work_area_id, production_line_id, crew_id, shift_template_id,
         handover_shift_profile_id, status, work_date,
         event_time, deadline_at, values_json, sub_form_values_json, price_rule_version_id,
         quantity, amount_micros, revision, created_at, created_by, updated_at, updated_by,
         business_kind, material_type_id, material_type_name_snapshot,
         material_id, material_name_snapshot, business_config_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '{}', '{}', ?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ticketNo, resolved.ticketTypeId, resolved.ticketTypeVersionId, resolved.formVersionId,
        input.siteId, input.factoryId, input.workAreaId, input.productionLineId, effectiveCrewId,
        effectiveShiftTemplateId, input.handoverShiftProfileId || null,
        status, input.workDate, input.eventTime,
        price?.id ?? null, input.quantity, timestamp, auth.accountId, timestamp, auth.accountId,
        businessKind, businessKind === 'production' ? materialScope.materialTypeId : null,
        businessKind === 'production' ? materialScope.materialName : null,
        businessKind === 'production' ? materialScope.materialId : null,
        businessKind === 'production' ? materialScope.materialName : null,
        JSON.stringify({ businessKind, materialId: businessKind === 'production' ? materialScope.materialId : null,
          materialTypeId: businessKind === 'production' ? materialScope.materialTypeId : null,
          businessItems: businessKind === 'production' ? materialScope.items : input.businessItems ?? [] })],
    )
    run(
      `UPDATE tickets SET ticket_type_snapshot_json = ?, form_snapshot_json = ?, site_snapshot_json = ?, price_snapshot_json = ?
       WHERE id = ?`,
      [JSON.stringify(resolved.snapshot), JSON.stringify(resolved.formSchema), JSON.stringify({
        siteId: input.siteId,
        siteName: one<{ name: string }>('SELECT name FROM production_bases WHERE id = ?', [input.siteId])?.name ?? '',
        factoryId: input.factoryId,
        factoryName: one<{ name: string }>('SELECT name FROM factories WHERE id = ?', [input.factoryId])?.name ?? null,
        workAreaId: input.workAreaId,
        workAreaName: input.workAreaId ? one<{ name: string }>('SELECT name FROM work_areas WHERE id = ?', [input.workAreaId])?.name ?? null : null,
        productionLineId: input.productionLineId,
        productionLineName: input.productionLineId ? one<{ name: string }>('SELECT name FROM production_lines WHERE id = ?', [input.productionLineId])?.name ?? null : null,
        crewId: effectiveCrewId,
        crewName: effectiveCrewId ? one<{ name: string }>('SELECT name FROM crews WHERE id = ?', [effectiveCrewId])?.name ?? null : null,
        shiftTemplateId: effectiveShiftTemplateId,
        shiftName: effectiveShiftTemplateId ? one<{ name: string }>('SELECT name FROM shift_templates WHERE id = ?', [effectiveShiftTemplateId])?.name ?? null : null,
        handoverShiftProfileId: input.handoverShiftProfileId || null,
        handoverName: input.handoverShiftProfileId ? one<{ name: string }>('SELECT name FROM handover_shift_profiles WHERE id = ?', [input.handoverShiftProfileId])?.name ?? null : null,
      }), JSON.stringify(price ?? {}), id],
    )
    if (businessKind === 'generic') {
      run(
        `INSERT INTO ticket_pricing
          (ticket_id, status, method, unit, unit_price_micros, source_price_id,
           confirmed_by, confirmed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, price ? 'confirmed' : 'pending', price ? 'quantity_unit' : null,
          price?.unit ?? null, price?.unitPriceMicros ?? null, price?.id ?? null,
          price ? auth.accountId : null, price ? timestamp : null, timestamp, timestamp],
      )
    } else {
      createBusinessWorkItems({ ticketId: id, kind: businessKind, siteId: input.siteId,
        materialTypeId: materialScope.materialTypeId, eventTime: input.eventTime, items: materialScope.items })
    }
    validated.forEach(({ candidate, assignment }) => {
      run(
        `INSERT INTO ticket_assignments
          (id, ticket_id, person_id, role, assignment_source, planned_quantity, actual_quantity,
           created_at, updated_at, person_name_snapshot, person_snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [newId('assign'), id, candidate.person.id, assignment.role, candidate.source,
          input.quantity, timestamp, timestamp, candidate.person.name, JSON.stringify(assignmentSnapshot(candidate, input.siteId, input.factoryId, input.workDate))],
      )
    })
    recordEvent(id, null, status, auth.accountId, '创建工单', { clientRequestId: input.clientRequestId })
  })
  const created = mapTicket(ticketRow(id))
  auditTicket(auth, 'ticket.create', created, undefined, created)
  return created
}

/** The PC manual drawer is only for ordinary generic work; sanitation has its own App flow. */
export function createManualTicket(auth: AuditAuth, input: CreateTicketInput): Ticket {
  const ticketType = one<{ code: string }>('SELECT code FROM ticket_types WHERE id = ?', [input.ticketTypeId])
  if (ticketType?.code === 'VEHICLE_SANITATION' || ticketType?.code === 'FACILITY_SANITATION') {
    throw AppError.badRequest('洗消工单请在 App 新建并执行专用洗消流程')
  }
  return createTicket(auth, input)
}

function recordEvent(
  ticketId: string,
  fromStatus: TicketStatus | null,
  toStatus: TicketStatus,
  accountId: string,
  note: string,
  payload: unknown = {},
): void {
  run(
    `INSERT INTO ticket_events
      (id, ticket_id, event_type, from_status, to_status, account_id, note, payload_json, created_at)
     VALUES (?, ?, 'transition', ?, ?, ?, ?, ?, ?)`,
    [newId('event'), ticketId, fromStatus, toStatus, accountId, note, JSON.stringify(payload), nowIso()],
  )
}

function transition(
  row: TicketRow,
  toStatus: TicketStatus,
  revision: number,
  accountId: string,
  note: string,
): void {
  requireRevision(row, revision, '工单')
  if (!transitions[row.status].includes(toStatus)) {
    throw AppError.stateConflict(`工单不能从 ${row.status} 流转到 ${toStatus}`)
  }
  const result = run(
    `UPDATE tickets SET status = ?, revision = revision + 1, updated_at = ?, updated_by = ?
     WHERE id = ? AND revision = ?`,
    [toStatus, nowIso(), accountId, row.id, revision],
  )
  if (!result.changes) throw AppError.revisionConflict()
  recordEvent(row.id, row.status, toStatus, accountId, note)
}

function auditTicket(
  auth: AuditAuth,
  action: string,
  ticket: Ticket,
  before?: unknown,
  after?: unknown,
): void {
  writeAudit({
    accountId: auth.accountId,
    action,
    entityType: 'ticket',
    entityId: ticket.id,
    scopeType: ticket.factoryId ? 'factory' : 'base',
    scopeId: ticket.factoryId || ticket.siteId,
    before,
    after,
    ipAddress: auth.ipAddress,
  })
}

export function assignTicket(
  auth: AuditAuth,
  id: string,
  assignments: Array<{ personId: string; role: 'lead' | 'member' }>,
  revision: number,
): Ticket {
  const row = ticketRow(auth, id)
  if (row.business_kind && row.business_kind !== 'generic') {
    throw AppError.badRequest('生产和装卸工单请按岗位明细分配人员')
  }
  if (!canAccessFactoryScope(auth.grants, 'ticket.assign', row.site_id, row.factory_id)) throw AppError.forbidden()
  requireRevision(row, revision, '工单')
  if (!['pending_assignment', 'pending_start'].includes(row.status)) {
    throw AppError.stateConflict('只有待指派或待开始工单可以调整人员')
  }
  if (!assignments.length) throw AppError.badRequest('至少保留一名执行人员')
  if (new Set(assignments.map((assignment) => assignment.personId)).size !== assignments.length) {
    throw AppError.badRequest('执行人员不能重复')
  }
  const before = mapTicket(row)
  const existing = new Map(before.assignments.map((assignment) => [assignment.personId, assignment]))
  const candidates = assignments.filter((assignment) => !existing.has(assignment.personId)).map((assignment) => ({
    assignment,
    candidate: rosterContext.validateAssignment({
      personId: assignment.personId,
      siteId: row.site_id,
      factoryId: row.factory_id,
      crewId: row.crew_id,
      eventTime: row.event_time,
      workDate: row.work_date,
    }),
  }))
  transaction(() => {
    for (const previous of before.assignments) {
      const retained = assignments.find((assignment) => assignment.personId === previous.personId)
      if (!retained) run('DELETE FROM ticket_assignments WHERE id = ? AND ticket_id = ?', [previous.id, id])
      else if (retained.role !== previous.role) run('UPDATE ticket_assignments SET role = ?, updated_at = ? WHERE id = ? AND ticket_id = ?', [retained.role, nowIso(), previous.id, id])
    }
    const timestamp = nowIso()
    for (const { assignment, candidate } of candidates) {
      run(
        `INSERT INTO ticket_assignments
          (id, ticket_id, person_id, role, assignment_source, planned_quantity, actual_quantity,
           created_at, updated_at, person_name_snapshot, person_snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [newId('assign'), id, assignment.personId, assignment.role, candidate.source,
          row.quantity, timestamp, timestamp, candidate.person.name, JSON.stringify(assignmentSnapshot(candidate, row.site_id, row.factory_id, row.work_date))],
      )
    }
    run(
      `UPDATE tickets SET status = 'pending_start', revision = revision + 1,
         updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
      [timestamp, auth.accountId, id, revision],
    )
    recordEvent(id, row.status, 'pending_start', auth.accountId, '指派人员')
  })
  const updated = mapTicket(ticketRow(id))
  auditTicket(auth, 'ticket.assign', updated, before, updated)
  return updated
}

export function assignBusinessWorkItem(
  auth: AuditAuth,
  id: string,
  workItemId: string,
  assignments: Array<{ personId: string; role: 'lead' | 'member'; shareBasisPoints: number }>,
  revision: number,
): Ticket {
  const row = ticketRow(auth, id)
  if (!row.business_kind || row.business_kind === 'generic') throw AppError.badRequest('该工单没有业务明细')
  if (!canAccessFactoryScope(auth.grants, 'ticket.assign', row.site_id, row.factory_id)) throw AppError.forbidden()
  requireRevision(row, revision, '工单')
  if (!['pending_assignment', 'pending_start'].includes(row.status)) throw AppError.stateConflict('工单开始后不能调整岗位人员')
  if (!one<{ id: string }>('SELECT id FROM ticket_business_work_items WHERE id = ? AND ticket_id = ?', [workItemId, id])) {
    throw AppError.notFound('工单作业明细')
  }
  if (new Set(assignments.map((item) => item.personId)).size !== assignments.length) throw AppError.badRequest('同一岗位人员不能重复')
  if (assignments.some((item) => !Number.isInteger(item.shareBasisPoints) || item.shareBasisPoints < 0 || item.shareBasisPoints > 10000)) {
    throw AppError.badRequest('人员贡献比例无效')
  }
  if (assignments.length && assignments.reduce((sum, item) => sum + item.shareBasisPoints, 0) !== 10000) {
    throw AppError.badRequest('每个岗位的人员贡献比例必须合计100%')
  }
  const before = mapTicket(row)
  const existing = new Map(before.assignments.map((assignment) => [assignment.personId, assignment]))
  const candidates = assignments.filter((item) => !existing.has(item.personId)).map((item) => ({
    item,
    candidate: rosterContext.validateAssignment({ personId: item.personId, siteId: row.site_id,
      factoryId: row.factory_id, crewId: row.crew_id, eventTime: row.event_time, workDate: row.work_date }),
  }))
  transaction(() => {
    const timestamp = nowIso()
    for (const item of assignments) {
      const retained = existing.get(item.personId)
      if (retained && retained.role !== item.role) {
        run('UPDATE ticket_assignments SET role = ?, updated_at = ? WHERE id = ?', [item.role, timestamp, retained.id])
      }
    }
    for (const { item, candidate } of candidates) {
      run(`INSERT INTO ticket_assignments
        (id, ticket_id, person_id, role, assignment_source, planned_quantity, actual_quantity,
         created_at, updated_at, person_name_snapshot, person_snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      [newId('assign'), id, item.personId, item.role, candidate.source, row.quantity,
        timestamp, timestamp, candidate.person.name,
        JSON.stringify(assignmentSnapshot(candidate, row.site_id, row.factory_id, row.work_date))])
    }
    const assignmentIds = new Map<string, string>()
    for (const assignment of assignments) {
      const current = one<{ id: string }>('SELECT id FROM ticket_assignments WHERE ticket_id = ? AND person_id = ?', [id, assignment.personId])
      if (!current) throw AppError.stateConflict('执行人员保存失败')
      assignmentIds.set(assignment.personId, current.id)
    }
    setBusinessWorkItemAssignments(workItemId, assignments.map((item) => ({
      ticketAssignmentId: assignmentIds.get(item.personId)!, shareBasisPoints: item.shareBasisPoints,
    })))
    run(`DELETE FROM ticket_assignments WHERE ticket_id = ? AND NOT EXISTS (
      SELECT 1 FROM ticket_business_work_item_assignments a WHERE a.ticket_assignment_id = ticket_assignments.id
    )`, [id])
    const hasAssignments = one<{ count: number }>('SELECT count(*) AS count FROM ticket_assignments WHERE ticket_id = ?', [id])?.count ?? 0
    const allItemsAssigned = businessWorkItemShareTotals(id).every((share) => share === 10000)
    const nextStatus: TicketStatus = hasAssignments && allItemsAssigned ? 'pending_start' : 'pending_assignment'
    run('UPDATE tickets SET status = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?',
      [nextStatus, timestamp, auth.accountId, id, revision])
    recordEvent(id, row.status, nextStatus, auth.accountId, '调整岗位执行人员')
  })
  const updated = mapTicket(ticketRow(id))
  auditTicket(auth, 'ticket.business_assignment', updated, before, updated)
  return updated
}

export function setBusinessWorkItemPrice(
  auth: AuditAuth,
  id: string,
  workItemId: string,
  input: { revision: number; priceRuleVersionId: string; reason: string },
): Ticket {
  const row = ticketRow(auth, id)
  if (row.business_kind === 'production' || row.business_kind === 'loading') {
    throw AppError.badRequest('生产、装卸工单价格由业务配置同步，平台不支持改价')
  }
  if (!row.business_kind || row.business_kind === 'generic') throw AppError.badRequest('该工单没有业务明细价格')
  if (!canAccessFactoryScope(auth.grants, 'price.manage', row.site_id, row.factory_id)) throw AppError.forbidden()
  requireRevision(row, input.revision, '工单')
  const item = one<{ kind: 'production_post' | 'loading_type'; catalog_id: string; price_status: string }>(
    'SELECT kind, catalog_id, price_status FROM ticket_business_work_items WHERE id = ? AND ticket_id = ?', [workItemId, id],
  )
  if (!item) throw AppError.notFound('工单作业明细')
  const rule = one<{ id: string; unit: string; unit_price_micros: number; effective_from: string; effective_to: string | null; site_id: string; catalog_id: string; material_type_id: string | null }>(
    'SELECT * FROM business_price_rule_versions WHERE id = ? AND status = \'published\'', [input.priceRuleVersionId],
  )
  if (!rule || rule.site_id !== row.site_id || rule.catalog_id !== item.catalog_id
    || (row.business_kind === 'production' && rule.material_type_id !== row.material_type_id)
    || (row.business_kind === 'loading' && rule.material_type_id !== null)
    || rule.effective_from > row.event_time || (rule.effective_to && rule.effective_to < row.event_time)) {
    throw AppError.badRequest('请选择匹配基地、作业项和作业日期的生效价格')
  }
  if (row.status === 'cancelled') throw AppError.stateConflict('已取消工单不能改价')
  const workMonth = row.work_date.slice(0, 7)
  if (getPeriod(workMonth)?.status === 'closed') throw AppError.stateConflict('该月已关账，不能改价')
  const prior = all<AccrualRow>('SELECT * FROM payroll_accruals WHERE business_work_item_id = ?', [workItemId])
  if (prior.some((accrual) => accrual.settlement_status !== 'open' || accrual.adjustment_of_id)) {
    throw AppError.stateConflict('已有锁定或调整记录，不能直接改价')
  }
  const before = mapTicket(row)
  transaction(() => {
    run('DELETE FROM payroll_accruals WHERE business_work_item_id = ? AND settlement_status = \'open\'', [workItemId])
    setBusinessWorkItemPriceSnapshot({ workItemId, unit: rule.unit, unitPriceMicros: rule.unit_price_micros, priceRuleVersionId: rule.id })
    if (row.status === 'closed') {
      const links = all<{ person_id: string; share_basis_points: number }>(
        `SELECT ta.person_id, a.share_basis_points FROM ticket_business_work_item_assignments a
         JOIN ticket_assignments ta ON ta.id = a.ticket_assignment_id WHERE a.work_item_id = ?`, [workItemId],
      )
      for (const link of links) {
        const confirmation = one<{ payroll_company_id: string }>(
          'SELECT payroll_company_id FROM payroll_company_confirmations WHERE work_month = ? AND person_id = ? AND status = \'confirmed\'',
          [workMonth, link.person_id],
        )
        const assignedQuantity = (row.quantity || 0) * link.share_basis_points / 10000
        run(`INSERT INTO payroll_accruals
          (id, ticket_id, business_work_item_id, person_id, work_site_id, price_rule_version_id, quantity,
           amount_micros, work_month, payroll_company_id, settlement_status, revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'open', 1, ?, ?)`,
        [newId('accrual'), id, workItemId, link.person_id, row.site_id, assignedQuantity,
          Math.round(assignedQuantity * rule.unit_price_micros), workMonth,
          confirmation?.payroll_company_id ?? null, nowIso(), nowIso()])
      }
    }
    const items = listBusinessWorkItems(id, row.quantity)
    const amount = items.every((workItem) => workItem.priceStatus === 'confirmed')
      ? items.reduce((sum, workItem) => sum + (workItem.amountMicros ?? 0), 0) : null
    run('UPDATE tickets SET amount_micros = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?',
      [amount, nowIso(), auth.accountId, id, input.revision])
  })
  const updated = mapTicket(ticketRow(id))
  auditTicket(auth, 'ticket.business_work_item.pricing', updated, { ...before, reason: input.reason }, updated)
  return updated
}

export function startTicket(auth: {
  accountId: string
  ipAddress: string
  personId?: string | null
  grants: Array<{ capability: string; type: string; id: string }>
  demoIdentityId?: string | null
  selectedBaseId?: string | null
}, id: string, revision: number, note: string): Ticket {
  const row = ticketRow(auth, id)
  assertGenericExecution(row, '开始或执行')
  if (!canAccessFactoryScope(auth.grants, 'ticket.execute', row.site_id, row.factory_id)) throw AppError.forbidden()
  if (
    auth.personId
    && !canAccessFactoryScope(auth.grants, 'ticket.assign', row.site_id, row.factory_id)
    && !getAssignments(id).some((assignment) => assignment.personId === auth.personId)
  ) {
    throw AppError.forbidden('只能开始本人被指派的工单')
  }
  transition(row, 'in_progress', revision, auth.accountId, note || '开始执行')
  const updated = mapTicket(ticketRow(id))
  auditTicket(auth, 'ticket.start', updated, mapTicket(row), updated)
  return updated
}

export function saveTicketValues(
  auth: {
    accountId: string
    ipAddress: string
    personId?: string | null
    grants: Array<{ capability: string; type: string; id: string }>
    demoIdentityId?: string | null
    selectedBaseId?: string | null
  },
  id: string,
  values: Record<string, unknown>,
  subFormValues: Record<string, Array<Record<string, unknown>>>,
  assignmentQuantities: Record<string, number> | undefined,
  revision: number,
  validate = false,
): Ticket {
  const row = ticketRow(auth, id)
  assertGenericExecution(row, '填写执行数据')
  if (!canAccessFactoryScope(auth.grants, 'ticket.execute', row.site_id, row.factory_id)) throw AppError.forbidden()
  if (
    auth.personId
    && !canAccessFactoryScope(auth.grants, 'ticket.assign', row.site_id, row.factory_id)
    && !getAssignments(id).some((assignment) => assignment.personId === auth.personId)
  ) {
    throw AppError.forbidden('只能填写本人被指派的工单')
  }
  requireRevision(row, revision, '工单')
  if (!['in_progress', 'pending_data', 'overdue'].includes(row.status)) {
    throw AppError.stateConflict('只有执行中的工单可以保存填报数据')
  }
  const fileSchema = JSON.parse(one<{ form_snapshot_json: string }>('SELECT form_snapshot_json FROM tickets WHERE id=?',[id])?.form_snapshot_json || '{}') as FormVersionSchema
  const oldValues = JSON.parse(row.values_json || '{}')
  const oldSubValues = JSON.parse(row.sub_form_values_json || '{}')
  const assertFilesUnchanged = (fields: FormVersionSchema['mainFields'], current: Record<string,unknown>, previous: Record<string,unknown>) => {
    for (const field of fields.filter(f => f.type === 'photo' || f.type === 'attachment')) {
      if (current[field.key] !== undefined && JSON.stringify(current[field.key]) !== JSON.stringify(previous[field.key])) throw AppError.badRequest('当前不允许填写照片或附件')
      if (previous[field.key] !== undefined) current[field.key] = previous[field.key]
    }
  }
  assertFilesUnchanged(fileSchema.mainFields || [],values,oldValues)
  for (const sub of fileSchema.subForms || []) (subFormValues[sub.key] || []).forEach((record,index) => assertFilesUnchanged(sub.fields,record,oldSubValues[sub.key]?.[index] || {}))
  if (validate) {
    const snapshot = one<{ form_snapshot_json: string }>('SELECT form_snapshot_json FROM tickets WHERE id = ?', [id])
    const schema = JSON.parse(snapshot?.form_snapshot_json || '{}') as FormVersionSchema
    const result = validateFrozenForm(schema, values, subFormValues)
    if (!result.valid) {
      throw AppError.badRequest('表单校验未通过', result.issues)
    }
  }
  transaction(() => {
    const result = run(
      `UPDATE tickets SET values_json = ?, sub_form_values_json = ?, revision = revision + 1,
         updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
      [JSON.stringify(values), JSON.stringify(subFormValues), nowIso(), auth.accountId, id, revision],
    )
    if (!result.changes) throw AppError.revisionConflict()
    if (assignmentQuantities) {
      const assignedIds = new Set(getAssignments(id).map((assignment) => assignment.id))
      for (const [assignmentId, quantity] of Object.entries(assignmentQuantities)) {
        if (!assignedIds.has(assignmentId)) throw AppError.badRequest('分摊数量包含无效人员')
        run(
          `UPDATE ticket_assignments SET actual_quantity = ?, updated_at = ?
           WHERE id = ? AND ticket_id = ?`,
          [quantity, nowIso(), assignmentId, id],
        )
      }
    }
  })
  const updated = mapTicket(ticketRow(id))
  auditTicket(auth, 'ticket.values.save', updated, {
    status: row.status,
    revision: row.revision,
    values: JSON.parse(row.values_json),
    subFormValues: JSON.parse(row.sub_form_values_json),
  }, {
    status: updated.status,
    revision: updated.revision,
    values: updated.values,
    subFormValues: updated.subFormValues,
  })
  return updated
}

interface ConfirmedPrice { id: string | null; unit_price_micros: number }
interface PricingRow { status: string; method: string | null; unit_price_micros: number | null; source_price_id: string | null; lump_sum_cents: number | null }

function assertGenericExecution(row: TicketRow, action: string): void {
  if (row.business_kind && row.business_kind !== 'generic') {
    throw AppError.badRequest(`生产、装卸工单由业务系统同步，平台不支持${action}`)
  }
}

/** 单张定价优先于创建时冻结的默认单价；status=pending 表示这张工单暂时不定价。 */
function readPricing(row: TicketRow): { pricing: PricingRow | null; price: ConfirmedPrice | undefined } {
  const pricing = one<PricingRow>(
    'SELECT status, method, unit_price_micros, source_price_id, lump_sum_cents FROM ticket_pricing WHERE ticket_id = ?', [row.id],
  ) ?? null
  if (pricing) {
    const usable = pricing.status === 'confirmed' && pricing.method === 'quantity_unit' && pricing.unit_price_micros !== null
    return { pricing, price: usable ? { id: pricing.source_price_id, unit_price_micros: pricing.unit_price_micros! } : undefined }
  }
  const savedPrice = JSON.parse(row.price_snapshot_json || '{}') as { id?: string; unitPriceMicros?: number }
  if (savedPrice.id && typeof savedPrice.unitPriceMicros === 'number') {
    return { pricing: null, price: { id: savedPrice.id, unit_price_micros: savedPrice.unitPriceMicros } }
  }
  const legacy = one<PriceRuleRow>('SELECT * FROM price_rule_versions WHERE id = ?', [row.price_rule_version_id ?? ''])
  return { pricing: null, price: legacy ? { id: legacy.id, unit_price_micros: legacy.unit_price_micros } : undefined }
}

function allocationQuantities(row: TicketRow, assignments: TicketAssignment[]): number[] {
  const perPerson = row.quantity ?? 0
  return assignments.map((assignment) => assignment.actualQuantity ?? assignment.plannedQuantity ?? perPerson)
}

/** 产量×单价工单的分摊之和必须等于核定总产量，否则不允许进入计价。 */
function assertAllocationTotal(row: TicketRow, assignments: TicketAssignment[], price: ConfirmedPrice | undefined): number {
  const total = allocationQuantities(row, assignments).reduce((sum, quantity) => sum + quantity, 0)
  if (price && row.quantity !== null && Math.abs(total - row.quantity) > 0.000001) {
    throw AppError.stateConflict('个人产量之和必须等于工单核定总产量')
  }
  return total
}

export function submitTicket(
  auth: {
    accountId: string
    ipAddress: string
    personId?: string | null
    grants: Array<{ capability: string; type: string; id: string }>
    demoIdentityId?: string | null
    selectedBaseId?: string | null
  },
  id: string,
  values: Record<string, unknown>,
  subFormValues: Record<string, Array<Record<string, unknown>>>,
  assignmentQuantities: Record<string, number> | undefined,
  revision: number,
  quantity: number | null | undefined,
): Ticket {
  const initial = ticketRow(auth, id)
  const businessKind = initial.business_kind ?? 'generic'
  const saved = saveTicketValues(
    auth, id, values, subFormValues, assignmentQuantities, revision, true,
  )
  if (quantity !== undefined && quantity !== null) {
    run('UPDATE tickets SET quantity = ? WHERE id = ?', [quantity, id])
  }
  const row = ticketRow(auth, id)
  if (businessKind !== 'generic') {
    const shares = businessWorkItemShareTotals(id)
    if (!shares.length || shares.some((share) => share !== 10000)) {
      throw AppError.stateConflict('每个岗位都需要分配执行人员，且贡献比例合计100%')
    }
    const workItems = listBusinessWorkItems(id, row.quantity)
    const amount = workItems.every((item) => item.priceStatus === 'confirmed')
      ? workItems.reduce((sum, item) => sum + (item.amountMicros ?? 0), 0) : null
    run('UPDATE tickets SET amount_micros = ? WHERE id = ?', [amount, id])
    transition(row, 'completed', row.revision, auth.accountId, '提交执行数据')
    const updated = mapTicket(ticketRow(id))
    auditTicket(auth, 'ticket.submit', updated, saved, updated)
    return updated
  }
  // 分摊与总量的校验前移到提交环节，避免工人提交后卡在大管理员审核时才发现。
  assertAllocationTotal(row, getAssignments(id), readPricing(row).price)
  transition(row, 'completed', row.revision, auth.accountId, '提交执行数据')
  const updated = mapTicket(ticketRow(id))
  auditTicket(auth, 'ticket.submit', updated, saved, updated)
  return updated
}

export function approveTicket(
  auth: AuditAuth,
  id: string,
  revision: number,
  note: string,
): Ticket {
  const row = ticketRow(auth, id)
  assertGenericExecution(row, '审核')
  if (!canAccessFactoryScope(auth.grants, 'ticket.review', row.site_id, row.factory_id)) throw AppError.forbidden()
  requireRevision(row, revision, '工单')
  if (row.status !== 'completed') throw AppError.stateConflict('只有已提交工单可以审核')
  const ticket = mapTicket(row)
  const workMonth = row.work_date.slice(0, 7)
  const period = getPeriod(workMonth)
  if (period?.status === 'closed') throw AppError.stateConflict('该月已关账，不能新增计件')
  if (row.business_kind && row.business_kind !== 'generic') {
    if (row.quantity === null) throw AppError.stateConflict('工单缺少实际工作量')
    const items = all<{ id: string; price_status: 'pending' | 'confirmed'; unit_price_micros: number | null }>(
      'SELECT id, price_status, unit_price_micros FROM ticket_business_work_items WHERE ticket_id = ?', [id],
    )
    if (!items.length) throw AppError.stateConflict('工单缺少作业明细')
    if (businessWorkItemShareTotals(id).some((share) => share !== 10000)) {
      throw AppError.stateConflict('每个岗位的人员贡献比例必须合计100%')
    }
    const rootQuantity = row.quantity
    transaction(() => {
      for (const item of items) {
        if (item.price_status !== 'confirmed' || item.unit_price_micros === null) continue
        const links = all<{ person_id: string; share_basis_points: number }>(
          `SELECT ta.person_id, a.share_basis_points FROM ticket_business_work_item_assignments a
           JOIN ticket_assignments ta ON ta.id = a.ticket_assignment_id WHERE a.work_item_id = ?`, [item.id],
        )
        for (const link of links) {
          const confirmation = one<{ payroll_company_id: string }>(
            `SELECT payroll_company_id FROM payroll_company_confirmations WHERE work_month = ? AND person_id = ? AND status = 'confirmed'`,
            [workMonth, link.person_id],
          )
          const assignedQuantity = rootQuantity * link.share_basis_points / 10000
          run(`INSERT INTO payroll_accruals
            (id, ticket_id, business_work_item_id, person_id, work_site_id, price_rule_version_id, quantity,
             amount_micros, work_month, payroll_company_id, settlement_status, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'open', 1, ?, ?)`,
          [newId('accrual'), id, item.id, link.person_id, row.site_id, assignedQuantity,
            Math.round(assignedQuantity * item.unit_price_micros), workMonth,
            confirmation?.payroll_company_id ?? null, nowIso(), nowIso()])
        }
      }
      const allPriced = items.every((item) => item.price_status === 'confirmed')
      const totalAmount = allPriced ? Math.round(items.reduce((sum, item) => sum + rootQuantity * item.unit_price_micros!, 0)) : null
      const changed = run(`UPDATE tickets SET status = 'closed', amount_micros = ?, revision = revision + 1,
        updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
      [totalAmount, nowIso(), auth.accountId, id, revision])
      if (!changed.changes) throw AppError.revisionConflict()
      recordEvent(id, row.status, 'closed', auth.accountId, note || '审核通过')
    })
    const approved = mapTicket(ticketRow(id))
    auditTicket(auth, 'ticket.approve', approved, ticket, approved)
    return approved
  }
  const assignments = getAssignments(id)
  if (!assignments.length) throw AppError.stateConflict('工单没有执行人员')
  const { pricing, price } = readPricing(row)
  const quantities = allocationQuantities(row, assignments)
  const totalQuantity = assertAllocationTotal(row, assignments, price)
  if (pricing?.status === 'confirmed' && pricing.method === 'lump_sum' && pricing.lump_sum_cents !== null) {
    const shares = splitLumpSum(pricing.lump_sum_cents, assignments.map((a) => a.personId))
    transaction(() => {
      for (const share of shares) {
        const confirmation = one<{ payroll_company_id: string }>(
          `SELECT payroll_company_id FROM payroll_company_confirmations WHERE work_month = ? AND person_id = ? AND status = 'confirmed'`,
          [workMonth, share.personId],
        )
        run(`INSERT INTO payroll_accruals (id, ticket_id, person_id, work_site_id, price_rule_version_id,
          quantity, amount_micros, work_month, payroll_company_id, settlement_status, revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, 'open', 1, ?, ?)`,
        [newId('accrual'), id, share.personId, row.site_id, share.amountCents * 10000, workMonth,
          confirmation?.payroll_company_id ?? null, nowIso(), nowIso()])
      }
      const changed = run(`UPDATE tickets SET status = 'closed', amount_micros = ?, revision = revision + 1,
        updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
      [pricing.lump_sum_cents! * 10000, nowIso(), auth.accountId, id, revision])
      if (!changed.changes) throw AppError.revisionConflict()
      recordEvent(id, row.status, 'closed', auth.accountId, note || '审核通过')
    })
    const approved = mapTicket(ticketRow(id))
    auditTicket(auth, 'ticket.approve', approved, ticket, approved)
    return approved
  }
  if (!price) {
    transaction(() => {
      const changed = run(`UPDATE tickets SET status = 'closed', quantity = ?, amount_micros = NULL,
        revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
      [row.quantity, nowIso(), auth.accountId, id, revision])
      if (!changed.changes) throw AppError.revisionConflict()
      recordEvent(id, row.status, 'closed', auth.accountId, note || '审核通过，待定价')
    })
    const approved = mapTicket(ticketRow(id))
    auditTicket(auth, 'ticket.approve', approved, ticket, approved)
    return approved
  }
  transaction(() => {
    for (const [index, assignment] of assignments.entries()) {
      const quantity = quantities[index]
      const confirmation = one<{ payroll_company_id: string }>(
        `SELECT payroll_company_id FROM payroll_company_confirmations
         WHERE work_month = ? AND person_id = ? AND status = 'confirmed'`,
        [workMonth, assignment.personId],
      )
      run(
        `INSERT INTO payroll_accruals
          (id, ticket_id, person_id, work_site_id, price_rule_version_id, quantity, amount_micros,
           work_month, payroll_company_id, settlement_status, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?)`,
        [newId('accrual'), id, assignment.personId, row.site_id, price.id, quantity,
          Math.round(quantity * price.unit_price_micros), workMonth,
          confirmation?.payroll_company_id ?? null, nowIso(), nowIso()],
      )
    }
    const changed = run(
      `UPDATE tickets SET status = 'closed', quantity = ?, amount_micros = ?,
         revision = revision + 1,
         updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
      [totalQuantity, quantities.reduce((sum, quantity) => sum + Math.round(quantity * price.unit_price_micros), 0),
        nowIso(), auth.accountId, id, revision],
    )
    if (!changed.changes) throw AppError.revisionConflict()
    recordEvent(id, row.status, 'closed', auth.accountId, note || '审核通过')
  })
  void ticket
  const approved = mapTicket(ticketRow(id))
  auditTicket(auth, 'ticket.approve', approved, ticket, approved)
  return approved
}

export function setTicketPricing(
  auth: AuditAuth,
  id: string,
  input: { revision: number; method: 'quantity_unit'; unit: string; unitPriceMicros: number; reason: string }
    | { revision: number; method: 'lump_sum'; lumpSumCents: number; reason: string },
): Ticket {
  const initial = ticketRow(auth, id)
  if (initial.business_kind && initial.business_kind !== 'generic') throw AppError.badRequest('生产、装卸价格须在对应作业明细中维护')
  if (!canAccessFactoryScope(auth.grants, 'price.manage', initial.site_id, initial.factory_id)) throw AppError.forbidden()
  const before = mapTicket(initial)
  transaction(() => {
    const row = ticketRow(auth, id)
    requireRevision(row, input.revision, '工单')
    if (row.status === 'cancelled') throw AppError.stateConflict('已取消工单不能定价')
    const month = row.work_date.slice(0, 7)
    if (getPeriod(month)?.status === 'closed') throw AppError.stateConflict('该月已关账，不能修改定价')
    const existing = all<AccrualRow>('SELECT * FROM payroll_accruals WHERE ticket_id = ?', [id])
    if (existing.some((item) => item.settlement_status !== 'open' || item.adjustment_of_id)) {
      throw AppError.stateConflict('工单存在锁定或调整记录，不能直接改价')
    }
    const referenced = one<{ count: number }>(
      `SELECT count(*) AS count FROM payroll_accruals WHERE adjustment_of_id IN
        (SELECT id FROM payroll_accruals WHERE ticket_id = ?)`, [id],
    )
    if (referenced?.count) throw AppError.stateConflict('工单存在后续调整记录，不能直接改价')
    if (existing.length) {
      writeAudit({ accountId: auth.accountId, action: 'ticket.pricing.recalculate', entityType: 'ticket',
        entityId: id, scopeType: row.factory_id ? 'factory' : 'base', scopeId: row.factory_id || row.site_id,
        before: existing, after: { reason: input.reason }, ipAddress: auth.ipAddress })
      run('DELETE FROM payroll_accruals WHERE ticket_id = ?', [id])
    }
    const timestamp = nowIso()
    run(`INSERT INTO ticket_pricing
      (ticket_id, status, method, unit, unit_price_micros, lump_sum_cents, source_price_id, confirmed_by, confirmed_at, reason, created_at, updated_at)
      VALUES (?, 'confirmed', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
      ON CONFLICT(ticket_id) DO UPDATE SET status = 'confirmed', method = excluded.method, unit = excluded.unit,
        unit_price_micros = excluded.unit_price_micros, lump_sum_cents = excluded.lump_sum_cents, source_price_id = NULL,
        confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at, reason = excluded.reason,
        revision = ticket_pricing.revision + 1, updated_at = excluded.updated_at`,
    [id, input.method, input.method === 'quantity_unit' ? input.unit : null,
      input.method === 'quantity_unit' ? input.unitPriceMicros : null,
      input.method === 'lump_sum' ? input.lumpSumCents : null,
      auth.accountId, timestamp, input.reason, timestamp, timestamp])
    let amount: number | null = null
    if (row.status === 'closed') {
      const assignments = getAssignments(id)
      if (!assignments.length) throw AppError.stateConflict('工单没有执行人员')
      if (input.method === 'quantity_unit' && row.quantity !== null) {
        const total = assignments.reduce((sum, a) => sum + (a.actualQuantity ?? a.plannedQuantity ?? row.quantity ?? 0), 0)
        if (Math.abs(total - row.quantity) > 0.000001) throw AppError.stateConflict('个人产量之和必须等于工单核定总产量')
      }
      const shares = input.method === 'lump_sum'
        ? new Map(splitLumpSum(input.lumpSumCents, assignments.map((a) => a.personId)).map((s) => [s.personId, s.amountCents * 10000]))
        : null
      amount = 0
      for (const assignment of assignments) {
        const quantity = input.method === 'quantity_unit' ? assignment.actualQuantity ?? assignment.plannedQuantity ?? row.quantity ?? 0 : null
        const personAmount = input.method === 'quantity_unit' ? Math.round(quantity! * input.unitPriceMicros) : shares!.get(assignment.personId)!
        if (!Number.isSafeInteger(personAmount)) throw AppError.badRequest('金额超出允许范围')
        amount += personAmount
        const confirmation = one<{ payroll_company_id: string }>(
          `SELECT payroll_company_id FROM payroll_company_confirmations WHERE work_month = ? AND person_id = ? AND status = 'confirmed'`,
          [month, assignment.personId],
        )
        run(`INSERT INTO payroll_accruals
          (id, ticket_id, person_id, work_site_id, price_rule_version_id, quantity, amount_micros,
           work_month, payroll_company_id, settlement_status, revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'open', 1, ?, ?)`,
        [newId('accrual'), id, assignment.personId, row.site_id, quantity, personAmount,
          month, confirmation?.payroll_company_id ?? existing.find((item) => item.person_id === assignment.personId)?.payroll_company_id ?? null,
          timestamp, timestamp])
      }
    }
    const updated = run(`UPDATE tickets SET amount_micros = ?, price_rule_version_id = NULL,
      price_snapshot_json = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
    [amount, JSON.stringify(input.method === 'quantity_unit'
      ? { unit: input.unit, unitPriceMicros: input.unitPriceMicros }
      : { method: input.method, lumpSumCents: input.lumpSumCents }), timestamp, auth.accountId, id, input.revision])
    if (!updated.changes) throw AppError.revisionConflict()
    const after = mapTicket(ticketRow(id))
    auditTicket(auth, 'ticket.pricing', after, before, after)
  })
  return mapTicket(ticketRow(id))
}

export function cancelTicket(auth: AuditAuth, id: string, revision: number, note: string): Ticket {
  const row = ticketRow(auth, id)
  assertGenericExecution(row, '取消或修改状态')
  if (!canAccessFactoryScope(auth.grants, 'ticket.assign', row.site_id, row.factory_id)) throw AppError.forbidden()
  transition(row, 'cancelled', revision, auth.accountId, note || '取消工单')
  const updated = mapTicket(ticketRow(id))
  auditTicket(auth, 'ticket.cancel', updated, mapTicket(row), updated)
  return updated
}

export function listPriceRules(
  auth: {
    grants: Array<{ capability: string; type: string; id: string }>
    demoIdentityId?: string | null
    selectedBaseId?: string | null
  },
  query: PageQuery,
): PagedResult<PriceRuleVersion> {
  const rows = one<{ rows_json: string }>(
    `SELECT json_group_array(json_object(
      'id', id, 'ticketTypeId', ticket_type_id, 'siteId', site_id,
      'versionNo', version_no, 'unit', unit, 'unitPriceMicros', unit_price_micros,
      'effectiveFrom', effective_from, 'effectiveTo', effective_to, 'status', status
    )) AS rows_json FROM price_rule_versions ORDER BY effective_from DESC`,
  )
  const items = (rows?.rows_json ? JSON.parse(rows.rows_json) as Array<{
    id: string; ticketTypeId: string; siteId: string; versionNo: number; unit: string;
    unitPriceMicros: number; effectiveFrom: string; effectiveTo: string | null; status: string
  }> : [])
    .filter((row) => withinScopedBase(auth, row.siteId))
    .filter((row) => canAccessSite(auth.grants, 'price.view', row.siteId))
    .map((row) => ({ ...row, status: row.status as PriceRuleVersion['status'] }))
  return pageResult(items, query)
}

export function createPriceRule(
  auth: AuditAuth,
  input: {
    ticketTypeId: string
    siteId: string
    unit: string
    unitPriceMicros: number
    effectiveFrom: string
    effectiveTo: string | null
  },
): PriceRuleVersion {
  requireScopedBase(auth, input.siteId)
  if (!canAccessFactoryScope(auth.grants, 'price.manage', input.siteId, null)) throw AppError.forbidden()
  if (!one<IdRow>('SELECT id FROM production_bases WHERE id = ? AND site_confirmed = 1 AND status = ?', [input.siteId, 'active'])) {
    throw AppError.badRequest('计价基地尚未确认或未启用')
  }
  const type = one<TicketType>('SELECT id, code, name, category_id AS categoryId, owner_type AS ownerType, owner_id AS ownerId, origin, status, current_version_id AS currentVersionId, revision, created_at AS createdAt, created_by AS createdBy, updated_at AS updatedAt, updated_by AS updatedBy FROM ticket_types WHERE id = ?', [input.ticketTypeId])
  if (!type || type.status !== 'published') throw AppError.notFound('已发布工单类型')
  const siteCompany = one<{ company_id: string }>(
    'SELECT company_id FROM production_bases WHERE id = ?',
    [input.siteId],
  )?.company_id
  if (!siteCompany) throw AppError.notFound('作业基地')
  if (type.ownerType === 'company' && type.ownerId !== siteCompany) {
    throw AppError.forbidden('本地工单类型只能在实际作业公司计价')
  }
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw AppError.badRequest('失效时间不能早于生效时间')
  const overlap = one<IdRow>(
    `SELECT id FROM price_rule_versions
     WHERE ticket_type_id = ? AND site_id = ? AND status = 'published'
       AND effective_from <= COALESCE(?, '9999-12-31T23:59:59+23:59')
       AND (effective_to IS NULL OR effective_to >= ?)
     LIMIT 1`,
    [input.ticketTypeId, input.siteId, input.effectiveTo, input.effectiveFrom],
  )
  if (overlap) throw AppError.conflict('同一工单类型在该基地的计价生效区间重叠')
  const versionNo = (one<{ max_no: number | null }>(
    'SELECT MAX(version_no) AS max_no FROM price_rule_versions WHERE ticket_type_id = ? AND site_id = ?',
    [input.ticketTypeId, input.siteId],
  )?.max_no ?? 0) + 1
  const id = newId('price')
  const timestamp = nowIso()
  run(
    `INSERT INTO price_rule_versions
      (id, ticket_type_id, site_id, version_no, unit, unit_price_micros, effective_from,
       effective_to, status, revision, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', 1, ?, ?, ?, ?)`,
    [id, input.ticketTypeId, input.siteId, versionNo, input.unit, input.unitPriceMicros,
      input.effectiveFrom, input.effectiveTo, timestamp, auth.accountId, timestamp, auth.accountId],
  )
  const created: PriceRuleVersion = {
    id, ticketTypeId: input.ticketTypeId, siteId: input.siteId, versionNo,
    unit: input.unit, unitPriceMicros: input.unitPriceMicros,
    effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, status: 'published',
  }
  writeAudit({
    accountId: auth.accountId,
    action: 'price.publish',
    entityType: 'price_rule_version',
    entityId: id,
    scopeType: 'base',
    scopeId: input.siteId,
    after: created,
    ipAddress: auth.ipAddress,
  })
  return created
}

export function getPeriod(workMonth: string): PayrollPeriod | undefined {
  const row = one<{
    id: string; work_month: string; status: PayrollPeriod['status'];
    closed_at: string | null; closed_by: string | null; revision: number
  }>('SELECT * FROM payroll_periods WHERE work_month = ?', [workMonth])
  return row ? {
    id: row.id,
    workMonth: row.work_month,
    status: row.status,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    revision: row.revision,
  } : undefined
}

interface PayrollCandidateRow {
  ticketId: string
  status: TicketStatus
  siteId: string
  factoryId: string | null
  personId: string
  personName: string
}

function canManagePayrollForTicket(
  grants: ScopeGrant[],
  ticket: Pick<PayrollCandidateRow, 'siteId' | 'factoryId'>,
  payrollCompanyId?: string,
): boolean {
  return grants.some((grant) => {
    if (grant.capability === 'payroll.close' && grant.type === 'group') return true
    if (!['payroll.close', 'ticket.assign'].includes(grant.capability)) return false
    if (grant.type === 'company') {
      const base = one<{ company_id: string }>(
        'SELECT company_id FROM production_bases WHERE id = ?',
        [ticket.siteId],
      )
      return Boolean(
        base
        && base.company_id === grant.id
        && (!payrollCompanyId || payrollCompanyId === grant.id),
      )
    }
    if (grant.type === 'base') {
      const base = one<{ company_id: string }>(
        'SELECT company_id FROM production_bases WHERE id = ?',
        [ticket.siteId],
      )
      return grant.id === ticket.siteId
        && Boolean(base)
        && (!payrollCompanyId || base?.company_id === payrollCompanyId)
    }
    if (grant.type === 'factory') {
      const factory = one<{ company_id: string }>(
        'SELECT company_id FROM factories WHERE id = ?',
        [grant.id],
      )
      return grant.id === ticket.factoryId
        && Boolean(factory)
        && (!payrollCompanyId || factory?.company_id === payrollCompanyId)
    }
    return false
  })
}

function payrollCandidateRows(workMonth: string, baseId: string | null = null): PayrollCandidateRow[] {
  return all<{
    ticket_id: string
    status: TicketStatus
    site_id: string
    factory_id: string | null
    person_id: string
    person_name: string
  }>(
    `SELECT t.id AS ticket_id, t.status, t.site_id, t.factory_id,
            ta.person_id, COALESCE(ta.person_name_snapshot, p.name) AS person_name
       FROM tickets t
       JOIN ticket_assignments ta ON ta.ticket_id = t.id
       JOIN people p ON p.id = ta.person_id
      WHERE t.status IN ('completed', 'closed')
        AND substr(t.work_date, 1, 7) = ?
      ORDER BY t.event_time, t.id, ta.person_id`,
    [workMonth],
  ).filter((row) => baseId === null || row.site_id === baseId).map((row) => ({
    ticketId: row.ticket_id,
    status: row.status,
    siteId: row.site_id,
    factoryId: row.factory_id,
    personId: row.person_id,
    personName: row.person_name,
  }))
}

export function listPayrollConfirmCandidates(
  auth: {
    grants: Array<{ capability: string; type: string; id: string }>
    demoIdentityId?: string | null
    selectedBaseId?: string | null
  },
  workMonth: string,
): PayrollConfirmCandidate[] {
  const confirmations = new Map(
    all<{ person_id: string; payroll_company_id: string }>(
      `SELECT person_id, payroll_company_id
         FROM payroll_company_confirmations
        WHERE work_month = ? AND status = 'confirmed'`,
      [workMonth],
    ).map((row) => [row.person_id, row.payroll_company_id]),
  )
  const candidates = new Map<string, PayrollConfirmCandidate>()
  for (const ticket of payrollCandidateRows(workMonth, scopedBaseId(auth))) {
    if (!canManagePayrollForTicket(auth.grants, ticket)) continue
    const current = candidates.get(ticket.personId) ?? {
      personId: ticket.personId,
      personName: ticket.personName,
      ticketIds: [],
      ticketStatuses: [],
      payrollCompanyId: confirmations.get(ticket.personId) ?? null,
    }
    if (!current.ticketIds.includes(ticket.ticketId)) current.ticketIds.push(ticket.ticketId)
    if (!current.ticketStatuses.includes(ticket.status)) current.ticketStatuses.push(ticket.status)
    candidates.set(ticket.personId, current)
  }
  return [...candidates.values()]
}

export function confirmPayrollCompany(
  auth: AuditAuth,
  workMonth: string,
  personIds: string[],
  payrollCompanyId: string,
): void {
  const company = one<{ id: string }>('SELECT id FROM companies WHERE id = ? AND payroll_enabled = 1', [payrollCompanyId])
  if (!company) throw AppError.notFound('可发放工资的公司')
  const period = getPeriod(workMonth)
  if (period?.status === 'closed') throw AppError.stateConflict('该月已关账')
  const rows = payrollCandidateRows(workMonth, scopedBaseId(auth))
  const eligiblePeople = new Set(rows.map((row) => row.personId))
  for (const personId of personIds) {
    if (!eligiblePeople.has(personId)) {
      throw AppError.badRequest('只能确认本月已提交或已关闭工单中的执行人员')
    }
    const authorized = rows.some((row) => (
      row.personId === personId
      && canManagePayrollForTicket(auth.grants, row, payrollCompanyId)
    ))
    if (!authorized) throw AppError.forbidden('不能确认实际作业范围之外人员的工资主体')
  }
  transaction(() => {
    for (const personId of personIds) {
      const person = one<IdRow>('SELECT id FROM people WHERE id = ?', [personId])
      if (!person) throw AppError.notFound('人员')
      run(
        `INSERT INTO payroll_company_confirmations
          (id, work_month, person_id, payroll_company_id, status, confirmed_by, confirmed_at, revision)
         VALUES (?, ?, ?, ?, 'confirmed', ?, ?, 1)
         ON CONFLICT(work_month, person_id) DO UPDATE SET
           payroll_company_id = excluded.payroll_company_id,
           status = 'confirmed',
           confirmed_by = excluded.confirmed_by,
           confirmed_at = excluded.confirmed_at,
           revision = payroll_company_confirmations.revision + 1`,
        [newId('payconfirm'), workMonth, personId, payrollCompanyId, auth.accountId, nowIso()],
      )
      run(
        `UPDATE payroll_accruals SET payroll_company_id = ?
         WHERE work_month = ? AND person_id = ? AND settlement_status = 'open'
           AND (? IS NULL OR work_site_id = ?)`,
        [payrollCompanyId, workMonth, personId, scopedBaseId(auth), scopedBaseId(auth)],
      )
    }
  })
  writeAudit({
    accountId: auth.accountId,
    action: 'payroll.company.confirm',
    entityType: 'payroll_period',
    entityId: workMonth,
    scopeType: 'company',
    scopeId: payrollCompanyId,
    after: { workMonth, personIds, payrollCompanyId },
    ipAddress: auth.ipAddress,
  })
}

export function listPayrollAccruals(
  auth: {
    personId?: string | null
    grants: Array<{ capability: string; type: string; id: string }>
    demoIdentityId?: string | null
    selectedBaseId?: string | null
  },
  workMonth: string,
  payrollCompanyId?: string,
): PayrollAccrual[] {
  const rows = one<{ rows_json: string }>(
    `SELECT json_group_array(json_object(
      'id', pa.id, 'ticketId', pa.ticket_id, 'personId', pa.person_id,
      'businessWorkItemId', pa.business_work_item_id,
      'workSiteId', pa.work_site_id, 'factoryId', t.factory_id,
      'priceRuleVersionId', pa.price_rule_version_id, 'quantity', pa.quantity,
      'amountMicros', pa.amount_micros, 'workMonth', pa.work_month,
      'payrollCompanyId', pa.payroll_company_id, 'settlementStatus', pa.settlement_status
    )) AS rows_json
      FROM payroll_accruals pa
      JOIN tickets t ON t.id = pa.ticket_id
     WHERE pa.work_month = ?`,
    [workMonth],
  )
  const selectedBase = scopedBaseId(auth)
  return (rows?.rows_json ? JSON.parse(rows.rows_json) as Array<PayrollAccrual & { factoryId: string | null }> : [])
    .filter((row) => selectedBase === null || row.workSiteId === selectedBase)
    .filter((row) => (
      canAccessFactoryScope(auth.grants, 'payroll.view', row.workSiteId, row.factoryId)
      || (row.personId === auth.personId
        && auth.grants.some((grant) => grant.capability === 'ticket.execute'))
    ))
    .filter((row) => !payrollCompanyId || row.payrollCompanyId === payrollCompanyId)
    .map(({ factoryId: _factoryId, ...row }) => row)
}

export function payrollSummary(
  auth: {
    personId?: string | null
    grants: Array<{ capability: string; type: string; id: string }>
    demoIdentityId?: string | null
    selectedBaseId?: string | null
  },
  workMonth: string,
): {
  period: PayrollPeriod
  pendingPricing: Array<{ id: string; ticketNo: string; workDate: string; siteName: string }>
  companies: Array<{
    payrollCompanyId: string | null
    companyName: string
    personCount: number
    ticketCount: number
    amountMicros: number
    unconfirmedCount: number
    items: PayrollAccrual[]
  }>
} {
  const period = getPeriod(workMonth) ?? ensurePeriod(workMonth)
  const selectedBase = scopedBaseId(auth)
  const accruals = listPayrollAccruals(auth, workMonth)
  const groups = new Map<string | null, PayrollAccrual[]>()
  for (const accrual of accruals) {
    const key = accrual.payrollCompanyId
    groups.set(key, [...(groups.get(key) ?? []), accrual])
  }
  return {
    period,
    pendingPricing: all<{ id: string; ticket_no: string; work_date: string; site_id: string; site_name: string; factory_id: string | null }>(
      `SELECT t.id, t.ticket_no, t.work_date, t.site_id, b.name AS site_name, t.factory_id
       FROM tickets t JOIN production_bases b ON b.id = t.site_id
       WHERE t.status = 'closed' AND substr(t.work_date, 1, 7) = ? AND (
         EXISTS (SELECT 1 FROM ticket_pricing p WHERE p.ticket_id = t.id AND p.status = 'pending')
         OR EXISTS (SELECT 1 FROM ticket_business_work_items w WHERE w.ticket_id = t.id AND w.price_status = 'pending')
       )
       ORDER BY t.work_date, t.ticket_no`, [workMonth],
    ).filter((row) => selectedBase === null || row.site_id === selectedBase)
      .filter((row) => canAccessFactoryScope(auth.grants, 'payroll.view', row.site_id, row.factory_id))
      .map((row) => ({ id: row.id, ticketNo: row.ticket_no, workDate: row.work_date, siteName: row.site_name })),
    companies: [...groups.entries()].map(([companyId, items]) => ({
      payrollCompanyId: companyId,
      companyName: companyId
        ? one<{ name: string }>('SELECT name FROM companies WHERE id = ?', [companyId])?.name || companyId
        : '待确认发放公司',
      personCount: new Set(items.map((item) => item.personId)).size,
      ticketCount: new Set(items.map((item) => item.ticketId)).size,
      amountMicros: items.reduce((sum, item) => sum + item.amountMicros, 0),
      unconfirmedCount: items.filter((item) => !item.payrollCompanyId).length,
      items,
    })),
  }
}

function ensurePeriod(workMonth: string): PayrollPeriod {
  const id = newId('period')
  const timestamp = nowIso()
  run(
    `INSERT INTO payroll_periods
      (id, work_month, status, closed_at, closed_by, revision, created_at, updated_at)
     VALUES (?, ?, 'open', NULL, NULL, 1, ?, ?)`,
    [id, workMonth, timestamp, timestamp],
  )
  return { id, workMonth, status: 'open', closedAt: null, closedBy: null, revision: 1 }
}

export function closePayroll(
  auth: AuditAuth,
  workMonth: string,
  revision: number,
  replaceAccruals: Array<{ accrualId: string; quantity: number; reason: string }>,
  additionalAccruals: Array<{
    ticketId: string
    personId: string
    workSiteId: string
    priceRuleVersionId: string
    quantity: number
    amountMicros: number
    reason: string
  }>,
): PayrollPeriod {
  if (!auth.grants.some((grant) => grant.capability === 'payroll.close' && grant.type === 'group')) {
    throw AppError.forbidden('仅总部可月结锁定')
  }
  const selectedBase = scopedBaseId(auth)
  if (selectedBase !== null) {
    throw AppError.stateConflict('薪资月结是总部整月操作，当前生产基地视图不能执行')
  }
  let period = getPeriod(workMonth) ?? ensurePeriod(workMonth)
  if (period.status === 'closed') throw AppError.stateConflict('该月已关账')
  const pendingPricing = one<{ count: number }>(
    `SELECT count(*) AS count FROM tickets t
     WHERE t.work_date LIKE ? AND t.status = 'closed' AND (? IS NULL OR t.site_id = ?) AND (
       EXISTS (SELECT 1 FROM ticket_pricing p WHERE p.ticket_id = t.id AND p.status = 'pending')
       OR EXISTS (SELECT 1 FROM ticket_business_work_items w WHERE w.ticket_id = t.id AND w.price_status = 'pending')
     )`,
    [`${workMonth}-%`, selectedBase, selectedBase],
  )
  if (pendingPricing?.count) throw AppError.stateConflict('存在已审核但尚未定价的工单，不能月结')
  const accruals = listPayrollAccruals(auth, workMonth)
  if (accruals.some((accrual) => !accrual.payrollCompanyId)) {
    throw AppError.stateConflict('仍有计件记录未确认发放公司，不能月结')
  }
  transaction(() => {
    for (const adjustment of replaceAccruals) {
      const original = one<AccrualRow>('SELECT * FROM payroll_accruals WHERE id = ?', [adjustment.accrualId])
      if (!original || original.work_month !== workMonth) throw AppError.notFound('计件记录')
      requireScopedBase(auth, original.work_site_id)
      if (original.business_work_item_id) throw AppError.stateConflict('生产、装卸工作量更正本轮未开放')
      const ticket = ticketRow(original.ticket_id)
      const priceSnapshot = JSON.parse(ticket.price_snapshot_json || '{}') as { unitPriceMicros?: number }
      const pricing = one<{ method: string; unit_price_micros: number | null }>(
        'SELECT method, unit_price_micros FROM ticket_pricing WHERE ticket_id = ?', [original.ticket_id],
      )
      if (pricing && pricing.method !== 'quantity_unit') throw AppError.stateConflict('总包工单不能按数量调整')
      const legacyPrice = one<PriceRuleRow>('SELECT * FROM price_rule_versions WHERE id = ?', [original.price_rule_version_id])
      const unitPrice = pricing?.unit_price_micros ?? priceSnapshot.unitPriceMicros ?? legacyPrice?.unit_price_micros
      if (unitPrice === undefined || unitPrice === null) throw AppError.stateConflict('原计件记录缺少冻结的单价')
      run(
        `UPDATE payroll_accruals
         SET quantity = ?, amount_micros = ?, settlement_status = 'adjusted',
             adjustment_of_id = ?, adjustment_reason = ?, revision = revision + 1,
             updated_at = ?
         WHERE id = ? AND settlement_status = 'open'`,
        [adjustment.quantity, Math.round(adjustment.quantity * unitPrice),
          original.id, adjustment.reason, nowIso(), original.id],
      )
    }
    for (const additional of additionalAccruals) {
      const target = ticketRow(additional.ticketId)
      requireScopedBase(auth, additional.workSiteId)
      requireScopedBase(auth, target.site_id)
      if (target.business_kind && target.business_kind !== 'generic') throw AppError.stateConflict('本轮不能向生产、装卸工单追加薪酬记录')
      run(
        `INSERT INTO payroll_accruals
          (id, ticket_id, person_id, work_site_id, price_rule_version_id, quantity, amount_micros,
           work_month, payroll_company_id, settlement_status, revision, created_at, updated_at,
           adjustment_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'adjusted', 1, ?, ?, ?)`,
        [newId('accrual'), additional.ticketId, additional.personId, additional.workSiteId,
          additional.priceRuleVersionId, additional.quantity, additional.amountMicros,
          workMonth, nowIso(), nowIso(), additional.reason],
      )
    }
    run(
      `UPDATE payroll_accruals SET settlement_status = 'locked', revision = revision + 1,
         updated_at = ? WHERE work_month = ? AND settlement_status = 'open'`,
      [nowIso(), workMonth],
    )
    const result = run(
      `UPDATE payroll_periods SET status = 'closed', closed_at = ?, closed_by = ?,
         revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`,
      [nowIso(), auth.accountId, nowIso(), period.id, revision],
    )
    if (!result.changes) throw AppError.revisionConflict()
    period = {
      ...period,
      status: 'closed',
      closedAt: nowIso(),
      closedBy: auth.accountId,
      revision: period.revision + 1,
    }
  })
  writeAudit({
    accountId: auth.accountId,
    action: 'payroll.close',
    entityType: 'payroll_period',
    entityId: workMonth,
    scopeType: 'group',
    scopeId: 'group',
    after: { workMonth, revision: period.revision, replaceAccruals, additionalAccruals },
    ipAddress: auth.ipAddress,
  })
  return period
}

export function reopenPayroll(
  auth: AuditAuth,
  workMonth: string,
  revision: number,
): PayrollPeriod {
  if (!auth.grants.some((grant) => grant.capability === 'payroll.close' && grant.type === 'group')) {
    throw AppError.forbidden('仅总部可重开月结')
  }
  if (scopedBaseId(auth) !== null) {
    throw AppError.stateConflict('薪资重开是总部整月操作，当前生产基地视图不能执行')
  }
  const period = getPeriod(workMonth)
  if (!period) throw AppError.notFound('月度期间')
  transaction(() => {
    const result = run(
      `UPDATE payroll_periods SET status = 'reopened', revision = revision + 1,
         updated_at = ? WHERE id = ? AND revision = ? AND status = 'closed'`,
      [nowIso(), period.id, revision],
    )
    if (!result.changes) throw AppError.revisionConflict()
    run(
      `UPDATE payroll_accruals SET settlement_status = 'open', revision = revision + 1,
         updated_at = ? WHERE work_month = ? AND settlement_status = 'locked'`,
      [nowIso(), workMonth],
    )
  })
  const reopened: PayrollPeriod = {
    ...period,
    status: 'reopened',
    revision: period.revision + 1,
  }
  writeAudit({
    accountId: auth.accountId,
    action: 'payroll.reopen',
    entityType: 'payroll_period',
    entityId: workMonth,
    scopeType: 'group',
    scopeId: 'group',
    before: period,
    after: reopened,
    ipAddress: auth.ipAddress,
  })
  return getPeriod(workMonth) ?? reopened
}

export function listEligibleCandidates(
  auth: {
    grants: Array<{ capability: string; type: string; id: string }>
    demoIdentityId?: string | null
    selectedBaseId?: string | null
  },
  input: {
    siteId: string
    factoryId: string | null
    workAreaId: string | null
    productionLineId: string | null
    crewId: string | null
    eventTime: string
    workDate: string
  },
) {
  requireScopedBase(auth, input.siteId)
  if (!canAccessFactoryScope(auth.grants, 'ticket.assign', input.siteId, input.factoryId)) throw AppError.forbidden()
  if (input.crewId) assertCrewLocation(input.crewId, input.workAreaId, input.productionLineId)
  return rosterContext.findEligibleCandidates(input)
}
