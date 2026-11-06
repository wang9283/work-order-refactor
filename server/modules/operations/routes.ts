import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../core/auth'
import { parseInput,success } from '../../core/http'
import { context,rosters,saveRosters } from './service'
import { workloads,readTicket,demoSync } from './workloads'
import { adjustAssignments,confirm,feedback,createFeedback,resolveFeedback,exportWorkloads } from './allocations'
import { selfCreate,completeSelf } from './self-orders'
import { assignmentRules,saveAssignmentRule,rosterCandidates,saveShift,sanitationSummary } from './dispatch'
import { createSanitation,demoAssets,startSanitation,addEvidence,startArea,completeArea,completeSanitation } from './sanitation'

const querySchema=z.object({dateFrom:z.iso.date().optional(),dateTo:z.iso.date().optional(),crewId:z.string().min(1).optional(),scope:z.enum(['mine','managed']).optional(),ticketTypeId:z.string().optional(),status:z.string().optional(),plateNumber:z.string().trim().max(30).optional()})
const saveRosterSchema=z.object({mode:z.enum(['monthly','daily']),records:z.array(z.object({workDate:z.iso.date(),shiftTemplateId:z.string().min(1),crewId:z.string().min(1),revision:z.number().int().nonnegative(),note:z.string().trim().max(500).optional(),assignments:z.array(z.object({personId:z.string().min(1),postId:z.string().min(1).nullable()})).max(200)})).min(1).max(62)})
const valuesSchema=z.record(z.string(),z.unknown())
const subFormsSchema=z.record(z.string(),z.array(valuesSchema)).optional()
export async function operationsRoutes(app:FastifyInstance):Promise<void> {
  app.get('/context',async request=>success(request,context(requireAuth(request))))
  app.get('/rosters',async request=>success(request,rosters(requireAuth(request),parseInput(querySchema,request.query))))
  app.put('/rosters',async request=>success(request,saveRosters(requireAuth(request),parseInput(saveRosterSchema,request.body))))
  app.get('/assignment-rules',async request=>success(request,assignmentRules(requireAuth(request))))
  app.put('/assignment-rules',async request=>success(request,saveAssignmentRule(requireAuth(request),parseInput(z.object({siteId:z.string().min(1),ticketTypeId:z.string().min(1),crewId:z.string().min(1),revision:z.number().int().nonnegative()}).strict(),request.body))))
  app.get('/roster-candidates',async request=>{const input=parseInput(z.object({crewId:z.string().min(1),workDate:z.iso.date()}),request.query);return success(request,rosterCandidates(requireAuth(request),input.crewId,input.workDate))})
  app.get('/sanitation-summary',async request=>success(request,sanitationSummary(requireAuth(request),parseInput(querySchema,request.query))))
  app.post('/shifts',async request=>success(request,saveShift(requireAuth(request),parseInput(z.object({siteId:z.string().min(1),code:z.string().trim().min(1).max(60).optional(),name:z.string().trim().min(1).max(80),startTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),endTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),status:z.enum(['active','inactive']),revision:z.literal(0)}).strict(),request.body))))
  app.put<{Params:{id:string}}>('/shifts/:id',async request=>success(request,saveShift(requireAuth(request),{...parseInput(z.object({name:z.string().trim().min(1).max(80),startTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),endTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),status:z.enum(['active','inactive']),revision:z.number().int().positive()}).strict(),request.body),id:request.params.id})))
  app.post('/sanitation',async request=>success(request,createSanitation(requireAuth(request),parseInput(z.object({kind:z.enum(['vehicle','facility']),workDate:z.iso.date(),plateNumber:z.string().trim().max(30).optional(),clientRequestId:z.string().trim().min(1).max(160)}).strict(),request.body))))
  app.get('/demo-assets',async request=>success(request,demoAssets(parseInput(z.object({kind:z.enum(['vehicle','facility'])}),request.query).kind)))
  app.post<{Params:{id:string}}>('/tickets/:id/start-sanitation',async request=>success(request,startSanitation(requireAuth(request),request.params.id,parseInput(z.object({revision:z.number().int().positive()}).strict(),request.body).revision)))
  app.post<{Params:{id:string}}>('/tickets/:id/evidence',async request=>success(request,addEvidence(requireAuth(request),request.params.id,parseInput(z.object({revision:z.number().int().positive(),pointKey:z.string().trim().min(1).max(100),assetId:z.string().trim().min(1).max(200)}).strict(),request.body))))
  app.post<{Params:{id:string;area:string}}>('/tickets/:id/areas/:area/start',async request=>{const input=parseInput(z.object({revision:z.number().int().positive(),areaKey:z.enum(['production','living','office']).optional()}).strict(),request.body);return success(request,startArea(requireAuth(request),request.params.id,request.params.area as 'production'|'living'|'office',input.revision))})
  app.post<{Params:{id:string;area:string}}>('/tickets/:id/areas/:area/complete',async request=>{const input=parseInput(z.object({revision:z.number().int().positive(),areaKey:z.enum(['production','living','office']).optional()}).strict(),request.body);return success(request,completeArea(requireAuth(request),request.params.id,request.params.area as 'production'|'living'|'office',input.revision))})
  app.post<{Params:{id:string}}>('/tickets/:id/complete-sanitation',async request=>success(request,completeSanitation(requireAuth(request),request.params.id,parseInput(z.object({revision:z.number().int().positive(),dryingRequired:z.boolean().optional(),dryingStartedAt:z.string().max(80).optional(),dryingEndedAt:z.string().max(80).optional()}).strict(),request.body))))
  app.get('/workloads',async request=>success(request,workloads(requireAuth(request),parseInput(querySchema,request.query))))
  app.get<{Params:{id:string}}>('/tickets/:id',async request=>success(request,readTicket(requireAuth(request),request.params.id)))
  app.post('/demo-sync',async request=>success(request,demoSync(requireAuth(request),parseInput(z.object({sourceKey:z.string().trim().min(1).max(160),businessKind:z.enum(['production','loading']),workDate:z.iso.date(),crewId:z.string().min(1),shiftTemplateId:z.string().min(1),quantity:z.number().finite().nonnegative(),materialId:z.string().optional(),loadingTypeId:z.string().optional()}).strict(),request.body))))
  app.put<{Params:{id:string;itemId:string}}>('/tickets/:id/items/:itemId/assignments',async request=>success(request,adjustAssignments(requireAuth(request),request.params.id,request.params.itemId,parseInput(z.object({revision:z.number().int().positive(),reason:z.string().trim().min(1).max(1000),assignments:z.array(z.object({personId:z.string().min(1),shareBasisPoints:z.number().int().min(0).max(10000)})).min(1).max(100)}).strict(),request.body))))
  app.post('/confirmations',async request=>success(request,confirm(requireAuth(request),parseInput(z.object({ticketIds:z.array(z.string().min(1)).min(1).max(100)}).strict(),request.body).ticketIds)))
  app.get('/feedback',async request=>success(request,feedback(requireAuth(request),parseInput(querySchema,request.query))))
  app.post('/feedback',async request=>{
    const input=parseInput(z.object({ticketId:z.string().min(1),message:z.string().trim().min(1).max(2000)}).strict(),request.body)
    return success(request,createFeedback(requireAuth(request),input.ticketId,input.message))
  })
  app.put<{Params:{id:string}}>('/feedback/:id',async request=>{
    const input=parseInput(z.object({revision:z.number().int().positive(),response:z.string().trim().min(1).max(2000)}).strict(),request.body)
    return success(request,resolveFeedback(requireAuth(request),request.params.id,input.revision,input.response))
  })
  app.get('/export',async request=>success(request,exportWorkloads(requireAuth(request),parseInput(querySchema,request.query))))
  app.post('/self-create',async request=>success(request,selfCreate(requireAuth(request),parseInput(z.object({ticketTypeId:z.string().min(1),crewId:z.string().min(1),shiftTemplateId:z.string().min(1).nullable().optional(),workDate:z.iso.date(),values:valuesSchema,subFormValues:subFormsSchema,quantity:z.number().finite().nonnegative().nullable().optional(),clientRequestId:z.string().trim().min(1).max(160)}).strict(),request.body))))
  app.post<{Params:{id:string}}>('/tickets/:id/complete',async request=>success(request,completeSelf(requireAuth(request),request.params.id,parseInput(z.object({revision:z.number().int().positive(),quantity:z.number().finite().nonnegative(),values:valuesSchema,subFormValues:subFormsSchema}).strict(),request.body))))
}
