import type {
  ActiveStatus,
  Capability,
  Company,
  Crew,
  CrewMembership,
  CrewScope,
  CrewMemberRole,
  Factory,
  HandoverShiftProfile,
  ManagementGroup,
  OrgReferenceData,
  PageQuery,
  PagedResult,
  Person,
  PersonCrewHistory,
  PersonCrewSummary,
  PersonQualification,
  ProductionBase,
  ProductionLine,
  Qualification,
  ScopeRef,
  Secondment,
  SecondmentStatus,
  ShiftTemplate,
  WorkArea,
} from '../../../packages/contracts/src'
import { toPageMeta } from '../../../packages/contracts/src'
import { writeAudit } from '../../core/audit'
import { requireScopedBase, scopedBaseId, withinScopedBase, withinScopedFactory } from '../../core/base-scope'
import { hasGrant, type AuthContext } from '../../core/auth'
import { AppError } from '../../core/errors'
import { newId, nowIso, one, run, transaction } from '../../db/database'
import { all } from '../../db/database'

type SqlValue = string | number | null
type IdRow = { id: string }
type RevisionRow = { revision: number }
type StatusRow = { status: string }

// Derived crew columns shared by every crew read model so the list, tree and
// detail views always agree on leaders and member counts.
const crewDerivedColumns = `
  (SELECT json_group_array(cm.person_id) FROM crew_memberships cm
     WHERE cm.crew_id = crews.id AND cm.role = 'leader'
       AND cm.valid_from <= date('now','localtime')
       AND (cm.valid_to IS NULL OR cm.valid_to >= date('now','localtime'))) AS leaderPersonIdsJson,
  (SELECT COUNT(*) FROM crew_memberships cm
     WHERE cm.crew_id = crews.id
       AND cm.valid_from <= date('now','localtime')
       AND (cm.valid_to IS NULL OR cm.valid_to >= date('now','localtime'))) AS memberCount`

const crewLeaderNamesColumn = `
  (SELECT json_group_array(p.name || ' · ' || p.employee_code) FROM crew_memberships cm
     JOIN people p ON p.id = cm.person_id
    WHERE cm.crew_id = crews.id AND cm.role = 'leader'
      AND cm.valid_from <= date('now','localtime')
      AND (cm.valid_to IS NULL OR cm.valid_to >= date('now','localtime'))) AS leaderNamesJson`

type CrewRow = Omit<Crew, 'leaderPersonIds' | 'leaderNames'> & {
  leaderPersonIdsJson: string | null
  leaderNamesJson?: string | null
}

function mapCrewRow(row: CrewRow): Crew {
  const { leaderPersonIdsJson, leaderNamesJson, ...rest } = row
  let leaderPersonIds: string[] = []
  try {
    leaderPersonIds = JSON.parse(leaderPersonIdsJson ?? '[]') as string[]
  } catch {
    leaderPersonIds = []
  }
  let leaderNames: string[] = []
  try {
    leaderNames = JSON.parse(leaderNamesJson ?? '[]') as string[]
  } catch {
    leaderNames = []
  }
  return { ...rest, leaderPersonIds, leaderNames }
}

function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA')
}

/** Membership covering the given date; unique per person thanks to the overlap rule. */
function currentCrewSummary(personId: string): PersonCrewSummary | null {
  const row = one<Omit<PersonCrewSummary, 'crewName'> & { crewName: string }>(
    `SELECT cm.crew_id AS crewId, c.name AS crewName, cm.role,
            cm.valid_from AS validFrom, cm.valid_to AS validTo
       FROM crew_memberships cm JOIN crews c ON c.id = cm.crew_id
      WHERE cm.person_id = ? AND c.status <> 'archived'
        AND cm.valid_from <= date('now','localtime')
        AND (cm.valid_to IS NULL OR cm.valid_to >= date('now','localtime'))
      ORDER BY cm.valid_from LIMIT 1`,
    [personId],
  )
  return row ?? null
}

function chunk<T>(items: T[], size = 400): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

/** Batch crew summary lookup so the person list stays a fixed number of queries. */
function crewSummariesFor(personIds: string[]): Map<string, PersonCrewSummary> {
  const map = new Map<string, PersonCrewSummary>()
  for (const batch of chunk(personIds)) {
    const placeholders = batch.map(() => '?').join(',')
    all<{ personId: string } & Omit<PersonCrewSummary, 'crewName'> & { crewName: string }>(
      `SELECT cm.person_id AS personId, cm.crew_id AS crewId, c.name AS crewName, cm.role,
              cm.valid_from AS validFrom, cm.valid_to AS validTo
         FROM crew_memberships cm JOIN crews c ON c.id = cm.crew_id
        WHERE cm.person_id IN (${placeholders}) AND c.status <> 'archived'
          AND cm.valid_from <= date('now','localtime')
          AND (cm.valid_to IS NULL OR cm.valid_to >= date('now','localtime'))
        ORDER BY cm.valid_from`,
      batch,
    ).forEach((row) => {
      if (map.has(row.personId)) return
      const { personId, ...summary } = row
      map.set(personId, summary)
    })
  }
  return map
}

function qualificationsFor(personIds: string[]): Map<string, Person['qualifications']> {
  const map = new Map<string, Person['qualifications']>()
  for (const batch of chunk(personIds)) {
    const placeholders = batch.map(() => '?').join(',')
    all<{ personId: string } & PersonQualification & { qualificationName: string; qualificationCode: string }>(
      `SELECT pq.person_id AS personId, pq.id, pq.qualification_id AS qualificationId,
              pq.valid_from AS validFrom, pq.valid_to AS validTo,
              pq.certificate_no AS certificateNo, pq.revision,
              pq.created_at AS createdAt, pq.created_by AS createdBy,
              pq.updated_at AS updatedAt, pq.updated_by AS updatedBy,
              q.name AS qualificationName, q.code AS qualificationCode
         FROM person_qualifications pq
         JOIN qualifications q ON q.id = pq.qualification_id
        WHERE pq.person_id IN (${placeholders})
        ORDER BY pq.person_id, q.name, pq.valid_from DESC`,
      batch,
    ).forEach((row) => {
      const list = map.get(row.personId) ?? []
      list.push(row)
      map.set(row.personId, list)
    })
  }
  return map
}

function canViewCrew(auth: AuthContext, crewId: string): boolean {
  const row = one<{ base_id: string; factory_id: string | null }>(
    'SELECT base_id, factory_id FROM crews WHERE id = ?', [crewId],
  )
  if (!row) return false
  return hasGrant(auth, 'crew.view', {
    type: row.factory_id ? 'factory' : 'base',
    id: row.factory_id || row.base_id,
  })
}

/**
 * Cross-crew overlap check. The message names the conflicting crew only when the
 * caller may see it; otherwise it stays generic so scoped accounts cannot probe
 * other mills' rosters.
 */
function assertNoCrewOverlap(personId: string, excludeMembershipId: string | null, from: string, to: string | null, auth: AuthContext): void {
  const conflict = one<{ crewId: string; crewName: string; validFrom: string; validTo: string | null }>(
    `SELECT cm.crew_id AS crewId, c.name AS crewName,
            cm.valid_from AS validFrom, cm.valid_to AS validTo
       FROM crew_memberships cm JOIN crews c ON c.id = cm.crew_id
      WHERE cm.person_id = ?
        AND (? IS NULL OR cm.id <> ?)
        AND cm.valid_from <= COALESCE(?, '9999-12-31')
        AND COALESCE(cm.valid_to, '9999-12-31') >= ?
      ORDER BY cm.valid_from LIMIT 1`,
    [personId, excludeMembershipId, excludeMembershipId, to, from],
  )
  if (!conflict) return
  if (!canViewCrew(auth, conflict.crewId)) {
    throw AppError.conflict('该人员在此日期范围已属于其他班组，请联系对应管理员先结束原关系')
  }
  const range = `${conflict.validFrom} 至 ${conflict.validTo || '长期'}`
  throw AppError.conflict(
    `该人员在所选日期内已属于「${conflict.crewName}」（${range}），请先结束该班组关系再登记新关系`,
    { crewId: conflict.crewId, validFrom: conflict.validFrom, validTo: conflict.validTo },
  )
}

/** Translate the SQLite overlap trigger into the API error contract. */
function runMembership<T>(action: () => T): T {
  try {
    return action()
  } catch (error) {
    if (error instanceof Error && error.message.includes('已属于其他班组')) {
      throw AppError.conflict('该人员在所选日期内已属于其他班组，请先结束原班组关系')
    }
    throw error
  }
}

const activeStatuses = new Set<ActiveStatus>(['active', 'inactive', 'archived'])
const crewRoles = new Set<CrewMemberRole>(['leader', 'operator', 'support'])
const secondmentStatuses = new Set<SecondmentStatus>([
  'planned',
  'active',
  'completed',
  'cancelled',
])

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
  status: ActiveStatus
  revision: number
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
  crew_ids: string
}

function mapHandoverProfile(row: HandoverProfileRow): HandoverShiftProfile {
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
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

function pageResult<T>(items: T[], query: PageQuery): PagedResult<T> {
  return {
    items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    meta: toPageMeta(items.length, query.page, query.pageSize),
  }
}

function assertActiveStatus(value: ActiveStatus): void {
  if (!activeStatuses.has(value)) throw AppError.badRequest('状态值无效')
}

function assertCrewRole(value: CrewMemberRole): void {
  if (!crewRoles.has(value)) throw AppError.badRequest('班组成员角色无效')
}

function assertSecondmentStatus(value: SecondmentStatus): void {
  if (!secondmentStatuses.has(value)) throw AppError.badRequest('借调状态无效')
}

function requireRow<T>(row: T | undefined, entity: string): T {
  if (!row) throw AppError.notFound(entity)
  return row
}

function assertRevision(row: RevisionRow | undefined, revision: number | undefined, entity: string): void {
  const current = requireRow(row, entity)
  if (revision === undefined) throw AppError.badRequest('缺少 revision，无法安全更新')
  if (current.revision !== revision) throw AppError.revisionConflict()
}

function contains(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase())
}

export function accessibleBaseIds(auth: AuthContext): Set<string> | null {
  const selectedBase = scopedBaseId(auth)
  if (auth.grants.some((grant) => grant.type === 'group')) {
    return selectedBase === null ? null : new Set([selectedBase])
  }

  const ids = new Set<string>()
  for (const grant of auth.grants) {
    if (grant.type === 'company') {
      all<IdRow>('SELECT id FROM production_bases WHERE company_id = ?', [grant.id])
        .forEach((row) => ids.add(row.id))
    } else if (grant.type === 'base') {
      ids.add(grant.id)
    } else if (grant.type === 'factory') {
      const row = one<{ base_id: string }>('SELECT base_id FROM factories WHERE id = ?', [grant.id])
      if (row) ids.add(row.base_id)
    } else if (grant.type === 'work_area') {
      const row = one<{ base_id: string }>('SELECT base_id FROM work_areas WHERE id = ?', [grant.id])
      if (row) ids.add(row.base_id)
    }
  }
  return selectedBase === null ? ids : new Set([...ids].filter((id) => id === selectedBase))
}

/**
 * A factory grant is narrower than the base it belongs to. Keep that distinction
 * in every read model so a single-mill administrator cannot see sibling mills.
 */
export function accessibleFactoryIds(auth: AuthContext): Set<string> | null {
  const selectedBase = scopedBaseId(auth)
  if (auth.grants.some((grant) => grant.type === 'group')) {
    if (selectedBase === null) return null
    return new Set(all<IdRow>('SELECT id FROM factories WHERE base_id = ?', [selectedBase]).map((row) => row.id))
  }

  const ids = new Set<string>()
  for (const grant of auth.grants) {
    if (grant.type === 'company') {
      all<IdRow>(
        `SELECT f.id FROM factories f
         JOIN production_bases b ON b.id = f.base_id
         WHERE b.company_id = ?`,
        [grant.id],
      ).forEach((row) => ids.add(row.id))
    } else if (grant.type === 'base') {
      all<IdRow>('SELECT id FROM factories WHERE base_id = ?', [grant.id])
        .forEach((row) => ids.add(row.id))
    } else if (grant.type === 'factory') {
      ids.add(grant.id)
    }
  }
  if (selectedBase === null) return ids
  return new Set(all<IdRow>('SELECT id FROM factories WHERE base_id = ?', [selectedBase])
    .map((row) => row.id)
    .filter((id) => ids.has(id)))
}

function canAccessFactory(
  auth: AuthContext,
  capability: Capability,
  baseId: string,
  factoryId: string | null | undefined,
): boolean {
  return hasGrant(auth, capability, {
    type: factoryId ? 'factory' : 'base',
    id: factoryId || baseId,
  })
}

function requireFactoryCapability(
  auth: AuthContext,
  capability: Capability,
  baseId: string,
  factoryId: string | null | undefined,
): void {
  requireScopedBase(auth, baseId)
  if (!canAccessFactory(auth, capability, baseId, factoryId)) throw AppError.forbidden()
}

function canAccessBase(auth: AuthContext, capability: Capability, baseId: string): boolean {
  return auth.grants.some((grant) => {
    if (grant.capability !== capability) return false
    if (grant.type === 'group') return true
    if (grant.type === 'base') return grant.id === baseId
    if (grant.type === 'factory') return false
    if (grant.type === 'company') {
      const base = one<{ company_id: string }>('SELECT company_id FROM production_bases WHERE id = ?', [baseId])
      return base?.company_id === grant.id
    }
    // An area grant never authorizes changes to the containing base.
    if (grant.type === 'work_area') return false
    return false
  })
}

function requireBaseCapability(auth: AuthContext, capability: Capability, baseId: string): void {
  requireScopedBase(auth, baseId)
  if (!canAccessBase(auth, capability, baseId)) throw AppError.forbidden()
}

function requireGroupCapability(auth: AuthContext, capability: Capability): void {
  const allowed = auth.grants.some(
    (grant) => grant.capability === capability && grant.type === 'group',
  )
  if (!allowed) throw AppError.forbidden()
}

function accessibleBases(auth: AuthContext): ProductionBase[] {
  const visible = accessibleBaseIds(auth)
  const visibleFactories = accessibleFactoryIds(auth)
  return all<ProductionBase>(
    `SELECT id, code, name, company_id AS companyId, address, site_confirmed AS siteConfirmed, status, revision,
            created_at AS createdAt, created_by AS createdBy,
            updated_at AS updatedAt, updated_by AS updatedBy
       FROM production_bases
      ORDER BY name`,
  ).map((base) => ({ ...base, siteConfirmed: Boolean(base.siteConfirmed) })).filter((base) =>
    (visible === null || visible.has(base.id))
    && (
      visibleFactories === null
      || all<IdRow>('SELECT id FROM factories WHERE base_id = ?', [base.id])
        .some((factory) => visibleFactories.has(factory.id))
    ),
  )
}

export function listShiftTemplates(auth: AuthContext, query: PageQuery): PagedResult<ShiftTemplate> {
  const visible = accessibleBaseIds(auth)
  const visibleFactories = accessibleFactoryIds(auth)
  const rows = all<ShiftTemplate>(
    `SELECT id, code, name, base_id AS baseId, start_time AS startTime,
            end_time AS endTime, cross_day AS crossDay, revision,
            created_at AS createdAt, created_by AS createdBy,
            updated_at AS updatedAt, updated_by AS updatedBy
       FROM shift_templates
      WHERE status = 'active'
      ORDER BY base_id, start_time, name`,
  ).filter((row) =>
    (visible === null || visible.has(row.baseId))
    && (
      visibleFactories === null
      || all<IdRow>('SELECT id FROM factories WHERE base_id = ?', [row.baseId])
        .some((factory) => visibleFactories.has(factory.id))
    )
    && (!query.siteId || row.baseId === query.siteId)
    && (!query.q || contains(row.name, query.q) || contains(row.code, query.q)),
  ).map((row) => ({ ...row, crossDay: Boolean(row.crossDay) }))
  return pageResult(rows, query)
}

function getBase(id: string): ProductionBase {
  const row = requireRow(
    one<ProductionBase>(
      `SELECT id, code, name, company_id AS companyId, address, site_confirmed AS siteConfirmed, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM production_bases WHERE id = ?`,
      [id],
    ),
    '作业基地',
  )
  return { ...row, siteConfirmed: Boolean(row.siteConfirmed) }
}

function getCompany(id: string): Company {
  return requireRow(
    one<Company>(
      `SELECT id, code, name, short_name AS shortName, is_group AS isGroup,
              payroll_enabled AS payrollEnabled, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM companies WHERE id = ?`,
      [id],
    ),
    '公司',
  )
}

function getArea(id: string): WorkArea {
  return requireRow(
    one<WorkArea>(
      `SELECT id, code, name, base_id AS baseId, factory_id AS factoryId, parent_id AS parentId,
              manager_person_id AS managerPersonId, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM work_areas WHERE id = ?`,
      [id],
    ),
    '工区',
  )
}

function getLine(id: string): ProductionLine {
  return requireRow(
    one<ProductionLine>(
      `SELECT id, code, name, base_id AS baseId, work_area_id AS workAreaId,
              status, revision, created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM production_lines WHERE id = ?`,
      [id],
    ),
    '产线',
  )
}

function getFactory(id: string): Factory {
  return requireRow(
    one<Factory>(
      `SELECT id, code, name, company_id AS companyId, base_id AS baseId, management_group_id AS managementGroupId,
              factory_type AS factoryType, manager_person_id AS managerPersonId,
              address, sort_order AS sortOrder, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM factories WHERE id = ?`,
      [id],
    ),
    '饲料厂',
  )
}

function getCrew(id: string): Crew {
  const row = requireRow(
    one<CrewRow>(
      `SELECT id, code, name, base_id AS baseId, work_area_id AS workAreaId, factory_id AS factoryId,
              (SELECT cm.person_id FROM crew_memberships cm WHERE cm.crew_id = crews.id AND cm.role = 'leader'
                 AND cm.valid_from <= date('now','localtime') AND (cm.valid_to IS NULL OR cm.valid_to >= date('now','localtime')) ORDER BY cm.valid_from, cm.id LIMIT 1) AS leaderPersonId, status, revision,
              ${crewDerivedColumns},
              ${crewLeaderNamesColumn},
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM crews WHERE id = ?`,
      [id],
    ),
    '班组',
  )
  return mapCrewRow(row)
}

function getPerson(id: string): Person {
  const row = personRow(id)
  const qualifications = all<PersonQualification & {
    qualificationName: string
    qualificationCode: string
  }>(
    `SELECT pq.id, pq.person_id AS personId, pq.qualification_id AS qualificationId,
            pq.valid_from AS validFrom, pq.valid_to AS validTo,
            pq.certificate_no AS certificateNo, pq.revision,
            pq.created_at AS createdAt, pq.created_by AS createdBy,
            pq.updated_at AS updatedAt, pq.updated_by AS updatedBy,
            q.name AS qualificationName, q.code AS qualificationCode
       FROM person_qualifications pq
       JOIN qualifications q ON q.id = pq.qualification_id
      WHERE pq.person_id = ?
      ORDER BY q.name, pq.valid_from DESC`,
    [id],
  )
  return { ...row, qualifications, crew: currentCrewSummary(id) }
}

/** Bare people row without derived summaries, used by write paths. */
function personRow(id: string): Omit<Person, 'qualifications' | 'crew'> {
  return requireRow(
    one<Omit<Person, 'qualifications' | 'crew'>>(
      `SELECT id, employee_code AS employeeCode, name, mobile,
              home_company_id AS homeCompanyId, home_base_id AS homeBaseId, factory_id AS factoryId,
              status, revision, created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM people WHERE id = ?`,
      [id],
    ),
    '人员',
  )
}

function getSecondment(id: string): Secondment {
  return requireRow(
    one<Secondment>(
      `SELECT id, person_id AS personId, from_company_id AS fromCompanyId,
              from_base_id AS fromBaseId, to_company_id AS toCompanyId,
              to_base_id AS toBaseId, to_factory_id AS toFactoryId, start_date AS startDate, end_date AS endDate,
              purpose, status, approved_by AS approvedBy, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM secondments WHERE id = ?`,
      [id],
    ),
    '借调记录',
  )
}

function audit(
  auth: AuthContext,
  action: string,
  entityType: string,
  entityId: string,
  scope: ScopeRef,
  before?: unknown,
  after?: unknown,
): void {
  writeAudit({
    accountId: auth.accountId,
    action,
    entityType,
    entityId,
    scopeType: scope.type,
    scopeId: scope.id,
    before,
    after,
    ipAddress: auth.ipAddress,
  })
}

export function listCompaniesFor(auth: AuthContext, query: PageQuery): PagedResult<Company> {
  const visible = accessibleBaseIds(auth)
  const companyIds = visible === null
    ? null
    : new Set(
        all<{ company_id: string }>(
          `SELECT DISTINCT company_id FROM production_bases`,
        )
          .filter((row) => all<IdRow>('SELECT id FROM production_bases WHERE company_id = ?', [row.company_id])
            .some((base) => visible.has(base.id)))
          .map((row) => row.company_id),
      )
  const rows = all<Company>(
    `SELECT id, code, name, short_name AS shortName, is_group AS isGroup,
            payroll_enabled AS payrollEnabled, status, revision,
            created_at AS createdAt, created_by AS createdBy,
            updated_at AS updatedAt, updated_by AS updatedBy
       FROM companies ORDER BY is_group DESC, name`,
  ).filter((row) => companyIds === null || companyIds.has(row.id) || row.isGroup)
  return pageResult(
    rows.filter((row) =>
      (!query.q || contains(row.name, query.q) || contains(row.code, query.q))
      && (!query.status || row.status === query.status),
    ),
    query,
  )
}

export function createCompany(
  auth: AuthContext,
  input: Pick<Company, 'code' | 'name' | 'shortName' | 'isGroup' | 'payrollEnabled' | 'status'>,
): Company {
  requireGroupCapability(auth, 'org.manage')
  assertActiveStatus(input.status)
  if (input.isGroup) {
    const group = one<IdRow>('SELECT id FROM companies WHERE is_group = 1')
    if (group) throw AppError.conflict('当前系统只允许一个饲料总部根公司')
  }
  const id = newId('company')
  const ts = nowIso()
  run(
    `INSERT INTO companies
      (id, code, name, short_name, is_group, payroll_enabled, status, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, input.code, input.name, input.shortName, Number(input.isGroup), Number(input.payrollEnabled),
      input.status, ts, auth.accountId, ts, auth.accountId],
  )
  const created = getCompany(id)
  audit(auth, 'org.company.create', 'company', id, { type: 'group', id: 'group' }, undefined, created)
  return created
}

export function updateCompany(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<Company, 'code' | 'name' | 'shortName' | 'payrollEnabled' | 'status' | 'revision'>>,
): Company {
  requireGroupCapability(auth, 'org.manage')
  const before = getCompany(id)
  assertRevision(before, input.revision, '公司')
  if (input.status) assertActiveStatus(input.status)
  if (before.isGroup && input.status === 'archived') throw AppError.conflict('饲料总部根公司不能归档')
  run(
    `UPDATE companies SET code = ?, name = ?, short_name = ?, payroll_enabled = ?,
       status = ?, revision = revision + 1, updated_at = ?, updated_by = ?
     WHERE id = ? AND revision = ?`,
    [input.code ?? before.code, input.name ?? before.name, input.shortName ?? before.shortName,
      Number(input.payrollEnabled ?? before.payrollEnabled), input.status ?? before.status,
      nowIso(), auth.accountId, id, before.revision],
  )
  const updated = getCompany(id)
  audit(auth, 'org.company.update', 'company', id, { type: 'group', id: 'group' }, before, updated)
  return updated
}

export function archiveCompany(auth: AuthContext, id: string, revision: number): void {
  const before = getCompany(id)
  if (before.isGroup) throw AppError.conflict('饲料总部根公司不能归档')
  const reference = one<IdRow>('SELECT id FROM production_bases WHERE company_id = ? LIMIT 1', [id])
    ?? one<IdRow>('SELECT id FROM people WHERE home_company_id = ? LIMIT 1', [id])
  if (reference) throw AppError.referenceConflict('公司仍被基地或人员引用')
  updateCompany(auth, id, { revision, status: 'archived' })
}

export function listBases(auth: AuthContext, query: PageQuery): PagedResult<ProductionBase> {
  return pageResult(
    accessibleBases(auth)
      .filter((row) =>
        (!query.companyId || row.companyId === query.companyId)
        && (!query.status || row.status === query.status)
        && (!query.q || contains(row.name, query.q) || contains(row.code, query.q)),
      ),
    query,
  )
}

export function createBase(
  auth: AuthContext,
  input: Pick<ProductionBase, 'code' | 'name' | 'companyId' | 'address' | 'status'>,
): ProductionBase {
  requireGroupCapability(auth, 'org.manage')
  getCompany(input.companyId)
  if (input.status) assertActiveStatus(input.status)
  const id = newId('base')
  const ts = nowIso()
  run(
    `INSERT INTO production_bases
      (id, code, name, company_id, address, status, site_confirmed, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
    [id, input.code, input.name, input.companyId, input.address, input.status,
      ts, auth.accountId, ts, auth.accountId],
  )
  const created = getBase(id)
  audit(auth, 'org.base.create', 'production_base', id, { type: 'base', id }, undefined, created)
  return created
}

export function updateBase(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<ProductionBase, 'code' | 'name' | 'companyId' | 'address' | 'siteConfirmed' | 'status' | 'revision'>>,
): ProductionBase {
  requireBaseCapability(auth, 'org.manage', id)
  const before = getBase(id)
  assertRevision(before, input.revision, '作业基地')
  if (input.siteConfirmed !== undefined && input.siteConfirmed !== before.siteConfirmed) requireGroupCapability(auth, 'org.manage')
  if (input.companyId && input.companyId !== before.companyId && (
    one<IdRow>('SELECT id FROM factories WHERE base_id = ? LIMIT 1', [id])
    || one<IdRow>('SELECT id FROM people WHERE home_base_id = ? LIMIT 1', [id])
    || one<IdRow>('SELECT id FROM tickets WHERE site_id = ? LIMIT 1', [id])
    || one<IdRow>('SELECT id FROM price_rule_versions WHERE site_id = ? LIMIT 1', [id])
  )) throw AppError.referenceConflict('基地已有工厂、人员、工单或计价，不能直接变更公司')
  if (input.companyId) getCompany(input.companyId)
  if (input.status) assertActiveStatus(input.status)
  run(
    `UPDATE production_bases SET code = ?, name = ?, company_id = ?, address = ?, site_confirmed = ?,
       status = ?, revision = revision + 1, updated_at = ?, updated_by = ?
     WHERE id = ? AND revision = ?`,
    [input.code ?? before.code, input.name ?? before.name, input.companyId ?? before.companyId,
      input.address ?? before.address, Number(input.siteConfirmed ?? before.siteConfirmed), input.status ?? before.status, nowIso(), auth.accountId,
      id, before.revision],
  )
  const updated = getBase(id)
  audit(auth, 'org.base.update', 'production_base', id, { type: 'base', id }, before, updated)
  return updated
}

export function archiveBase(auth: AuthContext, id: string, revision: number): void {
  requireBaseCapability(auth, 'org.manage', id)
  const before = getBase(id)
  assertRevision(before, revision, '作业基地')
  const reference =
    one<IdRow>(`SELECT id FROM factories WHERE base_id = ? AND status <> 'archived' LIMIT 1`, [id])
    ?? one<IdRow>(`SELECT id FROM work_areas WHERE base_id = ? AND status <> 'archived' LIMIT 1`, [id])
    ?? one<IdRow>(`SELECT id FROM production_lines WHERE base_id = ? AND status <> 'archived' LIMIT 1`, [id])
    ?? one<IdRow>(`SELECT id FROM crews WHERE base_id = ? AND status <> 'archived' LIMIT 1`, [id])
    ?? one<IdRow>(`SELECT id FROM secondments WHERE to_base_id = ? AND status IN ('planned', 'active') LIMIT 1`, [id])
  if (reference) throw AppError.referenceConflict('基地仍被工厂、工区、产线、班组或借调引用')
  updateBase(auth, id, { revision, status: 'archived' })
}

export function listFactories(auth: AuthContext, query: PageQuery): PagedResult<Factory> {
  const visible = accessibleBaseIds(auth)
  const visibleFactories = accessibleFactoryIds(auth)
  const rows = all<Factory>(
    `SELECT id, code, name, company_id AS companyId, base_id AS baseId, management_group_id AS managementGroupId,
            factory_type AS factoryType, manager_person_id AS managerPersonId,
            address, sort_order AS sortOrder, status, revision,
            created_at AS createdAt, created_by AS createdBy,
            updated_at AS updatedAt, updated_by AS updatedBy
       FROM factories ORDER BY sort_order, name`,
  ).filter((row) =>
    (visible === null || visible.has(row.baseId))
    && (visibleFactories === null || visibleFactories.has(row.id))
    && (!query.companyId || row.companyId === query.companyId)
    && (!query.siteId || row.baseId === query.siteId)
    && (!query.status || row.status === query.status)
    && (!query.q || contains(row.name, query.q) || contains(row.code, query.q)),
  )
  return pageResult(rows, query)
}

export function createFactory(
  auth: AuthContext,
  input: Pick<Factory, 'code' | 'name' | 'companyId' | 'baseId' | 'managementGroupId' | 'factoryType'
    | 'managerPersonId' | 'address' | 'sortOrder' | 'status'>,
): Factory {
  requireBaseCapability(auth, 'org.manage', input.baseId)
  const base = getBase(input.baseId)
  if (base.companyId !== input.companyId) throw AppError.badRequest('工厂所属公司与基地不一致')
  if (input.managementGroupId && !one<IdRow>('SELECT id FROM management_groups WHERE id = ? AND status = ?', [input.managementGroupId, 'active'])) throw AppError.badRequest('管理分组不存在或未启用')
  if (input.managerPersonId) personRow(input.managerPersonId)
  if (input.status) assertActiveStatus(input.status)
  const id = newId('factory')
  const ts = nowIso()
  run(
    `INSERT INTO factories
      (id, code, name, company_id, base_id, management_group_id, factory_type, manager_person_id,
       address, sort_order, status, revision, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, input.code, input.name, input.companyId, input.baseId, input.managementGroupId, input.factoryType,
      input.managerPersonId, input.address, input.sortOrder, input.status,
      ts, auth.accountId, ts, auth.accountId],
  )
  const created = getFactory(id)
  audit(auth, 'org.factory.create', 'factory', id, { type: 'base', id: input.baseId }, undefined, created)
  return created
}

export function updateFactory(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<Factory, 'code' | 'name' | 'baseId' | 'managementGroupId' | 'factoryType'
    | 'managerPersonId' | 'address' | 'sortOrder' | 'status' | 'revision'>>,
): Factory {
  const before = getFactory(id)
  requireFactoryCapability(auth, 'org.manage', before.baseId, before.id)
  assertRevision(before, input.revision, '饲料厂')
  const baseId = input.baseId ?? before.baseId
  if (baseId !== before.baseId) {
    throw AppError.badRequest('饲料厂不能直接迁移到其他基地，请归档后重新创建')
  }
  const base = getBase(baseId)
  const managementGroupId = input.managementGroupId === undefined ? before.managementGroupId : input.managementGroupId
  if (managementGroupId && !one<IdRow>('SELECT id FROM management_groups WHERE id = ? AND status = ?', [managementGroupId, 'active'])) throw AppError.badRequest('管理分组不存在或未启用')
  if (input.managerPersonId) personRow(input.managerPersonId)
  if (input.status) assertActiveStatus(input.status)
  run(
    `UPDATE factories SET code = ?, name = ?, company_id = ?, base_id = ?, management_group_id = ?, factory_type = ?,
       manager_person_id = ?, address = ?, sort_order = ?, status = ?,
       revision = revision + 1, updated_at = ?, updated_by = ?
     WHERE id = ? AND revision = ?`,
    [input.code ?? before.code, input.name ?? before.name, base.companyId, baseId, managementGroupId,
      input.factoryType ?? before.factoryType,
      input.managerPersonId === undefined ? before.managerPersonId : input.managerPersonId,
      input.address ?? before.address, input.sortOrder ?? before.sortOrder,
      input.status ?? before.status, nowIso(), auth.accountId, id, before.revision],
  )
  const updated = getFactory(id)
  audit(auth, 'org.factory.update', 'factory', id, { type: 'base', id: before.baseId }, before, updated)
  return updated
}

export function archiveFactory(auth: AuthContext, id: string, revision: number): void {
  const before = getFactory(id)
  requireFactoryCapability(auth, 'org.manage', before.baseId, before.id)
  assertRevision(before, revision, '饲料厂')
  const reference =
    one<IdRow>(`SELECT id FROM crews WHERE factory_id = ? AND status <> 'archived' LIMIT 1`, [id])
    ?? one<IdRow>(`SELECT id FROM people WHERE factory_id = ? AND status <> 'archived' LIMIT 1`, [id])
    ?? one<IdRow>(`SELECT id FROM handover_shift_profiles WHERE factory_id = ? AND status <> 'archived' LIMIT 1`, [id])
  if (reference) throw AppError.referenceConflict('饲料厂仍被生产班、人员或交接班配置引用')
  updateFactory(auth, id, { revision, status: 'archived' })
}

export function listHandoverShiftProfiles(auth: AuthContext): HandoverShiftProfile[] {
  const visible = accessibleBaseIds(auth)
  const visibleFactories = accessibleFactoryIds(auth)
  return all<HandoverProfileRow>(
    `SELECT hp.id, hp.name, hp.factory_id, f.base_id AS site_id,
            hp.shift_template_id, hp.assignment_mode, hp.handover_required,
            hp.early_start_minutes, hp.late_end_minutes, hp.instruction, hp.status,
            hp.revision, hp.created_at, hp.created_by, hp.updated_at, hp.updated_by,
            COALESCE(json_group_array(hpc.crew_id), '[]') AS crew_ids
       FROM handover_shift_profiles hp
       JOIN factories f ON f.id = hp.factory_id
       LEFT JOIN handover_shift_profile_crews hpc ON hpc.profile_id = hp.id
      WHERE hp.status = 'active'
      GROUP BY hp.id
      ORDER BY f.sort_order, f.name, hp.name`,
  )
    .filter((row) =>
      (visible === null || visible.has(row.site_id))
      && (visibleFactories === null || visibleFactories.has(row.factory_id)),
    )
    .map(mapHandoverProfile)
}

export function listWorkAreas(
  auth: AuthContext,
  query: PageQuery,
): PagedResult<WorkArea> {
  const rows = all<WorkArea>(
    `SELECT id, code, name, base_id AS baseId, factory_id AS factoryId, parent_id AS parentId,
            manager_person_id AS managerPersonId, status, revision,
            created_at AS createdAt, created_by AS createdBy,
            updated_at AS updatedAt, updated_by AS updatedBy
       FROM work_areas ORDER BY name`,
  ).filter((row) =>
    withinScopedBase(auth, row.baseId)
    &&
    (hasGrant(auth, 'org.view', { type: 'work_area', id: row.id }) || canAccessFactory(auth, 'org.view', row.baseId, row.factoryId))
    && (!query.siteId || row.baseId === query.siteId)
    && (!query.workAreaId || row.id === query.workAreaId)
    && (!query.status || row.status === query.status)
    && (!query.q || contains(row.name, query.q) || contains(row.code, query.q)),
  )
  return pageResult(rows, query)
}

export function createArea(
  auth: AuthContext,
  input: Pick<WorkArea, 'code' | 'name' | 'baseId' | 'factoryId' | 'parentId' | 'managerPersonId' | 'status'>,
): WorkArea {
  if (!input.factoryId) throw AppError.badRequest('工区必须关联工厂')
  requireFactoryCapability(auth, 'org.manage', input.baseId, input.factoryId)
  const factory = getFactory(input.factoryId)
  if (factory.baseId !== input.baseId || factory.status !== 'active') throw AppError.badRequest('工区所属工厂必须属于同一基地且处于启用状态')
  if (input.parentId) {
    const parent = getArea(input.parentId)
    if (parent.status !== 'active') throw AppError.badRequest('上级位置未启用')
    if (parent.baseId !== input.baseId || parent.factoryId !== input.factoryId) throw AppError.badRequest('上级工区必须属于同一工厂')
  }
  if (input.managerPersonId) personRow(input.managerPersonId)
  if (input.status) assertActiveStatus(input.status)
  const id = newId('area')
  const ts = nowIso()
  run(
    `INSERT INTO work_areas
      (id, code, name, base_id, factory_id, parent_id, manager_person_id, status, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, input.code, input.name, input.baseId, input.factoryId, input.parentId, input.managerPersonId,
      input.status, ts, auth.accountId, ts, auth.accountId],
  )
  const created = getArea(id)
  audit(auth, 'org.area.create', 'work_area', id, { type: 'base', id: input.baseId }, undefined, created)
  return created
}

export function updateArea(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<WorkArea, 'code' | 'name' | 'factoryId' | 'parentId' | 'managerPersonId' | 'status' | 'revision'>>,
): WorkArea {
  const before = getArea(id)
  requireFactoryCapability(auth, 'org.manage', before.baseId, before.factoryId)
  assertRevision(before, input.revision, '工区')
  const factoryId = input.factoryId === undefined ? before.factoryId : input.factoryId
  if (!factoryId) throw AppError.badRequest('工区必须关联工厂')
  requireFactoryCapability(auth, 'org.manage', before.baseId, factoryId)
  const factory = getFactory(factoryId)
  if (factory.baseId !== before.baseId || factory.status !== 'active') throw AppError.badRequest('工区所属工厂必须属于同一基地且处于启用状态')
  if (before.factoryId && before.factoryId !== factoryId) throw AppError.badRequest('已有工厂的工区不能转移到其他工厂')
  const parentId = input.parentId === undefined ? before.parentId : input.parentId
  if (parentId === id) throw AppError.badRequest('工区不能把自己设为上级')
  if (parentId) {
    const parent = getArea(parentId)
    if (parent.status !== 'active') throw AppError.badRequest('上级位置未启用')
    if (parent.baseId !== before.baseId || parent.factoryId !== factoryId) throw AppError.badRequest('上级工区必须属于同一工厂')
    if (isAreaDescendant(parentId, id)) throw AppError.badRequest('不能把下级工区设为上级')
  }
  if (input.managerPersonId) personRow(input.managerPersonId)
  if (input.status) assertActiveStatus(input.status)
  run(
    `UPDATE work_areas SET code = ?, name = ?, factory_id = ?, parent_id = ?, manager_person_id = ?,
       status = ?, revision = revision + 1, updated_at = ?, updated_by = ?
     WHERE id = ? AND revision = ?`,
    [input.code ?? before.code, input.name ?? before.name, factoryId, parentId,
      input.managerPersonId === undefined ? before.managerPersonId : input.managerPersonId,
      input.status ?? before.status, nowIso(), auth.accountId, id, before.revision],
  )
  run('UPDATE production_lines SET name=?,work_area_id=COALESCE(?,work_area_id),status=?,revision=revision+1,updated_at=? WHERE id=?', [input.name ?? before.name,parentId,input.status ?? before.status,nowIso(),id])
  const updated = getArea(id)
  audit(auth, 'org.area.update', 'work_area', id, { type: 'base', id: before.baseId }, before, updated)
  return updated
}

export function archiveArea(auth: AuthContext, id: string, revision: number): void {
  const before = getArea(id)
  requireFactoryCapability(auth, 'org.manage', before.baseId, before.factoryId)
  if (
    one<IdRow>('SELECT id FROM work_areas WHERE parent_id = ? AND status <> ? LIMIT 1', [id, 'archived'])
    ?? one<IdRow>('SELECT id FROM production_lines WHERE work_area_id = ? AND status <> ? LIMIT 1', [id, 'archived'])
    ?? one<IdRow>('SELECT id FROM crews WHERE work_area_id = ? AND status <> ? LIMIT 1', [id, 'archived'])
  ) throw AppError.referenceConflict('工区仍被下级工区、产线或班组引用')
  updateArea(auth, id, { revision, status: 'archived' })
}

function isAreaDescendant(areaId: string, ancestorId: string): boolean {
  let current = getArea(areaId)
  const seen = new Set<string>()
  while (current.parentId && !seen.has(current.id)) {
    if (current.parentId === ancestorId) return true
    seen.add(current.id)
    current = getArea(current.parentId)
  }
  return false
}

export function listLines(auth: AuthContext, query: PageQuery): PagedResult<ProductionLine> {
  return pageResult(
    all<ProductionLine>(
      `SELECT id, code, name, base_id AS baseId, work_area_id AS workAreaId,
              status, revision, created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM production_lines ORDER BY name`,
    ).filter((row) =>
      withinScopedBase(auth, row.baseId)
      && hasGrant(auth, 'org.view', { type: 'work_area', id: row.workAreaId })
      && (!query.siteId || row.baseId === query.siteId)
      && (!query.workAreaId || row.workAreaId === query.workAreaId)
      && (!query.status || row.status === query.status)
      && (!query.q || contains(row.name, query.q) || contains(row.code, query.q)),
    ),
    query,
  )
}

export function createLine(
  auth: AuthContext,
  input: Pick<ProductionLine, 'code' | 'name' | 'baseId' | 'workAreaId' | 'status'>,
): ProductionLine {
  const area = getArea(input.workAreaId)
  requireFactoryCapability(auth, 'org.manage', area.baseId, area.factoryId)
  if (!area.factoryId) throw AppError.badRequest('产线所属工区须先确认工厂')
  if (area.baseId !== input.baseId) throw AppError.badRequest('产线所属工区必须属于同一基地')
  if (input.status) assertActiveStatus(input.status)
  const id = newId('line')
  const ts = nowIso()
  run(
    `INSERT INTO production_lines
      (id, code, name, base_id, work_area_id, status, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, input.code, input.name, input.baseId, input.workAreaId, input.status,
      ts, auth.accountId, ts, auth.accountId],
  )
  run(`INSERT INTO work_areas(id,code,name,base_id,factory_id,parent_id,status,revision,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,1,?,?,?,?)`,[id,'LOC-'+input.code,input.name,input.baseId,area.factoryId,input.workAreaId,input.status,ts,auth.accountId,ts,auth.accountId])
  const created = getLine(id)
  audit(auth, 'org.line.create', 'production_line', id, { type: 'base', id: input.baseId }, undefined, created)
  return created
}

export function updateLine(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<ProductionLine, 'code' | 'name' | 'workAreaId' | 'status' | 'revision'>>,
): ProductionLine {
  const before = getLine(id)
  const oldArea = getArea(before.workAreaId)
  requireFactoryCapability(auth, 'org.manage', oldArea.baseId, oldArea.factoryId)
  assertRevision(before, input.revision, '产线')
  const workAreaId = input.workAreaId ?? before.workAreaId
  const newArea = getArea(workAreaId)
  if(workAreaId === id || isAreaDescendant(workAreaId,id)) throw AppError.badRequest('不能将自身或下级位置设为上级')
  if (!newArea.factoryId || newArea.baseId !== before.baseId || newArea.factoryId !== oldArea.factoryId) throw AppError.badRequest('产线所属工区必须属于同一工厂')
  if (input.status) assertActiveStatus(input.status)
  run(
    `UPDATE production_lines SET code = ?, name = ?, work_area_id = ?, status = ?,
       revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
    [input.code ?? before.code, input.name ?? before.name, workAreaId,
      input.status ?? before.status, nowIso(), auth.accountId, id, before.revision],
  )
  run('UPDATE work_areas SET name=?,parent_id=?,status=?,revision=revision+1,updated_at=? WHERE id=?',[input.name ?? before.name,workAreaId,input.status ?? before.status,nowIso(),id])
  const updated = getLine(id)
  audit(auth, 'org.line.update', 'production_line', id, { type: 'base', id: before.baseId }, before, updated)
  return updated
}

export function archiveLine(auth: AuthContext, id: string, revision: number): void {
  updateLine(auth, id, { revision, status: 'archived' })
}

export function listQualifications(auth: AuthContext, query: PageQuery): PagedResult<Qualification> {
  const visible = accessibleBaseIds(auth)
  if (visible && visible.size === 0) return pageResult([], query)
  return pageResult(
    all<Qualification>(
      `SELECT id, code, name, description, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM qualifications ORDER BY name`,
    ).filter((row) =>
      (!query.status || row.status === query.status)
      && (!query.q || contains(row.name, query.q) || contains(row.code, query.q)),
    ),
    query,
  )
}

export function createQualification(
  auth: AuthContext,
  input: Pick<Qualification, 'code' | 'name' | 'description' | 'status'>,
): Qualification {
  requireGroupCapability(auth, 'qualification.manage')
  if (input.status) assertActiveStatus(input.status)
  const id = newId('qual')
  const ts = nowIso()
  run(
    `INSERT INTO qualifications
      (id, code, name, description, status, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, input.code, input.name, input.description, input.status,
      ts, auth.accountId, ts, auth.accountId],
  )
  const created = requireRow(
    one<Qualification>(
      `SELECT id, code, name, description, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM qualifications WHERE id = ?`,
      [id],
    ),
    '作业资格',
  )
  audit(auth, 'org.qualification.create', 'qualification', id, { type: 'group', id: 'group' }, undefined, created)
  return created
}

export function updateQualification(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<Qualification, 'code' | 'name' | 'description' | 'status' | 'revision'>>,
): Qualification {
  requireGroupCapability(auth, 'qualification.manage')
  const before = requireRow(
    one<Qualification>(
      `SELECT id, code, name, description, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM qualifications WHERE id = ?`,
      [id],
    ),
    '作业资格',
  )
  assertRevision(before, input.revision, '作业资格')
  if (input.status) assertActiveStatus(input.status)
  run(
    `UPDATE qualifications SET code = ?, name = ?, description = ?, status = ?,
       revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
    [input.code ?? before.code, input.name ?? before.name, input.description ?? before.description,
      input.status ?? before.status, nowIso(), auth.accountId, id, before.revision],
  )
  const updated = requireRow(
    one<Qualification>(
      `SELECT id, code, name, description, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM qualifications WHERE id = ?`,
      [id],
    ),
    '作业资格',
  )
  audit(auth, 'org.qualification.update', 'qualification', id, { type: 'group', id: 'group' }, before, updated)
  return updated
}

export function archiveQualification(auth: AuthContext, id: string, revision: number): void {
  const reference = one<IdRow>('SELECT id FROM person_qualifications WHERE qualification_id = ? LIMIT 1', [id])
  if (reference) throw AppError.referenceConflict('资格已被人员引用，不能归档')
  updateQualification(auth, id, { revision, status: 'archived' })
}

export function listPeople(auth: AuthContext, query: PageQuery): PagedResult<Person> {
  const visible = accessibleBaseIds(auth)
  const personIds = new Set<string>()
  const visibleFactories = accessibleFactoryIds(auth)
  if (visible === null && visibleFactories === null) {
    all<IdRow>('SELECT id FROM people').forEach((row) => personIds.add(row.id))
  } else if (visible && visibleFactories === null) {
    for (const id of visible) {
      if (!canAccessBase(auth, 'person.view', id)) continue
      all<IdRow>('SELECT id FROM people WHERE home_base_id = ?', [id])
        .forEach((row) => personIds.add(row.id))
    }
  }
  if (visibleFactories) {
    for (const factoryId of visibleFactories) {
      const factory = getFactory(factoryId)
      if (!canAccessFactory(auth, 'person.view', factory.baseId, factory.id)) continue
      all<IdRow>('SELECT id FROM people WHERE factory_id = ?', [factoryId])
        .forEach((row) => personIds.add(row.id))
    }
  }
  if (visibleFactories) {
    for (const factoryId of visibleFactories) {
      const factory = getFactory(factoryId)
      if (!canAccessFactory(auth, 'person.view', factory.baseId, factory.id)) continue
      all<IdRow>(`SELECT DISTINCT person_id AS id FROM secondments WHERE to_factory_id = ?
        AND status IN ('planned', 'active') AND end_date >= date('now','localtime')`, [factoryId]).forEach((row) => personIds.add(row.id))
    }
  }
  const ids = [...personIds]
  // Read crew and qualification summaries in batches instead of per person.
  const crews = crewSummariesFor(ids)
  const qualifications = qualificationsFor(ids)
  const rows = all<Omit<Person, 'qualifications' | 'crew'>>(
    `SELECT id, employee_code AS employeeCode, name, mobile,
            home_company_id AS homeCompanyId, home_base_id AS homeBaseId, factory_id AS factoryId,
            status, revision, created_at AS createdAt, created_by AS createdBy,
            updated_at AS updatedAt, updated_by AS updatedBy
       FROM people ORDER BY employee_code`,
  )
  const items = rows
    .filter((row) => personIds.has(row.id))
    .filter((row) => withinScopedFactory(auth, row.factoryId))
    .map((row) => ({
      ...row,
      qualifications: qualifications.get(row.id) ?? [],
      crew: crews.get(row.id) ?? null,
    }))
    .filter((row) =>
      (!query.companyId || row.homeCompanyId === query.companyId)
      && (!query.siteId || row.homeBaseId === query.siteId)
      && (!query.factoryId || row.factoryId === query.factoryId)
      && (!query.crewId || row.crew?.crewId === query.crewId)
      && (!query.status || row.status === query.status)
      && (!query.q || contains(row.name, query.q) || contains(row.employeeCode, query.q)),
    )
  return pageResult(items, query)
}

export function createPerson(
  auth: AuthContext,
  input: Pick<Person, 'employeeCode' | 'name' | 'mobile' | 'homeCompanyId'
    | 'homeBaseId' | 'factoryId' | 'status'>,
): Person {
  requireFactoryCapability(auth, 'person.manage', input.homeBaseId, input.factoryId)
  const base = getBase(input.homeBaseId)
  if (base.companyId !== input.homeCompanyId) throw AppError.badRequest('人员所属公司与归属基地不一致')
  if (input.factoryId) {
    const factory = getFactory(input.factoryId)
    if (factory.baseId !== input.homeBaseId) throw AppError.badRequest('人员工厂必须属于归属基地')
  }
  if (input.status) assertActiveStatus(input.status)
  const id = newId('person')
  const ts = nowIso()
  run(
    `INSERT INTO people
      (id, employee_code, name, mobile, home_company_id, home_base_id, factory_id, status, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, input.employeeCode, input.name, input.mobile, input.homeCompanyId, input.homeBaseId,
      input.factoryId, input.status, ts, auth.accountId, ts, auth.accountId],
  )
  const created = getPerson(id)
  audit(auth, 'org.person.create', 'person', id, { type: 'base', id: input.homeBaseId }, undefined, created)
  return created
}

/** Single-person read used by GET /org/people/:id; keeps list and detail scopes consistent. */
export function readPerson(auth: AuthContext, id: string): Person {
  const person = getPerson(id)
  requireFactoryCapability(auth, 'person.view', person.homeBaseId, person.factoryId)
  return person
}

/**
 * Read-only crew relations of one person, including future and ended ones.
 * Crew names are hidden when the caller cannot view that crew.
 */
export function listPersonCrewRelations(auth: AuthContext, personId: string): PersonCrewHistory[] {
  const person = personRow(personId)
  requireFactoryCapability(auth, 'person.view', person.homeBaseId, person.factoryId)
  const today = todayLocal()
  return all<{ membershipId: string; crewId: string; crewName: string; role: CrewMemberRole; validFrom: string; validTo: string | null }>(
    `SELECT cm.id AS membershipId, cm.crew_id AS crewId, c.name AS crewName, cm.role,
            cm.valid_from AS validFrom, cm.valid_to AS validTo
       FROM crew_memberships cm JOIN crews c ON c.id = cm.crew_id
      WHERE cm.person_id = ? ORDER BY cm.valid_from, cm.id`,
    [personId],
  ).map((row) => {
    const visible = canViewCrew(auth, row.crewId)
    const relation: PersonCrewHistory['relation'] = row.validFrom > today
      ? 'future'
      : row.validTo && row.validTo < today ? 'ended' : 'current'
    return {
      membershipId: row.membershipId,
      crewId: row.crewId,
      crewName: visible ? row.crewName : '其他班组',
      role: row.role,
      validFrom: row.validFrom,
      validTo: row.validTo,
      relation,
    }
  })
}

export function updatePerson(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<Person, 'employeeCode' | 'name' | 'mobile' | 'homeCompanyId'
    | 'homeBaseId' | 'factoryId' | 'status' | 'revision'>>,
): Person {
  const before = getPerson(id)
  requireFactoryCapability(auth, 'person.manage', before.homeBaseId, before.factoryId)
  assertRevision(before, input.revision, '人员')
  const homeBaseId = input.homeBaseId ?? before.homeBaseId
  const homeCompanyId = input.homeCompanyId ?? before.homeCompanyId
  if (getBase(homeBaseId).companyId !== homeCompanyId) throw AppError.badRequest('人员所属公司与归属基地不一致')
  const factoryId = input.factoryId === undefined ? before.factoryId : input.factoryId
  requireFactoryCapability(auth, 'person.manage', homeBaseId, factoryId)
  if (factoryId) {
    const factory = getFactory(factoryId)
    if (factory.baseId !== homeBaseId) throw AppError.badRequest('人员工厂必须属于归属基地')
  }
  if (input.status) assertActiveStatus(input.status)
  run(
    `UPDATE people SET employee_code = ?, name = ?, mobile = ?, home_company_id = ?,
       home_base_id = ?, factory_id = ?, status = ?, revision = revision + 1,
       updated_at = ?, updated_by = ?
     WHERE id = ? AND revision = ?`,
    [input.employeeCode ?? before.employeeCode, input.name ?? before.name,
      input.mobile ?? before.mobile, homeCompanyId, homeBaseId, factoryId,
      input.status ?? before.status, nowIso(), auth.accountId, id, before.revision],
  )
  const updated = getPerson(id)
  audit(auth, 'org.person.update', 'person', id, { type: 'base', id: before.homeBaseId }, before, updated)
  return updated
}

export function archivePerson(auth: AuthContext, id: string, revision: number): void {
  const before = getPerson(id)
  requireFactoryCapability(auth, 'person.manage', before.homeBaseId, before.factoryId)
  const activeMembership = one<IdRow>(
    `SELECT id FROM crew_memberships
      WHERE person_id = ? AND (valid_to IS NULL OR valid_to >= date('now')) LIMIT 1`,
    [id],
  )
  const activeSecondment = one<IdRow>(
    `SELECT id FROM secondments
      WHERE person_id = ? AND status IN ('planned', 'active') LIMIT 1`,
    [id],
  )
  if (activeMembership || activeSecondment) {
    throw AppError.referenceConflict('人员仍在班组或借调中，请先结束相关有效期')
  }
  updatePerson(auth, id, { revision, status: 'archived' })
}

export function replacePersonQualifications(
  auth: AuthContext,
  personId: string,
  qualifications: Array<Pick<PersonQualification, 'qualificationId' | 'validFrom' | 'validTo' | 'certificateNo'>>,
): Person {
  const person = getPerson(personId)
  requireFactoryCapability(auth, 'person.manage', person.homeBaseId, person.factoryId)
  for (const item of qualifications) {
    requireRow(
      one<IdRow>('SELECT id FROM qualifications WHERE id = ?', [item.qualificationId]),
      '作业资格',
    )
    if (item.validTo && item.validTo < item.validFrom) throw AppError.badRequest('资格失效日期不能早于生效日期')
  }
  transaction(() => {
    run('DELETE FROM person_qualifications WHERE person_id = ?', [personId])
    const ts = nowIso()
    for (const item of qualifications) {
      run(
        `INSERT INTO person_qualifications
          (id, person_id, qualification_id, valid_from, valid_to, certificate_no, revision,
           created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [newId('pq'), personId, item.qualificationId, item.validFrom, item.validTo,
          item.certificateNo, ts, auth.accountId, ts, auth.accountId],
      )
    }
    run(
      `UPDATE people SET revision = revision + 1, updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [ts, auth.accountId, personId],
    )
  })
  const updated = getPerson(personId)
  audit(auth, 'org.person.qualifications.replace', 'person', personId,
    { type: 'base', id: person.homeBaseId }, person.qualifications, updated.qualifications)
  return updated
}

export function listCrews(auth: AuthContext, query: PageQuery): PagedResult<Crew> {
  const visible = accessibleBaseIds(auth)
  const visibleFactories = accessibleFactoryIds(auth)
  return pageResult(
    all<CrewRow>(
      `SELECT id, code, name, base_id AS baseId, work_area_id AS workAreaId, factory_id AS factoryId,
              (SELECT cm.person_id FROM crew_memberships cm WHERE cm.crew_id = crews.id AND cm.role = 'leader'
                 AND cm.valid_from <= date('now','localtime') AND (cm.valid_to IS NULL OR cm.valid_to >= date('now','localtime')) ORDER BY cm.valid_from, cm.id LIMIT 1) AS leaderPersonId, status, revision,
              ${crewDerivedColumns},
              ${crewLeaderNamesColumn},
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM crews ORDER BY name`,
    ).map(mapCrewRow).filter((row) =>
      (visible === null || visible.has(row.baseId))
      && (visibleFactories === null || Boolean(row.factoryId && visibleFactories.has(row.factoryId)))
      && withinScopedFactory(auth, row.factoryId)
      && (!query.siteId || row.baseId === query.siteId)
      && (!query.workAreaId || row.workAreaId === query.workAreaId)
      && (!query.factoryId || row.factoryId === query.factoryId)
      && (!query.status || row.status === query.status)
      && (!query.q || contains(row.name, query.q) || contains(row.code, query.q)),
    ),
    query,
  )
}

export function createCrew(
  auth: AuthContext,
  input: Pick<Crew, 'code' | 'name' | 'baseId' | 'workAreaId' | 'factoryId'
    | 'leaderPersonId' | 'status'>,
): Crew {
  requireFactoryCapability(auth, 'crew.manage', input.baseId, input.factoryId)
  if (input.workAreaId && (getArea(input.workAreaId).baseId !== input.baseId || getArea(input.workAreaId).factoryId !== input.factoryId)) {
    throw AppError.badRequest('班组工区必须属于同一工厂')
  }
  if (!input.factoryId) throw AppError.badRequest('生产班必须归属饲料厂')
  if (input.factoryId) {
    const factory = getFactory(input.factoryId)
    if (factory.baseId !== input.baseId) throw AppError.badRequest('班组工厂必须属于同一基地')
  }
  if (input.leaderPersonId) throw AppError.badRequest('请先添加班组成员，再将成员岗位设为班组长')
  if (input.status) assertActiveStatus(input.status)
  const id = newId('crew')
  const ts = nowIso()
  run(
    `INSERT INTO crews
      (id, code, name, base_id, work_area_id, factory_id, leader_person_id, status, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, input.code, input.name, input.baseId, input.workAreaId, input.factoryId,
      input.leaderPersonId, input.status, ts, auth.accountId, ts, auth.accountId],
  )
  const created = getCrew(id)
  audit(auth, 'org.crew.create', 'crew', id, { type: 'base', id: input.baseId }, undefined, created)
  return created
}

export function updateCrew(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<Crew, 'code' | 'name' | 'workAreaId' | 'factoryId'
    | 'leaderPersonId' | 'status' | 'revision'>>,
): Crew {
  const before = getCrew(id)
  requireFactoryCapability(auth, 'crew.manage', before.baseId, before.factoryId)
  assertRevision(before, input.revision, '班组')
  const workAreaId = input.workAreaId === undefined ? before.workAreaId : input.workAreaId
  const factoryId = input.factoryId === undefined ? before.factoryId : input.factoryId
  if (workAreaId && (getArea(workAreaId).baseId !== before.baseId || getArea(workAreaId).factoryId !== factoryId)) {
    throw AppError.badRequest('班组工区必须属于同一工厂')
  }
  requireFactoryCapability(auth, 'crew.manage', before.baseId, factoryId)
  if (!factoryId) throw AppError.badRequest('生产班必须归属饲料厂')
  if (factoryId && getFactory(factoryId).baseId !== before.baseId) {
    throw AppError.badRequest('班组工厂必须属于同一基地')
  }
  if (input.leaderPersonId !== undefined && input.leaderPersonId !== before.leaderPersonId) {
    throw AppError.badRequest('请在成员关系中设置班组长岗位')
  }
  if (input.status) assertActiveStatus(input.status)
  run(
    `UPDATE crews SET code = ?, name = ?, work_area_id = ?, factory_id = ?,
       leader_person_id = ?, status = ?,
       revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
    [input.code ?? before.code, input.name ?? before.name, workAreaId, factoryId,
      before.leaderPersonId,
      input.status ?? before.status, nowIso(), auth.accountId, id, before.revision],
  )
  const updated = getCrew(id)
  audit(auth, 'org.crew.update', 'crew', id, { type: 'base', id: before.baseId }, before, updated)
  return updated
}

export function archiveCrew(auth: AuthContext, id: string, revision: number): void {
  const before = getCrew(id)
  requireFactoryCapability(auth, 'crew.manage', before.baseId, before.factoryId)
  const active = one<IdRow>(
    `SELECT id FROM crew_memberships
      WHERE crew_id = ? AND (valid_to IS NULL OR valid_to >= date('now')) LIMIT 1`,
    [id],
  )
  if (active) throw AppError.referenceConflict('班组仍有有效成员，请先结束成员有效期')
  updateCrew(auth, id, { revision, status: 'archived' })
}

export function listCrewMembers(
  auth: AuthContext,
  crewId: string,
  asOf?: string,
  includeAll = false,
): CrewMembership[] {
  const crew = getCrew(crewId)
  requireFactoryCapability(auth, 'crew.view', crew.baseId, crew.factoryId)
  const date = asOf ?? todayLocal()
  return all<CrewMembership & { personName: string; employeeCode: string }>(
    `SELECT m.id, m.crew_id AS crewId, m.person_id AS personId,
            p.name AS personName, p.employee_code AS employeeCode, m.role,
            m.valid_from AS validFrom, m.valid_to AS validTo, m.revision,
            m.created_at AS createdAt, m.created_by AS createdBy,
            m.updated_at AS updatedAt, m.updated_by AS updatedBy
       FROM crew_memberships m JOIN people p ON p.id = m.person_id
      WHERE m.crew_id = ? AND (? = 1 OR (m.valid_from <= ? AND (m.valid_to IS NULL OR m.valid_to >= ?)))
      ORDER BY m.role, m.valid_from`,
    [crewId, Number(includeAll), date, date],
  )
}

export function addCrewMember(
  auth: AuthContext,
  crewId: string,
  input: Pick<CrewMembership, 'personId' | 'role' | 'validFrom' | 'validTo'>,
): CrewMembership {
  return transaction(() => addCrewMemberInternal(auth, crewId, input))
}

function addCrewMemberInternal(
  auth: AuthContext,
  crewId: string,
  input: Pick<CrewMembership, 'personId' | 'role' | 'validFrom' | 'validTo'>,
): CrewMembership {
  const crew = getCrew(crewId)
  requireFactoryCapability(auth, 'crew.manage', crew.baseId, crew.factoryId)
  const person = personRow(input.personId)
  if (person.status !== 'active') throw AppError.badRequest('只能添加启用的人员')
  assertCrewRole(input.role)
  if (input.validTo && input.validTo < input.validFrom) throw AppError.badRequest('失效日期不能早于生效日期')
  if (!crew.factoryId) throw AppError.badRequest('班组须关联饲料厂')
  if (person.factoryId !== crew.factoryId) {
    const secondment = input.validTo && one<IdRow>(
      `SELECT id FROM secondments WHERE person_id = ? AND to_base_id = ? AND to_factory_id = ?
         AND status IN ('planned', 'active') AND start_date <= ? AND end_date >= ? LIMIT 1`,
      [input.personId, crew.baseId, crew.factoryId, input.validFrom, input.validTo],
    )
    if (!secondment) throw AppError.badRequest('跨厂成员须有覆盖成员有效期的借调，且必须填写结束日期')
  }
  // A person belongs to exactly one crew per date, across every crew.
  assertNoCrewOverlap(input.personId, null, input.validFrom, input.validTo ?? null, auth)
  const id = newId('cm')
  const ts = nowIso()
    runMembership(() => run(
      `INSERT INTO crew_memberships
        (id, crew_id, person_id, role, valid_from, valid_to, revision,
         created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [id, crewId, input.personId, input.role, input.validFrom, input.validTo,
        ts, auth.accountId, ts, auth.accountId],
    ))
    run(
      `UPDATE crews SET revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?`,
      [ts, auth.accountId, crewId],
    )
  const created = requireRow(
    one<CrewMembership>(
      `SELECT id, crew_id AS crewId, person_id AS personId, role,
              valid_from AS validFrom, valid_to AS validTo, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM crew_memberships WHERE id = ?`,
      [id],
    ),
    '班组成员',
  )
  audit(auth, 'org.crew.member.create', 'crew_membership', id, { type: 'base', id: crew.baseId }, undefined, created)
  return created
}

export function addCrewMembers(auth: AuthContext, crewId: string, members: Array<Pick<CrewMembership, 'personId' | 'role' | 'validFrom' | 'validTo'>>): CrewMembership[] {
  return transaction(() => members.map((member) => {
    try { return addCrewMemberInternal(auth, crewId, member) }
    catch (error) {
      if (error instanceof AppError) {
        const name = one<{ name: string }>('SELECT name FROM people WHERE id = ?', [member.personId])?.name || member.personId
        throw new AppError(error.status, error.code, `${name}：${error.message}；整批未保存`, { personId: member.personId })
      }
      throw error
    }
  }))
}

export function updateCrewMember(auth: AuthContext, id: string, input: Pick<CrewMembership, 'role' | 'validFrom' | 'validTo' | 'revision'>): CrewMembership {
  const before = requireRow(one<CrewMembership>(
    `SELECT id, crew_id AS crewId, person_id AS personId, role, valid_from AS validFrom, valid_to AS validTo,
      revision, created_at AS createdAt, created_by AS createdBy, updated_at AS updatedAt, updated_by AS updatedBy
      FROM crew_memberships WHERE id = ?`, [id]), '班组成员')
  const crew = getCrew(before.crewId)
  requireFactoryCapability(auth, 'crew.manage', crew.baseId, crew.factoryId)
  assertRevision(before, input.revision, '班组成员')
  const person = personRow(before.personId)
  if (person.status !== 'active') throw AppError.badRequest('只能设置启用的人员')
  if (input.validTo && input.validTo < input.validFrom) throw AppError.badRequest('结束日期不能早于生效日期')
  if (person.factoryId !== crew.factoryId && (!input.validTo || !one<IdRow>(
    `SELECT id FROM secondments WHERE person_id = ? AND to_factory_id = ? AND to_base_id = ? AND status IN ('planned','active') AND start_date <= ? AND end_date >= ? LIMIT 1`,
    [person.id, crew.factoryId, crew.baseId, input.validFrom, input.validTo],
  ))) throw AppError.badRequest('跨厂成员须有覆盖成员有效期的借调，且必须填写结束日期')
  // Cross-crew uniqueness: adjusting dates here must not collide with another crew.
  assertNoCrewOverlap(person.id, id, input.validFrom, input.validTo ?? null, auth)
  return transaction(() => {
    runMembership(() => run(
      `UPDATE crew_memberships SET role = ?, valid_from = ?, valid_to = ?, revision = revision + 1,
        updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
      [input.role, input.validFrom, input.validTo, nowIso(), auth.accountId, id, before.revision],
    ))
    run('UPDATE crews SET revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?', [nowIso(), auth.accountId, crew.id])
    const updated = { ...before, ...input, revision: before.revision + 1 }
    audit(auth, 'org.crew.member.update', 'crew_membership', id, { type: 'factory', id: crew.factoryId! }, before, updated)
    return updated
  })
}

export function listCrewScopes(auth: AuthContext, crewId: string): CrewScope[] {
  const crew = getCrew(crewId)
  requireFactoryCapability(auth, 'crew.view', crew.baseId, crew.factoryId)
  return all<CrewScope>(`SELECT id, crew_id AS crewId, work_area_id AS workAreaId,
    production_line_id AS productionLineId FROM crew_scopes WHERE crew_id = ? ORDER BY id`, [crewId])
}

export function replaceCrewScopes(auth: AuthContext, crewId: string, input: { workAreaIds: string[]; productionLineIds: string[]; revision: number }): CrewScope[] {
  const crew = getCrew(crewId)
  requireFactoryCapability(auth, 'crew.manage', crew.baseId, crew.factoryId)
  assertRevision(crew, input.revision, '班组')
  if (!crew.factoryId) throw AppError.badRequest('班组须先关联工厂')
  for (const areaId of new Set(input.workAreaIds)) {
    const area = getArea(areaId)
    if (area.factoryId !== crew.factoryId || area.status !== 'active') throw AppError.badRequest('适用工区须属于班组工厂且处于启用状态')
  }
  for (const lineId of new Set(input.productionLineIds)) {
    const line = getLine(lineId)
    const area = getArea(line.workAreaId)
    if (area.factoryId !== crew.factoryId || area.status !== 'active' || line.status !== 'active') throw AppError.badRequest('适用产线须属于班组工厂且处于启用状态')
  }
  return transaction(() => {
    const before = listCrewScopes(auth, crewId)
    run('DELETE FROM crew_scopes WHERE crew_id = ?', [crewId])
    for (const areaId of new Set(input.workAreaIds)) run('INSERT INTO crew_scopes (id, crew_id, work_area_id, production_line_id) VALUES (?, ?, ?, NULL)', [newId('cscope'), crewId, areaId])
    for (const lineId of new Set(input.productionLineIds)) run('INSERT INTO crew_scopes (id, crew_id, work_area_id, production_line_id) VALUES (?, ?, NULL, ?)', [newId('cscope'), crewId, lineId])
    run('UPDATE crews SET revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?', [nowIso(), auth.accountId, crewId])
    const after = listCrewScopes(auth, crewId)
    audit(auth, 'org.crew.scopes.replace', 'crew', crewId, { type: 'factory', id: crew.factoryId! }, before, after)
    return after
  })
}

export function endCrewMember(
  auth: AuthContext,
  id: string,
  endDate: string,
  revision: number,
): CrewMembership {
  const before = requireRow(
    one<CrewMembership>(
      `SELECT id, crew_id AS crewId, person_id AS personId, role,
              valid_from AS validFrom, valid_to AS validTo, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM crew_memberships WHERE id = ?`,
      [id],
    ),
    '班组成员',
  )
  const crew = getCrew(before.crewId)
  requireFactoryCapability(auth, 'crew.manage', crew.baseId, crew.factoryId)
  assertRevision(before, revision, '班组成员')
  if (endDate < before.validFrom) throw AppError.badRequest('结束日期不能早于生效日期')
  if (before.validTo && endDate > before.validTo) throw AppError.badRequest('结束日期不能延长原有效期')
  run(
    `UPDATE crew_memberships SET valid_to = ?, revision = revision + 1,
       updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
    [endDate, nowIso(), auth.accountId, id, before.revision],
  )
  const updated = { ...before, validTo: endDate, revision: before.revision + 1 }
  audit(auth, 'org.crew.member.end', 'crew_membership', id, { type: 'base', id: crew.baseId }, before, updated)
  return updated
}

export function listSecondments(auth: AuthContext, query: PageQuery): PagedResult<Secondment> {
  return pageResult(
    all<Secondment>(
      `SELECT id, person_id AS personId, from_company_id AS fromCompanyId,
              from_base_id AS fromBaseId, to_company_id AS toCompanyId,
              to_base_id AS toBaseId, to_factory_id AS toFactoryId, start_date AS startDate, end_date AS endDate,
              purpose, status, approved_by AS approvedBy, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM secondments ORDER BY start_date DESC`,
    ).filter((row) =>
      (withinScopedBase(auth, row.toBaseId) || withinScopedBase(auth, row.fromBaseId))
      && (canAccessFactory(auth, 'secondment.view', row.toBaseId, row.toFactoryId)
        || canAccessFactory(auth, 'secondment.view', row.fromBaseId, personRow(row.personId).factoryId))
      && (!query.status || row.status === query.status)
      && (!query.q || contains(row.purpose, query.q)),
    ),
    query,
  )
}

export function createSecondment(
  auth: AuthContext,
  input: Omit<Secondment, keyof import('../../../packages/contracts/src').AuditFields | 'id' | 'approvedBy'> & {
    approvedBy?: string | null
  },
): Secondment {
  const person = personRow(input.personId)
  if (input.fromCompanyId !== person.homeCompanyId || input.fromBaseId !== person.homeBaseId) {
    throw AppError.badRequest('借调来源必须与人员当前归属一致')
  }
  if (!input.toFactoryId) throw AppError.badRequest('必须明确接收工厂')
  requireFactoryCapability(auth, 'secondment.manage', input.toBaseId, input.toFactoryId)
  if (getBase(input.toBaseId).companyId !== input.toCompanyId) {
    throw AppError.badRequest('接收公司与接收基地不一致')
  }
  const targetFactory = getFactory(input.toFactoryId)
  if (targetFactory.baseId !== input.toBaseId || targetFactory.companyId !== input.toCompanyId || targetFactory.status !== 'active') {
    throw AppError.badRequest('接收工厂须为接收公司和基地下的启用工厂')
  }
  if (input.endDate < input.startDate) throw AppError.badRequest('借调结束日期不能早于开始日期')
  assertSecondmentStatus(input.status)
  const overlap = one<IdRow>(
    `SELECT id FROM secondments
      WHERE person_id = ? AND status IN ('planned', 'active')
        AND start_date <= ? AND end_date >= ? LIMIT 1`,
    [input.personId, input.endDate, input.startDate],
  )
  if (overlap) throw AppError.conflict('该人员在所选日期内已有有效借调')
  const id = newId('secondment')
  const ts = nowIso()
  run(
    `INSERT INTO secondments
      (id, person_id, from_company_id, from_base_id, to_company_id, to_base_id, to_factory_id,
       start_date, end_date, purpose, status, approved_by, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, input.personId, input.fromCompanyId, input.fromBaseId, input.toCompanyId,
      input.toBaseId, input.toFactoryId, input.startDate, input.endDate, input.purpose, input.status,
      input.approvedBy ?? null, ts, auth.accountId, ts, auth.accountId],
  )
  const created = getSecondment(id)
  audit(auth, 'org.secondment.create', 'secondment', id, { type: 'base', id: input.toBaseId }, undefined, created)
  return created
}

export function updateSecondment(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<Secondment, 'toFactoryId' | 'startDate' | 'endDate' | 'purpose' | 'status' | 'approvedBy' | 'revision'>>,
): Secondment {
  const before = getSecondment(id)
  requireFactoryCapability(auth, 'secondment.manage', before.toBaseId, before.toFactoryId)
  const toFactoryId = input.toFactoryId === undefined ? before.toFactoryId : input.toFactoryId
  if (toFactoryId) {
    requireFactoryCapability(auth, 'secondment.manage', before.toBaseId, toFactoryId)
    const factory = getFactory(toFactoryId)
    if (factory.baseId !== before.toBaseId || factory.companyId !== before.toCompanyId || factory.status !== 'active') {
      throw AppError.badRequest('接收工厂须为接收公司和基地下的启用工厂')
    }
  }
  assertRevision(before, input.revision, '借调记录')
  const startDate = input.startDate ?? before.startDate
  const endDate = input.endDate ?? before.endDate
  if (endDate < startDate) throw AppError.badRequest('借调结束日期不能早于开始日期')
  if (input.status) assertSecondmentStatus(input.status)
  const status = input.status ?? before.status
  if ((status === 'planned' || status === 'active') && one<IdRow>(
    `SELECT id FROM secondments WHERE person_id = ? AND id <> ?
       AND status IN ('planned', 'active') AND start_date <= ? AND end_date >= ? LIMIT 1`,
    [before.personId, id, endDate, startDate],
  )) throw AppError.conflict('该人员在所选日期内已有有效借调')
  run(
    `UPDATE secondments SET to_factory_id = ?, start_date = ?, end_date = ?, purpose = ?, status = ?,
       approved_by = ?, revision = revision + 1, updated_at = ?, updated_by = ?
     WHERE id = ? AND revision = ?`,
    [toFactoryId, startDate, endDate, input.purpose ?? before.purpose, input.status ?? before.status,
      input.approvedBy === undefined ? before.approvedBy : input.approvedBy,
      nowIso(), auth.accountId, id, before.revision],
  )
  const updated = getSecondment(id)
  audit(auth, 'org.secondment.update', 'secondment', id, { type: 'base', id: before.toBaseId }, before, updated)
  return updated
}

export function cancelSecondment(auth: AuthContext, id: string, revision: number): void {
  updateSecondment(auth, id, { revision, status: 'cancelled' })
}

export function getOrgTree(auth: AuthContext): OrgReferenceData {
  const query: PageQuery = {
    page: 1,
    pageSize: 200,
    sortOrder: 'asc',
  }
  const factories = listFactories(auth, query).items
  const groupIds = new Set(factories.map((factory) => factory.managementGroupId).filter(Boolean))
  const isGroupScope = auth.grants.some((grant) => grant.type === 'group')
  return {
    companies: listCompaniesFor(auth, query).items,
    bases: listBases(auth, query).items,
    factories,
    managementGroups: all<OrgReferenceData['managementGroups'][number]>('SELECT id, code, name, status, revision FROM management_groups ORDER BY name')
      .filter((group) => isGroupScope || groupIds.has(group.id)),
    handoverShiftProfiles: listHandoverShiftProfiles(auth),
    workAreas: listWorkAreas(auth, query).items,
    productionLines: listLines(auth, query).items,
    crews: listCrews(auth, query).items,
    qualifications: listQualifications(auth, query).items,
    shiftTemplates: listShiftTemplates(auth, query).items,
  }
}

function getManagementGroup(id: string): ManagementGroup {
  return requireRow(one<ManagementGroup>('SELECT id, code, name, status, revision FROM management_groups WHERE id = ?', [id]), '管理分组')
}

export function createManagementGroup(auth: AuthContext, input: Pick<ManagementGroup, 'code' | 'name' | 'status'>): ManagementGroup {
  requireGroupCapability(auth, 'org.manage')
  const id = newId('mg')
  const ts = nowIso()
  run('INSERT INTO management_groups (id, code, name, status, revision, created_at, updated_at, created_by, updated_by) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)', [id, input.code, input.name, input.status, ts, ts, auth.accountId, auth.accountId])
  const created = getManagementGroup(id)
  audit(auth, 'org.management-group.create', 'management_group', id, { type: 'group', id: 'group' }, undefined, created)
  return created
}

export function updateManagementGroup(auth: AuthContext, id: string, input: Partial<Pick<ManagementGroup, 'code' | 'name' | 'status' | 'revision'>>): ManagementGroup {
  requireGroupCapability(auth, 'org.manage')
  const before = getManagementGroup(id)
  assertRevision(before, input.revision, '管理分组')
  if (input.status === 'archived' && one<IdRow>("SELECT id FROM factories WHERE management_group_id = ? AND status <> 'archived' LIMIT 1", [id])) {
    throw AppError.referenceConflict('管理分组仍有工厂，请先调整工厂归属')
  }
  run('UPDATE management_groups SET code = ?, name = ?, status = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?', [input.code ?? before.code, input.name ?? before.name, input.status ?? before.status, nowIso(), auth.accountId, id, before.revision])
  const updated = getManagementGroup(id)
  audit(auth, 'org.management-group.update', 'management_group', id, { type: 'group', id: 'group' }, before, updated)
  return updated
}

export interface AccessScopeOption {
  label: string
  type: ScopeRef['type']
  id: string
}

export function listAccessOptions(auth: AuthContext): {
  accounts: Array<{ id: string; username: string; displayName: string; personId: string | null }>
  roles: Array<{ id: string; code: string; name: string; builtIn: boolean }>
  scopes: AccessScopeOption[]
} {
  requireGroupCapability(auth, 'access.manage')
  return {
    accounts: all(
      `SELECT id, username, display_name AS displayName, person_id AS personId
         FROM accounts WHERE status = 'active' ORDER BY display_name`,
    ),
    roles: all(
      `SELECT id, code, name, built_in AS builtIn FROM roles ORDER BY built_in DESC, name`,
    ),
    scopes: [
      { label: '全饲料总部', type: 'group', id: 'group' },
      ...all<{ id: string; name: string }>('SELECT id, name FROM companies ORDER BY name')
        .map((row) => ({ label: `公司 · ${row.name}`, type: 'company' as const, id: row.id })),
      ...all<{ id: string; name: string }>('SELECT id, name FROM production_bases ORDER BY name')
        .map((row) => ({ label: `基地 · ${row.name}`, type: 'base' as const, id: row.id })),
      ...all<{ id: string; name: string }>('SELECT id, name FROM factories WHERE status = ? ORDER BY sort_order, name', ['active'])
        .map((row) => ({ label: `饲料厂 · ${row.name}`, type: 'factory' as const, id: row.id })),
      ...all<{ id: string; base_id: string; name: string }>('SELECT id, base_id, name FROM work_areas ORDER BY name')
        .map((row) => ({ label: `工区 · ${row.name}`, type: 'work_area' as const, id: row.id })),
    ],
  }
}

export function listAccessAssignments(
  auth: AuthContext,
  accountId?: string,
): Array<{
  id: string
  accountId: string
  roleId: string
  roleCode: string
  roleName: string
  scope: ScopeRef
  validFrom: string | null
  validTo: string | null
}> {
  requireGroupCapability(auth, 'access.manage')
  return all<{
    id: string
    accountId: string
    roleId: string
    roleCode: string
    roleName: string
    type: ScopeRef['type']
    scopeId: string
    validFrom: string | null
    validTo: string | null
  }>(
    `SELECT ra.id, ra.account_id AS accountId, ra.role_id AS roleId,
            r.code AS roleCode, r.name AS roleName, ra.scope_type AS type,
            ra.scope_id AS scopeId, ra.valid_from AS validFrom, ra.valid_to AS validTo
       FROM role_assignments ra JOIN roles r ON r.id = ra.role_id
      WHERE (? IS NULL OR ra.account_id = ?)
      ORDER BY accountId, roleName`,
    [accountId ?? null, accountId ?? null],
  ).map((row) => ({
    id: row.id,
    accountId: row.accountId,
    roleId: row.roleId,
    roleCode: row.roleCode,
    roleName: row.roleName,
    scope: { type: row.type, id: row.scopeId },
    validFrom: row.validFrom,
    validTo: row.validTo,
  }))
}

export function createAccessAssignment(
  auth: AuthContext,
  input: {
    accountId: string
    roleId: string
    scope: ScopeRef
    validFrom?: string | null
    validTo?: string | null
  },
): string {
  requireGroupCapability(auth, 'access.manage')
  requireRow(one<IdRow>('SELECT id FROM accounts WHERE id = ? AND status = ?', [input.accountId, 'active']), '账号')
  requireRow(one<IdRow>('SELECT id FROM roles WHERE id = ?', [input.roleId]), '角色')
  validateScope(input.scope)
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) {
    throw AppError.badRequest('授权结束日期不能早于开始日期')
  }
  const duplicate = one<IdRow>(
    `SELECT id FROM role_assignments
      WHERE account_id = ? AND role_id = ? AND scope_type = ? AND scope_id = ? LIMIT 1`,
    [input.accountId, input.roleId, input.scope.type, input.scope.id],
  )
  if (duplicate) throw AppError.conflict('该账号在此范围已拥有相同角色')
  const id = newId('ra')
  run(
    `INSERT INTO role_assignments
      (id, account_id, role_id, scope_type, scope_id, valid_from, valid_to, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.accountId, input.roleId, input.scope.type, input.scope.id,
      input.validFrom ?? null, input.validTo ?? null, nowIso(), auth.accountId],
  )
  audit(auth, 'org.access.assignment.create', 'role_assignment', id,
    { type: 'group', id: 'group' }, undefined, input)
  return id
}

export function deleteAccessAssignment(auth: AuthContext, id: string): void {
  requireGroupCapability(auth, 'access.manage')
  const before = requireRow(
    one<{ id: string; account_id: string; role_id: string; scope_type: ScopeRef['type']; scope_id: string }>(
      `SELECT id, account_id, role_id, scope_type, scope_id FROM role_assignments WHERE id = ?`,
      [id],
    ),
    '授权记录',
  )
  run('DELETE FROM role_assignments WHERE id = ?', [id])
  audit(auth, 'org.access.assignment.delete', 'role_assignment', id,
    { type: 'group', id: 'group' }, before, undefined)
}

function validateScope(scope: ScopeRef): void {
  if (scope.type === 'group') return
  if (scope.type === 'company') return void getCompany(scope.id)
  if (scope.type === 'base') return void getBase(scope.id)
  if (scope.type === 'factory') return void getFactory(scope.id)
  void getArea(scope.id)
}

export function assertPermissionCoverage(auth: AuthContext, capability: Capability, scope: ScopeRef): void {
  if (!hasGrant(auth, capability, scope)) throw AppError.forbidden()
}
