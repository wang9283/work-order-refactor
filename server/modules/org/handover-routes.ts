import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { hasGrant, requireAuth } from '../../core/auth'
import { AppError } from '../../core/errors'
import { parseInput, success } from '../../core/http'
import { all, newId, nowIso, one, run, transaction } from '../../db/database'
import { writeAudit } from '../../core/audit'
import { requireScopedBase, withinScopedBase } from '../../core/base-scope'

interface HandoverProfileRow {
  id: string
  name: string
  factory_id: string
  site_id: string
  shift_template_id: string
  assignment_mode: 'roster_first' | 'manual'
  handover_required: number
  early_start_minutes: number
  late_end_minutes: number
  instruction: string
  status: 'active' | 'inactive' | 'archived'
  revision: number
  crew_ids: string
}

const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  factoryId: z.string().min(1),
  shiftTemplateId: z.string().min(1),
  crewIds: z.array(z.string().min(1)).min(1).max(50),
  assignmentMode: z.enum(['roster_first', 'manual']).default('roster_first'),
  handoverRequired: z.boolean().default(true),
  earlyStartMinutes: z.number().int().nonnegative().default(30),
  lateEndMinutes: z.number().int().nonnegative().default(30),
  instruction: z.string().trim().max(500).default(''),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  revision: z.number().int().positive().optional(),
})

function readProfile(id: string): HandoverProfileRow {
  const row = one<HandoverProfileRow>(
    `SELECT hp.id, hp.name, hp.factory_id, f.base_id AS site_id,
            hp.shift_template_id, hp.assignment_mode, hp.handover_required,
            hp.early_start_minutes, hp.late_end_minutes, hp.instruction,
            hp.status, hp.revision,
            COALESCE(json_group_array(hpc.crew_id), '[]') AS crew_ids
       FROM handover_shift_profiles hp
       JOIN factories f ON f.id = hp.factory_id
       LEFT JOIN handover_shift_profile_crews hpc ON hpc.profile_id = hp.id
      WHERE hp.id = ?
      GROUP BY hp.id`,
    [id],
  )
  if (!row) throw AppError.notFound('交接班作业配置')
  return row
}

function mapProfile(row: HandoverProfileRow) {
  return {
    id: row.id,
    name: row.name,
    factoryId: row.factory_id,
    siteId: row.site_id,
    shiftTemplateId: row.shift_template_id,
    crewIds: JSON.parse(row.crew_ids) as string[],
    assignmentMode: row.assignment_mode,
    handoverRequired: row.handover_required === 1,
    earlyStartMinutes: row.early_start_minutes,
    lateEndMinutes: row.late_end_minutes,
    instruction: row.instruction,
    status: row.status,
    revision: row.revision,
  }
}

function assertCrews(factoryId: string, crewIds: string[]): void {
  const expected = new Set(
    all<{ id: string }>(
      'SELECT id FROM crews WHERE factory_id = ? AND status = ?',
      [factoryId, 'active'],
    ).map((row) => row.id),
  )
  for (const id of new Set(crewIds)) {
    if (!expected.has(id)) throw AppError.badRequest('生产班必须属于所选饲料厂')
  }
}

export async function handoverRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { factoryId?: string; siteId?: string } }>('/handover-profiles', async (request) => {
    const auth = requireAuth(request)
    const clauses = ["hp.status = 'active'"]
    const params: string[] = []
    if (request.query.factoryId) {
      clauses.push('hp.factory_id = ?')
      params.push(request.query.factoryId)
    }
    if (request.query.siteId) {
      clauses.push('f.base_id = ?')
      params.push(request.query.siteId)
    }
    const rows = all<HandoverProfileRow>(
      `SELECT hp.id, hp.name, hp.factory_id, f.base_id AS site_id,
              hp.shift_template_id, hp.assignment_mode, hp.handover_required,
              hp.early_start_minutes, hp.late_end_minutes, hp.instruction,
              hp.status, hp.revision,
              COALESCE(json_group_array(hpc.crew_id), '[]') AS crew_ids
         FROM handover_shift_profiles hp
         JOIN factories f ON f.id = hp.factory_id
         LEFT JOIN handover_shift_profile_crews hpc ON hpc.profile_id = hp.id
        WHERE ${clauses.join(' AND ')}
        GROUP BY hp.id ORDER BY hp.name`,
      params,
    ).filter((row) => withinScopedBase(auth, row.site_id)).filter((row) => hasGrant(auth, 'ticket.view', {
      type: 'factory',
      id: row.factory_id,
    }))
    return success(request, rows.map(mapProfile))
  })

  app.post('/handover-profiles', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(profileSchema, request.body)
    const factory = one<{ base_id: string }>(
      'SELECT base_id FROM factories WHERE id = ? AND status = ?',
      [input.factoryId, 'active'],
    )
    if (!factory) throw AppError.notFound('饲料厂')
    requireScopedBase(auth, factory.base_id)
    if (!hasGrant(auth, 'work_profile.manage', { type: 'factory', id: input.factoryId })) {
      throw AppError.forbidden()
    }
    const shift = one<{ base_id: string }>(
      'SELECT base_id FROM shift_templates WHERE id = ? AND status = ?',
      [input.shiftTemplateId, 'active'],
    )
    if (!shift || shift.base_id !== factory.base_id) throw AppError.badRequest('班次不属于该饲料厂基地')
    assertCrews(input.factoryId, input.crewIds)
    const id = newId('handover')
    const ts = nowIso()
    transaction(() => {
      run(
        `INSERT INTO handover_shift_profiles
          (id, name, factory_id, shift_template_id, assignment_mode, handover_required,
           early_start_minutes, late_end_minutes, instruction, status, revision,
           created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [id, input.name, input.factoryId, input.shiftTemplateId, input.assignmentMode,
          Number(input.handoverRequired), input.earlyStartMinutes, input.lateEndMinutes,
          input.instruction, input.status, ts, auth.accountId, ts, auth.accountId],
      )
      for (const crewId of new Set(input.crewIds)) {
        run(
          'INSERT INTO handover_shift_profile_crews (profile_id, crew_id) VALUES (?, ?)',
          [id, crewId],
        )
      }
    })
    return reply.status(201).send(success(request, mapProfile(readProfile(id))))
  })

  app.put<{ Params: { id: string } }>('/handover-profiles/:id', async (request) => {
    const auth = requireAuth(request)
    const before = readProfile(request.params.id)
    requireScopedBase(auth, before.site_id)
    if (!hasGrant(auth, 'work_profile.manage', { type: 'factory', id: before.factory_id })) {
      throw AppError.forbidden()
    }
    const input = parseInput(profileSchema.extend({
      revision: z.number().int().positive(),
    }), request.body)
    if (before.revision !== input.revision) throw AppError.revisionConflict()
    const factory = one<{ base_id: string }>(
      'SELECT base_id FROM factories WHERE id = ? AND status = ?',
      [input.factoryId, 'active'],
    )
    if (!factory) throw AppError.notFound('饲料厂')
    requireScopedBase(auth, factory.base_id)
    if (!hasGrant(auth, 'work_profile.manage', { type: 'factory', id: input.factoryId })) {
      throw AppError.forbidden()
    }
    const shift = one<{ base_id: string }>(
      'SELECT base_id FROM shift_templates WHERE id = ? AND status = ?',
      [input.shiftTemplateId, 'active'],
    )
    if (!shift || shift.base_id !== factory.base_id) throw AppError.badRequest('班次不属于该饲料厂基地')
    assertCrews(input.factoryId, input.crewIds)
    transaction(() => {
      run(
        `UPDATE handover_shift_profiles SET name = ?, factory_id = ?, shift_template_id = ?,
           assignment_mode = ?, handover_required = ?, early_start_minutes = ?,
           late_end_minutes = ?, instruction = ?, status = ?, revision = revision + 1,
           updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
        [input.name, input.factoryId, input.shiftTemplateId, input.assignmentMode,
          Number(input.handoverRequired), input.earlyStartMinutes, input.lateEndMinutes,
          input.instruction, input.status, nowIso(), auth.accountId, before.id, before.revision],
      )
      run('DELETE FROM handover_shift_profile_crews WHERE profile_id = ?', [before.id])
      for (const crewId of new Set(input.crewIds)) {
        run(
          'INSERT INTO handover_shift_profile_crews (profile_id, crew_id) VALUES (?, ?)',
          [before.id, crewId],
        )
      }
    })
    return success(request, mapProfile(readProfile(before.id)))
  })

  app.delete<{ Params: { id: string }; Querystring: { revision?: string } }>(
    '/handover-profiles/:id',
    async (request) => {
      const auth = requireAuth(request)
      const before = readProfile(request.params.id)
      requireScopedBase(auth, before.site_id)
      if (!hasGrant(auth, 'work_profile.manage', { type: 'factory', id: before.factory_id })) {
        throw AppError.forbidden()
      }
      const revision = z.coerce.number().int().positive().parse(request.query.revision)
      if (before.revision !== revision) throw AppError.revisionConflict()
      run(
        `UPDATE handover_shift_profiles
            SET status = 'archived', revision = revision + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND revision = ?`,
        [nowIso(), auth.accountId, before.id, revision],
      )
      writeAudit({
        accountId: auth.accountId,
        action: 'org.handover-profile.archive',
        entityType: 'handover_shift_profile',
        entityId: before.id,
        scopeType: 'factory',
        scopeId: before.factory_id,
        before: mapProfile(before),
        after: { ...mapProfile(before), status: 'archived', revision: before.revision + 1 },
        ipAddress: auth.ipAddress,
      })
      return success(request, { id: before.id, archived: true })
    },
  )
}
