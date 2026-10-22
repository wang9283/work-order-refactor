import type { SQLInputValue } from 'node:sqlite'
import type {
  FormVersionSchema,
  PagedResult,
  WorkProfile,
} from '../../../packages/contracts/src'
import { newId } from '../../core/ids'
import { all, one, run, transaction } from '../../db/database'
import type {
  FormTemplateRow,
  FormVersionRow,
  TicketTypeRow,
  TicketTypeVersionRow,
  WorkProfileRow,
} from './types'
import { mapFormTemplate, mapFormVersion, mapTicketType, mapTicketTypeVersion, mapWorkProfile } from './types'

const now = () => new Date().toISOString()

export interface Paging {
  page: number
  pageSize: number
}

export interface FormListFilter extends Paging {
  q?: string
  ownerType?: 'group' | 'company'
  ownerId?: string
  status?: 'draft' | 'published' | 'retired'
}

export interface TicketTypeListFilter extends Paging {
  q?: string
  ownerType?: 'group' | 'company'
  ownerId?: string
  status?: 'draft' | 'published' | 'retired' | 'archived'
}

function pageMeta<T>(items: T[], total: number, paging: Paging): PagedResult<T> {
  return {
    items,
    meta: {
      page: paging.page,
      pageSize: paging.pageSize,
      total,
      totalPages: total ? Math.ceil(total / paging.pageSize) : 0,
    },
  }
}

export function listForms(filter: FormListFilter): PagedResult<ReturnType<typeof mapFormTemplate>> {
  const clauses: string[] = []
  const params: SQLInputValue[] = []
  if (filter.q) {
    clauses.push('(t.code LIKE ? OR t.name LIKE ?)')
    params.push(`%${filter.q}%`, `%${filter.q}%`)
  }
  if (filter.ownerType) {
    clauses.push('t.owner_type = ?')
    params.push(filter.ownerType)
  }
  if (filter.ownerId) {
    clauses.push('t.owner_id = ?')
    params.push(filter.ownerId)
  }
  if (filter.status) {
    clauses.push('EXISTS (SELECT 1 FROM form_versions fv WHERE fv.template_id = t.id AND fv.status = ?)')
    params.push(filter.status)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = Number(one<{ count: number }>(`SELECT COUNT(*) AS count FROM form_templates t ${where}`, params)?.count ?? 0)
  const rows = all<FormTemplateRow>(
    `SELECT t.* FROM form_templates t ${where}
     ORDER BY t.updated_at DESC, t.code ASC LIMIT ? OFFSET ?`,
    [...params, filter.pageSize, (filter.page - 1) * filter.pageSize],
  )
  return pageMeta(rows.map(mapFormTemplate), total, filter)
}

export function getForm(id: string): FormTemplateRow | undefined {
  return one<FormTemplateRow>('SELECT * FROM form_templates WHERE id = ?', [id])
}

export function getFormVersion(id: string): FormVersionRow | undefined {
  return one<FormVersionRow>('SELECT * FROM form_versions WHERE id = ?', [id])
}

export function getFormVersions(templateId: string): FormVersionRow[] {
  return all<FormVersionRow>(
    'SELECT * FROM form_versions WHERE template_id = ? ORDER BY version_no DESC',
    [templateId],
  )
}

export function getFormDetail(id: string) {
  const row = getForm(id)
  if (!row) return null
  return {
    ...mapFormTemplate(row),
    versions: getFormVersions(id).map(mapFormVersion),
  }
}

export function createForm(input: {
  code: string
  name: string
  ownerType: 'group' | 'company'
  ownerId: string
  source: 'native' | 'excel'
  schema: FormVersionSchema
  actorId: string | null
}): { formId: string; versionId: string } {
  return transaction(() => {
    const timestamp = now()
    const formId = newId('form')
    const versionId = newId('formver')
    run(
      `INSERT INTO form_templates
       (id, code, name, owner_type, owner_id, source, current_published_version_id, revision,
        created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?)`,
      [formId, input.code, input.name, input.ownerType, input.ownerId, input.source, timestamp,
        input.actorId, timestamp, input.actorId],
    )
    run(
      `INSERT INTO form_versions
       (id, template_id, version_no, status, schema_json, published_at, published_by,
        revision, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, 1, 'draft', ?, NULL, NULL, 1, ?, ?, ?, ?)`,
      [versionId, formId, JSON.stringify(input.schema), timestamp, input.actorId, timestamp, input.actorId],
    )
    return { formId, versionId }
  })
}

export function createFormVersion(templateId: string, actorId: string | null, sourceVersion?: FormVersionRow, suppliedSchema?: FormVersionSchema) {
  return transaction(() => {
    const form = getForm(templateId)
    if (!form) return null
    const versions = getFormVersions(templateId)
    const base = sourceVersion ?? versions.find((item) => item.status === 'draft') ?? versions[0]
    if (!base && !suppliedSchema) return null
    const nextNo = Math.max(0, ...versions.map((item) => item.version_no)) + 1
    const versionId = newId('formver')
    const timestamp = now()
    run(
      `INSERT INTO form_versions
       (id, template_id, version_no, status, schema_json, published_at, published_by,
        revision, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, 'draft', ?, NULL, NULL, 1, ?, ?, ?, ?)`,
      [versionId, templateId, nextNo,
        JSON.stringify(suppliedSchema ?? JSON.parse(base!.schema_json)),
        timestamp, actorId, timestamp, actorId],
    )
    run('UPDATE form_templates SET updated_at = ?, updated_by = ? WHERE id = ?', [timestamp, actorId, templateId])
    return versionId
  })
}

export function updateFormVersion(
  templateId: string,
  versionId: string,
  revision: number,
  schema: FormVersionSchema,
  actorId: string | null,
): boolean {
  return transaction(() => {
    const version = getFormVersion(versionId)
    if (!version || version.template_id !== templateId || version.status !== 'draft') return false
    const timestamp = now()
    const result = run(
      `UPDATE form_versions
       SET schema_json = ?, revision = revision + 1, updated_at = ?, updated_by = ?
       WHERE id = ? AND revision = ? AND status = 'draft'`,
      [JSON.stringify(schema), timestamp, actorId, versionId, revision],
    )
    if (result.changes) {
      run('UPDATE form_templates SET updated_at = ?, updated_by = ? WHERE id = ?', [timestamp, actorId, templateId])
    }
    return result.changes === 1
  })
}

export function deleteDraftVersion(templateId: string, versionId: string): 'deleted' | 'missing' | 'published' | 'last' {
  return transaction(() => {
    const version = getFormVersion(versionId)
    if (!version || version.template_id !== templateId) return 'missing'
    if (version.status !== 'draft') return 'published'
    if (getFormVersions(templateId).length <= 1) return 'last'
    run('DELETE FROM form_versions WHERE id = ?', [versionId])
    return 'deleted'
  })
}

export function publishFormVersion(templateId: string, versionId: string, revision: number, actorId: string | null): boolean {
  return transaction(() => {
    const version = getFormVersion(versionId)
    if (!version || version.template_id !== templateId || version.status !== 'draft' || version.revision !== revision) {
      return false
    }
    const timestamp = now()
    const result = run(
      `UPDATE form_versions
       SET status = 'published', published_at = ?, published_by = ?, revision = revision + 1,
           updated_at = ?, updated_by = ?
       WHERE id = ? AND revision = ? AND status = 'draft'`,
      [timestamp, actorId, timestamp, actorId, versionId, revision],
    )
    if (!result.changes) return false
    run(
      `UPDATE form_templates
       SET current_published_version_id = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [versionId, timestamp, actorId, templateId],
    )
    return true
  })
}

export function listTicketTypes(filter: TicketTypeListFilter) {
  const clauses: string[] = []
  const params: SQLInputValue[] = []
  if (filter.q) {
    clauses.push('(code LIKE ? OR name LIKE ?)')
    params.push(`%${filter.q}%`, `%${filter.q}%`)
  }
  if (filter.ownerType) {
    clauses.push('owner_type = ?')
    params.push(filter.ownerType)
  }
  if (filter.ownerId) {
    clauses.push('owner_id = ?')
    params.push(filter.ownerId)
  }
  if (filter.status) {
    clauses.push('status = ?')
    params.push(filter.status)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = Number(one<{ count: number }>(`SELECT COUNT(*) AS count FROM ticket_types ${where}`, params)?.count ?? 0)
  const rows = all<TicketTypeRow>(
    `SELECT * FROM ticket_types ${where} ORDER BY updated_at DESC, code ASC LIMIT ? OFFSET ?`,
    [...params, filter.pageSize, (filter.page - 1) * filter.pageSize],
  )
  return pageMeta(rows.map(mapTicketType), total, filter)
}

export function getTicketType(id: string): TicketTypeRow | undefined {
  return one<TicketTypeRow>('SELECT * FROM ticket_types WHERE id = ?', [id])
}

export function getTicketTypeVersion(id: string): TicketTypeVersionRow | undefined {
  return one<TicketTypeVersionRow>('SELECT * FROM ticket_type_versions WHERE id = ?', [id])
}

export function getWorkProfiles(versionId: string): WorkProfile[] {
  return all<WorkProfileRow>(
    'SELECT * FROM work_profiles WHERE ticket_type_version_id = ? ORDER BY site_id, work_area_id, id',
    [versionId],
  ).map(mapWorkProfile)
}

export function getTicketTypeDetail(id: string) {
  const row = getTicketType(id)
  if (!row) return null
  const versions = all<TicketTypeVersionRow>(
    'SELECT * FROM ticket_type_versions WHERE ticket_type_id = ? ORDER BY version_no DESC',
    [id],
  )
  const detailVersions = versions.map((version) => {
    const mapped = mapTicketTypeVersion(version, getWorkProfiles(version.id))
    const formVersion = getFormVersion(version.form_version_id)
    if (formVersion) mapped.formSchema = JSON.parse(formVersion.schema_json)
    return mapped
  })
  return { ...mapTicketType(row), canEdit: row.status !== 'archived', versions: detailVersions }
}

export type WorkProfileInput = Omit<WorkProfile, 'id' | 'ticketTypeVersionId' | 'status'>

function insertWorkProfiles(versionId: string, profiles: WorkProfileInput[], status: 'draft' | 'published') {
  const timestamp = now()
  for (const profile of profiles) {
    run(
      `INSERT INTO work_profiles
       (id, ticket_type_version_id, site_id, work_area_id, production_line_id, crew_id,
        shift_template_id, generation_mode, handover_grouping, handover_required,
        time_window_start, time_window_end, early_start_minutes, late_end_minutes,
        assignment_mode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('workprofile'), versionId, profile.siteId, profile.workAreaId,
        profile.productionLineId, profile.crewId, profile.shiftTemplateId,
        profile.generationMode, profile.handoverGrouping, profile.handoverRequired ? 1 : 0,
        profile.timeWindowStart, profile.timeWindowEnd, profile.earlyStartMinutes,
        profile.lateEndMinutes, profile.assignmentMode, status, timestamp, timestamp],
    )
  }
}

export function deleteWorkProfiles(versionId: string) {
  run('DELETE FROM work_profiles WHERE ticket_type_version_id = ?', [versionId])
}

export function createTicketCategory(input: {
  code: string
  name: string
  ownerType: 'group' | 'company'
  ownerId: string
  actorId: string | null
}) {
  const id = newId('cat')
  const timestamp = now()
  run(
    `INSERT INTO ticket_categories
     (id, code, name, owner_type, owner_id, status, revision, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
    [id, input.code, input.name, input.ownerType, input.ownerId, timestamp, input.actorId, timestamp, input.actorId],
  )
  return id
}

export function getTicketCategory(id: string) {
  return one<{
    id: string
    code: string
    name: string
    owner_type: 'group' | 'company'
    owner_id: string
    status: string
  }>('SELECT id, code, name, owner_type, owner_id, status FROM ticket_categories WHERE id = ?', [id])
}

export function createTicketType(input: {
  code: string
  name: string
  categoryId: string
  ownerType: 'group' | 'company'
  ownerId: string
  formTemplateId: string
  formVersionId: string
  workProfiles: WorkProfileInput[]
  actorId: string | null
}): { typeId: string; versionId: string } {
  return transaction(() => {
    const timestamp = now()
    const typeId = newId('tickettype')
    const versionId = newId('tickettypever')
    run(
      `INSERT INTO ticket_types
       (id, code, name, category_id, owner_type, owner_id, origin, status,
        current_version_id, revision, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', NULL, 1, ?, ?, ?, ?)`,
      [typeId, input.code, input.name, input.categoryId, input.ownerType, input.ownerId,
        input.ownerType === 'group' ? 'group_standard' : 'local',
        timestamp, input.actorId, timestamp, input.actorId],
    )
    run(
      `INSERT INTO ticket_type_versions
       (id, ticket_type_id, version_no, status, form_version_id, published_at, published_by,
        revision, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, 1, 'draft', ?, NULL, NULL, 1, ?, ?, ?, ?)`,
      [versionId, typeId, input.formVersionId, timestamp, input.actorId, timestamp, input.actorId],
    )
    insertWorkProfiles(versionId, input.workProfiles, 'draft')
    return { typeId, versionId }
  })
}

export function createTicketTypeVersion(input: {
  typeId: string
  formVersionId: string
  workProfiles: WorkProfileInput[]
  actorId: string | null
}) {
  return transaction(() => {
    const type = getTicketType(input.typeId)
    if (!type) return null
    const versions = all<TicketTypeVersionRow>(
      'SELECT * FROM ticket_type_versions WHERE ticket_type_id = ? ORDER BY version_no DESC',
      [input.typeId],
    )
    const versionId = newId('tickettypever')
    const timestamp = now()
    const nextNo = Math.max(0, ...versions.map((version) => version.version_no)) + 1
    run(
      `INSERT INTO ticket_type_versions
       (id, ticket_type_id, version_no, status, form_version_id, published_at, published_by,
        revision, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, 'draft', ?, NULL, NULL, 1, ?, ?, ?, ?)`,
      [versionId, input.typeId, nextNo, input.formVersionId, timestamp, input.actorId, timestamp, input.actorId],
    )
    insertWorkProfiles(versionId, input.workProfiles, 'draft')
    run('UPDATE ticket_types SET updated_at = ?, updated_by = ? WHERE id = ?', [timestamp, input.actorId, input.typeId])
    return versionId
  })
}

export function updateTicketTypeVersion(input: {
  typeId: string
  versionId: string
  revision: number
  formVersionId: string
  workProfiles: WorkProfileInput[]
  actorId: string | null
}): boolean {
  return transaction(() => {
    const version = getTicketTypeVersion(input.versionId)
    if (!version || version.ticket_type_id !== input.typeId || version.status !== 'draft' || version.revision !== input.revision) {
      return false
    }
    const timestamp = now()
    const result = run(
      `UPDATE ticket_type_versions
       SET form_version_id = ?, revision = revision + 1, updated_at = ?, updated_by = ?
       WHERE id = ? AND revision = ? AND status = 'draft'`,
      [input.formVersionId, timestamp, input.actorId, input.versionId, input.revision],
    )
    if (!result.changes) return false
    deleteWorkProfiles(input.versionId)
    insertWorkProfiles(input.versionId, input.workProfiles, 'draft')
    run('UPDATE ticket_types SET updated_at = ?, updated_by = ? WHERE id = ?', [timestamp, input.actorId, input.typeId])
    return true
  })
}

export function publishTicketTypeVersion(typeId: string, versionId: string, revision: number, actorId: string | null): boolean {
  return transaction(() => {
    const version = getTicketTypeVersion(versionId)
    if (!version || version.ticket_type_id !== typeId || version.status !== 'draft' || version.revision !== revision) {
      return false
    }
    const timestamp = now()
    const result = run(
      `UPDATE ticket_type_versions
       SET status = 'published', published_at = ?, published_by = ?, revision = revision + 1,
           updated_at = ?, updated_by = ?
       WHERE id = ? AND revision = ? AND status = 'draft'`,
      [timestamp, actorId, timestamp, actorId, versionId, revision],
    )
    if (!result.changes) return false
    run(
      `UPDATE work_profiles SET status = 'published', updated_at = ?
       WHERE ticket_type_version_id = ?`,
      [timestamp, versionId],
    )
    run(
      `UPDATE ticket_types
       SET status = 'published', current_version_id = ?, revision = revision + 1,
           updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [versionId, timestamp, actorId, typeId],
    )
    return true
  })
}
