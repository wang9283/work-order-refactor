import type { FormVersionSchema } from '../../../packages/contracts/src'

export interface FormIssue {
  path: string
  fieldKey: string
  message: string
}

export interface FormValidationResult {
  valid: boolean
  issues: FormIssue[]
}

function empty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  return false
}

function ruleMatches(rule: FormVersionSchema['conditionRules'][number], values: Record<string, unknown>): boolean {
  const actual = values[rule.fieldKey]
  if (rule.operator === 'eq') return actual === rule.value
  if (rule.operator === 'neq') return actual !== rule.value
  if (rule.operator === 'gt') return Number(actual) > Number(rule.value)
  if (rule.operator === 'gte') return Number(actual) >= Number(rule.value)
  if (rule.operator === 'lt') return Number(actual) < Number(rule.value)
  if (rule.operator === 'lte') return Number(actual) <= Number(rule.value)
  if (rule.operator === 'in') return Array.isArray(rule.value) && rule.value.includes(actual)
  return !empty(actual)
}

function behaviors(schema: FormVersionSchema, values: Record<string, unknown>): {
  hidden: Set<string>
  required: Set<string>
} {
  const hidden = new Set(
    schema.conditionRules.filter((rule) => rule.action === 'show').flatMap((rule) => rule.targetKeys),
  )
  const required = new Set<string>()
  for (const rule of schema.conditionRules) {
    if (!ruleMatches(rule, values)) continue
    for (const target of rule.targetKeys) {
      if (rule.action === 'hide') hidden.add(target)
      if (rule.action === 'show') hidden.delete(target)
      if (rule.action === 'require') required.add(target)
    }
  }
  return { hidden, required }
}

function fieldIssues(
  field: FormVersionSchema['mainFields'][number],
  value: unknown,
  path: string,
  forceRequired: boolean,
): FormIssue[] {
  if (field.type === 'photo' || field.type === 'attachment') return []
  const issues: FormIssue[] = []
  const isRequired = forceRequired || field.required || field.strategy === 'blocking'
  if (empty(value)) {
    if (isRequired) issues.push({ path, fieldKey: field.key, message: `请填写${field.name}` })
    return issues
  }
  if (field.type === 'number') {
    const number = Number(value)
    if (!Number.isFinite(number)) {
      issues.push({ path, fieldKey: field.key, message: `${field.name}必须是有效数字` })
    } else {
      if (field.validation?.min !== undefined && number < field.validation.min) {
        issues.push({ path, fieldKey: field.key, message: `${field.name}不能小于 ${field.validation.min}` })
      }
      if (field.validation?.max !== undefined && number > field.validation.max) {
        issues.push({ path, fieldKey: field.key, message: `${field.name}不能大于 ${field.validation.max}` })
      }
    }
  }
  if (typeof value === 'string') {
    if (field.validation?.minLength !== undefined && value.length < field.validation.minLength) {
      issues.push({ path, fieldKey: field.key, message: `${field.name}至少需要 ${field.validation.minLength} 个字符` })
    }
    if (field.validation?.maxLength !== undefined && value.length > field.validation.maxLength) {
      issues.push({ path, fieldKey: field.key, message: `${field.name}最多允许 ${field.validation.maxLength} 个字符` })
    }
    if (field.validation?.pattern) {
      try {
        if (!new RegExp(field.validation.pattern).test(value)) {
          issues.push({ path, fieldKey: field.key, message: `${field.name}格式不正确` })
        }
      } catch {
        issues.push({ path, fieldKey: field.key, message: `${field.name}规则配置无效` })
      }
    }
  }
  if (field.options?.length) {
    const allowed = new Set(field.options.map((option) => option.value))
    const items = Array.isArray(value) ? value : [value]
    if (items.some((item) => !allowed.has(String(item)))) {
      issues.push({ path, fieldKey: field.key, message: `${field.name}包含无效选项` })
    }
  }
  return issues
}

export function validateFrozenForm(
  schema: FormVersionSchema,
  values: Record<string, unknown>,
  subFormValues: Record<string, Array<Record<string, unknown>>>,
): FormValidationResult {
  const state = behaviors(schema, values)
  const issues = schema.mainFields
    .filter((field) => !state.hidden.has(field.key))
    .flatMap((field) => fieldIssues(
      field,
      values[field.key],
      field.key,
      state.required.has(field.key),
    ))

  for (const subForm of schema.subForms) {
    if (state.hidden.has(subForm.key)) continue
    const records = subFormValues[subForm.key] || []
    if (records.length < subForm.minRecords) {
      issues.push({
        path: subForm.key,
        fieldKey: subForm.key,
        message: `${subForm.name}至少需要 ${subForm.minRecords} 条记录`,
      })
    }
    if (records.length > subForm.maxRecords) {
      issues.push({
        path: subForm.key,
        fieldKey: subForm.key,
        message: `${subForm.name}最多允许 ${subForm.maxRecords} 条记录`,
      })
    }
    records.forEach((record, index) => {
      for (const field of subForm.fields) {
        issues.push(...fieldIssues(
          field,
          record[field.key],
          `${subForm.key}[${index}].${field.key}`,
          false,
        ))
      }
    })
  }
  return { valid: issues.length === 0, issues }
}

export function hasPendingBackfill(
  schema: FormVersionSchema,
  values: Record<string, unknown>,
): boolean {
  const state = behaviors(schema, values)
  return schema.mainFields.some((field) =>
    field.type !== 'photo' && field.type !== 'attachment' && field.strategy === 'backfill'
    && !state.hidden.has(field.key)
    && empty(values[field.key]),
  )
}
