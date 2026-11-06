// Scheduled-trigger regression: catch-up, miss marking, retry, idempotency, live window, weekly and expiry.
// Run with: node --import tsx scripts/trigger-schedule-check.mjs
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { run as dbRun, one as dbOne } from '../server/db/database.ts'
import { scanScheduledTriggers } from '../server/modules/execution/trigger-scheduler.ts'

if (!process.env.DATABASE_PATH || !resolve(process.env.DATABASE_PATH).endsWith('pricing-isolated-check.db')) {
  throw new Error('需要指定隔离数据库 pricing-isolated-check.db')
}
const base = process.env.API_BASE_URL || 'http://127.0.0.1:3131/api'
let token
async function req(path, method = 'GET', input, expected = 200) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: input ? JSON.stringify(input) : undefined })
  const body = await res.json()
  assert.equal(res.status, expected, `${method} ${path} ${JSON.stringify(body)}`)
  return body.data
}
token = (await req('/auth/login', 'POST', { username: 'group.admin', password: 'Feed2026!' })).token

// Rules start with a cursor equal to the wall-clock creation time, so the sweep window is pinned
// to a fixed instant; otherwise the assertions drift as the real date passes the sample dates.
const rewind = (ruleId) => dbRun('UPDATE ticket_trigger_cursors SET scanned_until = ? WHERE rule_id = ?', ['2026-11-02T23:59:00.000Z', ruleId])

const scope = { ticketTypeId: 'type_demo', siteId: 'base_direct', factoryId: 'factory_xinjin', workAreaId: 'area_xinjin_prod', crewId: 'crew_xinjin_sauce' }
const config = (over) => ({ ...scope, name: '定时验收', status: 'active', mode: 'schedule', effectiveFrom: '2026-11-02', effectiveTo: null, frequency: 'daily', time: '08:00', weekdays: [], eventType: null, conditions: [], deadlineHours: null, ...over })

// 1. Daily rule with a 24h deadline: historical slots are recorded as missed, never silently dropped.
const daily = await req('/trigger-rules', 'POST', config({ name: '定时-每日补漏', deadlineHours: 24 }), 201)
rewind(daily.id)
scanScheduledTriggers(new Date('2026-11-05T04:00:00Z'), false, daily.id)
let runs = await req(`/trigger-rules/${daily.id}/runs`)
assert.deepEqual(runs.map((x) => x.scheduled_at).sort(), ['2026-11-03T00:00:00.000Z', '2026-11-04T00:00:00.000Z', '2026-11-05T00:00:00.000Z'], '每日规则应逐个补齐 11-03/04/05 的 08:00 时段')
assert(runs.every((x) => x.status === 'missed' && x.ticket_id === null), '补扫时段应先标记漏触发，不自动开工单')

// 2. Retry materialises exactly one ticket with the rule's scope and deadline.
// Runs come back newest-first, so select the occurrence by its slot instead of by position.
const missed = runs.find((x) => x.scheduled_at === '2026-11-03T00:00:00.000Z')
assert(missed, '应能定位 11-03 的漏触发时段')
const retried = await req(`/trigger-runs/${missed.id}/retry`, 'POST', {})
assert.equal(retried.status, 'succeeded')
assert.ok(retried.ticket_id)
const ticket = await req(`/tickets/${retried.ticket_id}`)
assert.equal(ticket.factoryId, 'factory_xinjin')
assert.equal(ticket.workAreaId, 'area_xinjin_prod')
assert.equal(ticket.crewId, 'crew_xinjin_sauce')
assert.equal(ticket.workDate, '2026-11-03', '工作日按北京时间归属')
assert.equal(Date.parse(ticket.deadlineAt) - Date.parse(retried.scheduled_at), 24 * 3600000, '完成时限应按规则小时数冻结')
// 定时工单沿用创建时的定价口径：有生效默认单价则直接已定价，没有才进入待定价。
assert(['pending', 'confirmed'].includes(ticket.pricing.status), '定时工单应带出定价记录')
if (ticket.pricing.status === 'confirmed') {
  assert.equal(ticket.pricing.method, 'quantity_unit', '默认单价应按产量×单价落定')
  assert.ok(ticket.pricing.sourcePriceId, '默认单价应保留价格版本溯源')
}

// 3. Re-scan over an overlapping window must not duplicate occurrences (restart safety).
scanScheduledTriggers(new Date('2026-11-05T04:00:00Z'), false, daily.id)
scanScheduledTriggers(new Date('2026-11-10T00:00:00Z'), false, daily.id)
runs = await req(`/trigger-rules/${daily.id}/runs`)
assert.equal(runs.length, 8, '重复扫描应只补齐新时段，不产生重复记录')
assert.equal(new Set(runs.map((x) => x.occurrence_key)).size, runs.length, 'occurrence_key 必须唯一')
assert.equal(runs.filter((x) => x.status === 'succeeded').length, 1, '重试结果不应被后续扫描覆盖')

// 4. Weekly rule fires only on the selected weekday.
const weekly = await req('/trigger-rules', 'POST', config({ name: '定时-每周五', frequency: 'weekly', weekdays: [5] }), 201)
rewind(weekly.id)
scanScheduledTriggers(new Date('2026-11-09T00:00:00Z'), false, weekly.id)
const weeklyRuns = await req(`/trigger-rules/${weekly.id}/runs`)
assert.deepEqual(weeklyRuns.map((x) => x.scheduled_at), ['2026-11-06T00:00:00.000Z'], '每周规则只应命中周五时段')

// 5. Expiry date is inclusive and stops later slots.
const expiring = await req('/trigger-rules', 'POST', config({ name: '定时-到期限', effectiveTo: '2026-11-03' }), 201)
rewind(expiring.id)
scanScheduledTriggers(new Date('2026-11-06T00:00:00Z'), false, expiring.id)
const expiringRuns = await req(`/trigger-rules/${expiring.id}/runs`)
assert.deepEqual(expiringRuns.map((x) => x.scheduled_at), ['2026-11-03T00:00:00.000Z'], '失效日期当天含当日，之后不再生成')

// 6. Inactive rules stop generating, and existing cursors must not resurrect them.
const paused = await req('/trigger-rules', 'POST', config({ name: '定时-停用', status: 'inactive' }), 201)
scanScheduledTriggers(new Date('2026-11-05T04:00:00Z'), false, paused.id)
assert.equal((await req(`/trigger-rules/${paused.id}/runs`)).length, 0, '停用规则不应生成时段')

// 7. Live window: a slot inside 90s executes immediately instead of waiting for manual retry.
const live = await req('/trigger-rules', 'POST', config({ name: '定时-实时' }), 201)
dbRun('UPDATE ticket_trigger_cursors SET scanned_until = ? WHERE rule_id = ?', ['2026-11-02T23:59:30.000Z', live.id])
scanScheduledTriggers(new Date('2026-11-03T00:00:30Z'), true, live.id)
const liveRuns = await req(`/trigger-rules/${live.id}/runs`)
assert.equal(liveRuns.length, 1)
assert.equal(liveRuns[0].status === 'succeeded', true, '到点窗口内应直接生成工单')
assert.ok(liveRuns[0].ticket_id)

// 8. Heartbeat lets a second process decide whether recent slots are live work or history.
scanScheduledTriggers(new Date('2026-11-10T01:00:00Z'), false)
const heartbeat = dbOne('SELECT last_seen FROM ticket_trigger_heartbeat WHERE id = 1')
assert.equal(heartbeat.last_seen, '2026-11-10T01:00:00.000Z', '全量扫描应写入心跳')

console.log('定时触发：补漏标记、重试生成、幂等扫描、每周与失效日期、停用、到点执行与心跳通过')
