// Isolated acceptance runner: every suite gets a freshly seeded database and its own API process,
// so pricing / trigger / payroll regressions are reproducible without touching data/feed.db.
// Usage: node scripts/isolated-acceptance.mjs [--suite api|pricing|business|event|schedule] [--keep]
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const wanted = []
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === '--suite') wanted.push(...(argv[index + 1] || '').split(','))
}
const suites = [
  { key: 'api', script: 'scripts/api-smoke.mjs', label: '全流程 API 冒烟（含月结关账/反关账）' },
  { key: 'pricing', script: 'scripts/ticket-pricing-check.mjs', label: '单张定价：待定价、产量×单价、总包均分' },
  { key: 'business', script: 'scripts/business-work-items-check.mjs', label: '生产/装卸：基地配置、岗位比例、价格快照、执行边界与触发' },
  { key: 'event', script: 'scripts/trigger-engine-check.mjs', label: '事件触发：条件、隔离、重试、版本冻结、防重' },
  { key: 'schedule', script: 'scripts/trigger-schedule-check.mjs', label: '定时触发：补漏、幂等、每周、失效、到点执行' },
  { key: 'crew', script: 'scripts/crew-management-check.mjs', label: '班组归属：范围复用、批量回滚、跨班组重叠、调班边界' },
  { key: 'secondment', script: 'scripts/secondment-factory-check.mjs', label: '借调：分厂维度、借调期班组归属' },
  { key: 'locations', script: 'scripts/work-area-factory-check.mjs', label: '作业位置：工厂维度、层级与权限' },
].filter((suite) => !wanted.length || wanted.includes(suite.key))

// Windows hands out ephemeral ports that a child process cannot always re-bind immediately,
// so probe a fixed range and keep the port reserved until the caller starts listening.
async function freePort(start = 3210) {
  for (let port = start; port < start + 60; port += 1) {
    const held = await new Promise((done) => {
      const probe = createServer()
      probe.once('error', () => done(null))
      probe.once('listening', () => done(probe))
      probe.listen(port, '0.0.0.0')
    })
    if (held) return await new Promise((done) => held.close(() => done(port)))
  }
  throw new Error('没有可用的测试端口')
}

function run(command, args, env, allowFail = false) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', fail)
    child.on('close', (code) => {
      if (code !== 0 && !allowFail) fail(new Error(`${command} ${args.join(' ')} 退出码 ${code}\n${output.slice(-4000)}`))
      else done({ code, output })
    })
  })
}

async function waitForHealth(origin) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`)
      if (response.ok) return
    } catch { /* the API is still booting */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`服务未在 30s 内就绪: ${origin}`)
}

const results = []
const runId = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
for (const suite of suites) {
  const dir = resolve(root, `data/isolated/${suite.key}-${runId}`)
  mkdirSync(dir, { recursive: true })
  const databasePath = resolve(dir, 'pricing-isolated-check.db')
  const port = await freePort()
  const origin = "http://127.0.0.1:" + port
  const env = { DATABASE_PATH: databasePath, PORT: String(port), LOG_LEVEL: "error", API_BASE_URL: origin + "/api" }
  await run('node', ['--import', 'tsx', 'server/db/init.ts'], env)
  const seeded = new DatabaseSync(databasePath)
  const accounts = seeded.prepare('SELECT count(*) AS c FROM accounts').get().c
  const types = seeded.prepare("SELECT count(*) AS c FROM ticket_types WHERE id = 'type_demo'").get().c
  seeded.close()
  if (!accounts || !types) throw new Error(`${suite.label} 隔离库种子缺失: accounts=${accounts} type_demo=${types}`)
  const server = spawn('node', ['--import', 'tsx', 'server/index.ts'], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] })
  let serverError = ''
  server.stderr.on('data', (chunk) => { serverError += chunk })
  try {
    try {
      await waitForHealth(origin)
    } catch (error) {
      throw new Error(`${suite.label} 启动失败\n${serverError.slice(-3000) || String(error.message)}`)
    }
    const outcome = await run('node', ['--import', 'tsx', suite.script], env, true)
    results.push({ suite: suite.label, ok: outcome.code === 0, output: outcome.output.trim().split("\n").slice(outcome.code === 0 ? -3 : 0).join("\n"), serverError: serverError.slice(-3000) })
  } finally {
    server.kill()
    // Windows keeps the WAL handle alive until the child has really exited.
    await new Promise((done) => {
      if (server.exitCode !== null) return done()
      server.once('exit', () => done())
      setTimeout(done, 3000)
    })
  }
  if (!keep) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch (error) {
      console.log(`清理 ${dir} 失败（不影响结论）: ${error.message}`)
    }
  }
  else console.log(`保留隔离库: ${databasePath}`)
}

let failed = 0
for (const result of results) {
  if (!result.ok) failed += 1
  console.log(`\n[${result.ok ? 'PASS' : 'FAIL'}] ${result.suite}`)
  console.log(result.output)
  if (!result.ok && result.serverError) console.log(`服务端日志尾部:\n${result.serverError}`)
}
console.log(`\n合计 ${results.length} 套件，失败 ${failed}`)
process.exit(failed ? 1 : 0)
