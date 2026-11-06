import { hierarchyRoutes } from './modules/org/hierarchy-routes'
import { businessRoutes } from './modules/business/routes'
import { operationsRoutes } from './modules/operations/routes'
import { ensureBuiltinBusinessTypes } from './modules/business/system-types'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { bearerToken, resolveAuth } from './core/auth'
import { installErrorHandler } from './core/http'
import { closeDatabase } from './db/database'
import { migrate } from './db/migrate'
import { authRoutes } from './modules/auth/routes'
import { auditRoutes } from './modules/audit/routes'
import { healthRoutes } from './modules/health/routes'
import { executionRoutes } from './modules/execution/routes'
import { triggerRoutes } from './modules/execution/trigger-routes'
import { createScheduledRunner } from './modules/execution/trigger-scheduler'
import { orgRoutes } from './modules/org/routes'
import { handoverRoutes } from './modules/org/handover-routes'
import { referenceRoutes } from './modules/reference/routes'
import { templateRoutes } from './modules/templates/routes'
import { resolve, dirname } from 'node:path'

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'production' ? undefined : {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss' },
    },
  },
  genReqId: () => crypto.randomUUID(),
})

await app.register(cors, {
  origin: true,
  credentials: true,
})

installErrorHandler(app)
migrate()
ensureBuiltinBusinessTypes()

app.decorateRequest('auth', null)
app.addHook('onRequest', async (request) => {
  const token = bearerToken(request)
  const auth = token ? resolveAuth(token) : null
  request.auth = auth ? { ...auth, ipAddress: request.ip } : null
})

await app.register(healthRoutes, { prefix: '/api' })
await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(auditRoutes, { prefix: '/api' })
await app.register(orgRoutes, { prefix: '/api' })
await app.register(hierarchyRoutes, { prefix: '/api' })
await app.register(handoverRoutes, { prefix: '/api' })
await app.register(templateRoutes, { prefix: '/api' })
await app.register(businessRoutes, { prefix: '/api' })
await app.register(operationsRoutes, { prefix: '/api/operations' })
await app.register(executionRoutes, { prefix: '/api' })
await app.register(triggerRoutes, { prefix: '/api' })
await app.register(referenceRoutes, { prefix: '/api' })

const distPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
await app.register(fastifyStatic, {
  root: distPath,
  wildcard: false,
})
app.get('/app', async (_request, reply) => reply.sendFile('app.html'))

const port = Number(process.env.PORT || 3000)
await app.listen({ port, host: '0.0.0.0' })
const runTriggerScan = createScheduledRunner()
try { runTriggerScan() } catch (error) { app.log.error({ err: error }, '触发规则启动扫描失败') }
const triggerTimer = setInterval(() => {
  try { runTriggerScan() } catch (error) { app.log.error({ err: error }, '触发规则扫描失败') }
}, 30000)
triggerTimer.unref()

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down')
  clearInterval(triggerTimer)
  await app.close()
  closeDatabase()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
