import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const action = process.argv[2] || 'generate'
if (!['generate', 'receive'].includes(action)) throw new Error('用法：node scripts/product-demo-events.mjs generate|receive [--date=YYYY-MM-DD]')
const origin = (process.env.API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3304}/api`).replace(/\/$/, '')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('此脚本仅用于本机演示服务')
const workDate = process.argv.find((arg) => arg.startsWith('--date='))?.slice(7)
  || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) throw new Error('作业日期格式应为 YYYY-MM-DD')
let token = ''
async function request(path, method = 'GET', body) {
  const response = await fetch(origin + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const envelope = await response.json()
  if (!response.ok) throw new Error(`${response.status} ${path}: ${envelope.error?.message || JSON.stringify(envelope.error || envelope)}`)
  return envelope.data
}
token = (await request('/auth/login', 'POST', { username: 'ops.manager', password: 'Feed2026!' })).token
const context = await request('/operations/context')
if (!context.crews.some((crew) => crew.id === 'crew_ops_main')) throw new Error('当前服务缺少独立演示班组，请先运行 npm run demo')

if (action === 'generate') {
  for (const [businessKind, quantity] of [['production', 100], ['loading', 40]]) {
    const crewId=businessKind==='production'?'crew_ops_main':'crew_ops_loading'
    const result = await request('/operations/demo-sync', 'POST', {
      sourceKey: `product-demo:${workDate}:night:${businessKind}`,
      businessKind, workDate, crewId, shiftTemplateId: businessKind==='production'?'shift_ops_night':'shift_ops_day', quantity,
      ...(businessKind === 'production' ? { materialId: 'material_ops_demo' } : { loadingTypeId: 'catalog_ops_loading' }),
    })
    console.log(JSON.stringify({ businessKind, duplicate: result.duplicate, ticketNo: result.ticket.ticketNo,
      quantity: result.ticket.quantity, workItems: result.ticket.workItems.map((item) => ({
        name: item.name, people: item.assignments.map((person) => ({ name: person.personName, share: person.shareBasisPoints / 100, quantity: person.quantity })),
      })),
    }, null, 2))
  }
} else {
  const query = new URLSearchParams({ dateFrom: workDate, dateTo: workDate, scope: 'managed' })
  const payload = await request(`/operations/export?${query}`)
  if (payload.simulated !== true || !Array.isArray(payload.rows)) throw new Error('工作量输出不是有效的本地演示数据')
  const directory = resolve(root, 'data/product-demo/receipts')
  mkdirSync(directory, { recursive: true })
  const receiptPath = resolve(directory, `${workDate}-${Date.now()}.json`)
  writeFileSync(receiptPath, JSON.stringify({ receivedAt: new Date().toISOString(), receiver: 'local-payroll-demo', payload }, null, 2), 'utf8')
  console.log(JSON.stringify({ status: '模拟薪酬接收完成', workDate, rows: payload.rows.length, totals: payload.totals, receiptPath }, null, 2))
}
