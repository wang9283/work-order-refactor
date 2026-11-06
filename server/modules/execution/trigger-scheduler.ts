import { all, nowIso, one, run, transaction } from '../../db/database'
import { creatorActor, enqueueTrigger, executeTrigger } from './trigger-engine'
import { scheduledInstant, type ScheduleConfig } from './trigger-schedule'

interface ScheduledRule {
  id: string; current_version: number; created_by: string; updated_at: string
  config_json: string; mode: 'schedule'
}

/** Claim all elapsed slots under a database write lock, then execute only current slots. */
export function scanScheduledTriggers(now = new Date(), executeRecent = true, onlyRuleId?: string): void {
  const rules = all<ScheduledRule>(`SELECT r.id, r.current_version, r.created_by, r.updated_at, v.config_json, v.mode
    FROM ticket_trigger_rules r JOIN ticket_trigger_versions v ON v.rule_id = r.id AND v.version = r.current_version
    WHERE r.status = 'active' AND v.mode = 'schedule'`)
  for (const candidate of rules) {
    if (onlyRuleId && candidate.id !== onlyRuleId) continue
    transaction(() => {
      const rule = one<ScheduledRule>(`SELECT r.id, r.current_version, r.created_by, r.updated_at, v.config_json, v.mode
        FROM ticket_trigger_rules r JOIN ticket_trigger_versions v ON v.rule_id = r.id AND v.version = r.current_version
        WHERE r.id = ? AND r.status = 'active' AND v.mode = 'schedule'`, [candidate.id])
      if (!rule) return
      const cursor = one<{ scanned_until: string }>('SELECT scanned_until FROM ticket_trigger_cursors WHERE rule_id = ?', [rule.id])?.scanned_until || rule.updated_at
      const start = Date.parse(cursor)
      const end = now.getTime()
      if (start >= end) return
      const config = JSON.parse(rule.config_json) as ScheduleConfig
      const firstDay = Math.floor((start + 8 * 3600000) / 86400000)
      const lastDay = Math.floor((end + 8 * 3600000) / 86400000)
      for (let day = firstDay; day <= lastDay; day++) {
        const date = new Date(day * 86400000).toISOString().slice(0, 10)
        const instant = scheduledInstant(config, date)
        if (!instant) continue
        const time = Date.parse(instant)
        if (time <= start || time > end) continue
        const occurrence = enqueueTrigger(rule, `schedule:${instant}`, instant, {})
        if (executeRecent && end - time <= 90000 && occurrence.status === 'missed' && occurrence.attempts === 0) {
          try { executeTrigger(occurrence.id, creatorActor(rule.created_by)) }
          catch (error) {
            run(`UPDATE ticket_trigger_runs SET status = 'failed', error_message = ?, attempts = attempts + 1, updated_at = ?
              WHERE id = ? AND status != 'succeeded'`, [error instanceof Error ? error.message.slice(0, 1000) : '执行失败', nowIso(), occurrence.id])
          }
        }
      }
      run(`INSERT INTO ticket_trigger_cursors(rule_id, scanned_until) VALUES (?, ?)
        ON CONFLICT(rule_id) DO UPDATE SET scanned_until = excluded.scanned_until`, [rule.id, now.toISOString()])
    })
  }
  if (!onlyRuleId) run(`INSERT INTO ticket_trigger_heartbeat (id, last_seen) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`, [now.toISOString()])
}

/** Wait for a fresh peer heartbeat before treating recent slots as live work. */
export function createScheduledRunner(startedAt = new Date()): () => void {
  let initialized = false
  return () => {
    const now = new Date()
    if (!initialized) {
      const previous = one<{ last_seen: string }>('SELECT last_seen FROM ticket_trigger_heartbeat WHERE id = 1')
      const last = previous ? Date.parse(previous.last_seen) : 0
      if (last > startedAt.getTime()) {
        scanScheduledTriggers(now, true)
      } else if (last && now.getTime() - last < 60000) {
        return
      } else {
        scanScheduledTriggers(now, false)
      }
      initialized = true
      return
    }
    scanScheduledTriggers(now, true)
  }
}
