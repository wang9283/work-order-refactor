import { createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type {
  Capability,
  CapabilityGrant,
  CurrentUser,
  DemoIdentityId,
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
  ipAddress: string
  tokenHash: string
  demoIdentityId: DemoIdentityId | null
  selectedBaseId: string | null
  selectedOrgNodeId: string | null
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

export function createSession(
  accountId: string,
  ttlHours = 24,
  scope: {
    demoIdentityId?: DemoIdentityId | null
    selectedBaseId?: string | null
    selectedOrgNodeId?: string | null
  } = {},
): { token: string; expiresAt: string } {
  const token = issueToken()
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + ttlHours * 60 * 60 * 1000)
  run(
    `INSERT INTO sessions
      (token_hash, account_id, expires_at, created_at, last_seen_at, demo_identity_id, selected_base_id, selected_org_node_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      hashToken(token),
      accountId,
      expiresAt.toISOString(),
      createdAt.toISOString(),
      createdAt.toISOString(),
      scope.demoIdentityId ?? null,
      scope.selectedBaseId ?? null,
      scope.selectedOrgNodeId ?? null,
    ],
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
  const row = one<AccountRow & {
    expires_at: string
    demo_identity_id: DemoIdentityId | null
    selected_base_id: string | null
    selected_org_node_id: string | null
  }>(
    `SELECT a.id, a.username, a.display_name, a.person_id, a.status, s.expires_at,
            s.demo_identity_id, s.selected_base_id, s.selected_org_node_id
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

  // Explicit organization ancestry expands only downward, never into siblings.
  for (const grant of [...grants]) {
    if (grant.type !== 'factory') continue
    const descendants = all<{factory_id:string}>(`WITH RECURSIVE branch AS (
      SELECT id,factory_id FROM org_nodes WHERE factory_id=?
      UNION ALL SELECT n.id,n.factory_id FROM org_nodes n JOIN branch b ON n.parent_id=b.id
    ) SELECT factory_id FROM branch WHERE factory_id IS NOT NULL`,[grant.id])
    for (const node of descendants) if (!grants.some(g => g.capability === grant.capability && g.type === 'factory' && g.id === node.factory_id)) grants.push({ ...grant, id: node.factory_id })
  }

  run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', [new Date().toISOString(), tokenHash])
  return {
    accountId: row.id,
    username: row.username,
    displayName: row.display_name,
    personId: row.person_id,
    ipAddress: '',
    tokenHash,
    demoIdentityId: row.demo_identity_id,
    selectedBaseId: row.selected_base_id,
    selectedOrgNodeId: row.selected_org_node_id,
    grants,
  }
}

export function setSessionSelectedBase(tokenHash: string, baseId: string): void {
  run('UPDATE sessions SET selected_base_id = ?, last_seen_at = ? WHERE token_hash = ?', [
    baseId,
    new Date().toISOString(),
    tokenHash,
  ])
}

export function setSessionSelectedOrg(tokenHash: string, orgNodeId: string, baseId: string): void {
  run('UPDATE sessions SET selected_org_node_id = ?, selected_base_id = ?, last_seen_at = ? WHERE token_hash = ?', [
    orgNodeId,
    baseId,
    new Date().toISOString(),
    tokenHash,
  ])
}

export function hasGrant(auth: AuthContext, capability: Capability, scope: ScopeRef): boolean {
  return auth.grants.some((grant) => {
    if (grant.capability !== capability) return false
    if (grant.type === 'group') return true

    // A grant covers itself and descendants. Child grants never widen upward.
    if (scope.type === 'company') return grant.type === 'company' && grant.id === scope.id
    if (grant.type === 'base') {
      if (scope.type === 'base') return grant.id === scope.id
      if (scope.type === 'factory') {
        return one<{ base_id: string }>('SELECT base_id FROM factories WHERE id = ?', [scope.id])?.base_id === grant.id
      }
      if (scope.type === 'work_area') {
        return one<{ base_id: string }>('SELECT base_id FROM work_areas WHERE id = ?', [scope.id])?.base_id === grant.id
      }
      return false
    }
    if (grant.type === 'company') {
      if (scope.type === 'base') {
        return one<{ company_id: string }>('SELECT company_id FROM production_bases WHERE id = ?', [scope.id])?.company_id === grant.id
      }
      if (scope.type === 'factory') {
        return one<{ company_id: string }>('SELECT company_id FROM factories WHERE id = ?', [scope.id])?.company_id === grant.id
      }
      if (scope.type === 'work_area') {
        return one<{ company_id: string }>(
          `SELECT b.company_id FROM work_areas wa
           JOIN production_bases b ON b.id = wa.base_id
           WHERE wa.id = ?`,
          [scope.id],
        )?.company_id === grant.id
      }
      return false
    }
    if (grant.type === 'factory') {
      if (scope.type === 'factory') return grant.id === scope.id
      if (scope.type === 'work_area') return one<{ factory_id: string | null }>('SELECT factory_id FROM work_areas WHERE id = ?', [scope.id])?.factory_id === grant.id
      return false
    }
    return scope.type === 'work_area' && grant.type === 'work_area' && grant.id === scope.id
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
