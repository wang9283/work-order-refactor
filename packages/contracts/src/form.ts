import { z } from 'zod'
import type { AuditFields, Id } from './common'

export const formFieldTypes = [
  'text',
  'textarea',
  'number',
  'date',
  'datetime',
  'single_select',
  'multi_select',
  'boolean',
  'photo',
  'attachment',
] as const

export type FormFieldType = (typeof formFieldTypes)[number]
export const fieldStrategies = ['optional', 'backfill', 'blocking'] as const
export type FieldStrategy = (typeof fieldStrategies)[number]

export interface FieldOption {
  label: string
  value: string
}

export interface FieldValidation {
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

export interface FormFieldDefinition {
  id: Id
  key: string
  name: string
  type: FormFieldType
  required: boolean
  strategy: FieldStrategy
  sort: number
  placeholder?: string
  helpText?: string
  defaultValue?: string | number | boolean
  options?: FieldOption[]
  validation?: FieldValidation
  sourceSystemId?: string
  isCore: boolean
  editableByLocal: boolean
}

export interface SubFormDefinition {
  id: Id
  key: string
  name: string
  sort: number
  minRecords: number
  maxRecords: number
  fields: FormFieldDefinition[]
}

export interface FormConditionRule {
  id: Id
  fieldKey: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_empty'
  value: unknown
  action: 'show' | 'hide' | 'require' | 'disable'
  targetKeys: string[]
}

export interface FormVersionSchema {
  mainFields: FormFieldDefinition[]
  subForms: SubFormDefinition[]
  conditionRules: FormConditionRule[]
}

export interface FormTemplate extends AuditFields {
  id: Id
  code: string
  name: string
  ownerType: 'group' | 'company'
  ownerId: Id
  source: 'native' | 'excel'
  locked: boolean
  currentPublishedVersionId: Id | null
}

export interface FormVersion extends AuditFields {
  id: Id
  templateId: Id
  versionNo: number
  status: 'draft' | 'published' | 'retired'
  schema: FormVersionSchema
  publishedAt: string | null
  publishedBy: Id | null
}

const fieldValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  pattern: z.string().optional(),
})

export const formFieldSchema = z.object({
  id: z.string().min(1),
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, '字段标识必须以字母开头'),
  name: z.string().trim().min(1).max(80),
  type: z.enum(formFieldTypes).refine((type) => type !== 'photo' && type !== 'attachment', '当前不允许照片或附件字段'),
  required: z.boolean().default(false),
  strategy: z.enum(fieldStrategies).default('optional'),
  sort: z.number().int().nonnegative(),
  placeholder: z.string().max(160).optional(),
  helpText: z.string().max(500).optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.object({ label: z.string().min(1), value: z.string().min(1) })).optional(),
  validation: fieldValidationSchema.optional(),
  sourceSystemId: z.string().optional(),
  isCore: z.boolean().default(false),
  editableByLocal: z.boolean().default(true),
})

export const subFormSchema = z.object({
  id: z.string().min(1),
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  name: z.string().trim().min(1).max(80),
  sort: z.number().int().nonnegative(),
  minRecords: z.number().int().nonnegative().default(0),
  maxRecords: z.number().int().positive().default(100),
  fields: z.array(formFieldSchema),
})

export const formVersionSchema = z.object({
  mainFields: z.array(formFieldSchema),
  subForms: z.array(subFormSchema),
  conditionRules: z.array(z.object({
    id: z.string().min(1),
    fieldKey: z.string().min(1),
    operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_empty']),
    value: z.unknown(),
    action: z.enum(['show', 'hide', 'require', 'disable']),
    targetKeys: z.array(z.string()),
  })).default([]),
}) .superRefine((schema, context) => {
  const checkFields = (fields: typeof schema.mainFields, path: (string | number)[]) => {
    const keys = new Set<string>()
    fields.forEach((field,index) => {
      if (keys.has(field.key)) context.addIssue({code:'custom',path:[...path,index,'key'],message:'字段标识不能重复'})
      keys.add(field.key)
      if ((field.type === 'single_select' || field.type === 'multi_select') && !field.options?.length) context.addIssue({code:'custom',path:[...path,index,'options'],message:'选择字段至少需要一个选项'})
    })
  }
  checkFields(schema.mainFields,['mainFields'])
  const keys = new Set<string>()
  schema.subForms.forEach((sub,index) => {
    if(keys.has(sub.key)) context.addIssue({code:'custom',path:['subForms',index,'key'],message:'明细表标识不能重复'})
    keys.add(sub.key)
    if(sub.minRecords > sub.maxRecords) context.addIssue({code:'custom',path:['subForms',index,'minRecords'],message:'最少行数不能超过最多行数'})
    checkFields(sub.fields,['subForms',index,'fields'])
  })
})

export type FormValues = Record<string, unknown>
