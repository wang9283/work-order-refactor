import { z } from 'zod'

export const executionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().optional(),
  status: z.enum([
    'pending_assignment',
    'pending_start',
    'in_progress',
    'pending_data',
    'overdue',
    'completed',
    'closed',
    'cancelled',
  ]).optional(),
  siteId: z.string().trim().optional(),
  ticketCategoryId: z.string().trim().optional(),
  ticketTypeId: z.string().trim().optional(),
  materialId: z.string().trim().optional(),
  materialTypeId: z.string().trim().optional(),
  productionPostId: z.string().trim().optional(),
  productionLineId: z.string().trim().optional(),
  loadingTypeId: z.string().trim().optional(),
  plateNumber: z.string().trim().max(30).optional(),
  crewId: z.string().trim().optional(),
  shiftTemplateId: z.string().trim().optional(),
  source: z.enum(['self', 'demo_sync', 'legacy']).optional(),
  workAreaId: z.string().trim().optional(),
  workDateFrom: z.string().trim().optional(),
  workDateTo: z.string().trim().optional(),
  personId: z.string().trim().optional(),
  statusGroup: z.enum(['all', 'todo', 'doing', 'waiting', 'done']).default('all'),
  factoryId: z.string().trim().optional(),
})

export const createTicketSchema = z.object({
  ticketTypeId: z.string().min(1),
  businessKind: z.enum(['generic', 'production', 'loading']).default('generic'),
  materialId: z.string().nullable().default(null),
  materialTypeId: z.string().nullable().default(null),
  businessItems: z.array(z.object({
    catalogId: z.string().min(1),
    kind: z.enum(['production_post', 'loading_type']),
  })).max(30).default([]),
  siteId: z.string().min(1),
  factoryId: z.string().nullable().default(null),
  workAreaId: z.string().nullable().default(null),
  productionLineId: z.string().nullable().default(null),
  crewId: z.string().nullable().default(null),
  shiftTemplateId: z.string().nullable().default(null),
  eventTime: z.string().datetime({ offset: true }),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assignments: z.array(z.object({
    personId: z.string().min(1),
    role: z.enum(['lead', 'member']).default('member'),
  })).max(100).default([]),
  quantity: z.number().nonnegative().nullable().default(null),
  handoverShiftProfileId: z.string().nullable().default(null),
  clientRequestId: z.string().min(1).optional(),
}).superRefine((input, context) => {
  if (input.businessKind === 'generic' && (input.materialId || input.materialTypeId || input.businessItems.length)) {
    context.addIssue({ code: 'custom', message: '通用工单不能包含生产或装卸业务字段' })
  }
  if (input.businessKind !== 'generic' && input.assignments.length) {
    context.addIssue({ code: 'custom', message: '生产、装卸人员须分岗位指派并设置贡献比例' })
  }
  if (input.businessKind === 'production'
    && (!(input.materialId || input.materialTypeId)
      || (!input.materialId && !input.businessItems.length)
      || input.businessItems.some((item) => item.kind !== 'production_post'))) {
    context.addIssue({ code: 'custom', message: '生产工单须选择产品或料类；未选产品时须至少一个生产岗位' })
  }
  if (input.businessKind === 'loading'
    && (input.materialId || input.materialTypeId || input.businessItems.length !== 1 || input.businessItems[0]?.kind !== 'loading_type')) {
    context.addIssue({ code: 'custom', message: '装卸工单须选择一种装卸类型' })
  }
})

export const manualCreateTicketSchema = createTicketSchema.refine(
  (input) => input.businessKind === 'generic',
  {
    path: ['businessKind'],
    message: '生产、装卸工单由业务系统同步，平台不支持手工创建',
  },
)

export const assignTicketSchema = z.object({
  assignments: z.array(z.object({
    personId: z.string().min(1),
    role: z.enum(['lead', 'member']).default('member'),
  })).min(1).max(100),
  revision: z.number().int().positive(),
})

export const saveTicketValuesSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  subFormValues: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
  assignmentQuantities: z.record(z.string(), z.number().nonnegative()).optional(),
  revision: z.number().int().positive(),
})

export const transitionSchema = z.object({
  revision: z.number().int().positive(),
  note: z.string().trim().max(1000).default(''),
})

export const submitTicketSchema = saveTicketValuesSchema.extend({
  quantity: z.number().nonnegative().nullable().optional(),
})

export const completeTicketSchema = transitionSchema.extend({
  quantity: z.number().nonnegative().nullable().optional(),
})

export const reviseAssignmentsSchema = z.object({
  assignments: z.array(z.object({
    personId: z.string().min(1),
    role: z.enum(['lead', 'member']).default('member'),
    actualQuantity: z.number().nonnegative().nullable().default(null),
  })).min(1),
  revision: z.number().int().positive(),
  note: z.string().trim().max(1000).default(''),
})

export const priceRuleSchema = z.object({
  ticketTypeId: z.string().min(1),
  siteId: z.string().min(1),
  unit: z.string().trim().min(1).max(30),
  unitPriceMicros: z.number().int().nonnegative(),
  effectiveFrom: z.string().datetime({ offset: true }),
  effectiveTo: z.string().datetime({ offset: true }).nullable().default(null),
})

export const ticketPricingSchema = z.union([
  z.object({
    revision: z.number().int().positive(), method: z.literal('quantity_unit').default('quantity_unit'),
    unit: z.string().trim().min(1).max(30), unitPriceMicros: z.number().int().nonnegative().safe(),
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({
    revision: z.number().int().positive(), method: z.literal('lump_sum'),
    lumpSumCents: z.number().int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER / 10000)),
    reason: z.string().trim().min(1).max(1000),
  }),
])

export const priceRulePublishSchema = z.object({
  revision: z.number().int().positive(),
})

export const confirmPayrollCompanySchema = z.object({
  workMonth: z.string().regex(/^\d{4}-\d{2}$/),
  personIds: z.array(z.string().min(1)).min(1),
  payrollCompanyId: z.string().min(1),
})

export const closePayrollSchema = z.object({
  workMonth: z.string().regex(/^\d{4}-\d{2}$/),
  revision: z.number().int().positive(),
  replaceAccruals: z.array(z.object({
    accrualId: z.string().min(1),
    quantity: z.number().nonnegative(),
    reason: z.string().trim().min(1).max(1000),
  })).default([]),
  additionalAccruals: z.array(z.object({
    ticketId: z.string().min(1),
    personId: z.string().min(1),
    workSiteId: z.string().min(1),
    priceRuleVersionId: z.string().min(1),
    quantity: z.number().nonnegative(),
    amountMicros: z.number().int(),
    reason: z.string().trim().min(1).max(1000),
  })).default([]),
})

export const payrollQuerySchema = z.object({
  workMonth: z.string().regex(/^\d{4}-\d{2}$/),
  payrollCompanyId: z.string().optional(),
  settlementStatus: z.enum(['open', 'locked', 'adjusted']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
