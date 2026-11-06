import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const databasePath = resolve(root, process.env.DATABASE_PATH || 'data/product-demo/operations-demo.db')
if (databasePath.toLowerCase() === resolve(root, 'data/feed.db').toLowerCase()) {
  throw new Error('产品 demo 请使用独立 DATABASE_PATH。默认演示库位于 data/product-demo。')
}
const port = Number(process.env.PORT || 3304)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 必须为 1024 至 65535 的整数')

await new Promise((done, fail) => {
  const probe = createServer()
  probe.once('error', () => fail(new Error(`端口 ${port} 已被占用，请指定其他 PORT`)))
  probe.listen(port, '0.0.0.0', () => probe.close(done))
})

const env = { ...process.env, DATABASE_PATH: databasePath, PORT: String(port), LOG_LEVEL: process.env.LOG_LEVEL || 'warn' }
const options = { cwd: root, env, stdio: 'inherit', windowsHide: true }
function runNode(args) {
  const result = spawnSync(process.execPath, args, options)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`演示准备失败：node ${args[0]}，退出码 ${result.status}`)
}

if (!existsSync(databasePath)) {
  runNode(['--import', 'tsx', 'server/db/init.ts'])
} else {
  runNode(['--import', 'tsx', '--input-type=module', '-e',
    "import { migrate } from './server/db/migrate.ts'; import { closeDatabase } from './server/db/database.ts'; migrate(); closeDatabase();"])
}
runNode(['scripts/prepare-operations-demo.mjs'])

if (!process.argv.includes('--skip-build')) {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run build'], options)
    : spawnSync('npm', ['run', 'build'], options)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('构建失败，演示服务尚未启动')
}
if (!existsSync(resolve(root, 'dist/index.html')) || !existsSync(resolve(root, 'dist/app.html'))) {
  throw new Error('构建页面不存在，请先执行 npm run build')
}

console.log(`\nPC: http://127.0.0.1:${port}/`)
console.log(`App: http://127.0.0.1:${port}/app.html`)
console.log(`演示数据库: ${databasePath}`)
console.log('身份与生产基地: 在页面右上角切换；PC 与 App 的选择分别保存')
console.log('业务事件: npm run demo:events；模拟薪酬接收: npm run demo:receive\n')

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], options)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))
server.once('error', (error) => { console.error(error); process.exitCode = 1 })
const code = await new Promise((done) => server.once('exit', (exitCode) => done(exitCode)))
process.exitCode = code || 0
