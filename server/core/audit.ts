import type { SQLInputValue } from 'node:sqlite'
import { run } from '../db/database'
import { newId } from './ids'

export interface AuditEntry {
  accountId: string | null
  action: string
  entityType: string
  entityId: string
  scopeType?: string | null
  scopeId?: string | null
  before?: unknown
  after?: unknown
  ipAddress?: string
}

export function writeAudit(entry: AuditEntry): void {
  run(
    `INSERT INTO audit_logs
      (id, account_id, action, entity_type, entity_id, scope_type, scope_id, before_json, after_json, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('audit'),
      entry.accountId,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.scopeType ?? null,
      entry.scopeId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.ipAddress ?? '',
      new Date().toISOString(),
    ] satisfies SQLInputValue[],
  )
}
