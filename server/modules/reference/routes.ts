import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../core/auth'
import { success } from '../../core/http'
import { getOrgTree } from '../org/service'

export async function referenceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/reference-data', async (request) => success(request, getOrgTree(requireAuth(request))))
}
