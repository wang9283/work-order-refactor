import { createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type {
  Capability,
  CapabilityGrant,
  CurrentUser,
  RoleAssignmentSummary,
  ScopeRef,
  ScopeType,
} from '../../packages/contracts/src'
import { all, one, run } from '../db/database'
import { AppError } from './errors'
import { newId } from './ids'

export interface AuthContext {
  accountId: string
  username: string
  displayName: string
  personId: string | null
  tokenHash: string
  grants: CapabilityGrant[]
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null
  }
}

interface AccountRow {
  id: string
  username: string
  display_name: string
  person_id: string | null
  status: string
}

interface GrantRow {
  capability: Capability
  scope_type: ScopeType
  scope_id: string
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function issueToken(): string {
  return crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '')
}

export function createSession(accountId: string, ttlHours = 24): { token: string; expiresAt: string } {
  const token = issueToken()
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + ttlHours * 60 * 60 * 1000)
  run(
    `INSERT INTO sessions (token_hash, account_id, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
    [hashToken(token), accountId, expiresAt.toISOString(), createdAt.toISOString(), createdAt.toISOString()],
  )
  return { token, expiresAt: expiresAt.toISOString() }
}

export function deleteSession(token: string): void {
  run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)])
}

export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim() || null
}

export function resolveAuth(token: string): AuthContext | null {
  const tokenHash = hashToken(token)
  const row = one<AccountRow & { expires_at: string }>(
    `SELECT a.id, a.username, a.display_name, a.person_id, a.status, s.expires_at
     FROM sessions s
     JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = ?`,
    [tokenHash],
  )
  if (!row || row.status !== 'active' || Date.parse(row.expires_at) <= Date.now()) return null

  const grants = all<GrantRow>(
    `SELECT DISTINCT rc.capability, ra.scope_type, ra.scope_id
     FROM role_assignments ra
     JOIN role_capabilities rc ON rc.role_id = ra.role_id
     WHERE ra.account_id = ?
       AND (ra.valid_from IS NULL OR ra.valid_from <= date('now'))
       AND (ra.valid_to IS NULL OR ra.valid_to >= date('now'))`,
    [row.id],
  ).map((grant) => ({
    capability: grant.capability,
    type: grant.scope_type,
    id: grant.scope_id,
  }))

  run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', [new Date().toISOString(), tokenHash])
  return {
    accountId: row.id,
    username: row.username,
    displayName: row.display_name,
    personId: row.person_id,
    tokenHash,
    grants,
  }
}

function expandScope(type: ScopeType, id: string): Array<{ type: ScopeType; id: string }> {
  if (type === 'group') return [{ type: 'group', id }]
  if (type === 'company') {
    return [
      { type: 'company', id },
      ...all<{ id: string }>('SELECT id FROM production_bases WHERE company_id = ?', [id]).map((row) => ({ type: 'base' as const, id: row.id })),
    ]
  }
  if (type === 'base') {
    return [
      { type: 'base', id },
      ...all<{ id: string }>('SELECT id FROM work_areas WHERE base_id = ?', [id]).map((row) => ({ type: 'work_area' as const, id: row.id })),
    ]
  }
  return [{ type: 'work_area', id }]
}

export function hasGrant(auth: AuthContext, capability: Capability, scope: ScopeRef): boolean {
  const requested = expandScope(scope.type, scope.id)
  return auth.grants.some((grant) => {
    if (grant.capability !== capability) return false
    if (grant.type === 'group') return true
    if (grant.type === 'company') return requested.some((target) => target.type === 'company' && target.id === grant.id)
    const target = requested.some((item) => item.type === grant.type && item.id === grant.id)
    if (!target) return false
    if (grant.type === 'base') {
      const baseCompany = one<{ company_id: string }>('SELECT company_id FROM production_bases WHERE id = ?', [grant.id])
      return requested.some((item) => item.type === 'base' && (!baseCompany || item.id === grant.id))
    }
    return true
  })
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw AppError.unauthorized()
  return request.auth
}

export function requireCapability(request: FastifyRequest, capability: Capability, scope: ScopeRef): AuthContext {
  const auth = requireAuth(request)
  if (!hasGrant(auth, capability, scope)) throw AppError.forbidden()
  return auth
}

export function currentUser(auth: AuthContext): CurrentUser {
  const assignments = all<{
    assignment_id: string
    role_id: string
    role_code: string
    role_name: string
    built_in: number
    scope_type: ScopeType
    scope_id: string
    valid_from: string | null
    valid_to: string | null
  }>(
    `SELECT ra.id AS assignment_id, r.id AS role_id, r.code AS role_code, r.name AS role_name,
            r.built_in, ra.scope_type, ra.scope_id, ra.valid_from, ra.valid_to
     FROM role_assignments ra
     JOIN roles r ON r.id = ra.role_id
     WHERE ra.account_id = ?`,
    [auth.accountId],
  )
  return {
    accountId: auth.accountId,
    username: auth.username,
    displayName: auth.displayName,
    personId: auth.personId,
    status: 'active',
    grants: auth.grants,
    assignments: assignments.map((row): RoleAssignmentSummary => ({
      assignmentId: row.assignment_id,
      role: {
        id: row.role_id,
        code: row.role_code,
        name: row.role_name,
        builtIn: row.built_in === 1,
      },
      scope: { type: row.scope_type, id: row.scope_id },
      validFrom: row.valid_from,
      validTo: row.valid_to,
    })),
  }
}

export function addRoleAssignment(input: {
  accountId: string
  roleId: string
  scope: ScopeRef
  validFrom?: string | null
  validTo?: string | null
  createdBy?: string | null
}): string {
  const id = newId('ra')
  run(
    `INSERT INTO role_assignments
      (id, account_id, role_id, scope_type, scope_id, valid_from, valid_to, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.accountId,
      input.roleId,
      input.scope.type,
      input.scope.id,
      input.validFrom ?? null,
      input.validTo ?? null,
      new Date().toISOString(),
      input.createdBy ?? null,
    ],
  )
  return id
}
