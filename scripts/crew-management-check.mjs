// Mutates the isolated test database. Run after seeding.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const base = process.env.API_BASE_URL || 'http://127.0.0.1:3127/api'
async function call(path, token, method = 'GET', body) {
  const r = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json() }
}
function expect(result, status, label) { assert.equal(result.status, status, `${label}: ${JSON.stringify(result.body)}`); return result.body.data }
const token = expect(await call('/auth/login', null, 'POST', { username: 'group.admin', password: 'Feed2026!' }), 200, '登录').token
const suffix = randomUUID().slice(0, 8)
const createCrew = (code, name) => call('/org/crews', token, 'POST', { code, name, baseId: 'base_direct', factoryId: 'factory_xinjin', workAreaId: null, leaderPersonId: null, status: 'active' })
const crewA = expect(await createCrew(`A-${suffix}`, `轮班甲${suffix}`), 201, '创建甲班')
const crewB = expect(await createCrew(`B-${suffix}`, `轮班乙${suffix}`), 201, '创建乙班')
const scope = { workAreaIds: ['area_xinjin_prod'], productionLineIds: ['line_xinjin_1'] }
expect(await call(`/org/crews/${crewA.id}/scopes`, token, 'PUT', { ...scope, revision: crewA.revision }), 200, '甲班配置产线')
expect(await call(`/org/crews/${crewB.id}/scopes`, token, 'PUT', { ...scope, revision: crewB.revision }), 200, '乙班复用同一产线')
// One person belongs to exactly one crew per date, so the roster tests use
// freshly created people instead of seeded members that already hold long-term relations.
const createPerson = async (code, name) => expect(await call('/org/people', token, 'POST', {
  employeeCode: `${code}-${suffix}`, name, mobile: '', homeCompanyId: 'co_xinjin',
  homeBaseId: 'base_direct', factoryId: 'factory_xinjin', status: 'active',
}), 201, `创建人员${name}`)
const freshA = await createPerson('ROSTER-A', `轮班人员甲${suffix}`)
const freshB = await createPerson('ROSTER-B', `轮班人员乙${suffix}`)
const membersPath = `/org/crews/${crewA.id}/members`
const member = (personId, role = 'operator') => ({ personId, role, validFrom: '2027-01-01', validTo: '2027-12-31' })
const failed = await call(`${membersPath}/batch`, token, 'POST', { members: [member(freshA.id), member('person_sun')] })
assert.equal(failed.status, 400, '无覆盖借调时整批拒绝')
assert(failed.body.error.message.includes('孙明') && failed.body.error.message.includes('整批未保存'), '失败原因指出人员及回滚')
assert.equal(expect(await call(`${membersPath}?all=true`, token), 200, '验证批次回滚').length, 0)
const created = expect(await call(`${membersPath}/batch`, token, 'POST', { members: [member(freshA.id, 'leader'), member(freshB.id)] }), 201, '批量添加')
assert.equal(created.length, 2)
assert.equal(expect(await call(`${membersPath}?asOf=2026-12-31`, token), 200, '查看未来关系').length, 0)
assert.equal(expect(await call(`${membersPath}?asOf=2027-01-01`, token), 200, '查看生效日关系').length, 2)
assert.equal(expect(await call(`${membersPath}?all=true`, token), 200, '查询全部关系').length, 2)
expect(await call(`${membersPath}/batch`, token, 'POST', { members: [member(freshA.id)] }), 409, '拒绝同班组重叠关系')
const crossCrew = await call(`/org/crews/${crewB.id}/members/batch`, token, 'POST', { members: [member(freshA.id)] })
assert.equal(crossCrew.status, 409, '拒绝跨班组重叠关系')
assert(crossCrew.body.error.message.includes('轮班甲'), `冲突提示应指出原班组：${JSON.stringify(crossCrew.body.error)}`)
const gapWindow = { personId: freshA.id, role: 'operator', validFrom: '2027-12-31', validTo: '2028-01-05' }
assert.equal((await call(`/org/crews/${crewB.id}/members/batch`, token, 'POST', { members: [gapWindow] })).status, 409, '结束日次日才允许新班组')
const nextDay = { personId: freshA.id, role: 'operator', validFrom: '2028-01-01', validTo: null }
expect(await call(`/org/crews/${crewB.id}/members/batch`, token, 'POST', { members: [nextDay] }), 201, '原关系结束次日起可调班')
const relations = expect(await call(`/org/people/${freshA.id}/crew-relations`, token), 200, '人员班组关系')
assert.equal(relations.length, 2, '应返回甲班与乙班两条关系')
assert(relations.every((item) => item.relation === 'future'), '2027/2028 关系今日均为未来')
assert.equal(relations.find((item) => item.crewId === crewB.id).validFrom, '2028-01-01')
assert.equal(relations.find((item) => item.crewId === crewA.id).crewName, `轮班甲${suffix}`)
// Seeded people hold long-term relations that cover today.
const seeded = expect(await call('/org/people?pageSize=200', token), 200, '人员列表')
const yang = seeded.find((person) => person.id === 'person_yang')
assert.equal(yang.crew?.crewId, 'crew_xinjin_sauce', '人员列表返回当前班组摘要')
assert.equal(yang.crew?.role, 'leader', '人员列表返回班组岗位')
assert(seeded.some((person) => !person.crew), '未分配班组的人员 crew 为空')
const byCrew = expect(await call('/org/people?pageSize=200&crewId=crew_xinjin_sauce', token), 200, '按班组筛选人员')
assert(byCrew.every((person) => person.crew?.crewId === 'crew_xinjin_sauce'), '筛选结果均归属该班组')
assert(byCrew.some((person) => person.id === 'person_yang'), '按班组可筛出成员')
const changed = expect(await call(`/org/crew-members/${created[1].id}`, token, 'PUT', { role: 'leader', validFrom: '2027-01-01', validTo: '2027-12-31', revision: created[1].revision }), 200, '设置第二名组长')
assert.equal(changed.role, 'leader')
const audit = expect(await call('/audit-logs?pageSize=200', token), 200, '查看成员变更审计')
assert(audit.some((entry) => entry.action === 'org.crew.member.update' && entry.entityId === changed.id), '成员变更必须留审计')
console.log('班组范围复用、批量回滚、成员日期、同班组与跨班组重叠、调班边界、角色和审计：通过')
