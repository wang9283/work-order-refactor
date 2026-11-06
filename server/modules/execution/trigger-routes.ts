import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { hasGrant, requireAuth } from '../../core/auth'
import { AppError } from '../../core/errors'
import { parseInput, success } from '../../core/http'
import { all, newId, nowIso, one, run, transaction } from '../../db/database'
import { creatorActor, enqueueTrigger, eventKey, executeTrigger, matchesEvent, type TriggerConfig } from './trigger-engine'
import { scanScheduledTriggers } from './trigger-scheduler'
import { requireScopedBase, withinScopedBase } from '../../core/base-scope'

const condition = z.object({ field: z.string().trim().min(1).max(80), op: z.enum(['eq', 'in']), values: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).max(20) })
const schema = z.object({
  ticketTypeId: z.string().min(1), siteId: z.string().min(1), factoryId: z.string().min(1),
  businessKind: z.enum(['generic', 'production', 'loading']).default('generic'),
  materialId: z.string().nullable().default(null),
  materialTypeId: z.string().nullable().default(null),
  businessItems: z.array(z.object({ catalogId: z.string().min(1), kind: z.enum(['production_post', 'loading_type']) })).max(30).default([]),
  name: z.string().trim().min(1).max(100), status: z.enum(['active', 'inactive']),
  mode: z.enum(['schedule', 'event']), workAreaId: z.string().nullable().default(null),
  crewId: z.string().nullable().default(null), deadlineHours: z.number().int().min(1).max(8760).nullable().default(null),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  frequency: z.enum(['daily', 'weekly']).nullable().default(null), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  eventType: z.string().trim().max(100).nullable().default(null), conditions: z.array(condition).max(10).default([]),
}).superRefine((v, ctx) => {
  if (v.effectiveTo && v.effectiveTo < v.effectiveFrom) ctx.addIssue({ code: 'custom', message: '失效日期不能早于生效日期' })
  if (v.mode === 'schedule' && (!v.frequency || !v.time || (v.frequency === 'weekly' && !v.weekdays.length))) ctx.addIssue({ code: 'custom', message: '定时规则需要频率、时间和适用星期' })
  if (v.mode === 'event' && !v.eventType) ctx.addIssue({ code: 'custom', message: '事件类型不能为空' })
  if (v.businessKind === 'generic' && (v.materialId || v.materialTypeId || v.businessItems.length)) ctx.addIssue({ code: 'custom', message: '通用工单触发规则不能包含生产或装卸字段' })
  if (v.businessKind === 'production'
    && (!(v.materialId || v.materialTypeId) || (!v.materialId && !v.businessItems.length) || v.businessItems.some((item) => item.kind !== 'production_post'))) {
    ctx.addIssue({ code: 'custom', message: '生产触发规则须选择产品或料类；未选产品时须至少一个生产岗位' })
  }
  if (v.businessKind === 'loading' && (v.materialId || v.materialTypeId || v.businessItems.length !== 1 || v.businessItems[0]?.kind !== 'loading_type')) {
    ctx.addIssue({ code: 'custom', message: '装卸触发规则须选择一种装卸类型' })
  }
})
type Params = { id: string }

export async function triggerRoutes(app: FastifyInstance): Promise<void> {
  app.post('/trigger-events', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(z.object({ siteId: z.string().min(1), source: z.string().trim().min(1).max(100), eventId: z.string().trim().min(1).max(200),
      eventType: z.string().trim().min(1).max(100), eventTime: z.string().datetime({ offset: true }),
      payload: z.record(z.string(), z.unknown()).default({}) }), request.body)
    requireScopedBase(auth, input.siteId)
    const rules = all<{ id: string; current_version: number; created_by: string; site_id: string; config_json: string; mode: 'event' }>(
      `SELECT r.id, r.current_version, r.created_by, r.site_id, v.config_json, v.mode FROM ticket_trigger_rules r
       JOIN ticket_trigger_versions v ON v.rule_id = r.id AND v.version = r.current_version
       WHERE r.status = 'active' AND v.mode = 'event' AND r.site_id = ?`, [input.siteId],
    )
    const results = []
    for (const rule of rules) {
      if (!hasGrant(auth, 'ticket.create', { type: 'base', id: rule.site_id })) continue
      const config = JSON.parse(rule.config_json) as TriggerConfig
      if (!matchesEvent(config, input.eventType, input.payload, input.eventTime)) continue
      const occurrence = enqueueTrigger(rule, eventKey(input.source, input.eventId), null, input)
      if (occurrence.status === 'succeeded' || occurrence.status === 'failed') results.push(occurrence)
      else {
        try { results.push(executeTrigger(occurrence.id, creatorActor(rule.created_by))) }
        catch (error) {
          run("UPDATE ticket_trigger_runs SET status = 'failed', error_message = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status != 'succeeded'", [error instanceof Error ? error.message : '执行失败', nowIso(), occurrence.id])
          results.push(one('SELECT * FROM ticket_trigger_runs WHERE id = ?', [occurrence.id]))
        }
      }
    }
    return success(request, results)
  })
  app.post<{ Params: Params }>('/trigger-runs/:id/retry', async (request) => {
    const auth = requireAuth(request)
    const found = one<{ created_by: string; site_id: string }>(`SELECT r.created_by, r.site_id FROM ticket_trigger_runs x
      JOIN ticket_trigger_rules r ON r.id = x.rule_id WHERE x.id = ?`, [request.params.id])
    if (!found) throw AppError.notFound('触发记录')
    requireScopedBase(auth, found.site_id)
    if (!hasGrant(auth, 'ticket.create', { type: 'base', id: found.site_id })) throw AppError.forbidden()
    return success(request, executeTrigger(request.params.id, creatorActor(found.created_by)))
  })
  app.get('/trigger-rules', async (request) => {
    const auth = requireAuth(request)
    const rows = all<{ id: string; site_id: string; factory_id: string; config_json: string } & Record<string, unknown>>(
      `SELECT r.*, v.mode, v.config_json FROM ticket_trigger_rules r JOIN ticket_trigger_versions v
       ON v.rule_id = r.id AND v.version = r.current_version ORDER BY r.created_at DESC`,
    )
    return success(request, rows.filter((r) => withinScopedBase(auth, r.site_id))
      .filter((r) => hasGrant(auth, 'ticket.view', { type: 'base', id: r.site_id }))
      .map((r) => ({ ...r, config: JSON.parse(r.config_json) })))
  })
  app.post('/trigger-rules', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(schema, request.body)
    requireScopedBase(auth, input.siteId)
    if (!hasGrant(auth, 'ticket.create', { type: 'base', id: input.siteId })) throw AppError.forbidden()
    const factory = one<{ id: string }>('SELECT id FROM factories WHERE id = ? AND base_id = ? AND status = ?', [input.factoryId, input.siteId, 'active'])
    if (!factory) throw AppError.badRequest('作业组织必须属于所选基地')
    const type = one<{ id: string; business_kind: string | null }>("SELECT id, business_kind FROM ticket_types WHERE id = ? AND status = 'published'", [input.ticketTypeId])
    if (!type || (input.businessKind === 'generic' ? type.business_kind !== null : type.business_kind !== input.businessKind)) {
      throw AppError.badRequest('工单类型与触发规则业务类别不匹配')
    }
    if (input.businessKind !== 'generic') {
      const expectedKind = input.businessKind === 'production' ? 'production_post' : 'loading_type'
      for (const item of input.businessItems) {
        if (item.kind !== expectedKind) throw AppError.badRequest('触发规则作业项类型不匹配')
        if (input.businessKind === 'production') {
          if (!one<{ id: string }>(`SELECT id FROM business_catalog WHERE id = ? AND kind = 'production_post' AND status = 'active'`, [item.catalogId])) {
            throw AppError.badRequest('触发规则岗位须为启用中的工序/岗位')
          }
        } else if (!one<{ id: string }>(`SELECT c.id FROM business_catalog c JOIN site_business_config_items s
          ON s.catalog_id = c.id WHERE c.id = ? AND c.kind = 'loading_type' AND c.status = 'active' AND s.site_id = ? AND s.enabled = 1`,
        [item.catalogId, input.siteId])) {
          throw AppError.badRequest('触发规则业务项必须先在所选基地启用')
        }
      }
      if (input.materialTypeId) {
        if (!one<{ id: string }>("SELECT id FROM business_catalog WHERE id = ? AND kind = 'material_type'", [input.materialTypeId])) {
          throw AppError.badRequest('触发规则料类类型不匹配')
        }
        const categoryEnabled = one<{ id: string }>(`SELECT c.id FROM business_catalog c JOIN site_business_config_items s
          ON s.catalog_id = c.id WHERE c.id = ? AND c.kind = 'material_type' AND c.status = 'active' AND s.site_id = ? AND s.enabled = 1`,
        [input.materialTypeId, input.siteId])
        if (!categoryEnabled) throw AppError.badRequest('触发规则料类须先在所选基地启用')
      }
      if (input.materialId) {
        const material = one<{ material_type_id: string }>("SELECT material_type_id FROM materials WHERE id = ? AND status = 'active'", [input.materialId])
        if (!material) throw AppError.badRequest('触发规则产品不存在或已停用')
        const categoryEnabled = one<{ id: string }>(`SELECT c.id FROM business_catalog c JOIN site_business_config_items s
          ON s.catalog_id = c.id WHERE c.id = ? AND c.kind = 'material_type' AND c.status = 'active' AND s.site_id = ? AND s.enabled = 1`,
        [material.material_type_id, input.siteId])
        if (!categoryEnabled) throw AppError.badRequest('触发规则产品的物料类别须先在所选基地启用')
      }
    }
    const id = newId('trigger')
    const timestamp = nowIso()
    transaction(() => {
      run(`INSERT INTO ticket_trigger_rules (id, ticket_type_id, site_id, factory_id, name, status, current_version, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`, [id, input.ticketTypeId, input.siteId, input.factoryId, input.name, input.status, auth.accountId, timestamp, timestamp])
      run(`INSERT INTO ticket_trigger_versions (rule_id, version, mode, config_json, created_by, created_at) VALUES (?, 1, ?, ?, ?, ?)`,
        [id, input.mode, JSON.stringify(input), auth.accountId, timestamp])
      run('INSERT INTO ticket_trigger_cursors (rule_id, scanned_until) VALUES (?, ?)', [id, timestamp])
    })
    return reply.status(201).send(success(request, { id, version: 1 }))
  })
  app.put<{ Params: Params }>('/trigger-rules/:id', async (request) => {
    const auth = requireAuth(request)
    const body = parseInput(z.object({ revision: z.number().int().positive(), config: schema }), request.body)
    const rule = one<{ site_id: string; ticket_type_id: string; factory_id: string; current_version: number }>(
      'SELECT site_id, ticket_type_id, factory_id, current_version FROM ticket_trigger_rules WHERE id = ?', [request.params.id],
    )
    if (!rule) throw AppError.notFound('触发规则')
    requireScopedBase(auth, rule.site_id)
    if (!hasGrant(auth, 'ticket.create', { type: 'base', id: rule.site_id })) throw AppError.forbidden()
    const input = body.config
    if (input.siteId !== rule.site_id || input.factoryId !== rule.factory_id || input.ticketTypeId !== rule.ticket_type_id) {
      throw AppError.badRequest('规则的工单类型和作业范围不能修改，请创建新规则')
    }
    scanScheduledTriggers(new Date(), false, request.params.id)
    const timestamp = nowIso()
    transaction(() => {
      const updated = run(`UPDATE ticket_trigger_rules SET name = ?, status = ?, current_version = current_version + 1,
        updated_at = ? WHERE id = ? AND current_version = ?`, [input.name, input.status, timestamp, request.params.id, body.revision])
      if (!updated.changes) throw AppError.revisionConflict()
      run('INSERT INTO ticket_trigger_versions (rule_id, version, mode, config_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [request.params.id, body.revision + 1, input.mode, JSON.stringify(input), auth.accountId, timestamp])
      run(`INSERT INTO ticket_trigger_cursors(rule_id, scanned_until) VALUES (?, ?)
        ON CONFLICT(rule_id) DO UPDATE SET scanned_until = excluded.scanned_until`, [request.params.id, timestamp])
    })
    return success(request, { id: request.params.id, version: body.revision + 1 })
  })
  app.get<{ Params: Params }>('/trigger-rules/:id/runs', async (request) => {
    const auth = requireAuth(request)
    const rule = one<{ site_id: string }>('SELECT site_id FROM ticket_trigger_rules WHERE id = ?', [request.params.id])
    if (!rule) throw AppError.notFound('触发规则')
    requireScopedBase(auth, rule.site_id)
    if (!hasGrant(auth, 'ticket.view', { type: 'base', id: rule.site_id })) throw AppError.forbidden()
    return success(request, all('SELECT * FROM ticket_trigger_runs WHERE rule_id = ? ORDER BY created_at DESC LIMIT 200', [request.params.id]))
  })
}
