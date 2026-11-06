import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AuditLogEntry } from '../../../packages/contracts/src'
import { requireAuth } from '../../core/auth'
import { AppError } from '../../core/errors'
import { parseInput, success } from '../../core/http'
import { all } from '../../db/database'
import { withinScopedBase } from '../../core/base-scope'
import { one } from '../../db/database'

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().optional(),
  action: z.string().trim().optional(),
  entityType: z.string().trim().optional(),
  scopeType: z.enum(['group', 'company', 'base', 'factory', 'work_area']).optional(),
  scopeId: z.string().trim().optional(),
})

interface AuditRow {
  id: string
  account_id: string | null
  account_name: string | null
  action: string
  entity_type: string
  entity_id: string
  scope_type: AuditLogEntry['scopeType']
  scope_id: string | null
  before_json: string | null
  after_json: string | null
  ip_address: string
  created_at: string
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/audit-logs', async (request) => {
    const auth = requireAuth(request)
    if (!auth.grants.some((grant) => grant.capability === 'audit.view')) {
      throw AppError.forbidden()
    }
    if (!auth.grants.some((grant) => grant.type === 'group')) {
      throw AppError.forbidden('审计日志当前仅对总部开放')
    }

    const query = parseInput(auditQuerySchema, request.query)
    const rows = all<AuditRow>(
      `SELECT al.id, al.account_id, a.display_name AS account_name, al.action,
              al.entity_type, al.entity_id, al.scope_type, al.scope_id,
              al.before_json, al.after_json, al.ip_address, al.created_at
       FROM audit_logs al
       LEFT JOIN accounts a ON a.id = al.account_id
       ORDER BY al.created_at DESC, al.id DESC`,
    )

    const items = rows
      .filter((row) => {
        if (row.scope_type === 'group' || row.scope_type === 'company') return true
        if (row.scope_type === 'base') return Boolean(row.scope_id && withinScopedBase(auth, row.scope_id))
        if (row.scope_type === 'factory') {
          const factory = row.scope_id
            ? one<{ base_id: string }>('SELECT base_id FROM factories WHERE id = ?', [row.scope_id])
            : undefined
          return Boolean(factory && withinScopedBase(auth, factory.base_id))
        }
        if (row.scope_type === 'work_area') {
          const area = row.scope_id
            ? one<{ base_id: string }>('SELECT base_id FROM work_areas WHERE id = ?', [row.scope_id])
            : undefined
          return Boolean(area && withinScopedBase(auth, area.base_id))
        }
        return false
      })
      .filter((row) => !query.action || row.action === query.action)
      .filter((row) => !query.entityType || row.entity_type === query.entityType)
      .filter((row) => !query.scopeType || row.scope_type === query.scopeType)
      .filter((row) => !query.scopeId || row.scope_id === query.scopeId)
      .filter((row) => {
        if (!query.q) return true
        const needle = query.q.toLocaleLowerCase()
        return [row.action, row.entity_type, row.entity_id, row.account_name || '']
          .some((value) => value.toLocaleLowerCase().includes(needle))
      })

    const start = (query.page - 1) * query.pageSize
    const pageItems = items.slice(start, start + query.pageSize).map((row): AuditLogEntry => ({
      id: row.id,
      accountId: row.account_id,
      accountName: row.account_name,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      before: parseJson(row.before_json),
      after: parseJson(row.after_json),
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    }))
    return success(request, pageItems, {
      page: query.page,
      pageSize: query.pageSize,
      total: items.length,
      totalPages: items.length ? Math.ceil(items.length / query.pageSize) : 0,
    })
  })
}
