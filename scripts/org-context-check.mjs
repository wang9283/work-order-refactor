// TDD seam: verifies the top-bar work-organization context against an isolated SQLite database.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:net'

const root = resolve(import.meta.dirname, '..')
const databasePath = resolve(root, 'data/isolated', `org-context-${Date.now()}`, 'check.db')
mkdirSync(resolve(databasePath, '..'), { recursive: true })

async function command(args, env) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  await new Promise((done, fail) => {
    child.on('error', fail)
    child.on('close', (code) => (code === 0 ? done() : fail(new Error(output))))
  })
}

let port
for (let candidate = 3470; candidate < 3510; candidate += 1) {
  const available = await new Promise((done) => {
    const server = createServer()
    server.on('error', () => done(false))
    server.listen(candidate, '127.0.0.1', () => server.close(() => done(true)))
  })
  if (available) { port = candidate; break }
}
assert(port, '测试端口可用')

const env = { DATABASE_PATH: databasePath, PORT: String(port), LOG_LEVEL: 'error', DEMO_AUTH: 'true' }
await command(['--import', 'tsx', 'server/db/init.ts'], env)
await command(['scripts/prepare-operations-demo.mjs'], env)

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
server.stdout.on('data', (chunk) => { logs += chunk })
server.stderr.on('data', (chunk) => { logs += chunk })

async function waitForHealth(origin) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`)
      if (response.ok) return
    } catch {
      // 服务尚未监听，继续等待
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`服务未就绪: ${logs.slice(-800)}`)
}
await waitForHealth(`http://127.0.0.1:${port}`)

const apiBase = `http://127.0.0.1:${port}/api`
async function request(path, { method = 'GET', body, token, expected = 200 } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const payload = response.status === 204 ? null : await response.json()
  assert.equal(response.status, expected, `${method} ${path} -> ${response.status}: ${logs.slice(-400)}`)
  return payload?.data ?? payload
}

try {
  const manager = await request('/auth/demo-login', { method: 'POST', body: { identityId: 'production-manager' } })
  assert.equal(manager.activeOrg.id, 'org_ops_demo', '默认进入首个授权作业组织')
  assert.deepEqual(manager.orgs.map((org) => org.id).sort(), ['org_ops_demo', 'org_ops_demo_b'], '生产经理可见两个作业组织')
  assert.equal(manager.activeBase.id, 'base_ops_demo', '基地由组织派生')

  // Same pricing base isolation: two orgs on different bases must not share crews.
  const contextA = await request('/operations/context', { token: manager.token })
  const crewsA = contextA.crews.map((crew) => crew.id).sort()
  const switched = await request('/auth/demo-org', { method: 'POST', body: { orgId: 'org_ops_demo_b' }, token: manager.token })
  assert.equal(switched.activeOrg.id, 'org_ops_demo_b', '切换作业组织成功')
  assert.equal(switched.activeBase.id, 'base_ops_demo_b', '切换组织后基地随之派生')
  const contextB = await request('/operations/context', { token: manager.token })
  const crewsB = contextB.crews.map((crew) => crew.id).sort()
  assert.ok(crewsA.length > 0 && crewsB.length > 0, '两端组织都有班组')
  assert.equal(crewsA.filter((id) => crewsB.includes(id)).length, 0, '同身份不同组织的班组互不串用')

  const workloadsB = await request('/operations/workloads?scope=managed', { token: manager.token })
  const ticketIdsB = new Set(workloadsB.tickets.map((ticket) => ticket.id))
  await request('/auth/demo-org', { method: 'POST', body: { orgId: 'org_ops_demo' }, token: manager.token })
  const workloadsA = await request('/operations/workloads?scope=managed', { token: manager.token })
  const cross = workloadsA.tickets.filter((ticket) => ticketIdsB.has(ticket.id))
  assert.equal(cross.length, 0, '组织 A 的工作量不显示组织 B 的工单')
  if (workloadsB.tickets.length) {
    await request(`/operations/tickets/${workloadsB.tickets[0].id}`, { token: manager.token, expected: 403 })
  }

  // Permission intersection: employee sees only its own org; group admin sees all.
  const employee = await request('/auth/demo-login', { method: 'POST', body: { identityId: 'employee' } })
  assert.deepEqual(employee.orgs.map((org) => org.id), ['org_ops_demo'], '员工仅见授权组织')
  const group = await request('/auth/demo-login', { method: 'POST', body: { identityId: 'group-admin' } })
  assert.ok(group.orgs.length >= 2, '总部管理员可见全部作业组织')

  // Forgery: an org outside the identity grants is rejected.
  await request('/auth/demo-org', { method: 'POST', body: { orgId: 'org_ops_demo_b' }, token: employee.token, expected: 403 })

  // Legacy base switch still maps to the org under that base.
  const byBase = await request('/auth/demo-base', { method: 'POST', body: { baseId: 'base_ops_demo_b' }, token: manager.token })
  assert.equal(byBase.activeOrg.baseId, 'base_ops_demo_b', '按基地切换映射到该基地的作业组织')

  // Renaming in Org Management shows up in the top bar on next load.
  const groupToken = group.token
  await request('/org/nodes/org_ops_demo', {
    method: 'PUT',
    token: groupToken,
    body: {
      parentId: 'org_ops_company',
      code: 'ORG-OPS-DEMO-A',
      name: '工作量演示工厂改名',
      payrollCompanyId: 'co_ops_demo',
      pricingSiteId: 'base_ops_demo',
      status: 'active',
      revision: 1,
    },
  })
  const afterRename = await request('/auth/demo-session', { token: manager.token })
  assert.ok(afterRename.orgs.some((org) => org.id === 'org_ops_demo' && org.name === '工作量演示工厂改名'), '顶栏组织名称与组织管理同步')

  // A freshly created org becomes selectable; deactivating it drops the session back.
  const created = await request('/org/nodes', {
    method: 'POST',
    token: groupToken,
    body: {
      parentId: 'org_ops_company',
      code: 'ORG-OPS-DEMO-C',
      name: '工作量演示工厂 C',
      payrollCompanyId: 'co_ops_demo',
      pricingSiteId: 'base_ops_demo',
      status: 'active',
    },
  })
  const orgC = created.id
  const withC = await request('/auth/demo-session', { token: manager.token })
  assert.ok(withC.orgs.some((org) => org.id === orgC), '组织管理新增组织后顶栏可选')
  await request('/auth/demo-org', { method: 'POST', body: { orgId: orgC }, token: manager.token })
  await request(`/org/nodes/${orgC}`, {
    method: 'PUT',
    token: groupToken,
    body: {
      parentId: 'org_ops_company',
      code: 'ORG-OPS-DEMO-C',
      name: '工作量演示工厂 C',
      payrollCompanyId: 'co_ops_demo',
      pricingSiteId: 'base_ops_demo',
      status: 'inactive',
      revision: 1,
    },
  })
  const afterDeactivate = await request('/auth/demo-session', { token: manager.token })
  assert.notEqual(afterDeactivate.activeOrg.id, orgC, '当前组织停用后回退到可用组织')
  assert.ok(!afterDeactivate.orgs.some((org) => org.id === orgC), '停用组织不再出现在选项中')
  await request('/auth/demo-org', { method: 'POST', body: { orgId: orgC }, token: manager.token, expected: 403 })

  console.log('ORG CONTEXT CHECK PASS')
} finally {
  server.kill()
}
