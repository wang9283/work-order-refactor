import { formVersionSchema } from '../../../packages/contracts/src/form'
import multipart from '@fastify/multipart'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Capability, FormVersionSchema, ScopeRef, WorkProfile } from '../../../packages/contracts/src'
import { hasGrant, requireAuth, type AuthContext } from '../../core/auth'
import { writeAudit } from '../../core/audit'
import { requireScopedBase, withinScopedBase } from '../../core/base-scope'
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
  getWorkProfiles,
  listForms,
  listTicketCatalog,
  listTicketTypes,
  publishFormVersion,
  publishTicketTypeVersion,
  updateFormVersion,
  updateTicketTypeVersion,
} from './repository'
import {
  excelCommitSchema,
  formCopySchema,
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
    if (grant.type === 'factory') {
      const factory = one<{ company_id: string }>('SELECT company_id FROM factories WHERE id = ?', [grant.id])
      if (factory) ids.add(factory.company_id)
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
    throw AppError.forbidden('饲料总部标准仅总部账号可维护')
  }
  const visible = visibleCompanyIds(auth)
  if (ownerType === 'company' && visible && !visible.has(ownerId)) throw AppError.forbidden()
}

function assertManagedOwner(
  auth: AuthContext,
  capability: Capability,
  ownerType: 'group' | 'company',
  ownerId: string,
): void {
  if (ownerType === 'group') {
    assertCapability(auth, capability, ownerScope('group', ownerId))
    assertOwnerVisible(auth, 'group', ownerId)
    return
  }

  // A company-level asset can be maintained either by an explicit company grant
  // or by an administrator whose scope covers one of that company's bases.
  // The latter is still constrained by the visibility check above. Factory and
  // work-area grants do not manage the company asset as a whole.
  const companyGrant = hasGrant(auth, capability, { type: 'company', id: ownerId })
  if (!companyGrant) {
    const baseGrant = auth.grants.some((grant) => {
      if (grant.capability !== capability || grant.type !== 'base') return false
      return one<{ company_id: string }>(
        'SELECT company_id FROM production_bases WHERE id = ?',
        [grant.id],
      )?.company_id === ownerId
    })
    if (!baseGrant) throw AppError.forbidden()
  }
  assertOwnerVisible(auth, ownerType, ownerId)
}

function canManage(auth: AuthContext, ownerType: 'group' | 'company', ownerId: string): boolean {
  try {
    assertManagedOwner(auth, 'form.manage', ownerType, ownerId)
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

type WorkProfileInput = Omit<WorkProfile, 'id' | 'ticketTypeVersionId' | 'status'>

function assertTicketAssetVisible(
  auth: AuthContext,
  ownerType: 'group' | 'company',
  ownerId: string,
  assetOwnerType: 'group' | 'company',
  assetOwnerId: string,
  localAssetLabel: string,
): void {
  if (assetOwnerType === 'company') {
    const visible = visibleCompanyIds(auth)
    if (visible && !visible.has(assetOwnerId)) throw AppError.notFound(localAssetLabel)
  }
  if (
    ownerType === 'company'
    && assetOwnerType === 'company'
    && assetOwnerId !== ownerId
  ) {
    throw AppError.forbidden(`不能引用其他公司的${localAssetLabel}`)
  }
}

function assertWorkProfiles(
  auth: AuthContext,
  ownerType: 'group' | 'company',
  ownerId: string,
  profiles: WorkProfileInput[],
): void {
  for (const profile of profiles) {
    requireScopedBase(auth, profile.siteId)
    const site = one<{ company_id: string }>(
      'SELECT company_id FROM production_bases WHERE id = ? AND status <> ? AND site_confirmed = 1',
      [profile.siteId, 'archived'],
    )
    if (!site) throw AppError.notFound('作业基地')
    assertOwnerVisible(auth, 'company', site.company_id)
    if (ownerType === 'company' && site.company_id !== ownerId) {
      throw AppError.forbidden('本地工单类型只能配置本公司的作业基地')
    }
    if (profile.factoryId) {
      const factory = one<{ base_id: string; status: string }>(
        'SELECT base_id, status FROM factories WHERE id = ?',
        [profile.factoryId],
      )
      if (!factory || factory.status === 'archived' || factory.base_id !== profile.siteId) {
        throw AppError.badRequest('饲料厂必须属于所选实际作业基地')
      }
      if (!hasGrant(auth, 'ticket_type.manage', { type: 'factory', id: profile.factoryId })) {
        throw AppError.forbidden('无权配置该饲料厂')
      }
      if (ownerType === 'company') {
        const factoryCompany = one<{ company_id: string }>(
          'SELECT company_id FROM factories WHERE id = ?',
          [profile.factoryId],
        )?.company_id
        if (factoryCompany !== ownerId) {
          throw AppError.forbidden('本地工单类型只能配置本公司的饲料厂')
        }
      }
    }
    if (profile.workAreaId) {
      const area = one<{ base_id: string; factory_id: string | null }>(
        'SELECT base_id, factory_id FROM work_areas WHERE id = ? AND status <> ?',
        [profile.workAreaId, 'archived'],
      )
      if (!area || !profile.factoryId || area.base_id !== profile.siteId || area.factory_id !== profile.factoryId) {
        throw AppError.badRequest('工区必须属于所选饲料厂')
      }
    }
    if (profile.productionLineId) {
      const line = one<{ base_id: string; work_area_id: string }>(
        'SELECT base_id, work_area_id FROM production_lines WHERE id = ? AND status <> ?',
        [profile.productionLineId, 'archived'],
      )
      if (!line || line.base_id !== profile.siteId || line.work_area_id !== profile.workAreaId) {
        throw AppError.badRequest('产线必须属于所选基地和工区')
      }
    }
    if (profile.crewId) {
      const crew = one<{ base_id: string; work_area_id: string; factory_id: string | null }>(
        'SELECT base_id, work_area_id, factory_id FROM crews WHERE id = ? AND status <> ?',
        [profile.crewId, 'archived'],
      )
      if (
        !crew
        || crew.base_id !== profile.siteId
        || (profile.workAreaId && crew.work_area_id !== profile.workAreaId)
        || (profile.factoryId && crew.factory_id !== profile.factoryId)
      ) {
        throw AppError.badRequest('生产班必须属于所选饲料厂')
      }
    }
    if (profile.shiftTemplateId) {
      const shift = one<{ base_id: string }>(
        'SELECT base_id FROM shift_templates WHERE id = ? AND status = ?',
        [profile.shiftTemplateId, 'active'],
      )
      if (!shift || shift.base_id !== profile.siteId) {
        throw AppError.badRequest('班次模板必须属于所选基地')
      }
    }
  }
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
    assertManagedOwner(auth, 'form.manage', input.ownerType, input.ownerId)
    const created = createForm({ ...input, actorId: auth.accountId })
    const detail = getFormDetail(created.formId)!
    writeAudit({
      accountId: auth.accountId,
      action: 'form.create',
      entityType: 'form_template',
      entityId: created.formId,
      scopeType: input.ownerType,
      scopeId: input.ownerId,
      after: { ...detail, versionId: created.versionId },
      ipAddress: auth.ipAddress,
    })
    return reply.status(201).send(success(request, detail))
  })

  app.post<{ Params: IdParams }>('/forms/:id/copies', async (request, reply) => {
    const auth = requireAuth(request)
    const source = getForm(request.params.id)
    if (!source || !formVisible(auth, source)) throw AppError.notFound('表单模板')
    const input = parseInput(formCopySchema, request.body)
    assertManagedOwner(auth, 'form.manage', input.ownerType, input.ownerId)
    const sourceVersion = input.fromVersionId
      ? getFormVersion(input.fromVersionId)
      : source.current_published_version_id
        ? getFormVersion(source.current_published_version_id)
        : getFormVersions(source.id)[0]
    if (!sourceVersion || sourceVersion.template_id !== source.id) {
      throw AppError.badRequest('来源表单版本不属于该模板')
    }
    const created = createForm({
      code: input.code,
      name: input.name,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      source: 'native',
      schema: JSON.parse(sourceVersion.schema_json),
      locked: input.locked,
      actorId: auth.accountId,
    })
    const detail = getFormDetail(created.formId)!
    writeAudit({
      accountId: auth.accountId,
      action: 'form.copy',
      entityType: 'form_template',
      entityId: created.formId,
      scopeType: input.ownerType,
      scopeId: input.ownerId,
      before: { sourceFormId: source.id, sourceVersionId: sourceVersion.id },
      after: { ...detail, versionId: created.versionId },
      ipAddress: auth.ipAddress,
    })
    return reply.status(201).send(success(request, detail))
  })

  app.post<{ Params: IdParams }>('/forms/:id/versions', async (request, reply) => {
    const auth = requireAuth(request)
    const form = getForm(request.params.id)
    if (!form) throw AppError.notFound('表单模板')
    assertManagedOwner(auth, 'form.manage', form.owner_type, form.owner_id)
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
    assertManagedOwner(auth, 'form.manage', form.owner_type, form.owner_id)
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
    assertManagedOwner(auth, 'form.manage', form.owner_type, form.owner_id)
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
    assertManagedOwner(auth, 'form.publish', form.owner_type, form.owner_id)
    const input = parseInput(publishVersionSchema, request.body)
    const candidate = getFormVersion(request.params.versionId)
    if (!candidate || candidate.template_id !== form.id) throw AppError.notFound('表单版本')
    parseInput(formVersionSchema, JSON.parse(candidate.schema_json))
    const published = publishFormVersion(form.id, request.params.versionId, input.revision, auth.accountId)
    if (!published) {
      const version = getFormVersion(request.params.versionId)
      if (!version || version.template_id !== form.id) throw AppError.notFound('表单版本')
      if (version.status !== 'draft') throw AppError.stateConflict('该版本已经发布')
      throw AppError.revisionConflict()
    }
    writeAudit({
      accountId: auth.accountId,
      action: 'form.publish',
      entityType: 'form_version',
      entityId: request.params.versionId,
      scopeType: form.owner_type,
      scopeId: form.owner_id,
      before: { status: 'draft', revision: input.revision },
      after: { status: 'published' },
      ipAddress: auth.ipAddress,
    })
    return success(request, { id: request.params.versionId, status: 'published' })
  })

  // ---------- ticket categories ----------
  app.post('/ticket-categories', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(ticketCategoryCreateSchema, request.body)
    assertManagedOwner(auth, 'ticket_type.manage', input.ownerType, input.ownerId)
    const id = createTicketCategory({ ...input, actorId: auth.accountId })
    return reply.status(201).send(success(request, { id }))
  })

  // ---------- ticket types ----------
  app.get('/ticket-catalog', async (request) => {
    const auth = requireAuth(request)
    const visible = visibleCompanyIds(auth)
    const catalog = listTicketCatalog(
      (type) => type.ownerType === 'group' || visible === null || visible.has(type.ownerId),
      (category) => category.ownerType === 'group' || visible === null || visible.has(category.ownerId),
    )
    return success(request, catalog)
  })

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
    const standardLocked = type.origin === 'group_standard' || type.locked === 1
    const editable = !standardLocked && canManage(auth, type.owner_type, type.owner_id)
    const scopedDetail = {
      ...detail,
      versions: detail.versions.map((version) => ({
        ...version,
        workProfiles: version.workProfiles.filter((profile) => withinScopedBase(auth, profile.siteId)),
      })),
    }
    return success(request, { ...scopedDetail, canEdit: editable, standardLocked })
  })

  app.post('/ticket-types', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(ticketTypeCreateSchema, request.body)
    assertManagedOwner(auth, 'ticket_type.manage', input.ownerType, input.ownerId)
    const category = getTicketCategory(input.categoryId)
    if (!category) throw AppError.notFound('工单分类')
    assertTicketAssetVisible(
      auth,
      input.ownerType,
      input.ownerId,
      category.owner_type,
      category.owner_id,
      '工单分类',
    )
    const form = getForm(input.formTemplateId)
    if (!form || !formVisible(auth, form)) throw AppError.notFound('表单模板')
    assertTicketAssetVisible(
      auth,
      input.ownerType,
      input.ownerId,
      form.owner_type,
      form.owner_id,
      '本地表单',
    )
    const formVersion = getFormVersion(input.formVersionId)
    if (!formVersion || formVersion.template_id !== form.id) throw AppError.badRequest('表单版本不属于所选模板')
    if (formVersion.status !== 'published') throw AppError.stateConflict('工单类型只能绑定已发布的表单版本')
    assertWorkProfiles(auth, input.ownerType, input.ownerId, input.workProfiles)
    const created = createTicketType({ ...input, actorId: auth.accountId })
    writeAudit({
      accountId: auth.accountId,
      action: 'ticket_type.create',
      entityType: 'ticket_type',
      entityId: created.typeId,
      scopeType: input.ownerType,
      scopeId: input.ownerId,
      after: created,
      ipAddress: auth.ipAddress,
    })
    return reply.status(201).send(success(request, created))
  })

  app.post<{ Params: IdParams }>('/ticket-types/:id/versions', async (request, reply) => {
    const auth = requireAuth(request)
    const type = getTicketType(request.params.id)
    if (!type) throw AppError.notFound('工单类型')
    if ((type.origin === 'group_standard' || type.locked === 1) && !auth.grants.some((grant) => grant.type === 'group')) {
      throw AppError.forbidden('饲料总部标准类型只能由总部发布新版本')
    }
    assertManagedOwner(auth, 'ticket_type.manage', type.owner_type, type.owner_id)
    const input = parseInput(ticketTypeVersionCreateSchema, request.body)
    const formVersion = getFormVersion(input.formVersionId)
    if (!formVersion || formVersion.status !== 'published') throw AppError.stateConflict('只能绑定已发布的表单版本')
    const form = getForm(formVersion.template_id)
    if (!form) throw AppError.notFound('表单模板')
    assertTicketAssetVisible(
      auth,
      type.owner_type,
      type.owner_id,
      form.owner_type,
      form.owner_id,
      '本地表单',
    )
    assertWorkProfiles(auth, type.owner_type, type.owner_id, input.workProfiles)
    const versionId = createTicketTypeVersion({ typeId: type.id, ...input, actorId: auth.accountId })
    if (!versionId) throw AppError.notFound('工单类型')
    return reply.status(201).send(success(request, { id: versionId }))
  })

  app.put<{ Params: VersionParams }>('/ticket-types/:id/versions/:versionId', async (request) => {
    const auth = requireAuth(request)
    const type = getTicketType(request.params.id)
    if (!type) throw AppError.notFound('工单类型')
    if ((type.origin === 'group_standard' || type.locked === 1) && !auth.grants.some((grant) => grant.type === 'group')) {
      throw AppError.forbidden('饲料总部标准类型只能由总部修改')
    }
    assertManagedOwner(auth, 'ticket_type.manage', type.owner_type, type.owner_id)
    const version = getTicketTypeVersion(request.params.versionId)
    if (!version || version.ticket_type_id !== type.id) throw AppError.notFound('类型版本')
    if (version.status !== 'draft') throw AppError.stateConflict('已发布类型版本不可修改')
    const input = parseInput(ticketTypeVersionUpdateSchema, request.body)
    const formVersion = getFormVersion(input.formVersionId)
    if (!formVersion || formVersion.status !== 'published') throw AppError.stateConflict('只能绑定已发布的表单版本')
    const form = getForm(formVersion.template_id)
    if (!form) throw AppError.notFound('表单模板')
    assertTicketAssetVisible(
      auth,
      type.owner_type,
      type.owner_id,
      form.owner_type,
      form.owner_id,
      '本地表单',
    )
    assertWorkProfiles(auth, type.owner_type, type.owner_id, input.workProfiles)
    const preservedProfiles = getWorkProfiles(version.id)
      .filter((profile) => !withinScopedBase(auth, profile.siteId))
      .map(({ id: _id, ticketTypeVersionId: _versionId, status: _status, ...profile }) => profile)
    const updated = updateTicketTypeVersion({
      typeId: type.id,
      versionId: version.id,
      revision: input.revision,
      formVersionId: input.formVersionId,
      workProfiles: [...preservedProfiles, ...input.workProfiles],
      actorId: auth.accountId,
    })
    if (!updated) throw AppError.revisionConflict()
    return success(request, { id: version.id, revision: input.revision + 1 })
  })

  app.post<{ Params: VersionParams }>('/ticket-types/:id/versions/:versionId/publish', async (request) => {
    const auth = requireAuth(request)
    const type = getTicketType(request.params.id)
    if (!type) throw AppError.notFound('工单类型')
    assertManagedOwner(auth, 'ticket_type.manage', type.owner_type, type.owner_id)
    const input = parseInput(publishVersionSchema, request.body)
    const published = publishTicketTypeVersion(type.id, request.params.versionId, input.revision, auth.accountId)
    if (!published) throw AppError.revisionConflict()
    writeAudit({
      accountId: auth.accountId,
      action: 'ticket_type.publish',
      entityType: 'ticket_type_version',
      entityId: request.params.versionId,
      scopeType: type.owner_type,
      scopeId: type.owner_id,
      before: { status: 'draft', revision: input.revision },
      after: { status: 'published', ticketTypeId: type.id },
      ipAddress: auth.ipAddress,
    })
    return success(request, { id: request.params.versionId, status: 'published' })
  })

  // ---------- excel import ----------
  app.post('/excel/imports/preview', { onRequest: async () => { throw AppError.badRequest('当前不允许上传文件') } }, async (request, reply) => {
    const auth = requireAuth(request)
    const ownerType = String(request.headers['x-owner-type'] || 'group')
    const ownerId = String(request.headers['x-owner-id'] || 'group')
    if (ownerType !== 'group' && ownerType !== 'company') {
      throw AppError.badRequest('Excel 导入归属无效')
    }
    assertManagedOwner(auth, 'excel_import.manage', ownerType, ownerId)
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
       VALUES (?, ?, ?, ?, ?, 'mapped', ?, ?, 1, ?, ?, ?, ?)`,
      [id, file.filename, parsed.sheetName, ownerType, ownerId,
        JSON.stringify(parsed.columns), sourcePath,
        timestamp, auth.accountId, timestamp, auth.accountId],
    )
    writeAudit({
      accountId: auth.accountId,
      action: 'excel.preview',
      entityType: 'excel_import_job',
      entityId: id,
      scopeType: ownerType,
      scopeId: ownerId,
      after: { fileName: file.filename, sheetName: parsed.sheetName, columns: parsed.columns },
      ipAddress: auth.ipAddress,
    })
    return reply.status(201).send(success(request, {
      importId: id,
      ownerType,
      ownerId,
      ...parsed,
    }))
  })

  app.post<{ Params: { importId: string } }>('/excel/imports/:importId/commit', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(excelCommitSchema, request.body)
    assertManagedOwner(auth, 'excel_import.manage', input.ownerType, input.ownerId)
    const job = one<{
      id: string
      status: string
      columns_json: string
      owner_type: 'group' | 'company'
      owner_id: string
      created_by: string | null
    }>(
      `SELECT id, status, columns_json, owner_type, owner_id, created_by
       FROM excel_import_jobs WHERE id = ?`,
      [request.params.importId],
    )
    if (!job) throw AppError.notFound('Excel 导入任务')
    if (job.owner_type !== input.ownerType || job.owner_id !== input.ownerId) {
      throw AppError.forbidden('草稿归属必须与上传任务一致')
    }
    if (job.created_by !== auth.accountId) throw AppError.forbidden('只能提交自己上传的 Excel 任务')
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
      locked: input.locked,
      actorId: auth.accountId,
    })
    run(
      `UPDATE excel_import_jobs SET status = 'draft_created', draft_form_template_id = ?,
         draft_form_version_id = ?, revision = revision + 1, updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [created.formId, created.versionId, new Date().toISOString(), auth.accountId, job.id],
    )
    writeAudit({
      accountId: auth.accountId,
      action: 'excel.form_draft.create',
      entityType: 'form_template',
      entityId: created.formId,
      scopeType: input.ownerType,
      scopeId: input.ownerId,
      before: { importId: job.id },
      after: { formTemplateId: created.formId, formVersionId: created.versionId },
      ipAddress: auth.ipAddress,
    })
    return reply.status(201).send(success(request, {
      formTemplateId: created.formId,
      formVersionId: created.versionId,
      status: 'draft',
    }))
  })
}
