import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

if (!process.env.DATABASE_PATH || !resolve(process.env.DATABASE_PATH).endsWith('pricing-isolated-check.db')) throw new Error('需要指定隔离数据库 pricing-isolated-check.db')
const base = process.env.API_BASE_URL || 'http://127.0.0.1:3131/api'
let token
async function req(path, method = 'GET', input, expected = 200) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: input ? JSON.stringify(input) : undefined })
  const body = await res.json()
  assert.equal(res.status, expected, `${path} ${JSON.stringify(body)}`)
  return body.data
}
token = (await req('/auth/login', 'POST', { username: 'group.admin', password: 'Feed2026!' })).token
const eventType = `test.${randomUUID()}`
const config = { ticketTypeId: 'type_demo', siteId: 'base_direct', factoryId: 'factory_xinjin', name: '事件测试', status: 'active', mode: 'event',
  effectiveFrom: '2026-01-01', eventType, workAreaId: 'missing-test-area', conditions: [{ field: 'kind', op: 'eq', values: ['grain'] }] }
const rule = await req('/trigger-rules', 'POST', config, 201)
const event = { siteId: 'base_direct', source: 'isolated-test', eventId: randomUUID(), eventType, eventTime: '2026-11-02T02:00:00Z', payload: { kind: 'grain' } }
assert.deepEqual(await req('/trigger-events', 'POST', { ...event, payload: { kind: 'other' } }), [])
assert.deepEqual(await req('/trigger-events', 'POST', { ...event, siteId: 'base_production' }), [])
const failed = (await req('/trigger-events', 'POST', event))[0]
assert.equal(failed.status, 'failed')
assert.equal(failed.ticket_id, null)
await req(`/trigger-rules/${rule.id}`, 'PUT', { revision: 1, config: { ...config, workAreaId: null } })
const retried = await req(`/trigger-runs/${failed.id}/retry`, 'POST', {})
assert.equal(retried.status, 'failed')
assert.equal(retried.rule_version, 1)
assert.equal(retried.attempts, 2)
const newEvent = { ...event, eventId: randomUUID() }
const results = await Promise.all([req('/trigger-events', 'POST', newEvent), req('/trigger-events', 'POST', newEvent)])
assert.equal(results[0][0].status, 'succeeded')
assert.equal(results[0][0].ticket_id, results[1][0].ticket_id)
assert.equal((await req(`/trigger-rules/${rule.id}/runs`)).length, 2)
console.log('事件条件、基地隔离、失败重试、版本冻结和并发防重通过')
