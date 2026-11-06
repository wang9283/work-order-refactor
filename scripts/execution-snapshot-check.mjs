// The destructive master-data edits below are allowed only in the named isolated test database.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
if (!process.env.DATABASE_PATH || !resolve(process.env.DATABASE_PATH).endsWith('codex-phase1-test.db')) throw new Error('需要指定隔离数据库 codex-phase1-test.db')
const base = process.env.API_BASE_URL || 'http://127.0.0.1:3127/api'
async function call(path, token, method = 'GET', body) {
  const r = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json() }
}
function expect(result, status, label) { assert.equal(result.status, status, `${label}: ${JSON.stringify(result.body)}`); return result.body.data }
const token = expect(await call('/auth/login', null, 'POST', { username: 'group.admin', password: 'Feed2026!' }), 200, '登录').token
const prior = expect(await call('/tickets?pageSize=200', token), 200, '读取已完成测试工单').find((t) => t.status === 'closed' && t.siteId === 'base_direct')
assert(prior, '请先运行 api-smoke.mjs 创建已核算的基线工单')
const suffix = randomUUID().slice(0, 8)
const external = expect(await call('/org/people', token, 'POST', { employeeCode: `EXT-${suffix}`, name: `无账号替班${suffix}`, mobile: '', homeCompanyId: 'co_xinjin', homeBaseId: 'base_direct', factoryId: 'factory_xinjin', status: 'active' }), 201, '登记无账号人员')
const access = expect(await call('/org/access/options', token), 200, '账号列表')
assert(!access.accounts.some((account) => account.personId === external.id), '人员登记不得自动创建登录账号')
const loan = expect(await call('/org/secondments', token, 'POST', { personId: 'person_sun', fromCompanyId: 'co_heze', fromBaseId: 'base_production', toCompanyId: 'co_xinjin', toBaseId: 'base_direct', toFactoryId: 'factory_xinjin', startDate: '2027-01-01', endDate: '2027-01-31', purpose: '验收借调', status: 'active' }), 201, '创建有效借调')
const body = { ticketTypeId: prior.ticketTypeId, siteId: 'base_direct', factoryId: 'factory_xinjin', workAreaId: 'area_xinjin_prod', productionLineId: 'line_xinjin_1', crewId: 'crew_xinjin_sauce', shiftTemplateId: 'shift_direct_day', handoverShiftProfileId: 'handover_xinjin_sauce_day', eventTime: '2027-01-15T00:00:00.000Z', workDate: '2027-01-15', quantity: 3 }
const beforeMembers = expect(await call('/org/crews/crew_xinjin_sauce/members?all=true', token), 200, '原班组成员')
const ticket = expect(await call('/tickets', token, 'POST', { ...body, assignments: [{ personId: 'person_yang', role: 'lead' }, { personId: 'person_sun', role: 'member' }] }), 201, '创建含借调的工单')
assert.equal(ticket.priceSnapshot.unitPriceMicros, 2500000)
assert.equal(ticket.siteSnapshot.productionLineName, '新津一号生产线')
const loanSnapshot = ticket.assignments.find((a) => a.personId === 'person_sun')
assert.equal(loanSnapshot.personSnapshot.secondmentId, loan.id)
expect(await call(`/org/secondments/${loan.id}?revision=${loan.revision}`, token, 'DELETE'), 200, '取消借调')
expect(await call('/tickets', token, 'POST', { ...body, assignments: [{ personId: 'person_sun', role: 'member' }] }), 400, '取消后不能新加借调人员')
const reassigned = expect(await call(`/tickets/${ticket.id}/assignments`, token, 'PUT', { revision: ticket.revision, assignments: [{ personId: 'person_yang', role: 'lead' }, { personId: 'person_sun', role: 'member' }, { personId: external.id, role: 'member' }] }), 200, '临时替班并保留既有借调快照')
assert.equal(reassigned.assignments.find((a) => a.personId === external.id).assignmentSource, 'manual')
assert.equal(reassigned.assignments.find((a) => a.personId === 'person_sun').id, loanSnapshot.id)
assert.deepEqual(reassigned.assignments.find((a) => a.personId === 'person_sun').personSnapshot, loanSnapshot.personSnapshot)
assert.deepEqual(expect(await call('/org/crews/crew_xinjin_sauce/members?all=true', token), 200, '替班后常设成员'), beforeMembers)
const tree = expect(await call('/org/tree', token), 200, '读取主数据')
const person = expect(await call('/org/people/person_yang', token), 200, '人员')
expect(await call('/org/people/person_yang', token, 'PUT', { name: `阳果改名${suffix}`, revision: person.revision }), 200, '修改人员')
for (const [path, item, name] of [
  ['/org/bases', tree.bases.find((x) => x.id === 'base_direct'), `新津基地改名${suffix}`],
  ['/org/factories', tree.factories.find((x) => x.id === 'factory_xinjin'), `新津工厂改名${suffix}`],
  ['/org/work-areas', tree.workAreas.find((x) => x.id === 'area_xinjin_prod'), `新津工区改名${suffix}`],
  ['/org/production-lines', tree.productionLines.find((x) => x.id === 'line_xinjin_1'), `新津产线改名${suffix}`],
  ['/org/crews', tree.crews.find((x) => x.id === 'crew_xinjin_sauce'), `生产班改名${suffix}`],
]) expect(await call(`${path}/${item.id}`, token, 'PUT', { name, revision: item.revision }), 200, `修改${path}`)
const db = new DatabaseSync(resolve(process.env.DATABASE_PATH))
db.prepare('UPDATE price_rule_versions SET unit_price_micros = ? WHERE id = ?').run(99000000, ticket.priceRuleVersionId)
db.close()
const after = expect(await call(`/tickets/${ticket.id}`, token), 200, '主数据修改后读取工单')
assert.deepEqual(after.siteSnapshot, ticket.siteSnapshot, '作业位置快照不变')
assert.deepEqual(after.priceSnapshot, ticket.priceSnapshot, '价格快照不变')
assert.deepEqual(after.formSchema, ticket.formSchema, '表单快照不变')
assert.equal(after.assignments.find((a) => a.personId === 'person_yang').personName, '阳果')
const started = expect(await call(`/tickets/${ticket.id}/start`, token, 'POST', { revision: after.revision, note: '验收开始' }), 200, '开始')
const quantities = Object.fromEntries(started.assignments.map((a) => [a.id, 2]))
const submitted = expect(await call(`/tickets/${ticket.id}/submit`, token, 'POST', { revision: started.revision, values: prior.values, subFormValues: prior.subFormValues, assignmentQuantities: quantities, quantity: 6 }), 200, '提交')
expect(await call('/payroll/confirm-company', token, 'POST', { workMonth: '2027-01', personIds: submitted.assignments.map((a) => a.personId), payrollCompanyId: 'co_heze' }), 200, '独立确认发薪公司')
const approved = expect(await call(`/tickets/${ticket.id}/approve`, token, 'POST', { revision: submitted.revision, note: '验收审核' }), 200, '审核计价')
assert.equal(approved.amountMicros, 15000000, '必须使用工单冻结单价核算')
const accruals = expect(await call('/payroll/accruals?workMonth=2027-01', token), 200, '计件结果').filter((x) => x.ticketId === ticket.id)
assert.equal(accruals.length, 3)
assert(accruals.every((x) => x.amountMicros === 5000000 && x.workSiteId === 'base_direct' && x.payrollCompanyId === 'co_heze'), '作业基地计价、独立发薪公司、无账号人员计件')
console.log('临时替班、借调取消、无账号参与、历史位置人员表单价格快照与发薪归集：通过')
