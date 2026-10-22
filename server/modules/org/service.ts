import type {
  ActiveStatus,
  Capability,
  Company,
  Crew,
  CrewMembership,
  CrewMemberRole,
  OrgReferenceData,
  PageQuery,
  PagedResult,
  Person,
  PersonQualification,
  ProductionBase,
  ProductionLine,
  Qualification,
  ScopeRef,
  Secondment,
  SecondmentStatus,
  WorkArea,
} from '../../../packages/contracts/src'
import { toPageMeta } from '../../../packages/contracts/src'
import { writeAudit } from '../../core/audit'
import type { AuthContext } from '../../core/auth'
import { AppError } from '../../core/errors'
import { newId, nowIso, one, run, transaction } from '../../db/database'
import { all } from '../../db/database'

type SqlValue = string | number | null
type IdRow = { id: string }
type RevisionRow = { revision: number }
type StatusRow = { status: string }

const activeStatuses = new Set<ActiveStatus>(['active', 'inactive', 'archived'])
const crewRoles = new Set<CrewMemberRole>(['leader', 'operator', 'support'])
const secondmentStatuses = new Set<SecondmentStatus>([
  'planned',
  'active',
  'completed',
  'cancelled',
])

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
  if (auth.grants.some((grant) => grant.type === 'group')) return null

  const ids = new Set<string>()
  for (const grant of auth.grants) {
    if (grant.type === 'company') {
      all<IdRow>('SELECT id FROM production_bases WHERE company_id = ?', [grant.id])
        .forEach((row) => ids.add(row.id))
    } else if (grant.type === 'base') {
      ids.add(grant.id)
    } else if (grant.type === 'work_area') {
      const row = one<{ base_id: string }>('SELECT base_id FROM work_areas WHERE id = ?', [grant.id])
      if (row) ids.add(row.base_id)
    }
  }
  return ids
}

function canAccessBase(auth: AuthContext, capability: Capability, baseId: string): boolean {
  const scope = { type: 'base' as const, id: baseId }
  return auth.grants.some((grant) => {
    if (grant.capability !== capability) return false
    if (grant.type === 'group') return true
    if (grant.type === 'base') return grant.id === baseId
    if (grant.type === 'company') {
      const base = one<{ company_id: string }>('SELECT company_id FROM production_bases WHERE id = ?', [baseId])
      return base?.company_id === grant.id
    }
    if (grant.type === 'work_area') {
      const area = one<{ base_id: string }>('SELECT base_id FROM work_areas WHERE id = ?', [grant.id])
      return area?.base_id === baseId
    }
    return scope.id === grant.id
  })
}

function requireBaseCapability(auth: AuthContext, capability: Capability, baseId: string): void {
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
  return all<ProductionBase>(
    `SELECT id, code, name, company_id AS companyId, address, status, revision,
            created_at AS createdAt, created_by AS createdBy,
            updated_at AS updatedAt, updated_by AS updatedBy
       FROM production_bases
      ORDER BY name`,
  ).filter((base) => visible === null || visible.has(base.id))
}

function getBase(id: string): ProductionBase {
  return requireRow(
    one<ProductionBase>(
      `SELECT id, code, name, company_id AS companyId, address, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM production_bases WHERE id = ?`,
      [id],
    ),
    '作业基地',
  )
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
      `SELECT id, code, name, base_id AS baseId, parent_id AS parentId,
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

function getCrew(id: string): Crew {
  return requireRow(
    one<Crew>(
      `SELECT id, code, name, base_id AS baseId, work_area_id AS workAreaId,
              leader_person_id AS leaderPersonId, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM crews WHERE id = ?`,
      [id],
    ),
    '班组',
  )
}

function getPerson(id: string): Person {
  const row = requireRow(
    one<Omit<Person, 'qualifications'>>(
      `SELECT id, employee_code AS employeeCode, name, mobile,
              home_company_id AS homeCompanyId, home_base_id AS homeBaseId,
              status, revision, created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM people WHERE id = ?`,
      [id],
    ),
    '人员',
  )
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
  return { ...row, qualifications }
}

function getSecondment(id: string): Secondment {
  return requireRow(
    one<Secondment>(
      `SELECT id, person_id AS personId, from_company_id AS fromCompanyId,
              from_base_id AS fromBaseId, to_company_id AS toCompanyId,
              to_base_id AS toBaseId, start_date AS startDate, end_date AS endDate,
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
    if (group) throw AppError.conflict('当前系统只允许一个集团根公司')
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
  if (before.isGroup && input.status === 'archived') throw AppError.conflict('集团根公司不能归档')
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
  if (before.isGroup) throw AppError.conflict('集团根公司不能归档')
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
      (id, code, name, company_id, address, status, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
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
  input: Partial<Pick<ProductionBase, 'code' | 'name' | 'companyId' | 'address' | 'status' | 'revision'>>,
): ProductionBase {
  requireBaseCapability(auth, 'org.manage', id)
  const before = getBase(id)
  assertRevision(before, input.revision, '作业基地')
  if (input.companyId) getCompany(input.companyId)
  if (input.status) assertActiveStatus(input.status)
  run(
    `UPDATE production_bases SET code = ?, name = ?, company_id = ?, address = ?,
       status = ?, revision = revision + 1, updated_at = ?, updated_by = ?
     WHERE id = ? AND revision = ?`,
    [input.code ?? before.code, input.name ?? before.name, input.companyId ?? before.companyId,
      input.address ?? before.address, input.status ?? before.status, nowIso(), auth.accountId,
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
    one<IdRow>(`SELECT id FROM work_areas WHERE base_id = ? AND status <> 'archived' LIMIT 1`, [id])
    ?? one<IdRow>(`SELECT id FROM production_lines WHERE base_id = ? AND status <> 'archived' LIMIT 1`, [id])
    ?? one<IdRow>(`SELECT id FROM crews WHERE base_id = ? AND status <> 'archived' LIMIT 1`, [id])
    ?? one<IdRow>(`SELECT id FROM secondments WHERE to_base_id = ? AND status IN ('planned', 'active') LIMIT 1`, [id])
  if (reference) throw AppError.referenceConflict('基地仍被工区、产线、班组或借调引用')
  updateBase(auth, id, { revision, status: 'archived' })
}

export function listWorkAreas(
  auth: AuthContext,
  query: PageQuery,
): PagedResult<WorkArea> {
  const visible = accessibleBaseIds(auth)
  const rows = all<WorkArea>(
    `SELECT id, code, name, base_id AS baseId, parent_id AS parentId,
            manager_person_id AS managerPersonId, status, revision,
            created_at AS createdAt, created_by AS createdBy,
            updated_at AS updatedAt, updated_by AS updatedBy
       FROM work_areas ORDER BY name`,
  ).filter((row) =>
    (visible === null || visible.has(row.baseId))
    && (!query.siteId || row.baseId === query.siteId)
    && (!query.workAreaId || row.id === query.workAreaId)
    && (!query.status || row.status === query.status)
    && (!query.q || contains(row.name, query.q) || contains(row.code, query.q)),
  )
  return pageResult(rows, query)
}

export function createArea(
  auth: AuthContext,
  input: Pick<WorkArea, 'code' | 'name' | 'baseId' | 'parentId' | 'managerPersonId' | 'status'>,
): WorkArea {
  requireBaseCapability(auth, 'org.manage', input.baseId)
  if (input.parentId) {
    const parent = getArea(input.parentId)
    if (parent.baseId !== input.baseId) throw AppError.badRequest('上级工区必须属于同一基地')
  }
  if (input.managerPersonId) getPerson(input.managerPersonId)
  if (input.status) assertActiveStatus(input.status)
  const id = newId('area')
  const ts = nowIso()
  run(
    `INSERT INTO work_areas
      (id, code, name, base_id, parent_id, manager_person_id, status, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, input.code, input.name, input.baseId, input.parentId, input.managerPersonId,
      input.status, ts, auth.accountId, ts, auth.accountId],
  )
  const created = getArea(id)
  audit(auth, 'org.area.create', 'work_area', id, { type: 'base', id: input.baseId }, undefined, created)
  return created
}

export function updateArea(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<WorkArea, 'code' | 'name' | 'parentId' | 'managerPersonId' | 'status' | 'revision'>>,
): WorkArea {
  const before = getArea(id)
  requireBaseCapability(auth, 'org.manage', before.baseId)
  assertRevision(before, input.revision, '工区')
  const parentId = input.parentId === undefined ? before.parentId : input.parentId
  if (parentId === id) throw AppError.badRequest('工区不能把自己设为上级')
  if (parentId) {
    const parent = getArea(parentId)
    if (parent.baseId !== before.baseId) throw AppError.badRequest('上级工区必须属于同一基地')
    if (isAreaDescendant(parentId, id)) throw AppError.badRequest('不能把下级工区设为上级')
  }
  if (input.managerPersonId) getPerson(input.managerPersonId)
  if (input.status) assertActiveStatus(input.status)
  run(
    `UPDATE work_areas SET code = ?, name = ?, parent_id = ?, manager_person_id = ?,
       status = ?, revision = revision + 1, updated_at = ?, updated_by = ?
     WHERE id = ? AND revision = ?`,
    [input.code ?? before.code, input.name ?? before.name, parentId,
      input.managerPersonId === undefined ? before.managerPersonId : input.managerPersonId,
      input.status ?? before.status, nowIso(), auth.accountId, id, before.revision],
  )
  const updated = getArea(id)
  audit(auth, 'org.area.update', 'work_area', id, { type: 'base', id: before.baseId }, before, updated)
  return updated
}

export function archiveArea(auth: AuthContext, id: string, revision: number): void {
  const before = getArea(id)
  requireBaseCapability(auth, 'org.manage', before.baseId)
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
  const visible = accessibleBaseIds(auth)
  return pageResult(
    all<ProductionLine>(
      `SELECT id, code, name, base_id AS baseId, work_area_id AS workAreaId,
              status, revision, created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM production_lines ORDER BY name`,
    ).filter((row) =>
      (visible === null || visible.has(row.baseId))
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
  requireBaseCapability(auth, 'org.manage', input.baseId)
  const area = getArea(input.workAreaId)
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
  requireBaseCapability(auth, 'org.manage', before.baseId)
  assertRevision(before, input.revision, '产线')
  const workAreaId = input.workAreaId ?? before.workAreaId
  if (getArea(workAreaId).baseId !== before.baseId) throw AppError.badRequest('产线所属工区必须属于同一基地')
  if (input.status) assertActiveStatus(input.status)
  run(
    `UPDATE production_lines SET code = ?, name = ?, work_area_id = ?, status = ?,
       revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
    [input.code ?? before.code, input.name ?? before.name, workAreaId,
      input.status ?? before.status, nowIso(), auth.accountId, id, before.revision],
  )
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
  const baseIds = visible === null
    ? all<IdRow>('SELECT id FROM production_bases')
        .filter((row) => canAccessBase(auth, 'person.view', row.id))
        .map((row) => row.id)
    : [...visible].filter((id) => canAccessBase(auth, 'person.view', id))
  const ids = all<IdRow>(
    `SELECT id FROM people ORDER BY employee_code`,
  ).filter((row) => {
    const person = one<{ home_base_id: string }>('SELECT home_base_id FROM people WHERE id = ?', [row.id])
    return person && baseIds.includes(person.home_base_id)
  }).map((row) => row.id)
  const items = ids
    .map(getPerson)
    .filter((row) =>
      (!query.companyId || row.homeCompanyId === query.companyId)
      && (!query.siteId || row.homeBaseId === query.siteId)
      && (!query.status || row.status === query.status)
      && (!query.q || contains(row.name, query.q) || contains(row.employeeCode, query.q)),
    )
  return pageResult(items, query)
}

export function createPerson(
  auth: AuthContext,
  input: Pick<Person, 'employeeCode' | 'name' | 'mobile' | 'homeCompanyId' | 'homeBaseId' | 'status'>,
): Person {
  requireBaseCapability(auth, 'person.manage', input.homeBaseId)
  const base = getBase(input.homeBaseId)
  if (base.companyId !== input.homeCompanyId) throw AppError.badRequest('人员所属公司与归属基地不一致')
  if (input.status) assertActiveStatus(input.status)
  const id = newId('person')
  const ts = nowIso()
  run(
    `INSERT INTO people
      (id, employee_code, name, mobile, home_company_id, home_base_id, status, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, input.employeeCode, input.name, input.mobile, input.homeCompanyId, input.homeBaseId,
      input.status, ts, auth.accountId, ts, auth.accountId],
  )
  const created = getPerson(id)
  audit(auth, 'org.person.create', 'person', id, { type: 'base', id: input.homeBaseId }, undefined, created)
  return created
}

/** Single-person read used by GET /org/people/:id; keeps list and detail scopes consistent. */
export function readPerson(auth: AuthContext, id: string): Person {
  const person = getPerson(id)
  requireBaseCapability(auth, 'person.view', person.homeBaseId)
  return person
}

export function updatePerson(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<Person, 'employeeCode' | 'name' | 'mobile' | 'homeCompanyId' | 'homeBaseId' | 'status' | 'revision'>>,
): Person {
  const before = getPerson(id)
  requireBaseCapability(auth, 'person.manage', before.homeBaseId)
  assertRevision(before, input.revision, '人员')
  const homeBaseId = input.homeBaseId ?? before.homeBaseId
  const homeCompanyId = input.homeCompanyId ?? before.homeCompanyId
  if (getBase(homeBaseId).companyId !== homeCompanyId) throw AppError.badRequest('人员所属公司与归属基地不一致')
  if (input.status) assertActiveStatus(input.status)
  run(
    `UPDATE people SET employee_code = ?, name = ?, mobile = ?, home_company_id = ?,
       home_base_id = ?, status = ?, revision = revision + 1, updated_at = ?, updated_by = ?
     WHERE id = ? AND revision = ?`,
    [input.employeeCode ?? before.employeeCode, input.name ?? before.name,
      input.mobile ?? before.mobile, homeCompanyId, homeBaseId,
      input.status ?? before.status, nowIso(), auth.accountId, id, before.revision],
  )
  const updated = getPerson(id)
  audit(auth, 'org.person.update', 'person', id, { type: 'base', id: before.homeBaseId }, before, updated)
  return updated
}

export function archivePerson(auth: AuthContext, id: string, revision: number): void {
  const before = getPerson(id)
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
  requireBaseCapability(auth, 'person.manage', person.homeBaseId)
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
  return pageResult(
    all<Crew>(
      `SELECT id, code, name, base_id AS baseId, work_area_id AS workAreaId,
              leader_person_id AS leaderPersonId, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM crews ORDER BY name`,
    ).filter((row) =>
      (visible === null || visible.has(row.baseId))
      && (!query.siteId || row.baseId === query.siteId)
      && (!query.workAreaId || row.workAreaId === query.workAreaId)
      && (!query.status || row.status === query.status)
      && (!query.q || contains(row.name, query.q) || contains(row.code, query.q)),
    ),
    query,
  )
}

export function createCrew(
  auth: AuthContext,
  input: Pick<Crew, 'code' | 'name' | 'baseId' | 'workAreaId' | 'leaderPersonId' | 'status'>,
): Crew {
  requireBaseCapability(auth, 'crew.manage', input.baseId)
  if (getArea(input.workAreaId).baseId !== input.baseId) throw AppError.badRequest('班组工区必须属于同一基地')
  if (input.leaderPersonId) getPerson(input.leaderPersonId)
  if (input.status) assertActiveStatus(input.status)
  const id = newId('crew')
  const ts = nowIso()
  run(
    `INSERT INTO crews
      (id, code, name, base_id, work_area_id, leader_person_id, status, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, input.code, input.name, input.baseId, input.workAreaId, input.leaderPersonId,
      input.status, ts, auth.accountId, ts, auth.accountId],
  )
  const created = getCrew(id)
  audit(auth, 'org.crew.create', 'crew', id, { type: 'base', id: input.baseId }, undefined, created)
  return created
}

export function updateCrew(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<Crew, 'code' | 'name' | 'workAreaId' | 'leaderPersonId' | 'status' | 'revision'>>,
): Crew {
  const before = getCrew(id)
  requireBaseCapability(auth, 'crew.manage', before.baseId)
  assertRevision(before, input.revision, '班组')
  const workAreaId = input.workAreaId ?? before.workAreaId
  if (getArea(workAreaId).baseId !== before.baseId) throw AppError.badRequest('班组工区必须属于同一基地')
  if (input.leaderPersonId) getPerson(input.leaderPersonId)
  if (input.status) assertActiveStatus(input.status)
  run(
    `UPDATE crews SET code = ?, name = ?, work_area_id = ?, leader_person_id = ?, status = ?,
       revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
    [input.code ?? before.code, input.name ?? before.name, workAreaId,
      input.leaderPersonId === undefined ? before.leaderPersonId : input.leaderPersonId,
      input.status ?? before.status, nowIso(), auth.accountId, id, before.revision],
  )
  const updated = getCrew(id)
  audit(auth, 'org.crew.update', 'crew', id, { type: 'base', id: before.baseId }, before, updated)
  return updated
}

export function archiveCrew(auth: AuthContext, id: string, revision: number): void {
  const before = getCrew(id)
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
): CrewMembership[] {
  const crew = getCrew(crewId)
  requireBaseCapability(auth, 'crew.view', crew.baseId)
  const date = asOf ?? new Date().toISOString().slice(0, 10)
  return all<CrewMembership>(
    `SELECT id, crew_id AS crewId, person_id AS personId, role,
            valid_from AS validFrom, valid_to AS validTo, revision,
            created_at AS createdAt, created_by AS createdBy,
            updated_at AS updatedAt, updated_by AS updatedBy
       FROM crew_memberships
      WHERE crew_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)
      ORDER BY role, valid_from`,
    [crewId, date, date],
  )
}

export function addCrewMember(
  auth: AuthContext,
  crewId: string,
  input: Pick<CrewMembership, 'personId' | 'role' | 'validFrom' | 'validTo'>,
): CrewMembership {
  const crew = getCrew(crewId)
  requireBaseCapability(auth, 'crew.manage', crew.baseId)
  getPerson(input.personId)
  assertCrewRole(input.role)
  if (input.validTo && input.validTo < input.validFrom) throw AppError.badRequest('失效日期不能早于生效日期')
  const overlap = one<IdRow>(
    `SELECT id FROM crew_memberships
      WHERE crew_id = ? AND person_id = ?
        AND valid_from <= COALESCE(?, '9999-12-31')
        AND (valid_to IS NULL OR valid_to >= ?) LIMIT 1`,
    [crewId, input.personId, input.validTo, input.validFrom],
  )
  if (overlap) throw AppError.conflict('该人员在所选日期内已属于本班组')
  const id = newId('cm')
  const ts = nowIso()
  transaction(() => {
    run(
      `INSERT INTO crew_memberships
        (id, crew_id, person_id, role, valid_from, valid_to, revision,
         created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [id, crewId, input.personId, input.role, input.validFrom, input.validTo,
        ts, auth.accountId, ts, auth.accountId],
    )
    run(
      `UPDATE crews SET revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?`,
      [ts, auth.accountId, crewId],
    )
  })
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
  requireBaseCapability(auth, 'crew.manage', crew.baseId)
  assertRevision(before, revision, '班组成员')
  if (endDate < before.validFrom) throw AppError.badRequest('结束日期不能早于生效日期')
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
  const visible = accessibleBaseIds(auth)
  return pageResult(
    all<Secondment>(
      `SELECT id, person_id AS personId, from_company_id AS fromCompanyId,
              from_base_id AS fromBaseId, to_company_id AS toCompanyId,
              to_base_id AS toBaseId, start_date AS startDate, end_date AS endDate,
              purpose, status, approved_by AS approvedBy, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM secondments ORDER BY start_date DESC`,
    ).filter((row) =>
      (visible === null || visible.has(row.fromBaseId) || visible.has(row.toBaseId))
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
  const person = getPerson(input.personId)
  if (input.fromCompanyId !== person.homeCompanyId || input.fromBaseId !== person.homeBaseId) {
    throw AppError.badRequest('借调来源必须与人员当前归属一致')
  }
  requireBaseCapability(auth, 'secondment.manage', input.toBaseId)
  if (getBase(input.toBaseId).companyId !== input.toCompanyId) {
    throw AppError.badRequest('接收公司与接收基地不一致')
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
      (id, person_id, from_company_id, from_base_id, to_company_id, to_base_id,
       start_date, end_date, purpose, status, approved_by, revision,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [id, input.personId, input.fromCompanyId, input.fromBaseId, input.toCompanyId,
      input.toBaseId, input.startDate, input.endDate, input.purpose, input.status,
      input.approvedBy ?? null, ts, auth.accountId, ts, auth.accountId],
  )
  const created = getSecondment(id)
  audit(auth, 'org.secondment.create', 'secondment', id, { type: 'base', id: input.toBaseId }, undefined, created)
  return created
}

export function updateSecondment(
  auth: AuthContext,
  id: string,
  input: Partial<Pick<Secondment, 'startDate' | 'endDate' | 'purpose' | 'status' | 'approvedBy' | 'revision'>>,
): Secondment {
  const before = getSecondment(id)
  requireBaseCapability(auth, 'secondment.manage', before.toBaseId)
  assertRevision(before, input.revision, '借调记录')
  const startDate = input.startDate ?? before.startDate
  const endDate = input.endDate ?? before.endDate
  if (endDate < startDate) throw AppError.badRequest('借调结束日期不能早于开始日期')
  if (input.status) assertSecondmentStatus(input.status)
  run(
    `UPDATE secondments SET start_date = ?, end_date = ?, purpose = ?, status = ?,
       approved_by = ?, revision = revision + 1, updated_at = ?, updated_by = ?
     WHERE id = ? AND revision = ?`,
    [startDate, endDate, input.purpose ?? before.purpose, input.status ?? before.status,
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
  return {
    companies: listCompaniesFor(auth, query).items,
    bases: listBases(auth, query).items,
    workAreas: listWorkAreas(auth, query).items,
    productionLines: listLines(auth, query).items,
    crews: listCrews(auth, query).items,
    qualifications: listQualifications(auth, query).items,
  }
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
      { label: '全集团', type: 'group', id: 'group' },
      ...all<{ id: string; name: string }>('SELECT id, name FROM companies ORDER BY name')
        .map((row) => ({ label: `公司 · ${row.name}`, type: 'company' as const, id: row.id })),
      ...all<{ id: string; name: string }>('SELECT id, name FROM production_bases ORDER BY name')
        .map((row) => ({ label: `基地 · ${row.name}`, type: 'base' as const, id: row.id })),
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
  void getArea(scope.id)
}

export function assertPermissionCoverage(auth: AuthContext, capability: Capability, scope: ScopeRef): void {
  if (!auth.grants.some((grant) => {
    if (grant.capability !== capability) return false
    if (grant.type === 'group' || grant.id === scope.id && grant.type === scope.type) return true
    if (grant.type === 'company') {
      if (scope.type === 'base') return getBase(scope.id).companyId === grant.id
      if (scope.type === 'work_area') return getBase(getArea(scope.id).baseId).companyId === grant.id
    }
    if (grant.type === 'base') {
      if (scope.type === 'work_area') return getArea(scope.id).baseId === grant.id
      if (scope.type === 'base') return scope.id === grant.id
    }
    return false
  })) throw AppError.forbidden()
}
