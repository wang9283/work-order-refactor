import type { FastifyInstance } from 'fastify'
import {
  accessAssignmentSchema,
  companySchema,
  companyUpdateSchema,
  crewMemberEndSchema,
  crewMembershipSchema,
  crewSchema,
  crewUpdateSchema,
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
  workAreaSchema,
  workAreaUpdateSchema,
} from '../../../packages/contracts/src'
import { requireAuth } from '../../core/auth'
import { parseInput, success } from '../../core/http'
import {
  addCrewMember,
  archiveArea,
  archiveBase,
  archiveCompany,
  archiveCrew,
  archiveLine,
  archivePerson,
  archiveQualification,
  cancelSecondment,
  createAccessAssignment,
  createArea,
  createBase,
  createCompany,
  createCrew,
  createLine,
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
  listCrews,
  listLines,
  listPeople,
  listQualifications,
  listSecondments,
  listWorkAreas,
  readPerson,
  replacePersonQualifications,
  updateArea,
  updateBase,
  updateCompany,
  updateCrew,
  updateLine,
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

  app.get('/org/people', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    return paged(request, listPeople(auth, query))
  })

  app.get<{ Params: IdParams }>('/org/people/:id', async (request) => {
    const auth = requireAuth(request)
    return success(request, readPerson(auth, request.params.id))
  })

  app.get('/org/crews', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    return paged(request, listCrews(auth, query))
  })

  app.get<{ Params: CrewIdParams; Querystring: { asOf?: string } }>('/org/crews/:crewId/members', async (request) => {
    const auth = requireAuth(request)
    return success(request, listCrewMembers(auth, request.params.crewId, request.query.asOf))
  })

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
      secondmentSchema.partial().extend({ revision: revisionSchema.shape.revision }),
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
