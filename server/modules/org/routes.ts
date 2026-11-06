import type { FastifyInstance } from 'fastify'
import {
  accessAssignmentSchema,
  companySchema,
  companyUpdateSchema,
  crewMemberEndSchema,
  crewMemberUpdateSchema,
  crewMembersBatchSchema,
  crewScopesSchema,
  crewMembershipSchema,
  crewSchema,
  crewUpdateSchema,
  factorySchema,
  factoryUpdateSchema,
  managementGroupSchema,
  managementGroupUpdateSchema,
  pageQuerySchema,
  personQualificationsSchema,
  personSchema,
  personUpdateSchema,
  productionBaseSchema,
  productionBaseUpdateSchema,
  productionLineSchema,
  productionLineUpdateSchema,
  qualificationSchema,
  qualificationUpdateSchema,
  revisionSchema,
  secondmentSchema,
  secondmentUpdateSchema,
  workAreaSchema,
  workAreaUpdateSchema,
} from '../../../packages/contracts/src'
import { requireAuth } from '../../core/auth'
import { parseInput, success } from '../../core/http'
import {
  addCrewMember,
  addCrewMembers,
  archiveArea,
  archiveBase,
  archiveCompany,
  archiveCrew,
  archiveFactory,
  archiveLine,
  archivePerson,
  archiveQualification,
  cancelSecondment,
  createAccessAssignment,
  createArea,
  createBase,
  createCompany,
  createCrew,
  createFactory,
  createLine,
  createManagementGroup,
  createPerson,
  createQualification,
  createSecondment,
  deleteAccessAssignment,
  endCrewMember,
  getOrgTree,
  listAccessAssignments,
  listAccessOptions,
  listBases,
  listCompaniesFor,
  listCrewMembers,
  listCrewScopes,
  listCrews,
  listFactories,
  listLines,
  listPeople,
  listPersonCrewRelations,
  listQualifications,
  listSecondments,
  listShiftTemplates,
  listWorkAreas,
  readPerson,
  replacePersonQualifications,
  replaceCrewScopes,
  updateArea,
  updateBase,
  updateCompany,
  updateCrew,
  updateCrewMember,
  updateFactory,
  updateLine,
  updateManagementGroup,
  updatePerson,
  updateQualification,
  updateSecondment,
} from './service'

type IdParams = { id: string }
type CrewIdParams = { crewId: string }

function paged<T>(request: Parameters<typeof success>[0], result: { items: T[]; meta: ReturnType<typeof import('../../../packages/contracts/src').toPageMeta> }) {
  return success(request, result.items, result.meta)
}

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  // ---------- read models ----------
  app.get('/org/tree', async (request) => {
    const auth = requireAuth(request)
    return success(request, getOrgTree(auth))
  })

  app.get('/org/companies', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    return paged(request, listCompaniesFor(auth, query))
  })

  app.get('/org/bases', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    return paged(request, listBases(auth, query))
  })

  app.get('/org/work-areas', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    return paged(request, listWorkAreas(auth, query))
  })

  app.get('/org/factories', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    return paged(request, listFactories(auth, query))
  })

  app.get('/org/production-lines', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    return paged(request, listLines(auth, query))
  })

  app.get('/org/qualifications', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    return paged(request, listQualifications(auth, query))
  })

  app.get('/org/shift-templates', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    return paged(request, listShiftTemplates(auth, query))
  })

  app.get('/org/people', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    return paged(request, listPeople(auth, query))
  })

  app.get<{ Params: IdParams }>('/org/people/:id', async (request) => {
    const auth = requireAuth(request)
    return success(request, readPerson(auth, request.params.id))
  })

  app.get<{ Params: IdParams }>('/org/people/:id/crew-relations', async (request) => {
    const auth = requireAuth(request)
    return success(request, listPersonCrewRelations(auth, request.params.id))
  })

  app.get('/org/crews', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    return paged(request, listCrews(auth, query))
  })

  app.get<{ Params: CrewIdParams; Querystring: { asOf?: string; all?: string } }>('/org/crews/:crewId/members', async (request) => {
    const auth = requireAuth(request)
    return success(request, listCrewMembers(auth, request.params.crewId, request.query.asOf, request.query.all === 'true'))
  })

  app.get<{ Params: CrewIdParams }>('/org/crews/:crewId/scopes', async (request) =>
    success(request, listCrewScopes(requireAuth(request), request.params.crewId)))

  app.put<{ Params: CrewIdParams }>('/org/crews/:crewId/scopes', async (request) =>
    success(request, replaceCrewScopes(requireAuth(request), request.params.crewId, parseInput(crewScopesSchema, request.body))))

  app.get('/org/secondments', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    return paged(request, listSecondments(auth, query))
  })

  app.get('/org/access/options', async (request) => {
    const auth = requireAuth(request)
    return success(request, listAccessOptions(auth))
  })

  app.get<{ Querystring: { accountId?: string } }>('/org/access/assignments', async (request) => {
    const auth = requireAuth(request)
    return success(request, listAccessAssignments(auth, request.query.accountId))
  })

  // ---------- companies ----------
  app.post('/org/management-groups', async (request, reply) => {
    const created = createManagementGroup(requireAuth(request), parseInput(managementGroupSchema, request.body))
    return reply.status(201).send(success(request, created))
  })
  app.put<{ Params: IdParams }>('/org/management-groups/:id', async (request) =>
    success(request, updateManagementGroup(requireAuth(request), request.params.id, parseInput(managementGroupUpdateSchema, request.body))))
  app.delete<{ Params: IdParams }>('/org/management-groups/:id', async (request) => {
    const { revision } = parseInput(revisionSchema, request.query)
    updateManagementGroup(requireAuth(request), request.params.id, { revision, status: 'archived' })
    return success(request, { id: request.params.id, archived: true })
  })

  app.post('/org/companies', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(companySchema, request.body)
    const created = createCompany(auth, input)
    return reply.status(201).send(success(request, created))
  })

  app.put<{ Params: IdParams }>('/org/companies/:id', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(companyUpdateSchema, request.body)
    return success(request, updateCompany(auth, request.params.id, input))
  })

  app.delete<{ Params: IdParams }>('/org/companies/:id', async (request) => {
    const auth = requireAuth(request)
    const { revision } = parseInput(revisionSchema, request.query)
    archiveCompany(auth, request.params.id, revision)
    return success(request, { id: request.params.id, archived: true })
  })

  // ---------- production bases ----------
  app.post('/org/bases', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(productionBaseSchema, request.body)
    const created = createBase(auth, input)
    return reply.status(201).send(success(request, created))
  })

  app.put<{ Params: IdParams }>('/org/bases/:id', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(productionBaseUpdateSchema, request.body)
    return success(request, updateBase(auth, request.params.id, input))
  })

  app.delete<{ Params: IdParams }>('/org/bases/:id', async (request) => {
    const auth = requireAuth(request)
    const { revision } = parseInput(revisionSchema, request.query)
    archiveBase(auth, request.params.id, revision)
    return success(request, { id: request.params.id, archived: true })
  })

  // ---------- work areas ----------
  app.post('/org/factories', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(factorySchema, request.body)
    const created = createFactory(auth, input)
    return reply.status(201).send(success(request, created))
  })

  app.put<{ Params: IdParams }>('/org/factories/:id', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(factoryUpdateSchema, request.body)
    return success(request, updateFactory(auth, request.params.id, input))
  })

  app.delete<{ Params: IdParams }>('/org/factories/:id', async (request) => {
    const auth = requireAuth(request)
    const { revision } = parseInput(revisionSchema, request.query)
    archiveFactory(auth, request.params.id, revision)
    return success(request, { id: request.params.id, archived: true })
  })

  app.post('/org/work-areas', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(workAreaSchema, request.body)
    const created = createArea(auth, input)
    return reply.status(201).send(success(request, created))
  })

  app.put<{ Params: IdParams }>('/org/work-areas/:id', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(workAreaUpdateSchema, request.body)
    return success(request, updateArea(auth, request.params.id, input))
  })

  app.delete<{ Params: IdParams }>('/org/work-areas/:id', async (request) => {
    const auth = requireAuth(request)
    const { revision } = parseInput(revisionSchema, request.query)
    archiveArea(auth, request.params.id, revision)
    return success(request, { id: request.params.id, archived: true })
  })

  // ---------- production lines ----------
  app.post('/org/production-lines', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(productionLineSchema, request.body)
    const created = createLine(auth, input)
    return reply.status(201).send(success(request, created))
  })

  app.put<{ Params: IdParams }>('/org/production-lines/:id', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(productionLineUpdateSchema, request.body)
    return success(request, updateLine(auth, request.params.id, input))
  })

  app.delete<{ Params: IdParams }>('/org/production-lines/:id', async (request) => {
    const auth = requireAuth(request)
    const { revision } = parseInput(revisionSchema, request.query)
    archiveLine(auth, request.params.id, revision)
    return success(request, { id: request.params.id, archived: true })
  })

  // ---------- qualifications ----------
  app.post('/org/qualifications', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(qualificationSchema, request.body)
    const created = createQualification(auth, input)
    return reply.status(201).send(success(request, created))
  })

  app.put<{ Params: IdParams }>('/org/qualifications/:id', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(qualificationUpdateSchema, request.body)
    return success(request, updateQualification(auth, request.params.id, input))
  })

  app.delete<{ Params: IdParams }>('/org/qualifications/:id', async (request) => {
    const auth = requireAuth(request)
    const { revision } = parseInput(revisionSchema, request.query)
    archiveQualification(auth, request.params.id, revision)
    return success(request, { id: request.params.id, archived: true })
  })

  // ---------- people ----------
  app.post('/org/people', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(personSchema, request.body)
    const created = createPerson(auth, input)
    return reply.status(201).send(success(request, created))
  })

  app.put<{ Params: IdParams }>('/org/people/:id', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(personUpdateSchema, request.body)
    return success(request, updatePerson(auth, request.params.id, input))
  })

  app.put<{ Params: IdParams }>('/org/people/:id/qualifications', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(personQualificationsSchema, request.body)
    return success(request, replacePersonQualifications(auth, request.params.id, input.qualifications))
  })

  app.delete<{ Params: IdParams }>('/org/people/:id', async (request) => {
    const auth = requireAuth(request)
    const { revision } = parseInput(revisionSchema, request.query)
    archivePerson(auth, request.params.id, revision)
    return success(request, { id: request.params.id, archived: true })
  })

  // ---------- crews ----------
  app.post('/org/crews', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(crewSchema, request.body)
    const created = createCrew(auth, input)
    return reply.status(201).send(success(request, created))
  })

  app.put<{ Params: IdParams }>('/org/crews/:id', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(crewUpdateSchema, request.body)
    return success(request, updateCrew(auth, request.params.id, input))
  })

  app.delete<{ Params: IdParams }>('/org/crews/:id', async (request) => {
    const auth = requireAuth(request)
    const { revision } = parseInput(revisionSchema, request.query)
    archiveCrew(auth, request.params.id, revision)
    return success(request, { id: request.params.id, archived: true })
  })

  app.post<{ Params: CrewIdParams }>('/org/crews/:crewId/members', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(crewMembershipSchema, request.body)
    const created = addCrewMember(auth, request.params.crewId, input)
    return reply.status(201).send(success(request, created))
  })

  app.post<{ Params: CrewIdParams }>('/org/crews/:crewId/members/batch', async (request, reply) => {
    const input = parseInput(crewMembersBatchSchema, request.body)
    return reply.status(201).send(success(request, addCrewMembers(requireAuth(request), request.params.crewId, input.members)))
  })

  app.put<{ Params: IdParams }>('/org/crew-members/:id', async (request) =>
    success(request, updateCrewMember(requireAuth(request), request.params.id, parseInput(crewMemberUpdateSchema, request.body))))

  app.put<{ Params: IdParams }>('/org/crew-members/:id/end', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(crewMemberEndSchema, request.body)
    return success(request, endCrewMember(auth, request.params.id, input.endDate, input.revision))
  })

  // ---------- secondments ----------
  app.post('/org/secondments', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(secondmentSchema, request.body)
    const created = createSecondment(auth, input)
    return reply.status(201).send(success(request, created))
  })

  app.put<{ Params: IdParams }>('/org/secondments/:id', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(
      secondmentUpdateSchema,
      request.body,
    )
    return success(request, updateSecondment(auth, request.params.id, input))
  })

  app.delete<{ Params: IdParams }>('/org/secondments/:id', async (request) => {
    const auth = requireAuth(request)
    const { revision } = parseInput(revisionSchema, request.query)
    cancelSecondment(auth, request.params.id, revision)
    return success(request, { id: request.params.id, cancelled: true })
  })

  // ---------- access assignments ----------
  app.post('/org/access/assignments', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(accessAssignmentSchema, request.body)
    const id = createAccessAssignment(auth, input)
    return reply.status(201).send(success(request, { id }))
  })

  app.delete<{ Params: IdParams }>('/org/access/assignments/:id', async (request) => {
    const auth = requireAuth(request)
    deleteAccessAssignment(auth, request.params.id)
    return success(request, { id: request.params.id, deleted: true })
  })
}
