import type { FastifyInstance } from 'fastify'
import { one } from '../../db/database'
import { success } from '../../core/http'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (request) => {
    const row = one<{ result: number }>('SELECT 1 AS result')
    return success(request, {
      status: row?.result === 1 ? 'ok' : 'unavailable',
      version: '3.0.0',
      time: new Date().toISOString(),
    })
  })
}
