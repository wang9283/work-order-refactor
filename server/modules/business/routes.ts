import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { hasGrant, requireAuth, type AuthContext } from '../../core/auth'
import { writeAudit } from '../../core/audit'
import { AppError } from '../../core/errors'
import { parseInput, success } from '../../core/http'
import { all, newId, nowIso, one, run, transaction } from '../../db/database'
import { requireScopedBase, withinScopedBase } from '../../core/base-scope'

const catalogKinds = ['material_type', 'production_post', 'loading_type'] as const
const catalogRoutes = {
  'material-types': 'material_type',
  'production-posts': 'production_post',
  'loading-types': 'loading_type',
} as const
type CatalogRoute = keyof typeof catalogRoutes
const catalogWriteSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(1).max(100),
  status: z.enum(['active', 'inactive']).default('active'),
  revision: z.number().int().positive().optional(),
})
const configSchema = z.object({
  revision: z.number().int().nonnegative(),
  items: z.array(z.object({ catalogId: z.string().min(1), enabled: z.boolean() })).max(500),
})
const businessPriceSchema = z.object({
  siteId: z.string().min(1),
  kind: z.enum(['production', 'loading']),
  catalogId: z.string().min(1),
  materialTypeId: z.string().nullable().default(null),
  unit: z.string().trim().min(1).max(30),
  unitPriceMicros: z.number().int().nonnegative().safe(),
  effectiveFrom: z.string().datetime({ offset: true }),
  effectiveTo: z.string().datetime({ offset: true }).nullable().default(null),
})
const materialWriteSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(1).max(100),
  abbr: z.string().trim().max(40).nullable().default(null),
  spec: z.string().trim().max(100).nullable().default(null),
  model: z.string().trim().max(100).nullable().default(null),
  materialTypeId: z.string().min(1),
  smallPack: z.boolean().default(false),
  postIds: z.array(z.string().min(1)).max(30).default([]),
  status: z.enum(['active', 'inactive']).default('active'),
})

type MaterialRow = {
  id: string; code: string; name: string; abbr: string | null; spec: string | null; model: string | null
  material_type_id: string; small_pack: number; status: 'active' | 'inactive'; revision: number
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null
}

function mapMaterial(row: MaterialRow, postIds: string[], materialTypeName: string | null) {
  return {
    id: row.id, code: row.code, name: row.name, abbr: row.abbr, spec: row.spec, model: row.model,
    materialTypeId: row.material_type_id, materialTypeName, smallPack: row.small_pack === 1,
    postCatalogIds: postIds, status: row.status, revision: row.revision,
    createdAt: row.created_at, createdBy: row.created_by, updatedAt: row.updated_at, updatedBy: row.updated_by,
  }
}

function readMaterial(id: string) {
  const row = one<MaterialRow>('SELECT * FROM materials WHERE id = ?', [id])
  if (!row) return undefined
  const postIds = all<{ post_catalog_id: string }>(
    'SELECT post_catalog_id FROM material_post_flags WHERE material_id = ? ORDER BY post_catalog_id', [id])
    .map((flag) => flag.post_catalog_id)
  const materialTypeName = one<{ name: string }>('SELECT name FROM business_catalog WHERE id = ?', [row.material_type_id])?.name ?? null
  return mapMaterial(row, postIds, materialTypeName)
}

function listMaterials() {
  const rows = all<MaterialRow>('SELECT * FROM materials ORDER BY code, name')
  return rows.map((row) => readMaterial(row.id)!)
}

function assertMaterialReferences(materialTypeId: string, postIds: string[]): void {
  if (!one<{ id: string }>(`SELECT id FROM business_catalog WHERE id = ? AND kind = 'material_type' AND status = 'active'`, [materialTypeId])) {
    throw AppError.badRequest('物料类别不存在或已停用')
  }
  if (new Set(postIds).size !== postIds.length) throw AppError.badRequest('参与工序不能重复')
  for (const postId of postIds) {
    if (!one<{ id: string }>(`SELECT id FROM business_catalog WHERE id = ? AND kind = 'production_post' AND status = 'active'`, [postId])) {
      throw AppError.badRequest('参与工序不存在或已停用')
    }
  }
}

type CatalogRow = {
  id: string; kind: typeof catalogKinds[number]; code: string; name: string; status: 'active' | 'inactive'
  revision: number; created_at: string; created_by: string | null; updated_at: string; updated_by: string | null
}

function assertBaseGrant(auth: AuthContext, capability: 'org.view' | 'ticket_type.manage' | 'price.view' | 'price.manage', siteId: string): void {
  requireScopedBase(auth, siteId)
  if (!hasGrant(auth, capability, { type: 'base', id: siteId })) throw AppError.forbidden()
}

function mapCatalog(row: CatalogRow) {
  return {
    id: row.id, kind: row.kind, code: row.code, name: row.name, status: row.status,
    revision: row.revision, createdAt: row.created_at, createdBy: row.created_by,
    updatedAt: row.updated_at, updatedBy: row.updated_by,
  }
}

export async function businessRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { kind?: typeof catalogKinds[number] } }>('/business-catalogs', async (request) => {
    requireAuth(request)
    const query = z.object({ kind: z.enum(catalogKinds).optional() }).parse(request.query)
    const rows = query.kind
      ? all<CatalogRow>('SELECT * FROM business_catalog WHERE kind = ? ORDER BY name, code', [query.kind])
      : all<CatalogRow>('SELECT * FROM business_catalog ORDER BY kind, name, code')
    return success(request, rows.map(mapCatalog))
  })

  app.get<{ Params: { kind: CatalogRoute } }>('/business-catalogs/:kind', async (request) => {
    requireAuth(request)
    const params = parseInput(z.object({ kind: z.enum(Object.keys(catalogRoutes) as [CatalogRoute, ...CatalogRoute[]]) }), request.params)
    const kind = catalogRoutes[params.kind]
    const rows = all<CatalogRow>('SELECT * FROM business_catalog WHERE kind = ? ORDER BY name, code', [kind])
    return success(request, rows.map(mapCatalog))
  })

  app.post<{ Params: { kind: string } }>('/business-catalogs/:kind', async (request, reply) => {
    const auth = requireAuth(request)
    const params = parseInput(z.object({ kind: z.enum(Object.keys(catalogRoutes) as [CatalogRoute, ...CatalogRoute[]]) }), request.params)
    const kind = catalogRoutes[params.kind]
    if (!hasGrant(auth, 'business_catalog.manage', { type: 'group', id: 'group' })) throw AppError.forbidden()
    const input = parseInput(catalogWriteSchema, request.body)
    const timestamp = nowIso()
    const id = newId('bizcat')
    run(`INSERT INTO business_catalog (id, kind, code, name, status, revision, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, kind, input.code, input.name, input.status, timestamp, auth.accountId, timestamp, auth.accountId])
    const created = one<CatalogRow>('SELECT * FROM business_catalog WHERE id = ?', [id])!
    writeAudit({ accountId: auth.accountId, action: 'business_catalog.create', entityType: 'business_catalog', entityId: id,
      scopeType: 'group', scopeId: 'group', after: mapCatalog(created), ipAddress: auth.ipAddress })
    return reply.status(201).send(success(request, mapCatalog(created)))
  })

  app.put<{ Params: { kind: string; id: string } }>('/business-catalogs/:kind/:id', async (request) => {
    const auth = requireAuth(request)
    const routeParams = parseInput(z.object({ kind: z.enum(Object.keys(catalogRoutes) as [CatalogRoute, ...CatalogRoute[]]), id: z.string().min(1) }), request.params)
    const kind = catalogRoutes[routeParams.kind]
    if (!hasGrant(auth, 'business_catalog.manage', { type: 'group', id: 'group' })) throw AppError.forbidden()
    const input = parseInput(catalogWriteSchema.extend({ revision: z.number().int().positive() }), request.body)
    const before = one<CatalogRow>('SELECT * FROM business_catalog WHERE id = ? AND kind = ?', [routeParams.id, kind])
    if (!before) throw AppError.notFound('业务目录项')
    const timestamp = nowIso()
    const changed = run(`UPDATE business_catalog SET code = ?, name = ?, status = ?, revision = revision + 1,
      updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
    [input.code, input.name, input.status, timestamp, auth.accountId, routeParams.id, input.revision])
    if (!changed.changes) throw AppError.revisionConflict()
    const after = one<CatalogRow>('SELECT * FROM business_catalog WHERE id = ?', [routeParams.id])!
    writeAudit({ accountId: auth.accountId, action: 'business_catalog.update', entityType: 'business_catalog', entityId: routeParams.id,
      scopeType: 'group', scopeId: 'group', before: mapCatalog(before), after: mapCatalog(after), ipAddress: auth.ipAddress })
    return success(request, mapCatalog(after))
  })

  app.get('/materials', async (request) => {
    requireAuth(request)
    return success(request, listMaterials())
  })

  app.post('/materials', async (request, reply) => {
    const auth = requireAuth(request)
    if (!hasGrant(auth, 'business_catalog.manage', { type: 'group', id: 'group' })) throw AppError.forbidden()
    const input = parseInput(materialWriteSchema, request.body)
    assertMaterialReferences(input.materialTypeId, input.postIds)
    const timestamp = nowIso()
    const id = newId('material')
    transaction(() => {
      run(`INSERT INTO materials
        (id, code, name, abbr, spec, model, material_type_id, small_pack, status, revision, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [id, input.code, input.name, input.abbr, input.spec, input.model, input.materialTypeId,
        input.smallPack ? 1 : 0, input.status, timestamp, auth.accountId, timestamp, auth.accountId])
      for (const postId of input.postIds) {
        run('INSERT INTO material_post_flags (material_id, post_catalog_id) VALUES (?, ?)', [id, postId])
      }
    })
    const created = readMaterial(id)!
    writeAudit({ accountId: auth.accountId, action: 'material.create', entityType: 'material', entityId: id,
      scopeType: 'group', scopeId: 'group', after: created, ipAddress: auth.ipAddress })
    return reply.status(201).send(success(request, created))
  })

  app.put<{ Params: { id: string } }>('/materials/:id', async (request) => {
    const auth = requireAuth(request)
    if (!hasGrant(auth, 'business_catalog.manage', { type: 'group', id: 'group' })) throw AppError.forbidden()
    const params = z.object({ id: z.string().min(1) }).parse(request.params)
    const input = parseInput(materialWriteSchema.extend({ revision: z.number().int().positive() }), request.body)
    const before = readMaterial(params.id)
    if (!before) throw AppError.notFound('产品')
    assertMaterialReferences(input.materialTypeId, input.postIds)
    const timestamp = nowIso()
    transaction(() => {
      const changed = run(`UPDATE materials SET code = ?, name = ?, abbr = ?, spec = ?, model = ?,
        material_type_id = ?, small_pack = ?, status = ?, revision = revision + 1, updated_at = ?, updated_by = ?
       WHERE id = ? AND revision = ?`,
      [input.code, input.name, input.abbr, input.spec, input.model, input.materialTypeId,
        input.smallPack ? 1 : 0, input.status, timestamp, auth.accountId, params.id, input.revision])
      if (!changed.changes) throw AppError.revisionConflict()
      run('DELETE FROM material_post_flags WHERE material_id = ?', [params.id])
      for (const postId of input.postIds) {
        run('INSERT INTO material_post_flags (material_id, post_catalog_id) VALUES (?, ?)', [params.id, postId])
      }
    })
    const after = readMaterial(params.id)!
    writeAudit({ accountId: auth.accountId, action: 'material.update', entityType: 'material', entityId: params.id,
      scopeType: 'group', scopeId: 'group', before, after, ipAddress: auth.ipAddress })
    return success(request, after)
  })

  app.get<{ Params: { siteId: string } }>('/sites/:siteId/business-config', async (request) => {
    const auth = requireAuth(request)
    const { siteId } = z.object({ siteId: z.string().min(1) }).parse(request.params)
    assertBaseGrant(auth, 'org.view', siteId)
    const meta = one<{ revision: number }>('SELECT revision FROM site_business_config_meta WHERE site_id = ?', [siteId])
    const items = all<{ catalog_id: string; kind: typeof catalogKinds[number]; enabled: number }>(
      `SELECT c.id AS catalog_id, c.kind, COALESCE(s.enabled, 0) AS enabled
       FROM business_catalog c LEFT JOIN site_business_config_items s
         ON s.catalog_id = c.id AND s.site_id = ? WHERE c.kind != 'production_post' ORDER BY c.kind, c.name`, [siteId],
    )
    return success(request, { siteId, revision: meta?.revision ?? 0,
      items: items.map((item) => ({ catalogId: item.catalog_id, kind: item.kind, enabled: item.enabled === 1 })) })
  })

  app.put<{ Params: { siteId: string } }>('/sites/:siteId/business-config', async (request) => {
    const auth = requireAuth(request)
    const { siteId } = z.object({ siteId: z.string().min(1) }).parse(request.params)
    assertBaseGrant(auth, 'ticket_type.manage', siteId)
    const input = configSchema.parse(request.body)
    if (!one<{ id: string }>(`SELECT id FROM production_bases WHERE id = ? AND status = 'active'`, [siteId])) {
      throw AppError.notFound('启用中的作业基地')
    }
    const before = one<{ revision: number }>('SELECT revision FROM site_business_config_meta WHERE site_id = ?', [siteId])
    if ((before?.revision ?? 0) !== input.revision) throw AppError.revisionConflict()
    if (new Set(input.items.map((item) => item.catalogId)).size !== input.items.length) throw AppError.badRequest('业务项不能重复')
    const ids = input.items.map((item) => item.catalogId)
    const items = ids.length
      ? all<CatalogRow>(`SELECT * FROM business_catalog WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
      : []
    if (items.length !== ids.length) throw AppError.badRequest('配置包含不存在的业务目录项')
    const itemMap = new Map(items.map((item) => [item.id, item]))
    for (const item of input.items) {
      const row = itemMap.get(item.catalogId)!
      if (row.kind === 'production_post') throw AppError.badRequest('工序/岗位不按基地配置，请在物料档案维护参与工序')
      if (item.enabled && row.status !== 'active') throw AppError.badRequest('停用的业务目录项不能在基地启用')
    }
    const timestamp = nowIso()
    transaction(() => {
      for (const item of input.items) {
        run(`INSERT INTO site_business_config_items (site_id, catalog_id, enabled, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(site_id, catalog_id) DO UPDATE SET enabled = excluded.enabled,
            updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        [siteId, item.catalogId, item.enabled ? 1 : 0, timestamp, auth.accountId])
      }
      run(`INSERT INTO site_business_config_meta (site_id, revision, updated_at, updated_by) VALUES (?, 1, ?, ?)
        ON CONFLICT(site_id) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [siteId, timestamp, auth.accountId])
    })
    const revision = (before?.revision ?? 0) + 1
    writeAudit({ accountId: auth.accountId, action: 'business_config.update', entityType: 'site_business_config', entityId: siteId,
      scopeType: 'base', scopeId: siteId, before: { revision: input.revision }, after: { revision, items: input.items }, ipAddress: auth.ipAddress })
    return success(request, { siteId, revision, items: input.items.map((item) => ({ ...item, kind: itemMap.get(item.catalogId)!.kind })) })
  })

  app.get<{ Querystring: { siteId?: string; kind?: 'production' | 'loading' } }>('/business-prices', async (request) => {
    const auth = requireAuth(request)
    const query = z.object({ siteId: z.string().optional(), kind: z.enum(['production', 'loading']).optional() }).parse(request.query)
    if (query.siteId) requireScopedBase(auth, query.siteId)
    const rows = all<BusinessPriceRow>('SELECT * FROM business_price_rule_versions ORDER BY effective_from DESC')
      .filter((row) => withinScopedBase(auth, row.site_id))
      .filter((row) => (!query.siteId || row.site_id === query.siteId) && (!query.kind || row.kind === query.kind)
        && hasGrant(auth, 'price.view', { type: 'base', id: row.site_id }))
    return success(request, rows.map(mapBusinessPrice))
  })

  app.post('/business-prices', async (request, reply) => {
    const auth = requireAuth(request)
    const input = businessPriceSchema.parse(request.body)
    assertBaseGrant(auth, 'price.manage', input.siteId)
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw AppError.badRequest('失效时间不能早于生效时间')
    const catalogKind = input.kind === 'production' ? 'production_post' : 'loading_type'
    const configured = input.kind === 'production'
      ? one<{ id: string }>(`SELECT id FROM business_catalog WHERE id = ? AND kind = ? AND status = 'active'`,
        [input.catalogId, catalogKind])
      : one<{ id: string }>(`SELECT c.id FROM business_catalog c JOIN site_business_config_items s
        ON s.catalog_id = c.id WHERE c.id = ? AND c.kind = ? AND c.status = 'active' AND s.site_id = ? AND s.enabled = 1`,
        [input.catalogId, catalogKind, input.siteId])
    if (!configured) throw AppError.badRequest(input.kind === 'production' ? '价格对象须为启用中的工序/岗位' : '价格对象须先在该基地启用')
    if (input.kind === 'production') {
      if (!input.materialTypeId) throw AppError.badRequest('生产价格必须选择料类')
      const material = one<{ id: string }>(`SELECT c.id FROM business_catalog c JOIN site_business_config_items s
        ON s.catalog_id = c.id WHERE c.id = ? AND c.kind = 'material_type' AND c.status = 'active'
          AND s.site_id = ? AND s.enabled = 1`, [input.materialTypeId, input.siteId])
      if (!material) throw AppError.badRequest('料类须先在该基地启用')
    } else if (input.materialTypeId !== null) throw AppError.badRequest('装卸价格不按料类区分')
    const scopeCheck = input.materialTypeId === null ? 'material_type_id IS NULL' : 'material_type_id = ?'
    const params: Array<string | number | null> = [input.siteId, input.kind, input.catalogId]
    if (input.materialTypeId !== null) params.push(input.materialTypeId)
    const overlap = one<{ id: string }>(`SELECT id FROM business_price_rule_versions
      WHERE site_id = ? AND kind = ? AND catalog_id = ? AND ${scopeCheck} AND status = 'published'
        AND effective_from <= COALESCE(?, '9999-12-31T23:59:59+23:59')
        AND (effective_to IS NULL OR effective_to >= ?) LIMIT 1`,
    [...params, input.effectiveTo, input.effectiveFrom])
    if (overlap) throw AppError.conflict('同一基地、岗位和料类的价格生效区间不能重叠')
    const versionNo = (one<{ maximum: number | null }>(`SELECT MAX(version_no) AS maximum FROM business_price_rule_versions
      WHERE site_id = ? AND kind = ? AND catalog_id = ? AND ${scopeCheck}`,
    params)?.maximum ?? 0) + 1
    const id = newId('bizprice')
    const timestamp = nowIso()
    run(`INSERT INTO business_price_rule_versions
      (id, site_id, kind, catalog_id, material_type_id, version_no, unit, unit_price_micros,
       effective_from, effective_to, status, revision, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1, ?, ?)`,
    [id, input.siteId, input.kind, input.catalogId, input.materialTypeId, versionNo, input.unit,
      input.unitPriceMicros, input.effectiveFrom, input.effectiveTo, timestamp, auth.accountId])
    const created = one<BusinessPriceRow>('SELECT * FROM business_price_rule_versions WHERE id = ?', [id])!
    writeAudit({ accountId: auth.accountId, action: 'business_price.publish', entityType: 'business_price_rule_version', entityId: id,
      scopeType: 'base', scopeId: input.siteId, after: mapBusinessPrice(created), ipAddress: auth.ipAddress })
    return reply.status(201).send(success(request, mapBusinessPrice(created)))
  })
}

export interface BusinessPriceRow {
  id: string; site_id: string; kind: 'production' | 'loading'; catalog_id: string; material_type_id: string | null
  version_no: number; unit: string; unit_price_micros: number; effective_from: string; effective_to: string | null
  status: 'published' | 'retired'
}

export function mapBusinessPrice(row: BusinessPriceRow) {
  return { id: row.id, siteId: row.site_id, kind: row.kind, catalogId: row.catalog_id, materialTypeId: row.material_type_id,
    versionNo: row.version_no, unit: row.unit, unitPriceMicros: row.unit_price_micros,
    effectiveFrom: row.effective_from, effectiveTo: row.effective_to, status: row.status }
}
