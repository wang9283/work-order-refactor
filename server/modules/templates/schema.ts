import { z } from 'zod'
import { formVersionSchema } from '../../../packages/contracts/src/form'
import { workProfileSchema } from '../../../packages/contracts/src/work-order'

export const formTemplateCreateSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(100),
  ownerType: z.enum(['group', 'company']),
  ownerId: z.string().min(1),
  source: z.enum(['native', 'excel']).default('native'),
  schema: formVersionSchema,
})

export const formTemplateQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
  ownerType: z.enum(['group', 'company']).optional(),
  ownerId: z.string().trim().optional(),
  status: z.enum(['draft', 'published', 'retired']).optional(),
})

export const formVersionCreateSchema = z.object({
  fromVersionId: z.string().min(1).optional(),
  schema: formVersionSchema.optional(),
})

export const formVersionUpdateSchema = z.object({
  schema: formVersionSchema,
  revision: z.number().int().positive(),
})

export const publishVersionSchema = z.object({
  revision: z.number().int().positive(),
})

export const ticketCategoryCreateSchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(1).max(80),
  ownerType: z.enum(['group', 'company']),
  ownerId: z.string().min(1),
})

export const ticketTypeCreateSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(100),
  categoryId: z.string().min(1),
  ownerType: z.enum(['group', 'company']),
  ownerId: z.string().min(1),
  formTemplateId: z.string().min(1),
  formVersionId: z.string().min(1),
  workProfiles: z.array(workProfileSchema.omit({ id: true })).default([]),
})

export const ticketTypeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
  ownerType: z.enum(['group', 'company']).optional(),
  ownerId: z.string().trim().optional(),
  status: z.enum(['draft', 'published', 'retired', 'archived']).optional(),
})

export const ticketTypeVersionCreateSchema = z.object({
  formVersionId: z.string().min(1),
  workProfiles: z.array(workProfileSchema.omit({ id: true })).default([]),
})

export const ticketTypeVersionUpdateSchema = z.object({
  formVersionId: z.string().min(1),
  workProfiles: z.array(workProfileSchema.omit({ id: true })),
  revision: z.number().int().positive(),
})

export const excelCommitSchema = z.object({
  templateName: z.string().trim().min(2).max(100),
  templateCode: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, '模板编码必须以字母开头'),
  ownerType: z.enum(['group', 'company']),
  ownerId: z.string().min(1),
  mappings: z.record(z.string(), z.string().nullable()),
  revision: z.number().int().positive().optional(),
})
