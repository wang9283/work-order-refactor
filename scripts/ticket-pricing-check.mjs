import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

if (!process.env.DATABASE_PATH || !resolve(process.env.DATABASE_PATH).endsWith('pricing-isolated-check.db')) {
  throw new Error('需要指定隔离数据库 pricing-isolated-check.db')
}
const base = process.env.API_BASE_URL || 'http://127.0.0.1:3131/api'
const db = new DatabaseSync(resolve(process.env.DATABASE_PATH))
db.prepare("UPDATE price_rule_versions SET status = 'retired' WHERE ticket_type_id = 'type_demo'").run()
db.close()
let token
async function request(path, method = 'GET', body, expected = 200) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const result = await response.json()
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`)
  return result.data
}
token = (await request('/auth/login', 'POST', { username: 'group.admin', password: 'Feed2026!' })).token
async function makeTicket() {
  return request('/tickets', 'POST', {
    ticketTypeId: 'type_demo', siteId: 'base_direct', factoryId: 'factory_xinjin', workAreaId: 'area_xinjin_prod',
    crewId: 'crew_xinjin_sauce', eventTime: '2026-11-02T02:00:00Z', workDate: '2026-11-02',
    assignments: [{ personId: 'person_yang', role: 'lead' }], quantity: 2,
  }, 201)
}
async function submit(ticket) {
  ticket = await request(`/tickets/${ticket.id}/start`, 'POST', { revision: ticket.revision })
  return request(`/tickets/${ticket.id}/submit`, 'POST', { revision: ticket.revision, values: { note: 'test' }, quantity: 2, assignmentQuantities: { [ticket.assignments[0].id]: 2 } })
}
const price = (ticket) => ({ revision: ticket.revision, unit: '件', unitPriceMicros: 2500000, reason: '验收计价' })
let a = await makeTicket()
assert.equal(a.pricing.status, 'pending')
a = await submit(a)
a = await request(`/tickets/${a.id}/approve`, 'POST', { revision: a.revision })
assert.equal(a.amountMicros, null)
assert((await request('/payroll/summary?workMonth=2026-11')).pendingPricing.some((ticket) => ticket.id === a.id))
await request('/payroll/close', 'POST', { workMonth: '2026-11', revision: 1 }, 409)
const before = (await request('/payroll/accruals?workMonth=2026-11')).filter((x) => x.ticketId === a.id)
assert.equal(before.length, 0)
const stale = price(a)
const adminToken = token
token = (await request('/auth/login', 'POST', { username: 'executor.demo', password: 'Feed2026!' })).token
await request(`/tickets/${a.id}/pricing`, 'PUT', stale, 403)
token = adminToken
a = await request(`/tickets/${a.id}/pricing`, 'PUT', stale)
assert.equal(a.amountMicros, 5000000)
assert(!(await request('/payroll/summary?workMonth=2026-11')).pendingPricing.some((ticket) => ticket.id === a.id))
await request(`/tickets/${a.id}/pricing`, 'PUT', stale, 409)
let b = await makeTicket()
b = await request(`/tickets/${b.id}/pricing`, 'PUT', price(b))
b = await submit(b)
b = await request(`/tickets/${b.id}/approve`, 'POST', { revision: b.revision })
assert.equal(b.amountMicros, a.amountMicros)
const records = await request('/payroll/accruals?workMonth=2026-11')
assert.equal(records.filter((x) => x.ticketId === a.id).length, 1)
assert.equal(records.filter((x) => x.ticketId === b.id).length, 1)
let c = await makeTicket()
c = await submit(c)
c = await request(`/tickets/${c.id}/approve`, 'POST', { revision: c.revision })
const concurrent = await Promise.all([1, 2].map(() => fetch(base + `/tickets/${c.id}/pricing`, {
  method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(price(c)),
})))
assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409])
assert.equal((await request('/payroll/accruals?workMonth=2026-11')).filter((x) => x.ticketId === c.id).length, 1)
c = await request(`/tickets/${c.id}`)
c = await request(`/tickets/${c.id}/pricing`, 'PUT', { ...price(c), unitPriceMicros: 3000000, reason: '单价调整' })
assert.equal(c.amountMicros, 6000000)
const changed = (await request('/payroll/accruals?workMonth=2026-11')).filter((x) => x.ticketId === c.id)
assert.equal(changed.length, 1)
assert.equal(changed[0].amountMicros, 6000000)
assert((await request('/audit-logs?pageSize=200')).some((entry) => entry.entityId === c.id && entry.action === 'ticket.pricing.recalculate'))
async function lumpTicket(preprice, cents) {
  let t = await request('/tickets', 'POST', {
    ticketTypeId: 'type_demo', siteId: 'base_direct', factoryId: 'factory_xinjin', workAreaId: 'area_xinjin_prod',
    crewId: 'crew_xinjin_sauce', eventTime: '2026-11-02T02:00:00Z', workDate: '2026-11-02',
    assignments: ['person_yang', 'person_wang', 'person_gao'].map((personId) => ({ personId, role: 'member' })),
  }, 201)
  const pricing = () => ({ revision: t.revision, method: 'lump_sum', lumpSumCents: cents, reason: '总包验收' })
  if (preprice) t = await request(`/tickets/${t.id}/pricing`, 'PUT', pricing())
  t = await request(`/tickets/${t.id}/start`, 'POST', { revision: t.revision })
  t = await request(`/tickets/${t.id}/submit`, 'POST', { revision: t.revision, values: { note: '总包' } })
  t = await request(`/tickets/${t.id}/approve`, 'POST', { revision: t.revision })
  if (!preprice) t = await request(`/tickets/${t.id}/pricing`, 'PUT', pricing())
  assert.equal(t.amountMicros, cents * 10000)
  const accruals = (await request('/payroll/accruals?workMonth=2026-11')).filter((x) => x.ticketId === t.id)
  assert.equal(accruals.length, 3)
  assert(accruals.every((x) => x.quantity === null))
  assert.equal(accruals.reduce((sum, x) => sum + x.amountMicros, 0), cents * 10000)
  return accruals.map((x) => x.amountMicros).sort((x, y) => y - x)
}
assert.deepEqual(await lumpTicket(true, 100000), [333340000, 333330000, 333330000])
assert.deepEqual(await lumpTicket(false, 1), [10000, 0, 0])
console.log('单张定价：审核前后定价、待定价及重复请求通过')
