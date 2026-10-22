import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { bearerToken, resolveAuth } from './core/auth'
import { installErrorHandler } from './core/http'
import { closeDatabase } from './db/database'
import { migrate } from './db/migrate'
import { authRoutes } from './modules/auth/routes'
import { healthRoutes } from './modules/health/routes'
import { referenceRoutes } from './modules/reference/routes'
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

app.decorateRequest('auth', null)
app.addHook('onRequest', async (request) => {
  const token = bearerToken(request)
  request.auth = token ? resolveAuth(token) : null
})

await app.register(healthRoutes, { prefix: '/api' })
await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(referenceRoutes, { prefix: '/api' })

const distPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
await app.register(fastifyStatic, {
  root: distPath,
  wildcard: false,
})
app.get('/app', async (_request, reply) => reply.sendFile('app.html'))

const port = Number(process.env.PORT || 3000)
await app.listen({ port, host: '0.0.0.0' })

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down')
  await app.close()
  closeDatabase()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
