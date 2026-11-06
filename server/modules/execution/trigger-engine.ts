import { createHash } from 'node:crypto'
import { all, newId, nowIso, one, run, transaction } from '../../db/database'
import { AppError } from '../../core/errors'
import { createTicket } from './repository'

export interface TriggerConfig {
  ticketTypeId: string; siteId: string; factoryId: string; workAreaId: string | null; crewId: string | null
  businessKind?: 'generic' | 'production' | 'loading'; materialId?: string | null; materialTypeId?: string | null
  businessItems?: Array<{ catalogId: string; kind: 'production_post' | 'loading_type' }>
  deadlineHours: number | null; effectiveFrom: string; effectiveTo: string | null
  mode: 'schedule' | 'event'; eventType: string | null
  conditions: Array<{ field: string; op: 'eq' | 'in'; values: Array<string | number | boolean> }>
}
interface Actor { accountId: string; ipAddress: string; grants: Array<{ capability: string; type: string; id: string }> }
interface Rule { id: string; current_version: number; created_by: string; config_json: string; mode: 'schedule' | 'event' }
interface TriggerRun { id: string; rule_id: string; rule_version: number; status: 'missed' | 'failed' | 'succeeded'; ticket_id: string | null; scheduled_at: string | null; input_json: string; attempts: number }

export function eventKey(source: string, eventId: string): string {
  return `event:${createHash('sha256').update(JSON.stringify([source, eventId])).digest('hex')}`
}

export function creatorActor(accountId: string): Actor {
  const account = one<{ status: string }>('SELECT status FROM accounts WHERE id = ?', [accountId])
  if (!account || account.status !== 'active') throw AppError.forbidden('规则创建账号已停用')
  const grants = all<{ capability: string; scope_type: string; scope_id: string }>(
    `SELECT DISTINCT rc.capability, ra.scope_type, ra.scope_id FROM role_assignments ra
      JOIN role_capabilities rc ON rc.role_id = ra.role_id WHERE ra.account_id = ?
      AND (ra.valid_from IS NULL OR ra.valid_from <= date('now')) AND (ra.valid_to IS NULL OR ra.valid_to >= date('now'))`, [accountId],
  ).map((g) => ({ capability: g.capability, type: g.scope_type, id: g.scope_id }))
  return { accountId, ipAddress: 'trigger', grants }
}

export function executeTrigger(runId: string, actor: Actor): TriggerRun {
  return transaction(() => {
    const occurrence = one<TriggerRun>('SELECT * FROM ticket_trigger_runs WHERE id = ?', [runId])
    if (!occurrence) throw AppError.notFound('触发记录')
    if (occurrence.status === 'succeeded') return occurrence
    const version = one<{ config_json: string }>('SELECT config_json FROM ticket_trigger_versions WHERE rule_id = ? AND version = ?', [occurrence.rule_id, occurrence.rule_version])
    if (!version) throw AppError.notFound('触发规则版本')
    const config = JSON.parse(version.config_json) as TriggerConfig
    const input = JSON.parse(occurrence.input_json) as { eventTime?: string }
    const eventTime = occurrence.scheduled_at || input.eventTime || nowIso()
    const workDate = new Date(new Date(eventTime).getTime() + 8 * 3600000).toISOString().slice(0, 10)
    try {
      transaction(() => {
        const ticket = createTicket(actor, {
          ticketTypeId: config.ticketTypeId, siteId: config.siteId, factoryId: config.factoryId,
          workAreaId: config.workAreaId, productionLineId: null, crewId: config.crewId,
          shiftTemplateId: null, eventTime, workDate, assignments: [], quantity: null,
          businessKind: config.businessKind ?? 'generic', materialId: config.materialId ?? null,
          materialTypeId: config.materialTypeId ?? null,
          businessItems: config.businessItems ?? [],
        })
        if (config.deadlineHours) run('UPDATE tickets SET deadline_at = ? WHERE id = ?', [new Date(Date.parse(eventTime) + config.deadlineHours * 3600000).toISOString(), ticket.id])
        run(`UPDATE ticket_trigger_runs SET status = 'succeeded', ticket_id = ?, error_message = NULL,
          attempts = attempts + 1, updated_at = ? WHERE id = ?`, [ticket.id, nowIso(), runId])
      })
    } catch (error) {
      run(`UPDATE ticket_trigger_runs SET status = 'failed', error_message = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`,
        [error instanceof Error ? error.message.slice(0, 1000) : '生成工单失败', nowIso(), runId])
    }
    return one<TriggerRun>('SELECT * FROM ticket_trigger_runs WHERE id = ?', [runId])!
  })
}

export function enqueueTrigger(rule: Rule, occurrenceKey: string, scheduledAt: string | null, input: unknown): TriggerRun {
  const timestamp = nowIso()
  run(`INSERT OR IGNORE INTO ticket_trigger_runs (id, rule_id, rule_version, occurrence_key, mode, scheduled_at, input_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'missed', ?, ?)`,
  [newId('trigger_run'), rule.id, rule.current_version, occurrenceKey, rule.mode, scheduledAt, JSON.stringify(input), timestamp, timestamp])
  return one<TriggerRun>('SELECT * FROM ticket_trigger_runs WHERE rule_id = ? AND occurrence_key = ?', [rule.id, occurrenceKey])!
}

export function matchesEvent(config: TriggerConfig, eventType: string, payload: Record<string, unknown>, eventTime: string): boolean {
  const date = new Date(Date.parse(eventTime) + 8 * 3600000).toISOString().slice(0, 10)
  return config.mode === 'event' && config.eventType === eventType && date >= config.effectiveFrom
    && (!config.effectiveTo || date <= config.effectiveTo)
    && config.conditions.every((c) => c.op === 'eq' ? payload[c.field] === c.values[0] : c.values.includes(payload[c.field] as string | number | boolean))
}
