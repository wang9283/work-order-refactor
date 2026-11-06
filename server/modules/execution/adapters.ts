import type {
  FormVersionSchema,
  WorkProfile,
} from '../../../packages/contracts/src'
import { all, one, parseJson } from '../../db/database'
import { AppError } from '../../core/errors'
import type {
  CandidateResolution,
  PayrollCompanyPort,
  PriceResolutionPort,
  ResolvedTicketTypeVersion,
  RosterContextPort,
  TicketContextPort,
} from './ports'

interface ResolvedRow {
  ticket_type_id: string
  ticket_type_code: string
  ticket_type_name: string
  owner_type: 'group' | 'company'
  owner_id: string
  ticket_type_version_id: string
  ticket_type_version_no: number
  form_version_id: string
  form_version_no: number
  schema_json: string
}

interface ProfileRow {
  id: string
  ticket_type_version_id: string
  name: string
  site_id: string
  factory_id: string | null
  work_area_id: string | null
  production_line_id: string | null
  crew_id: string | null
  shift_template_id: string | null
  generation_mode: 'manual' | 'api' | 'schedule'
  handover_grouping: 'none' | 'shift' | 'day'
  handover_required: number
  time_window_start: string | null
  time_window_end: string | null
  early_start_minutes: number
  late_end_minutes: number
  assignment_mode: 'roster_first' | 'qualification' | 'manual'
  status: 'draft' | 'published' | 'retired'
}

interface CandidateRow {
  person_id: string
  employee_code: string
  person_name: string
  home_company_id: string
  home_base_id: string
  factory_id: string | null
  crew_id: string | null
  crew_name: string
  membership_role: 'leader' | 'operator' | 'support'
  source: 'roster' | 'secondment' | 'manual'
}

function mapProfile(row: ProfileRow): WorkProfile {
  return {
    id: row.id,
    ticketTypeVersionId: row.ticket_type_version_id,
    name: row.name,
    siteId: row.site_id,
    factoryId: row.factory_id,
    workAreaId: row.work_area_id,
    productionLineId: row.production_line_id,
    crewId: row.crew_id,
    shiftTemplateId: row.shift_template_id,
    generationMode: row.generation_mode,
    handoverGrouping: row.handover_grouping,
    handoverRequired: row.handover_required === 1,
    timeWindowStart: row.time_window_start,
    timeWindowEnd: row.time_window_end,
    earlyStartMinutes: row.early_start_minutes,
    lateEndMinutes: row.late_end_minutes,
    assignmentMode: row.assignment_mode,
    status: row.status,
  }
}

export class SqliteTicketContext implements TicketContextPort {
  resolveTicketTypeVersion(ticketTypeId: string): ResolvedTicketTypeVersion {
    const row = one<ResolvedRow>(
      `SELECT tt.id AS ticket_type_id, tt.code AS ticket_type_code, tt.name AS ticket_type_name,
              tt.owner_type, tt.owner_id,
              ttv.id AS ticket_type_version_id, ttv.version_no AS ticket_type_version_no,
              fv.id AS form_version_id, fv.version_no AS form_version_no, fv.schema_json
       FROM ticket_types tt
       JOIN ticket_type_versions ttv ON ttv.ticket_type_id = tt.id
       JOIN form_versions fv ON fv.id = ttv.form_version_id
       WHERE tt.id = ? AND tt.status = 'published' AND ttv.status = 'published'
       ORDER BY ttv.version_no DESC LIMIT 1`,
      [ticketTypeId],
    )
    if (!row) throw AppError.notFound('已发布的工单类型')
    const profiles = all<ProfileRow>(
      `SELECT * FROM work_profiles
       WHERE ticket_type_version_id = ? AND status = 'published'`,
      [row.ticket_type_version_id],
    ).map(mapProfile)
    const schema = parseJson<FormVersionSchema>(row.schema_json, {
      mainFields: [],
      subForms: [],
      conditionRules: [],
    })
    return {
      ticketTypeId: row.ticket_type_id,
      ticketTypeCode: row.ticket_type_code,
      ticketTypeName: row.ticket_type_name,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      ticketTypeVersionId: row.ticket_type_version_id,
      ticketTypeVersionNo: row.ticket_type_version_no,
      formVersionId: row.form_version_id,
      formVersionNo: row.form_version_no,
      formSchema: { ...schema, mainFields: schema.mainFields.filter(f => f.type !== 'photo' && f.type !== 'attachment'), subForms: schema.subForms.map(sub => ({...sub, fields: sub.fields.filter(f => f.type !== 'photo' && f.type !== 'attachment')})) },
      workProfiles: profiles,
      snapshot: {
        ticketTypeId: row.ticket_type_id,
        code: row.ticket_type_code,
        name: row.ticket_type_name,
        typeVersionNo: row.ticket_type_version_no,
        formVersionNo: row.form_version_no,
      },
    }
  }

  findWorkProfile(
    resolved: ResolvedTicketTypeVersion,
    input: {
      siteId: string
      factoryId?: string | null
      workAreaId: string | null
      productionLineId: string | null
    },
  ): WorkProfile | null {
    return resolved.workProfiles
      .filter((profile) => (
        profile.siteId === input.siteId
        && (!profile.factoryId || profile.factoryId === input.factoryId)
        && (!profile.workAreaId || profile.workAreaId === input.workAreaId)
        && (!profile.productionLineId || profile.productionLineId === input.productionLineId)
      ))
      .sort((left, right) => {
        const score = (profile: WorkProfile): number =>
          (profile.factoryId ? 8 : 0)
          + (profile.productionLineId ? 4 : 0)
          + (profile.workAreaId ? 2 : 0)
          + (profile.crewId ? 1 : 0)
        return score(right) - score(left)
      })[0] || null
  }
}

export class SqliteRosterContext implements RosterContextPort {
  findEligibleCandidates(input: {
    siteId: string
    factoryId: string | null
    workAreaId: string | null
    productionLineId: string | null
    crewId: string | null
    eventTime: string
    workDate: string
  }): CandidateResolution[] {
    const rows = all<CandidateRow>(
      `WITH eligible AS (
         SELECT p.id AS person_id, p.employee_code, p.name AS person_name,
                p.home_company_id, p.home_base_id, p.factory_id,
                c.id AS crew_id, c.name AS crew_name,
                cm.role AS membership_role, CASE WHEN p.factory_id = c.factory_id THEN 'roster' ELSE 'secondment' END AS source
         FROM people p
         JOIN crew_memberships cm ON cm.person_id = p.id
         JOIN crews c ON c.id = cm.crew_id
         WHERE p.status = 'active'
           AND p.home_base_id = ?
           AND c.status = 'active'
           AND c.base_id = ?
           AND (p.factory_id = c.factory_id OR EXISTS (
             SELECT 1 FROM secondments s WHERE s.person_id = p.id
               AND s.to_factory_id = c.factory_id AND s.status IN ('planned', 'active')
               AND s.start_date <= ? AND s.end_date >= ?
           ))
           AND (? IS NULL OR c.factory_id = ?)
           AND (? IS NULL OR c.id = ?)
           AND cm.valid_from <= ?
           AND (cm.valid_to IS NULL OR cm.valid_to >= ?)

         UNION ALL

         SELECT p.id AS person_id, p.employee_code, p.name AS person_name,
                p.home_company_id, p.home_base_id, p.factory_id,
                COALESCE(target_crew.id, home_crew.id) AS crew_id,
                COALESCE(target_crew.name, home_crew.name, '借调人员') AS crew_name,
                'operator' AS membership_role, 'secondment' AS source
         FROM people p
         JOIN secondments s
           ON s.person_id = p.id
          AND s.to_base_id = ?
          AND s.to_factory_id = ?
          AND s.status IN ('planned', 'active')
          AND s.start_date <= ?
          AND s.end_date >= ?
         LEFT JOIN crews target_crew
           ON target_crew.id = ?
          AND target_crew.base_id = ?
          AND target_crew.status = 'active'
          AND (? IS NULL OR target_crew.factory_id = ?)
         LEFT JOIN crew_memberships home_cm
           ON home_cm.person_id = p.id
          AND home_cm.valid_from <= ?
          AND (home_cm.valid_to IS NULL OR home_cm.valid_to >= ?)
         LEFT JOIN crews home_crew
           ON home_crew.id = home_cm.crew_id
          AND home_crew.status = 'active'
         WHERE p.status = 'active'
           AND (p.factory_id IS NULL OR p.factory_id <> ?)
           AND (? IS NULL OR target_crew.id IS NOT NULL)
       )
       SELECT * FROM eligible`,
      [
        input.siteId,
        input.siteId,
        input.workDate,
        input.workDate,
        input.factoryId,
        input.factoryId,
        input.crewId,
        input.crewId,
        input.workDate,
        input.workDate,
        input.siteId,
        input.factoryId,
        input.workDate,
        input.workDate,
        input.crewId,
        input.siteId,
        input.factoryId,
        input.factoryId,
        input.workDate,
        input.workDate,
        input.factoryId,
        input.crewId,
      ],
    )
    const deduplicated = new Map<string, CandidateRow>()
    for (const row of rows) {
      const existing = deduplicated.get(row.person_id)
      if (!existing || row.membership_role === 'leader') deduplicated.set(row.person_id, row)
    }
    if (input.factoryId) {
      const local = all<CandidateRow>(`SELECT p.id AS person_id, p.employee_code, p.name AS person_name,
        p.home_company_id, p.home_base_id, p.factory_id, NULL AS crew_id, '临时参与' AS crew_name,
        'operator' AS membership_role, 'manual' AS source FROM people p
        WHERE p.factory_id = ? AND p.home_base_id = ? AND p.status = 'active'`, [input.factoryId, input.siteId])
      for (const row of local) if (!deduplicated.has(row.person_id)) deduplicated.set(row.person_id, row)
    }
    return [...deduplicated.values()].map((row) => ({
      ...this.mapCandidate(row),
      isCrewMember: Boolean(input.crewId && one<{ id: string }>(
        `SELECT id FROM crew_memberships WHERE crew_id = ? AND person_id = ? AND valid_from <= ?
          AND (valid_to IS NULL OR valid_to >= ?) LIMIT 1`, [input.crewId, row.person_id, input.workDate, input.workDate],
      )),
    }))
  }

  validateAssignment(input: {
    personId: string
    siteId: string
    factoryId: string | null
    crewId: string | null
    eventTime: string
    workDate: string
  }): CandidateResolution {
    const row = one<CandidateRow>(
      `WITH eligible AS (
         SELECT p.id AS person_id, p.employee_code, p.name AS person_name,
                p.home_company_id, p.home_base_id, p.factory_id,
                c.id AS crew_id, c.name AS crew_name,
                cm.role AS membership_role, CASE WHEN p.factory_id = c.factory_id THEN 'roster' ELSE 'secondment' END AS source
         FROM people p
         JOIN crew_memberships cm ON cm.person_id = p.id
         JOIN crews c ON c.id = cm.crew_id
         WHERE p.id = ?
           AND p.status = 'active'
           AND p.home_base_id = ?
           AND c.status = 'active'
           AND c.base_id = ?
           AND (p.factory_id = c.factory_id OR EXISTS (
             SELECT 1 FROM secondments s WHERE s.person_id = p.id
               AND s.to_factory_id = c.factory_id AND s.status IN ('planned', 'active')
               AND s.start_date <= ? AND s.end_date >= ?
           ))
           AND (? IS NULL OR c.factory_id = ?)
           AND (? IS NULL OR c.id = ?)
           AND cm.valid_from <= ?
           AND (cm.valid_to IS NULL OR cm.valid_to >= ?)

         UNION ALL

         SELECT p.id AS person_id, p.employee_code, p.name AS person_name,
                p.home_company_id, p.home_base_id, p.factory_id,
                COALESCE(home_crew.id, target_crew.id) AS crew_id,
                COALESCE(home_crew.name, target_crew.name, '借调人员') AS crew_name,
                'operator' AS membership_role, 'secondment' AS source
         FROM people p
         JOIN secondments s
           ON s.person_id = p.id
          AND s.to_base_id = ?
          AND s.to_factory_id = ?
          AND s.status IN ('planned', 'active')
          AND s.start_date <= ?
          AND s.end_date >= ?
         LEFT JOIN crew_memberships home_cm
           ON home_cm.person_id = p.id
          AND home_cm.valid_from <= ?
          AND (home_cm.valid_to IS NULL OR home_cm.valid_to >= ?)
         LEFT JOIN crews home_crew
           ON home_crew.id = home_cm.crew_id
          AND home_crew.status = 'active'
         LEFT JOIN crews target_crew
           ON target_crew.id = ?
          AND target_crew.base_id = ?
          AND target_crew.status = 'active'
          AND (? IS NULL OR target_crew.factory_id = ?)
         WHERE p.id = ?
           AND p.status = 'active'
           AND (p.factory_id IS NULL OR p.factory_id <> ?)
           AND (? IS NULL OR target_crew.id IS NOT NULL)
       )
       SELECT * FROM eligible
       ORDER BY source = 'roster' DESC, membership_role = 'leader' DESC
       LIMIT 1`,
      [
        input.personId,
        input.siteId,
        input.siteId,
        input.workDate,
        input.workDate,
        input.factoryId,
        input.factoryId,
        input.crewId,
        input.crewId,
        input.workDate,
        input.workDate,
        input.siteId,
        input.factoryId,
        input.workDate,
        input.workDate,
        input.workDate,
        input.workDate,
        input.crewId,
        input.siteId,
        input.factoryId,
        input.factoryId,
        input.personId,
        input.factoryId,
        input.crewId,
      ],
    )
    if (row) return this.mapCandidate(row)
    const manual = one<CandidateRow>(`SELECT p.id AS person_id, p.employee_code, p.name AS person_name,
      p.home_company_id, p.home_base_id, p.factory_id, NULL AS crew_id, '临时参与' AS crew_name,
      'operator' AS membership_role, 'manual' AS source FROM people p
      WHERE p.id = ? AND p.factory_id = ? AND p.home_base_id = ? AND p.status = 'active'`,
    [input.personId, input.factoryId, input.siteId])
    if (!manual) throw AppError.badRequest('人员不在该工厂的有效范围或借调范围内')
    return this.mapCandidate(manual)
  }

  private mapCandidate(row: CandidateRow): CandidateResolution {
    return {
      person: {
        id: row.person_id,
        employeeCode: row.employee_code,
        name: row.person_name,
        homeCompanyId: row.home_company_id,
        homeBaseId: row.home_base_id,
      },
      crewId: row.crew_id,
      crewName: row.crew_name,
      source: row.source,
      role: row.membership_role === 'leader' ? 'lead' : 'member',
    }
  }
}

export class SqlitePriceContext implements PriceResolutionPort {
  findPublishedPrice(input: {
    ticketTypeId: string
    siteId: string
    eventTime: string
  }): { id: string; versionNo: number; unitPriceMicros: number; unit: string; effectiveFrom: string; effectiveTo: string | null } | null {
    const row = one<{ id: string; version_no: number; unit_price_micros: number; unit: string; effective_from: string; effective_to: string | null }>(
      `SELECT id, version_no, unit_price_micros, unit, effective_from, effective_to
       FROM price_rule_versions
       WHERE ticket_type_id = ? AND site_id = ? AND status = 'published'
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC, version_no DESC LIMIT 1`,
      [input.ticketTypeId, input.siteId, input.eventTime, input.eventTime],
    )
    return row ? {
      id: row.id,
      versionNo: row.version_no,
      unitPriceMicros: row.unit_price_micros,
      unit: row.unit,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
    } : null
  }
}

export class SqlitePayrollCompany implements PayrollCompanyPort {
  resolvePayrollCompany(input: {
    personId: string
    workMonth: string
    confirmedCompanyId?: string | null
  }): string | null {
    if (input.confirmedCompanyId) return input.confirmedCompanyId
    const row = one<{ payroll_company_id: string }>(
      `SELECT payroll_company_id
       FROM payroll_company_confirmations
       WHERE work_month = ? AND person_id = ? AND status = 'confirmed'`,
      [input.workMonth, input.personId],
    )
    return row?.payroll_company_id ?? null
  }
}
