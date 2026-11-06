import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { pageQuerySchema } from '../../../packages/contracts/src'
import { requireAuth } from '../../core/auth'
import { parseInput, success } from '../../core/http'
import {
  assignTicket,
  assignBusinessWorkItem,
  cancelTicket,
  closePayroll,
  confirmPayrollCompany,
  createPriceRule,
  createManualTicket,
  listEligibleCandidates,
  listPayrollAccruals,
  listPayrollConfirmCandidates,
  listPriceRules,
  listTickets,
  payrollSummary,
  readTicket,
  reopenPayroll,
  saveTicketValues,
  startTicket,
  submitTicket,
  approveTicket,
  setTicketPricing,
  setBusinessWorkItemPrice,
} from './repository'
import {
  assignTicketSchema,
  closePayrollSchema,
  confirmPayrollCompanySchema,
  executionQuerySchema,
  manualCreateTicketSchema,
  payrollQuerySchema,
  priceRuleSchema,
  saveTicketValuesSchema,
  submitTicketSchema,
  transitionSchema,
  ticketPricingSchema,
} from './schema'

type IdParams = { id: string }

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tickets', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(executionQuerySchema, request.query)
    const result = listTickets(auth, query)
    return success(request, result.items, result.meta)
  })

  app.get<{ Querystring: { siteId?: string; factoryId?: string; workAreaId?: string; productionLineId?: string; crewId?: string; eventTime?: string; workDate?: string } }>(
    '/tickets/candidates',
    async (request) => {
      const auth = requireAuth(request)
      const { siteId, workDate } = request.query
      if (!siteId || !workDate) return success(request, [])
      return success(request, listEligibleCandidates(auth, {
        siteId,
        factoryId: request.query.factoryId || null,
        workAreaId: request.query.workAreaId || null,
        productionLineId: request.query.productionLineId || null,
        crewId: request.query.crewId || null,
        eventTime: request.query.eventTime || `${workDate}T08:00:00+08:00`,
        workDate,
      }))
    },
  )

  app.get<{ Params: IdParams }>('/tickets/:id', async (request) => {
    const auth = requireAuth(request)
    return success(request, readTicket(auth, request.params.id))
  })

  app.post('/tickets', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(manualCreateTicketSchema, request.body)
    const created = createManualTicket(auth, input)
    return reply.status(201).send(success(request, created))
  })

  app.put<{ Params: IdParams }>('/tickets/:id/assignments', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(assignTicketSchema, request.body)
    return success(request, assignTicket(auth, request.params.id, input.assignments, input.revision))
  })

  app.put<{ Params: { id: string; workItemId: string } }>('/tickets/:id/business-work-items/:workItemId/assignments', async (request) => {
    const auth = requireAuth(request)
    const params = parseInput(z.object({ id: z.string().min(1), workItemId: z.string().min(1) }), request.params)
    const input = parseInput(z.object({
      revision: z.number().int().positive(),
      assignments: z.array(z.object({ personId: z.string().min(1), role: z.enum(['lead', 'member']),
        shareBasisPoints: z.number().int().min(0).max(10000) })).max(100),
    }), request.body)
    return success(request, assignBusinessWorkItem(auth, params.id, params.workItemId, input.assignments, input.revision))
  })

  app.put<{ Params: { id: string; workItemId: string } }>('/tickets/:id/business-work-items/:workItemId/pricing', async (request) => {
    const auth = requireAuth(request)
    const params = parseInput(z.object({ id: z.string().min(1), workItemId: z.string().min(1) }), request.params)
    const input = parseInput(z.object({ revision: z.number().int().positive(), priceRuleVersionId: z.string().min(1),
      reason: z.string().trim().min(1).max(1000) }), request.body)
    return success(request, setBusinessWorkItemPrice(auth, params.id, params.workItemId, input))
  })

  app.post<{ Params: IdParams }>('/tickets/:id/start', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(transitionSchema, request.body)
    return success(request, startTicket(auth, request.params.id, input.revision, input.note))
  })

  app.put<{ Params: IdParams }>('/tickets/:id/values', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(saveTicketValuesSchema, request.body)
    return success(request, saveTicketValues(
      auth, request.params.id, input.values, input.subFormValues,
      input.assignmentQuantities, input.revision, false,
    ))
  })

  app.post<{ Params: IdParams }>('/tickets/:id/submit', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(submitTicketSchema, request.body)
    return success(request, submitTicket(
      auth, request.params.id, input.values, input.subFormValues,
      input.assignmentQuantities, input.revision, input.quantity,
    ))
  })

  app.post<{ Params: IdParams }>('/tickets/:id/approve', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(transitionSchema, request.body)
    return success(request, approveTicket(auth, request.params.id, input.revision, input.note))
  })

  app.put<{ Params: IdParams }>('/tickets/:id/pricing', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(ticketPricingSchema, request.body)
    return success(request, setTicketPricing(auth, request.params.id, input))
  })

  app.post<{ Params: IdParams }>('/tickets/:id/cancel', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(transitionSchema, request.body)
    return success(request, cancelTicket(auth, request.params.id, input.revision, input.note))
  })

  app.get('/prices', async (request) => {
    const auth = requireAuth(request)
    const query = parseInput(pageQuerySchema, request.query)
    const result = listPriceRules(auth, query)
    return success(request, result.items, result.meta)
  })

  app.post('/prices', async (request, reply) => {
    const auth = requireAuth(request)
    const input = parseInput(priceRuleSchema, request.body)
    const created = createPriceRule(auth, input)
    return reply.status(201).send(success(request, created))
  })

  app.post('/payroll/confirm-company', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(confirmPayrollCompanySchema, request.body)
    confirmPayrollCompany(auth, input.workMonth, input.personIds, input.payrollCompanyId)
    return success(request, {
      workMonth: input.workMonth,
      personCount: input.personIds.length,
      payrollCompanyId: input.payrollCompanyId,
    })
  })

  app.get<{ Querystring: { workMonth?: string } }>('/payroll/confirm-candidates', async (request) => {
    const auth = requireAuth(request)
    const { workMonth } = parseInput(payrollQuerySchema, {
      workMonth: request.query.workMonth,
    })
    return success(request, listPayrollConfirmCandidates(auth, workMonth))
  })

  app.get<{ Querystring: { workMonth?: string; payrollCompanyId?: string } }>('/payroll/accruals', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(payrollQuerySchema, {
      workMonth: request.query.workMonth,
      payrollCompanyId: request.query.payrollCompanyId,
    })
    return success(request, listPayrollAccruals(auth, input.workMonth, input.payrollCompanyId))
  })

  app.get<{ Querystring: { workMonth?: string } }>('/payroll/summary', async (request) => {
    const auth = requireAuth(request)
    const { workMonth } = parseInput(payrollQuerySchema, {
      workMonth: request.query.workMonth,
    })
    return success(request, payrollSummary(auth, workMonth))
  })

  app.post('/payroll/close', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(closePayrollSchema, request.body)
    return success(request, closePayroll(
      auth, input.workMonth, input.revision, input.replaceAccruals, input.additionalAccruals,
    ))
  })

  app.post('/payroll/reopen', async (request) => {
    const auth = requireAuth(request)
    const input = parseInput(
      closePayrollSchema.pick({ workMonth: true, revision: true }),
      request.body,
    )
    return success(request, reopenPayroll(auth, input.workMonth, input.revision))
  })
}
