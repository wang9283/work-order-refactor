// Run only against an isolated seeded test database; this creates test records.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const base = process.env.API_BASE_URL || 'http://127.0.0.1:3127/api'
async function call(path, token, method = 'GET', data) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
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
const testId = randomUUID().slice(0, 8)
const sibling = expect(await call('/org/factories', group, 'POST', {
  code: `SIB-${testId}`, name: '菏泽兄弟厂测试', companyId: 'co_heze', baseId: 'base_production',
  factoryType: 'other', managerPersonId: null, address: '', sortOrder: 90, status: 'active',
}), 201, '创建同基地兄弟工厂')
// A person belongs to one crew per date, so the loan test uses a fresh person
// without any existing long-term membership.
const loanPerson = expect(await call('/org/people', group, 'POST', {
  employeeCode: `LOAN-${testId}`, name: `借调验证人员${testId}`, mobile: '', homeCompanyId: 'co_xinjin',
  homeBaseId: 'base_direct', factoryId: 'factory_xinjin', status: 'active',
}), 201, '登记借调验证人员')
const request = {
  personId: loanPerson.id, fromCompanyId: 'co_xinjin', fromBaseId: 'base_direct',
  toCompanyId: 'co_heze', toBaseId: 'base_production', toFactoryId: 'factory_heze',
  startDate: '2027-01-10', endDate: '2027-01-20', purpose: `工厂范围验证 ${testId}`, status: 'active',
}
expect(await call('/org/secondments', group, 'POST', { ...request, toFactoryId: 'factory_xinjin' }), 400, '拒绝不属于接收基地的工厂')
expect(await call('/org/secondments', heze, 'POST', { ...request, toFactoryId: sibling.id }), 403, '拒绝借入兄弟工厂')
const secondment = expect(await call('/org/secondments', group, 'POST', request), 201, '创建指定接收工厂的借调')
const revised = expect(await call(`/org/secondments/${secondment.id}`, group, 'PUT', { revision: secondment.revision, purpose: '仅修改事由' }), 200, '局部修改借调')
assert.equal(revised.status, 'active', '局部修改不能重置借调状态')
assert.equal(revised.toFactoryId, 'factory_heze', '局部修改不能清除接收工厂')
const members = '/org/crews/crew_heze_a/members'
const membership = { crewId: 'crew_heze_a', personId: loanPerson.id, role: 'operator', validFrom: '2027-01-10', validTo: '2027-01-20' }
expect(await call(members, group, 'POST', { ...membership, validFrom: '2027-01-09' }), 400, '成员有效期超出借调范围')
expect(await call(members, group, 'POST', membership), 201, '多工厂基地中按指定工厂加入班组')
expect(await call('/org/crews/crew_xinjin_sauce/members', group, 'POST', {
  crewId: 'crew_xinjin_sauce', personId: loanPerson.id, role: 'operator', validFrom: '2027-01-12', validTo: '2027-01-15',
}), 409, '借调班组期间不得同时属于其他班组')
const candidates = async (factory, date) => expect(await call(`/tickets/candidates?siteId=base_production&factoryId=${factory}&workDate=${date}`, group), 200, '查询候选')
assert(!(await candidates('factory_heze', '2027-01-09')).some(x => x.person.id === loanPerson.id), '未生效不得参与')
assert((await candidates('factory_heze', '2027-01-10')).some(x => x.person.id === loanPerson.id), '生效日允许参与')
assert(!(await candidates(sibling.id, '2027-01-10')).some(x => x.person.id === loanPerson.id), '兄弟工厂不得参与')
assert(!(await candidates('factory_heze', '2027-01-21')).some(x => x.person.id === loanPerson.id), '到期后不得参与')
expect(await call(`/org/secondments/${secondment.id}?revision=${revised.revision}`, group, 'DELETE'), 200, '取消借调')
assert(!(await candidates('factory_heze', '2027-01-10')).some(x => x.person.id === loanPerson.id), '取消后不得新增参与')
console.log('接收工厂、成员有效期、跨班组唯一归属、兄弟工厂、未生效、到期和取消：通过')
