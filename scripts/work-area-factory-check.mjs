// Run against an isolated seeded database: this creates test areas and a line.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const base = process.env.API_BASE_URL || 'http://127.0.0.1:3127/api'
async function call(path, token, method = 'GET', data) {
  const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined })
  return { status: response.status, body: await response.json() }
}
async function login(username) {
  const result = await call('/auth/login', null, 'POST', { username, password: 'Feed2026!' })
  assert.equal(result.status, 200)
  return result.body.data.token
}
function expect(result, status, label) {
  assert.equal(result.status, status, `${label}: ${JSON.stringify(result.body)}`)
  return result.body.data
}
const group = await login('group.admin')
const heze = await login('hz.factory.admin')
const suffix = randomUUID().slice(0, 8)
const groupRow = expect(await call('/org/management-groups', group, 'POST', { code: `MG-${suffix}`, name: `测试管理分组${suffix}`, status: 'active' }), 201, '新增管理分组')
const editedGroup = expect(await call(`/org/management-groups/${groupRow.id}`, group, 'PUT', { name: `测试管理分组更新${suffix}`, revision: groupRow.revision }), 200, '编辑管理分组')
expect(await call(`/org/management-groups/${groupRow.id}?revision=${editedGroup.revision}`, group, 'DELETE'), 200, '归档管理分组')
const siblingFactory = expect(await call('/org/factories', group, 'POST', { code: `SIB-${suffix}`, name: `菏泽兄弟厂测试${suffix}`, companyId: 'co_heze', baseId: 'base_production', factoryType: 'other', managerPersonId: null, address: '', sortOrder: 90, status: 'active' }), 201, '创建同基地兄弟工厂')
const area = { code: `JA-${suffix}`, name: '兄弟工厂工区测试', baseId: 'base_production', factoryId: siblingFactory.id, parentId: null, managerPersonId: null, status: 'active' }
const sibling = expect(await call('/org/work-areas', group, 'POST', area), 201, '创建兄弟工厂工区')
const changed = expect(await call(`/org/work-areas/${sibling.id}`, group, 'PUT', { revision: sibling.revision, name: '更新名称验证' }), 200, '局部修改工区')
assert.equal(changed.factoryId, siblingFactory.id, '局部修改保留工厂归属')
assert.equal(changed.status, 'active', '局部修改保留状态')
expect(await call('/org/work-areas', heze, 'POST', { ...area, code: `NO-${suffix}` }), 403, '拒绝兄弟工厂新增')
expect(await call('/org/work-areas', group, 'POST', { ...area, code: `BAD-${suffix}`, factoryId: 'factory_heze', parentId: sibling.id }), 400, '拒绝跨厂上级工区')
const visibleAreas = expect(await call('/org/work-areas?pageSize=200', heze), 200, '工厂工区范围')
assert(visibleAreas.some(x => x.id === 'area_heze_prod'))
assert(!visibleAreas.some(x => x.id === sibling.id || x.id === 'area_xinjin_prod'))
const reference = expect(await call('/reference-data', heze), 200, '受限参考数据')
assert(!reference.factories.some(x => x.id === siblingFactory.id), '参考数据不得泄露兄弟工厂')
assert(!reference.workAreas.some(x => x.id === sibling.id), '参考数据不得泄露兄弟工厂工区')
const line = expect(await call('/org/production-lines', group, 'POST', { code: `LINE-${suffix}`, name: '佳市产线测试', baseId: 'base_production', workAreaId: sibling.id, status: 'active' }), 201, '创建产线')
const visibleLines = expect(await call('/org/production-lines?pageSize=200', heze), 200, '工厂产线范围')
assert(!visibleLines.some(x => x.id === line.id))
expect(await call(`/org/production-lines/${line.id}`, group, 'PUT', { revision: line.revision, workAreaId: 'area_heze_prod' }), 400, '拒绝跨厂移动产线')
expect(await call('/org/crews', group, 'POST', { code: `CREW-${suffix}`, name: '跨厂验证班', baseId: 'base_production', factoryId: 'factory_heze', workAreaId: sibling.id, leaderPersonId: null, status: 'active' }), 400, '拒绝跨厂关联班组工区')
for (const scope of [{ type: 'base', id: 'base_direct' }, { type: 'factory', id: 'factory_heze' }]) {
  expect(await call('/org/access/assignments', group, 'POST', { accountId: 'acct_hz_factory', roleId: 'role_base_manager', scope }), 201, '设置混合范围的测试授权')
}
const scopedCandidate = `/tickets/candidates?siteId=base_production&factoryId=${siblingFactory.id}&workDate=2026-10-22`
expect(await call(scopedCandidate, heze), 403, '其他基地授权不能扩大当前工厂授权')
console.log('工区及产线工厂归属、跨厂挂接和读取范围：通过')
