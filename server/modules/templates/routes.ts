import multipart from '@fastify/multipart'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Capability, FormVersionSchema, ScopeRef } from '../../../packages/contracts/src'
import { hasGrant, requireAuth, type AuthContext } from '../../core/auth'
import { AppError } from '../../core/errors'
import { parseInput, success } from '../../core/http'
import { newId } from '../../core/ids'
import { one, run, transaction } from '../../db/database'
import { parseExcel, saveSourceFile } from './excel'
import {
  createForm,
  createFormVersion,
  createTicketCategory,
  createTicketType,
  createTicketTypeVersion,
  deleteDraftVersion,
  getForm,
  getFormDetail,
  getFormVersion,
  getFormVersions,
  getTicketCategory,
  getTicketType,
  getTicketTypeDetail,
  getTicketTypeVersion,
  listForms,
  listTicketTypes,
  publishFormVersion,
  publishTicketTypeVersion,
  updateFormVersion,
  updateTicketTypeVersion,
} from './repository'
import {
  excelCommitSchema,
  formTemplateCreateSchema,
  formTemplateQuerySchema,
  formVersionCreateSchema,
  formVersionUpdateSchema,
  publishVersionSchema,
  ticketCategoryCreateSchema,
  ticketTypeCreateSchema,
  ticketTypeQuerySchema,
  ticketTypeVersionCreateSchema,
  ticketTypeVersionUpdateSchema,
} from './schema'

type IdParams = { id: string }
type VersionParams = { id: string; versionId: string }

function ownerScope(ownerType: 'group' | 'company', ownerId: string): ScopeRef {
  return ownerType === 'group' ? { type: 'group', id: 'group' } : { type: 'company', id: ownerId }
}

function visibleCompanyIds(auth: AuthContext): Set<string> | null {
  if (auth.grants.some((grant) => grant.type === 'group')) return null
  const ids = new Set<string>()
  for (const grant of auth.grants) {
    if (grant.type === 'company') ids.add(grant.id)
    if (grant.type === 'base') {
      const base = one<{ company_id: string }>('SELECT company_id FROM production_bases WHERE id = ?', [grant.id])
      if (base) ids.add(base.company_id)
    }
    if (grant.type === 'work_area') {
      const base = one<{ company_id: string }>(
        `SELECT b.company_id FROM work_areas wa
         JOIN production_bases b ON b.id = wa.base_id WHERE wa.id = ?`,
        [grant.id],
      )
      if (base) ids.add(base.company_id)
    }
  }
  return ids
}

function assertOwnerVisible(auth: AuthContext, ownerType: 'group' | 'company', ownerId: string): void {
  if (ownerType === 'group' && !auth.grants.some((grant) => grant.type === 'group')) {
    throw AppError.forbidden('集团标准仅总部账号可维护')
  }
  const visible = visibleCompanyIds(auth)
  if (ownerType === 'company' && visible && !visible.has(ownerId)) throw AppError.forbidden()
}

function canManage(auth: AuthContext, ownerType: 'group' | 'company', ownerId: string): boolean {
  try {
    assertCapability(auth, 'form.manage', ownerScope(ownerType, ownerId))
    return true
  } catch {
    return false
  }
}

function assertCapability(auth: AuthContext, capability: Capability, scope: ScopeRef): void {
  if (!hasGrant(auth, capability, scope)) throw AppError.forbidden()
}

function paged<T>(request: FastifyRequest, result: { items: T[]; meta: Parameters<typeof success>[2] }) {
  return success(request, result.items, result.meta)
}

function formVisible(auth: AuthContext, form: NonNullable<ReturnType<typeof getForm>>): boolean {
  if (form.owner_type === 'group') return true
  const visible = visibleCompanyIds(auth)
  return visible === null || visible.has(form.owner_id)
}

function ticketTypeVisible(auth: AuthContext, type: NonNullable<ReturnType<typeof getTicketType>>): boolean {
  if (type.owner_type === 'group') return true
  const visible = visibleCompanyIds(auth)
  return visible === null || visible.has(type.owner_id)
}

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  })

  // ---------- form templates ----------
  app.get('/forms', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(formTemplateQuerySchema, request.query)
    const result = listForms(query)
    const visible = visibleCompanyIds(auth)
    const items = result.items.filter((form) => form.ownerType === 'group' || visible === null || visible.has(form.ownerId))
    return success(request, items, {
      ...result.meta,
      total: items.length,
      totalPages: items.length ? Math.ceil(items.length / query.pageSize) : 0,
    })
  })

  app.get<{ Params: IdParams }>('/forms/:id', async (request) => {
    const auth = requireAuth(request)
    const form = getForm(request.params.id)
    if (!form || !formVisible(auth, form)) throw AppError.notFound('表单模板')
    const detail = getFormDetail(form.id)!
    return success(request, { ...detail, canEdit: canManage(auth, form.owner_type, form.owner_id) })
  })

  app.post('/forms', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(formTemplateCreateSchema, request.body)
    assertCapability(auth, 'form.manage', ownerScope(input.ownerType, input.ownerId))
    assertOwnerVisible(auth, input.ownerType, input.ownerId)
    const created = createForm({ ...input, actorId: auth.accountId })
    const detail = getFormDetail(created.formId)!
    return reply.status(201).send(success(request, detail))
  })

  app.post<{ Params: IdParams }>('/forms/:id/versions', async (request, reply) => {
    const auth = requireAuth(request)
    const form = getForm(request.params.id)
    if (!form) throw AppError.notFound('表单模板')
    assertCapability(auth, 'form.manage', ownerScope(form.owner_type, form.owner_id))
    const input = parseInput(formVersionCreateSchema, request.body ?? {})
    const source = input.fromVersionId ? getFormVersion(input.fromVersionId) : undefined
    if (input.fromVersionId && (!source || source.template_id !== form.id)) {
      throw AppError.badRequest('来源版本不属于该表单模板')
    }
    const versionId = createFormVersion(form.id, auth.accountId, source, input.schema)
    if (!versionId) throw AppError.notFound('表单模板')
    const version = getFormVersion(versionId)!
    return reply.status(201).send(success(request, { id: version.id, versionNo: version.version_no, revision: version.revision }))
  })

  app.put<{ Params: VersionParams }>('/forms/:id/versions/:versionId', async (request) => {
    const auth = requireAuth(request)
    const form = getForm(request.params.id)
    if (!form) throw AppError.notFound('表单模板')
    assertCapability(auth, 'form.manage', ownerScope(form.owner_type, form.owner_id))
    const version = getFormVersion(request.params.versionId)
    if (!version || version.template_id !== form.id) throw AppError.notFound('表单版本')
    if (version.status !== 'draft') throw AppError.stateConflict('已发布版本不可修改，请创建新版本')
    const input = parseInput(formVersionUpdateSchema, request.body)
    const updated = updateFormVersion(form.id, version.id, input.revision, input.schema, auth.accountId)
    if (!updated) throw AppError.revisionConflict()
    return success(request, { id: version.id, revision: input.revision + 1 })
  })

  app.delete<{ Params: VersionParams }>('/forms/:id/versions/:versionId', async (request) => {
    const auth = requireAuth(request)
    const form = getForm(request.params.id)
    if (!form) throw AppError.notFound('表单模板')
    assertCapability(auth, 'form.manage', ownerScope(form.owner_type, form.owner_id))
    const result = deleteDraftVersion(form.id, request.params.versionId)
    if (result === 'missing') throw AppError.notFound('表单版本')
    if (result === 'published') throw AppError.stateConflict('已发布版本不可删除')
    if (result === 'last') throw AppError.stateConflict('表单至少保留一个版本')
    return success(request, { id: request.params.versionId, deleted: true })
  })

  app.post<{ Params: VersionParams }>('/forms/:id/versions/:versionId/publish', async (request) => {
    const auth = requireAuth(request)
    const form = getForm(request.params.id)
    if (!form) throw AppError.notFound('表单模板')
    assertCapability(auth, 'form.publish', ownerScope(form.owner_type, form.owner_id))
    const input = parseInput(publishVersionSchema, request.body)
    const published = publishFormVersion(form.id, request.params.versionId, input.revision, auth.accountId)
    if (!published) {
      const version = getFormVersion(request.params.versionId)
      if (!version || version.template_id !== form.id) throw AppError.notFound('表单版本')
      if (version.status !== 'draft') throw AppError.stateConflict('该版本已经发布')
      throw AppError.revisionConflict()
    }
    return success(request, { id: request.params.versionId, status: 'published' })
  })

  // ---------- ticket categories ----------
  app.post('/ticket-categories', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(ticketCategoryCreateSchema, request.body)
    assertCapability(auth, 'ticket_type.manage', ownerScope(input.ownerType, input.ownerId))
    assertOwnerVisible(auth, input.ownerType, input.ownerId)
    const id = createTicketCategory({ ...input, actorId: auth.accountId })
    return reply.status(201).send(success(request, { id }))
  })

  // ---------- ticket types ----------
  app.get('/ticket-types', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(ticketTypeQuerySchema, request.query)
    const result = listTicketTypes(query)
    const visible = visibleCompanyIds(auth)
    const items = result.items.filter((type) => type.ownerType === 'group' || visible === null || visible.has(type.ownerId))
    return success(request, items, {
      ...result.meta,
      total: items.length,
      totalPages: items.length ? Math.ceil(items.length / query.pageSize) : 0,
    })
  })

  app.get<{ Params: IdParams }>('/ticket-types/:id', async (request) => {
    const auth = requireAuth(request)
    const type = getTicketType(request.params.id)
    if (!type || !ticketTypeVisible(auth, type)) throw AppError.notFound('工单类型')
    const detail = getTicketTypeDetail(type.id)!
    const standardLocked = type.origin === 'group_standard'
    const editable = !standardLocked && canManage(auth, type.owner_type, type.owner_id)
    return success(request, { ...detail, canEdit: editable, standardLocked })
  })

  app.post('/ticket-types', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(ticketTypeCreateSchema, request.body)
    assertCapability(auth, 'ticket_type.manage', ownerScope(input.ownerType, input.ownerId))
    assertOwnerVisible(auth, input.ownerType, input.ownerId)
    const category = getTicketCategory(input.categoryId)
    if (!category) throw AppError.notFound('工单分类')
    const form = getForm(input.formTemplateId)
    if (!form) throw AppError.notFound('表单模板')
    const formVersion = getFormVersion(input.formVersionId)
    if (!formVersion || formVersion.template_id !== form.id) throw AppError.badRequest('表单版本不属于所选模板')
    if (formVersion.status !== 'published') throw AppError.stateConflict('工单类型只能绑定已发布的表单版本')
    const created = createTicketType({ ...input, actorId: auth.accountId })
    return reply.status(201).send(success(request, created))
  })

  app.post<{ Params: IdParams }>('/ticket-types/:id/versions', async (request, reply) => {
    const auth = requireAuth(request)
    const type = getTicketType(request.params.id)
    if (!type) throw AppError.notFound('工单类型')
    if (type.origin === 'group_standard' && !auth.grants.some((grant) => grant.type === 'group')) {
      throw AppError.forbidden('集团标准类型只能由总部发布新版本')
    }
    assertCapability(auth, 'ticket_type.manage', ownerScope(type.owner_type, type.owner_id))
    const input = parseInput(ticketTypeVersionCreateSchema, request.body)
    const formVersion = getFormVersion(input.formVersionId)
    if (!formVersion || formVersion.status !== 'published') throw AppError.stateConflict('只能绑定已发布的表单版本')
    const versionId = createTicketTypeVersion({ typeId: type.id, ...input, actorId: auth.accountId })
    if (!versionId) throw AppError.notFound('工单类型')
    return reply.status(201).send(success(request, { id: versionId }))
  })

  app.put<{ Params: VersionParams }>('/ticket-types/:id/versions/:versionId', async (request) => {
    const auth = requireAuth(request)
    const type = getTicketType(request.params.id)
    if (!type) throw AppError.notFound('工单类型')
    if (type.origin === 'group_standard' && !auth.grants.some((grant) => grant.type === 'group')) {
      throw AppError.forbidden('集团标准类型只能由总部修改')
    }
    assertCapability(auth, 'ticket_type.manage', ownerScope(type.owner_type, type.owner_id))
    const version = getTicketTypeVersion(request.params.versionId)
    if (!version || version.ticket_type_id !== type.id) throw AppError.notFound('类型版本')
    if (version.status !== 'draft') throw AppError.stateConflict('已发布类型版本不可修改')
    const input = parseInput(ticketTypeVersionUpdateSchema, request.body)
    const formVersion = getFormVersion(input.formVersionId)
    if (!formVersion || formVersion.status !== 'published') throw AppError.stateConflict('只能绑定已发布的表单版本')
    const updated = updateTicketTypeVersion({
      typeId: type.id,
      versionId: version.id,
      revision: input.revision,
      formVersionId: input.formVersionId,
      workProfiles: input.workProfiles,
      actorId: auth.accountId,
    })
    if (!updated) throw AppError.revisionConflict()
    return success(request, { id: version.id, revision: input.revision + 1 })
  })

  app.post<{ Params: VersionParams }>('/ticket-types/:id/versions/:versionId/publish', async (request) => {
    const auth = requireAuth(request)
    const type = getTicketType(request.params.id)
    if (!type) throw AppError.notFound('工单类型')
    assertCapability(auth, 'ticket_type.manage', ownerScope(type.owner_type, type.owner_id))
    const input = parseInput(publishVersionSchema, request.body)
    const published = publishTicketTypeVersion(type.id, request.params.versionId, input.revision, auth.accountId)
    if (!published) throw AppError.revisionConflict()
    return success(request, { id: request.params.versionId, status: 'published' })
  })

  // ---------- excel import ----------
  app.post('/excel/imports/preview', async (request, reply) => {
    const auth = requireAuth(request)
    assertCapability(auth, 'excel_import.manage', { type: 'group', id: 'group' })
    if (!request.isMultipart()) throw AppError.badRequest('请使用 multipart/form-data 上传 .xlsx 文件')
    const file = await request.file()
    if (!file) throw AppError.badRequest('未收到 Excel 文件')
    if (!file.filename.toLowerCase().endsWith('.xlsx')) throw AppError.badRequest('仅支持 .xlsx 文件')
    const buffer = await file.toBuffer()
    const parsed = await parseExcel(buffer, file.filename)
    const sourcePath = saveSourceFile(buffer, file.filename)
    const id = newId('excelimport')
    const timestamp = new Date().toISOString()
    run(
      `INSERT INTO excel_import_jobs
        (id, file_name, sheet_name, owner_type, owner_id, status, columns_json, source_path,
         revision, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, 'group', 'group', 'mapped', ?, ?, 1, ?, ?, ?, ?)`,
      [id, file.filename, parsed.sheetName, JSON.stringify(parsed.columns), sourcePath,
        timestamp, auth.accountId, timestamp, auth.accountId],
    )
    return reply.status(201).send(success(request, { importId: id, ...parsed }))
  })

  app.post<{ Params: { importId: string } }>('/excel/imports/:importId/commit', async (request, reply) => {
    const auth = requireAuth(request)
    assertCapability(auth, 'excel_import.manage', { type: 'group', id: 'group' })
    const input = parseInput(excelCommitSchema, request.body)
    const job = one<{
      id: string
      status: string
      columns_json: string
    }>('SELECT id, status, columns_json FROM excel_import_jobs WHERE id = ?', [request.params.importId])
    if (!job) throw AppError.notFound('Excel 导入任务')
    if (job.status === 'draft_created') throw AppError.stateConflict('该导入任务已经生成草稿')
    const columns = JSON.parse(job.columns_json) as Array<{
      sourceColumn: string
      targetFieldKey: string
      inferredType: string
      sampleValues: string[]
    }>
    const mappings = input.mappings
    const mainFields: FormVersionSchema['mainFields'] = []
    for (const column of columns) {
      const key = mappings[column.sourceColumn]
      if (!key) continue
      mainFields.push({
        id: newId('field'),
        key,
        name: column.sourceColumn,
        type: column.inferredType === 'select' ? 'single_select'
          : column.inferredType === 'unknown' ? 'text'
            : column.inferredType as FormVersionSchema['mainFields'][number]['type'],
        required: false,
        strategy: 'optional',
        sort: mainFields.length + 1,
        options: column.inferredType === 'select'
          ? [...new Set(column.sampleValues)].map((value) => ({ label: value, value }))
          : undefined,
        isCore: false,
        editableByLocal: true,
      })
    }
    if (!mainFields.length) throw AppError.badRequest('至少映射一个字段')
    const schema: FormVersionSchema = { mainFields, subForms: [], conditionRules: [] }
    const created = createForm({
      code: input.templateCode,
      name: input.templateName,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      source: 'excel',
      schema,
      actorId: auth.accountId,
    })
    run(
      `UPDATE excel_import_jobs SET status = 'draft_created', draft_form_template_id = ?,
         draft_form_version_id = ?, revision = revision + 1, updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [created.formId, created.versionId, new Date().toISOString(), auth.accountId, job.id],
    )
    return reply.status(201).send(success(request, {
      formTemplateId: created.formId,
      formVersionId: created.versionId,
      status: 'draft',
    }))
  })
}
