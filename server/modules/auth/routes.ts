import type { FastifyInstance } from 'fastify'
import { loginSchema } from '../../../packages/contracts/src'
import { one } from '../../db/database'
import {
  bearerToken,
  createSession,
  currentUser,
  deleteSession,
  requireAuth,
  resolveAuth,
} from '../../core/auth'
import { parseInput, success } from '../../core/http'
import { AppError } from '../../core/errors'
import { verifyPassword } from '../../core/password'

interface AccountRow {
  id: string
  username: string
  password_hash: string
  display_name: string
  person_id: string | null
  status: string
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/login', async (request) => {
    const input = parseInput(loginSchema, request.body)
    const account = one<AccountRow>('SELECT * FROM accounts WHERE username = ?', [input.username])
    if (!account || account.status !== 'active' || !verifyPassword(input.password, account.password_hash)) {
      throw AppError.invalidCredentials()
    }
    const session = createSession(account.id)
    const auth = resolveAuth(session.token)
    if (!auth) throw AppError.unauthorized()
    return success(request, {
      token: session.token,
      expiresAt: session.expiresAt,
      user: currentUser(auth),
    })
  })

  app.post('/logout', async (request, reply) => {
    const token = bearerToken(request)
    if (token) deleteSession(token)
    return reply.status(204).send()
  })

  app.get('/me', async (request) => {
    const auth = requireAuth(request)
    return success(request, currentUser(auth))
  })
}
