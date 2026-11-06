import assert from 'node:assert/strict'
import { resolve } from 'node:path'

if (!process.env.DATABASE_PATH || !resolve(process.env.DATABASE_PATH).endsWith('pricing-isolated-check.db')) {
  throw new Error('需要指定隔离数据库 pricing-isolated-check.db')
}

const base = process.env.API_BASE_URL || 'http://127.0.0.1:3131/api'
let token
async function request(path, method = 'GET', body, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json()
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`)
  return result.data
}

token = (await request('/auth/login', 'POST', { username: 'group.admin', password: 'Feed2026!' })).token
const { resolveAuth } = await import('../server/core/auth.ts')
const { createTicket: createExternalTicket } = await import('../server/modules/execution/repository.ts')
const { run: runSql } = await import('../server/db/database.ts')
const auth = resolveAuth(token)
if (!auth) throw new Error('业务夹具需要有效登录身份')
function createExternal(input) {
  return createExternalTicket(auth, {
    businessKind: 'generic',
    materialId: null,
    materialTypeId: null,
    businessItems: [],
    factoryId: null,
    workAreaId: null,
    productionLineId: null,
    crewId: null,
    shiftTemplateId: null,
    assignments: [],
    quantity: null,
    handoverShiftProfileId: null,
    ...input,
  })
}
async function expectExternalReject(input, message) {
  try {
    await createExternal(input)
    assert.fail(`预期业务校验失败：${message}`)
  } catch (error) {
    assert.match(String(error instanceof Error ? error.message : error), new RegExp(message))
  }
}
assert((await request('/sites/base_direct/business-config')).items.every((item) => !item.enabled), '基础字典不应自动在基地启用')
assert.equal((await request('/business-prices')).length, 0, '基础字典不应初始化价格')

async function catalog(kind, code, name) {
  return request(`/business-catalogs/${kind}`, 'POST', { code, name, status: 'active' }, 201)
}

const materialTypes = await Promise.all(['A', 'B', 'C', 'D'].map((suffix) => catalog('material-types', `MAT-${suffix}`, `验收料类${suffix}`)))
const productionPosts = await Promise.all(['A', 'B', 'C'].map((suffix) => catalog('production-posts', `POST-${suffix}`, `验收岗位${suffix}`)))
const loadingType = await catalog('loading-types', 'LOAD-A', '验收装卸类型')
const materials = await request('/business-catalogs/material-types')
assert.equal(materials.filter((item) => item.code.startsWith('MAT-')).length, 4)
assert(materials.some((item) => item.name === '畜禽料'))
assert(materials.some((item) => item.name === '反刍料'))

async function configureSite(siteId, ids) {
  const current = await request(`/sites/${siteId}/business-config`)
  return request(`/sites/${siteId}/business-config`, 'PUT', {
    revision: current.revision,
    items: ids.map((catalogId) => ({ catalogId, enabled: true })),
  })
}
await configureSite('base_direct', [...materialTypes.map((item) => item.id), loadingType.id])
await configureSite('base_production', [materialTypes[0].id, materialTypes[1].id])
let savedConfig = await request('/sites/base_direct/business-config')
assert(savedConfig.items.every((item) => item.kind !== 'production_post'), '基地配置不再包含工序/岗位')
await request('/sites/base_direct/business-config', 'PUT', { revision: savedConfig.revision, items: [{ catalogId: loadingType.id, enabled: false }] })
savedConfig = await request('/sites/base_direct/business-config')
assert(savedConfig.items.find((item) => item.catalogId === materialTypes[0].id)?.enabled, '装卸配置修改不能覆盖生产配置')
await request('/sites/base_direct/business-config', 'PUT', { revision: savedConfig.revision, items: [{ catalogId: loadingType.id, enabled: true }] })
await request('/sites/base_direct/business-config', 'PUT', { revision: savedConfig.revision + 1, items: [{ catalogId: productionPosts[0].id, enabled: true }] }, 400)

async function publishPrice(siteId, kind, catalogId, materialTypeId, unitPriceMicros) {
  return request('/business-prices', 'POST', {
    siteId, kind, catalogId, materialTypeId, unit: '吨', unitPriceMicros,
    effectiveFrom: '2026-10-01T00:00:00.000Z', effectiveTo: null,
  }, 201)
}
const priceA = await publishPrice('base_direct', 'production', productionPosts[0].id, materialTypes[0].id, 2_000_000)
const priceB = await publishPrice('base_direct', 'production', productionPosts[1].id, materialTypes[0].id, 3_000_000)
const priceOtherBase = await publishPrice('base_production', 'production', productionPosts[0].id, materialTypes[0].id, 8_000_000)
await publishPrice('base_direct', 'loading', loadingType.id, null, 1_500_000)

const material = await request('/materials', 'POST', {
  code: 'ACC-PROD-A', name: '验收产品A', abbr: '产品A', spec: '散装（吨）', model: '颗粒',
  materialTypeId: materialTypes[0].id, smallPack: false,
  postIds: [productionPosts[0].id, productionPosts[1].id], status: 'active',
}, 201)
assert.deepEqual([...material.postCatalogIds].sort(), [productionPosts[0].id, productionPosts[1].id].sort())
assert.equal(material.materialTypeName, '验收料类A')
assert((await request('/materials')).some((item) => item.id === material.id))

const baseOrderInput = {
  ticketTypeId: 'type_builtin_production', businessKind: 'production', materialTypeId: materialTypes[0].id,
  businessItems: [{ catalogId: productionPosts[0].id, kind: 'production_post' }],
  siteId: 'base_direct', factoryId: 'factory_xinjin', crewId: null,
  eventTime: '2026-10-22T08:00:00+08:00', workDate: '2026-10-22', assignments: [], quantity: null,
}
const dayOrder = createExternal({ ...baseOrderInput, productionLineId: 'line_xinjin_1', shiftTemplateId: 'shift_direct_day' })
assert.equal(dayOrder.businessKind, 'production')
assert.equal(dayOrder.businessWorkItems[0].priceRuleVersionId, priceA.id)
assert.equal(dayOrder.businessWorkItems[0].unitPriceMicros, 2_000_000)
const nightOrder = createExternal({ ...baseOrderInput, productionLineId: 'line_xinjin_2', shiftTemplateId: 'shift_direct_night' })
assert.equal(nightOrder.businessWorkItems[0].unitPriceMicros, dayOrder.businessWorkItems[0].unitPriceMicros)
const otherSiteOrder = createExternal({
  ...baseOrderInput, siteId: 'base_production', factoryId: 'factory_heze', crewId: null,
  productionLineId: null, shiftTemplateId: 'shift_production_night',
})
assert.equal(otherSiteOrder.businessWorkItems[0].priceRuleVersionId, priceOtherBase.id)
assert.equal(otherSiteOrder.businessWorkItems[0].unitPriceMicros, 8_000_000)

const loadingOrder = createExternal({
  ticketTypeId: 'type_builtin_loading', businessKind: 'loading', materialTypeId: null,
  businessItems: [{ catalogId: loadingType.id, kind: 'loading_type' }],
  siteId: 'base_direct', factoryId: 'factory_xinjin', crewId: null,
  eventTime: '2026-10-22T08:00:00+08:00', workDate: '2026-10-22', assignments: [], quantity: null,
})
assert.equal(loadingOrder.businessWorkItems.length, 1)
assert.equal(loadingOrder.businessWorkItems[0].unitPriceMicros, 1_500_000)

const defaultedOrder = createExternal({
  ...baseOrderInput, materialId: material.id, businessItems: [],
})
assert.equal(defaultedOrder.materialId, material.id)
assert.equal(defaultedOrder.materialName, '验收产品A')
assert.equal(defaultedOrder.materialTypeId, materialTypes[0].id)
assert.deepEqual(defaultedOrder.businessWorkItems.map((item) => item.catalogId).sort(),
  [productionPosts[0].id, productionPosts[1].id].sort(), '未显式指定岗位时按产品参与工序默认')
assert.deepEqual(defaultedOrder.businessWorkItems.map((item) => item.unitPriceMicros).sort(), [2_000_000, 3_000_000])
await expectExternalReject({
  ...baseOrderInput, materialId: material.id,
  businessItems: [{ catalogId: productionPosts[2].id, kind: 'production_post' }],
}, '生产岗位超出产品参与工序范围')
await expectExternalReject({
  ...baseOrderInput, materialId: material.id, materialTypeId: materialTypes[1].id, businessItems: [],
}, '物料类别')
const scopedOrder = createExternal({
  ...baseOrderInput, materialId: material.id,
  businessItems: [{ catalogId: productionPosts[0].id, kind: 'production_post' }],
})
assert.equal(scopedOrder.businessWorkItems.length, 1)
const updatedMaterial = await request(`/materials/${material.id}`, 'PUT', {
  code: material.code, name: material.name, materialTypeId: material.materialTypeId, smallPack: true,
  postIds: [productionPosts[0].id], status: 'active', revision: material.revision,
})
assert.deepEqual(updatedMaterial.postCatalogIds, [productionPosts[0].id])
assert.equal(updatedMaterial.smallPack, true)
await request(`/materials/${material.id}`, 'PUT', {
  code: material.code, name: material.name, materialTypeId: material.materialTypeId, smallPack: true,
  postIds: [productionPosts[0].id], status: 'active', revision: material.revision,
}, 409)
await expectExternalReject({
  ...baseOrderInput, materialId: material.id,
  businessItems: [{ catalogId: productionPosts[1].id, kind: 'production_post' }],
}, '生产岗位超出产品参与工序范围')

const order = createExternal({
  ...baseOrderInput,
  businessItems: productionPosts.map((item) => ({ catalogId: item.id, kind: 'production_post' })),
})
assert.deepEqual(order.businessWorkItems.map((item) => item.priceStatus), ['confirmed', 'confirmed', 'pending'])
const itemA = order.businessWorkItems.find((item) => item.catalogId === productionPosts[0].id)
const itemB = order.businessWorkItems.find((item) => item.catalogId === productionPosts[1].id)
const itemC = order.businessWorkItems.find((item) => item.catalogId === productionPosts[2].id)
assert(itemA && itemB && itemC)

async function assignItem(workItemId, assignments, revision) {
  return request(`/tickets/${order.id}/business-work-items/${workItemId}/assignments`, 'PUT', { revision, assignments })
}
let current = await assignItem(itemA.id, [
  { personId: 'person_yang', role: 'lead', shareBasisPoints: 6000 },
  { personId: 'person_wang', role: 'member', shareBasisPoints: 4000 },
], order.revision)
await request(`/tickets/${order.id}/business-work-items/${itemB.id}/assignments`, 'PUT', {
  revision: current.revision, assignments: [{ personId: 'person_yang', role: 'lead', shareBasisPoints: 10_000 }],
})
current = await request(`/tickets/${order.id}`)
await request(`/tickets/${order.id}/business-work-items/${itemC.id}/assignments`, 'PUT', {
  revision: current.revision, assignments: [{ personId: 'person_wang', role: 'member', shareBasisPoints: 10_000 }],
})
current = await request(`/tickets/${order.id}`)
assert.equal(current.status, 'pending_start')
assert.equal(current.assignments.length, 2, '工单级人员列表应去重')
assert.equal(current.businessWorkItems.length, 3)
assert(current.businessWorkItems.every((item) => item.quantity === null))
await request(`/tickets/${order.id}/business-work-items/${itemA.id}/assignments`, 'PUT', {
  revision: current.revision, assignments: [
    { personId: 'person_yang', role: 'lead', shareBasisPoints: 6000 },
    { personId: 'person_wang', role: 'member', shareBasisPoints: 3900 },
  ],
}, 400)

await request(`/tickets/${order.id}/start`, 'POST', { revision: current.revision }, 400)
await request(`/tickets/${order.id}/submit`, 'POST', { revision: current.revision, values: {} }, 400)
await request(`/tickets/${order.id}/approve`, 'POST', { revision: current.revision }, 400)
await request(`/tickets/${order.id}/cancel`, 'POST', { revision: current.revision }, 400)
runSql(`UPDATE tickets SET status = 'completed', quantity = 100, revision = revision + 1,
  updated_at = ?, updated_by = ? WHERE id = ?`, [new Date().toISOString(), 'acct_group', order.id])
current = await request(`/tickets/${order.id}`)
assert.equal(current.quantity, 100)
assert(current.businessWorkItems.every((item) => item.quantity === 100), '每个岗位都应展示整单产量')
assert.deepEqual(Object.fromEntries(current.businessWorkItems.find((item) => item.id === itemA.id)?.assignments.map((assignment) => [assignment.personId, assignment.quantity]) || []), {
  person_yang: 60, person_wang: 40,
})
assert.equal(current.amountMicros, null, '缺少一個岗位价格时整单金额应保持待核算')

await request(`/tickets/${order.id}/business-work-items/${itemC.id}/pricing`, 'PUT', {
  revision: current.revision, priceRuleVersionId: priceOtherBase.id, reason: '跨基地价格不应适用',
}, 400)
const priceC = await publishPrice('base_direct', 'production', productionPosts[2].id, materialTypes[0].id, 4_000_000)
await request(`/tickets/${order.id}/business-work-items/${itemC.id}/pricing`, 'PUT', {
  revision: current.revision, priceRuleVersionId: priceC.id, reason: '补充本岗位价格',
}, 400)
assert.equal(current.amountMicros, null, '生产、装卸工单不允许在平台内补价')
const accruals = (await request('/payroll/accruals?workMonth=2026-10')).filter((item) => item.ticketId === order.id)
assert.equal(accruals.length, 0, '外部同步工单不经过旧审核流程生成薪酬核算')

const rule = await request('/trigger-rules', 'POST', {
  ticketTypeId: 'type_builtin_production', businessKind: 'production', materialId: material.id,
  materialTypeId: materialTypes[0].id,
  businessItems: [{ catalogId: productionPosts[0].id, kind: 'production_post' }],
  siteId: 'base_direct', factoryId: 'factory_xinjin', name: '业务触发验收', status: 'active', mode: 'event',
  workAreaId: null, crewId: null, deadlineHours: null, effectiveFrom: '2026-10-01', effectiveTo: null,
  frequency: null, time: null, weekdays: [], eventType: 'acceptance.production.ready', conditions: [],
}, 201)
const triggerResult = await request('/trigger-events', 'POST', {
  siteId: 'base_direct', source: 'acceptance', eventId: 'business-work-item-event',
  eventType: 'acceptance.production.ready', eventTime: '2026-10-22T09:00:00+08:00', payload: {},
})
assert.equal(triggerResult[0].status, 'succeeded')
const triggered = await request(`/tickets/${triggerResult[0].ticket_id}`)
assert.equal(triggered.businessKind, 'production')
assert.equal(triggered.materialTypeId, materialTypes[0].id)
assert.equal(triggered.businessWorkItems[0].catalogId, productionPosts[0].id)
assert.equal(triggered.materialId, material.id)
assert.equal(rule.version, 1)

const materialName = order.materialTypeName
await request(`/business-catalogs/production-posts/${productionPosts[2].id}`, 'PUT', {
  code: productionPosts[2].code, name: productionPosts[2].name, status: 'inactive', revision: productionPosts[2].revision,
})
const savedHistory = await request(`/tickets/${order.id}`)
assert.equal(savedHistory.materialTypeName, materialName)
assert.equal(savedHistory.businessWorkItems.find((item) => item.id === itemC.id).name, productionPosts[2].name)

console.log('业务目录、基地启用、内部同步创建、生产/装卸只读价格、产品参与工序、比例分摊、单次产量、执行边界和业务触发通过')
