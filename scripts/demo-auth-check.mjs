// TDD seam: public HTTP endpoints backed by an isolated SQLite database.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:net'

const root = resolve(import.meta.dirname, '..')
const databasePath = resolve(root, 'data/isolated', `demo-auth-${Date.now()}`, 'check.db')
mkdirSync(resolve(databasePath, '..'), { recursive: true })

async function command(args, env) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  await new Promise((done, fail) => {
    child.on('error', fail)
    child.on('close', (code) => code === 0 ? done() : fail(new Error(output)))
  })
}

let port
for (let candidate = 3430; candidate < 3470; candidate += 1) {
  const available = await new Promise((done) => {
    const server = createServer()
    server.on('error', () => done(false))
    server.listen(candidate, '127.0.0.1', () => server.close(() => done(true)))
  })
  if (available) {
    port = candidate
    break
  }
}
assert(port, '测试端口可用')

const env = {
  DATABASE_PATH: databasePath,
  PORT: String(port),
  LOG_LEVEL: 'error',
  DEMO_AUTH: 'true',
}
await command(['--import', 'tsx', 'server/db/init.ts'], env)
await command(['scripts/prepare-operations-demo.mjs'], env)

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root,
  env: { ...process.env, ...env },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
server.stdout.on('data', (chunk) => { logs += chunk })
server.stderr.on('data', (chunk) => { logs += chunk })

const apiBase = `http://127.0.0.1:${port}/api`
async function request(path, { method = 'GET', body, token, expected = 200 } = {}) {
  const response = await fetch(apiBase + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json()
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`)
  return result.data
}

async function demoLogin(identityId) {
  const result = await request('/auth/demo-login', { method: 'POST', body: { identityId } })
  assert.equal(result.identity.id, identityId)
  assert.equal(result.user.accountId, result.identity.accountId)
  assert(result.activeBase?.id, '演示登录必须返回已选基地')
  assert(result.bases.some((base) => base.id === result.activeBase.id), '当前基地必须位于授权候选内')
  return result
}

try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${apiBase}/health`)).ok) break
    } catch { /* API is still booting */ }
    await new Promise((done) => setTimeout(done, 100))
  }

  const options = await request('/auth/demo-options')
  assert.equal(options.enabled, true, '显式开启时提供免登录演示身份')
  assert.deepEqual(
    options.identities.map((identity) => identity.id),
    ['group-admin', 'base-admin', 'production-manager', 'crew-leader', 'employee', 'sanitation-worker', 'payroll'],
  )
  assert.equal(options.identities.find((identity) => identity.id === 'production-manager')?.defaultForAdmin, true)
  assert.equal(options.identities.find((identity) => identity.id === 'employee')?.defaultForMobile, true)

  const managerLogin = await demoLogin('production-manager')
  const managerToken = managerLogin.token
  const manager = await request('/auth/me', { token: managerToken })
  assert.equal(manager.username, 'ops.manager')
  assert.equal(manager.assignments[0].role.code, 'base_manager')

  const managerSession = await request('/auth/demo-session', { token: managerToken })
  assert.equal(managerSession.activeBase.id, 'base_ops_demo')
  assert.deepEqual(managerSession.bases.map((base) => base.id), ['base_ops_demo', 'base_ops_demo_b'])

  const managerContext = await request('/operations/context', { token: managerToken })
  assert.equal(managerContext.crews.find((crew) => crew.id === 'crew_ops_main').canPlanMonth, true)
  assert(managerContext.crews.every((crew) => crew.siteId === 'base_ops_demo'))
  const sourceKeyPrefix = `scope-check-${Date.now()}`
  const ticketA = await request('/operations/demo-sync', {
    method: 'POST',
    token: managerToken,
    body: {
      sourceKey: `${sourceKeyPrefix}-a`,
      businessKind: 'loading',
      workDate: managerContext.today,
      crewId: 'crew_ops_main',
      shiftTemplateId: 'shift_ops_night',
      quantity: 12,
      loadingTypeId: 'catalog_ops_loading',
    },
  })

  const switchedManager = await request('/auth/demo-base', {
    method: 'POST',
    token: managerToken,
    body: { baseId: 'base_ops_demo_b' },
  })
  assert.equal(switchedManager.activeBase.id, 'base_ops_demo_b')
  const contextB = await request('/operations/context', { token: managerToken })
  assert(contextB.crews.some((crew) => crew.id === 'crew_ops_b'))
  assert(contextB.crews.every((crew) => crew.siteId === 'base_ops_demo_b'))
  const treeB = await request('/org/tree', { token: managerToken })
  assert.deepEqual(treeB.bases.map((base) => base.id), ['base_ops_demo_b'])
  assert(treeB.factories.every((factory) => factory.baseId === 'base_ops_demo_b'))
  assert(treeB.crews.every((crew) => crew.baseId === 'base_ops_demo_b'))
  assert(treeB.shiftTemplates.every((shift) => shift.baseId === 'base_ops_demo_b'))
  assert(treeB.workAreas.every((area) => area.baseId === 'base_ops_demo_b'))
  assert(treeB.productionLines.every((line) => line.baseId === 'base_ops_demo_b'))
  assert(treeB.handoverShiftProfiles.every((profile) => profile.siteId === 'base_ops_demo_b'))
  const workAreasB = await request('/org/work-areas?page=1&pageSize=200', { token: managerToken })
  assert(workAreasB.every((area) => area.baseId === 'base_ops_demo_b'))
  const linesB = await request('/org/production-lines?page=1&pageSize=200', { token: managerToken })
  assert(linesB.every((line) => line.baseId === 'base_ops_demo_b'))
  const handoversB = await request('/handover-profiles', { token: managerToken })
  assert.deepEqual(handoversB.map((profile) => profile.id), ['handover_ops_b'])
  const secondmentsB = await request('/org/secondments?page=1&pageSize=200', { token: managerToken })
  assert(secondmentsB.some((row) => row.id === 'secondment_ops_loan'))
  assert(!secondmentsB.some((row) => row.id === 'secondment_demo'), '基地 B 不能返回与该基地无关的借调')
  await request('/handover-profiles/handover_ops_a', {
    method: 'PUT',
    token: managerToken,
    body: {},
    expected: 403,
  })
  await request('/handover-profiles/handover_ops_a?revision=1', {
    method: 'DELETE',
    token: managerToken,
    expected: 403,
  })

  const multibaseB = await request('/ticket-types/type_ops_multibase', { token: managerToken })
  const versionBForProfiles = multibaseB.versions[0]
  assert.equal(versionBForProfiles.workProfiles.length, 1)
  assert.equal(versionBForProfiles.workProfiles[0].siteId, 'base_ops_demo_b')
  const profileInput = ({ id, ticketTypeVersionId, status, ...profile }) => profile
  const groupProfileToken = (await demoLogin('group-admin')).token
  await request('/auth/demo-base', {
    method: 'POST',
    token: groupProfileToken,
    body: { baseId: 'base_ops_demo_b' },
  })
  await request('/ticket-types/type_ops_multibase/versions/typever_ops_multibase', {
    method: 'PUT',
    token: groupProfileToken,
    expected: 403,
    body: {
      revision: versionBForProfiles.revision,
      formVersionId: versionBForProfiles.formVersionId,
      workProfiles: [{
        ...profileInput(versionBForProfiles.workProfiles[0]),
        name: '篡改为 A 基地配置',
        siteId: 'base_ops_demo',
        factoryId: 'factory_ops_demo',
        crewId: 'crew_ops_main',
        shiftTemplateId: 'shift_ops_day',
      }],
    },
  })
  await request('/operations/rosters', {
    method: 'PUT',
    token: managerToken,
    body: {
      mode: 'monthly',
      records: [{
        workDate: contextB.today,
        shiftTemplateId: 'shift_ops_b_day',
        crewId: 'crew_ops_b',
        revision: 0,
        assignments: [],
      }],
    },
  })
  const ticketB = await request('/operations/demo-sync', {
    method: 'POST',
    token: managerToken,
    body: {
      sourceKey: `${sourceKeyPrefix}-b`,
      businessKind: 'loading',
      workDate: contextB.today,
      crewId: 'crew_ops_b',
      shiftTemplateId: 'shift_ops_b_day',
      quantity: 8,
      loadingTypeId: 'catalog_ops_loading',
    },
  })
  const ticketsB = await request('/tickets?page=1&pageSize=100', { token: managerToken })
  assert(ticketsB.some((ticket) => ticket.id === ticketB.ticket.id))
  assert(!ticketsB.some((ticket) => ticket.id === ticketA.ticket.id), 'B 基地列表不能包含 A 基地工单')
  const workloadsB = await request('/operations/workloads?scope=managed', { token: managerToken })
  assert(!workloadsB.tickets.some((ticket) => ticket.id === ticketA.ticket.id), 'B 基地工作量不能包含 A 基地工单')
  await request(`/tickets/${ticketA.ticket.id}`, { token: managerToken, expected: 403 })
  await request('/operations/rosters?crewId=crew_ops_main', { token: managerToken, expected: 403 })
  await request('/tickets/candidates?siteId=base_ops_demo&workDate=' + contextB.today, {
    token: managerToken,
    expected: 403,
  })
  await request('/sites/base_ops_demo/business-config', { token: managerToken, expected: 403 })
  await request('/business-prices?siteId=base_ops_demo', { token: managerToken, expected: 403 })

  await request('/auth/demo-base', {
    method: 'POST',
    token: managerToken,
    body: { baseId: 'base_ops_demo' },
  })
  const ticketsA = await request('/tickets?page=1&pageSize=100', { token: managerToken })
  assert(ticketsA.some((ticket) => ticket.id === ticketA.ticket.id))
  assert(!ticketsA.some((ticket) => ticket.id === ticketB.ticket.id), 'A 基地列表不能包含 B 基地工单')
  const treeA = await request('/org/tree', { token: managerToken })
  assert.deepEqual(treeA.bases.map((base) => base.id), ['base_ops_demo'])
  assert(treeA.factories.every((factory) => factory.baseId === 'base_ops_demo'))
  assert(treeA.workAreas.every((area) => area.baseId === 'base_ops_demo'))
  assert(treeA.productionLines.every((line) => line.baseId === 'base_ops_demo'))
  assert(treeA.handoverShiftProfiles.every((profile) => profile.siteId === 'base_ops_demo'))
  const workAreasA = await request('/org/work-areas?page=1&pageSize=200', { token: managerToken })
  assert(workAreasA.every((area) => area.baseId === 'base_ops_demo'))
  const linesA = await request('/org/production-lines?page=1&pageSize=200', { token: managerToken })
  assert(linesA.every((line) => line.baseId === 'base_ops_demo'))
  const handoversA = await request('/handover-profiles', { token: managerToken })
  assert.deepEqual(handoversA.map((profile) => profile.id), ['handover_ops_a'])
  const secondmentsA = await request('/org/secondments?page=1&pageSize=200', { token: managerToken })
  assert(secondmentsA.some((row) => row.id === 'secondment_ops_loan'))
  assert(!secondmentsA.some((row) => row.id === 'secondment_demo'), '基地 A 不能返回与该基地无关的借调')

  const multibaseA = await request('/ticket-types/type_ops_multibase', { token: managerToken })
  const versionAForProfiles = multibaseA.versions[0]
  assert.equal(versionAForProfiles.workProfiles.length, 1)
  assert.equal(versionAForProfiles.workProfiles[0].siteId, 'base_ops_demo')
  await request('/auth/demo-base', {
    method: 'POST',
    token: groupProfileToken,
    body: { baseId: 'base_ops_demo' },
  })
  await request('/ticket-types/type_ops_multibase/versions/typever_ops_multibase', {
    method: 'PUT',
    token: groupProfileToken,
    body: {
      revision: versionAForProfiles.revision,
      formVersionId: versionAForProfiles.formVersionId,
      workProfiles: [{
        ...profileInput(versionAForProfiles.workProfiles[0]),
        name: 'A 基地配置（已更新）',
      }],
    },
  })
  await request('/auth/demo-base', {
    method: 'POST',
    token: groupProfileToken,
    body: { baseId: 'base_ops_demo_b' },
  })
  const multibaseBAfterAUpdate = await request('/ticket-types/type_ops_multibase', { token: groupProfileToken })
  assert.equal(multibaseBAfterAUpdate.versions[0].workProfiles.length, 1)
  assert.equal(multibaseBAfterAUpdate.versions[0].workProfiles[0].name, 'B 基地配置')
  await request('/auth/demo-base', {
    method: 'POST',
    token: groupProfileToken,
    body: { baseId: 'base_ops_demo' },
  })

  const leaderToken = (await demoLogin('crew-leader')).token
  const leader = await request('/auth/me', { token: leaderToken })
  assert.equal(leader.username, 'ops.leader')
  assert.equal(leader.personId, 'person_ops_leader')
  const leaderContext = await request('/operations/context', { token: leaderToken })
  assert.equal(leaderContext.crews.find((crew) => crew.id === 'crew_ops_main').canManage, true)
  assert.equal(leaderContext.crews.find((crew) => crew.id === 'crew_ops_main').canPlanMonth, false)

  const employeeToken = (await demoLogin('employee')).token
  const employee = await request('/auth/me', { token: employeeToken })
  assert.equal(employee.username, 'ops.worker')
  assert.equal(employee.personId, 'person_ops_a')
  const employeeContext = await request('/operations/context', { token: employeeToken })
  assert.equal(employeeContext.crews.some((crew) => crew.canManage), false)

  const sanitationToken = (await demoLogin('sanitation-worker')).token
  const sanitation = await request('/auth/me', { token: sanitationToken })
  assert.equal(sanitation.username, 'ops.wash')
  assert.equal(sanitation.personId, 'person_ops_wash')

  const today = employeeContext.today
  await request(`/operations/rosters?scope=mine&crewId=crew_ops_main&dateFrom=${today}&dateTo=${today}`, {
    token: employeeToken,
  })
  await request('/operations/rosters', {
    method: 'PUT',
    token: employeeToken,
    expected: 403,
    body: {
      mode: 'monthly',
      records: [{
        workDate: today,
        shiftTemplateId: 'shift_ops_day',
        crewId: 'crew_ops_main',
        revision: 0,
        assignments: [{ personId: 'person_ops_a', postId: 'catalog_ops_post_a' }],
      }],
    },
  })

  await request('/auth/demo-login', {
    method: 'POST',
    body: { identityId: 'not-whitelisted' },
    expected: 400,
  })

  const groupLogin = await demoLogin('group-admin')
  assert(groupLogin.bases.length > 1, '总部身份应可选择多个启用基地')
  const switched = await request('/auth/demo-base', {
    method: 'POST',
    token: groupLogin.token,
    body: { baseId: 'base_ops_demo' },
  })
  assert.equal(switched.activeBase.id, 'base_ops_demo')
  const restored = await request('/auth/demo-session', { token: groupLogin.token })
  assert.equal(restored.activeBase.id, 'base_ops_demo')
  const payrollSummary = await request(`/payroll/summary?workMonth=${managerContext.today.slice(0, 7)}`, {
    token: groupLogin.token,
  })
  await request('/payroll/close', {
    method: 'POST',
    token: groupLogin.token,
    expected: 409,
    body: {
      workMonth: managerContext.today.slice(0, 7),
      revision: payrollSummary.period.revision,
      replaceAccruals: [],
      additionalAccruals: [],
    },
  })

  const baseAdminLogin = await demoLogin('base-admin')
  await request('/auth/demo-base', {
    method: 'POST',
    token: baseAdminLogin.token,
    body: { baseId: 'base_ops_demo' },
    expected: 403,
  })

  console.log('[PASS] 免登录演示身份由服务端签发，并映射真实角色、人员与接口权限')
} catch (error) {
  error.message += `\n服务端日志尾部:\n${logs.slice(-4000)}`
  throw error
} finally {
  server.kill()
}
