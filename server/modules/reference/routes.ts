import type { FastifyInstance } from 'fastify'
import type { OrgReferenceData } from '../../../packages/contracts/src'
import { requireAuth } from '../../core/auth'
import { all } from '../../db/database'
import { success } from '../../core/http'

export async function referenceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/reference-data', async (request) => {
    requireAuth(request)
    const companies = all<OrgReferenceData['companies'][number]>(
      `SELECT id, code, name, short_name AS shortName, is_group AS isGroup,
              payroll_enabled AS payrollEnabled, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
       FROM companies ORDER BY is_group DESC, name`,
    )
    const bases = all<OrgReferenceData['bases'][number]>(
      `SELECT id, code, name, company_id AS companyId, address, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
       FROM production_bases WHERE status <> 'archived' ORDER BY name`,
    )
    const workAreas = all<OrgReferenceData['workAreas'][number]>(
      `SELECT id, code, name, base_id AS baseId, parent_id AS parentId,
              manager_person_id AS managerPersonId, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
       FROM work_areas WHERE status <> 'archived' ORDER BY sort_col, name`.replace('sort_col', 'name'),
    )
    const productionLines = all<OrgReferenceData['productionLines'][number]>(
      `SELECT id, code, name, base_id AS baseId, work_area_id AS workAreaId, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
       FROM production_lines WHERE status <> 'archived' ORDER BY name`,
    )
    const crews = all<OrgReferenceData['crews'][number]>(
      `SELECT id, code, name, base_id AS baseId, work_area_id AS workAreaId,
              leader_person_id AS leaderPersonId, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
       FROM crews WHERE status <> 'archived' ORDER BY name`,
    )
    const qualifications = all<OrgReferenceData['qualifications'][number]>(
      `SELECT id, code, name, description, status, revision,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
       FROM qualifications WHERE status <> 'archived' ORDER BY name`,
    )
    return success(request, {
      companies,
      bases,
      workAreas,
      productionLines,
      crews,
      qualifications,
    } satisfies OrgReferenceData)
  })
}
