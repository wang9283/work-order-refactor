import { Checkbox, DatePicker, Form, Input, InputNumber, Radio, Select, Switch } from 'antd'
import type { FormFieldDefinition, FormVersionSchema } from '@contracts/index'
import dayjs from 'dayjs'

export function formFieldRules(field: FormFieldDefinition) {
  if (field.type === 'photo' || field.type === 'attachment') return []
  const rules: Array<Record<string, unknown>> = []
  if (field.required || field.strategy === 'blocking') {
    rules.push({ required: true, message: `请填写${field.name}` })
  }
  if (field.validation?.min !== undefined || field.validation?.max !== undefined) {
    rules.push({
      validator: async (_: unknown, value: unknown) => {
        if (value === undefined || value === null || value === '') return
        const number = Number(value)
        if (!Number.isFinite(number)) throw new Error(`${field.name}必须是有效数字`)
        if (field.validation?.min !== undefined && number < field.validation.min) {
          throw new Error(`${field.name}不能小于 ${field.validation.min}`)
        }
        if (field.validation?.max !== undefined && number > field.validation.max) {
          throw new Error(`${field.name}不能大于 ${field.validation.max}`)
        }
      },
    })
  }
  if (field.validation?.minLength !== undefined) {
    rules.push({ min: field.validation.minLength, message: `至少 ${field.validation.minLength} 个字符` })
  }
  if (field.validation?.maxLength !== undefined) {
    rules.push({ max: field.validation.maxLength, message: `最多 ${field.validation.maxLength} 个字符` })
  }
  if (field.validation?.pattern) {
    try {
      rules.push({ pattern: new RegExp(field.validation.pattern), message: `${field.name}格式不正确` })
    } catch {
      // Invalid draft regex remains visible but does not block execution.
    }
  }
  return rules
}

export function formFieldInput(field: FormFieldDefinition) {
  const placeholder = field.placeholder || `请输入${field.name}`
  switch (field.type) {
    case 'textarea':
      return <Input.TextArea rows={3} placeholder={placeholder} maxLength={field.validation?.maxLength} />
    case 'number':
      return (
        <InputNumber
          style={{ width: '100%' }}
          min={field.validation?.min}
          max={field.validation?.max}
          placeholder={placeholder}
        />
      )
    case 'date':
      return <DatePicker style={{ width: '100%' }} placeholder={`请选择${field.name}`} />
    case 'datetime':
      return <DatePicker showTime style={{ width: '100%' }} placeholder={`请选择${field.name}`} />
    case 'single_select':
      return <Radio.Group options={field.options || []} />
    case 'multi_select':
      return <Checkbox.Group options={field.options || []} />
    case 'boolean':
      return <Switch />
    case 'photo':
    case 'attachment':
      return <Input disabled placeholder="历史文件字段，当前不允许填写" />
    default:
      return <Input placeholder={placeholder} maxLength={field.validation?.maxLength} />
  }
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.length === 0)
}

function matches(rule: FormVersionSchema['conditionRules'][number], values: Record<string, unknown>): boolean {
  const actual = values[rule.fieldKey]
  if (rule.operator === 'eq') return actual === rule.value
  if (rule.operator === 'neq') return actual !== rule.value
  if (rule.operator === 'gt') return Number(actual) > Number(rule.value)
  if (rule.operator === 'gte') return Number(actual) >= Number(rule.value)
  if (rule.operator === 'lt') return Number(actual) < Number(rule.value)
  if (rule.operator === 'lte') return Number(actual) <= Number(rule.value)
  if (rule.operator === 'in') return Array.isArray(rule.value) && rule.value.includes(actual)
  return !isEmpty(actual)
}

export function fieldVisibility(
  schema: FormVersionSchema,
  values: Record<string, unknown>,
): { hidden: Set<string>; required: Set<string>; disabled: Set<string> } {
  const hidden = new Set(
    schema.conditionRules.filter((rule) => rule.action === 'show').flatMap((rule) => rule.targetKeys),
  )
  const required = new Set<string>()
  const disabled = new Set<string>()
  for (const rule of schema.conditionRules) {
    if (!matches(rule, values)) continue
    for (const target of rule.targetKeys) {
      if (rule.action === 'hide') hidden.add(target)
      if (rule.action === 'show') hidden.delete(target)
      if (rule.action === 'require') required.add(target)
      if (rule.action === 'disable') disabled.add(target)
    }
  }
  return { hidden, required, disabled }
}

export function dateValueToApi(value: unknown, type: FormFieldDefinition['type']): unknown {
  if ((type === 'date' || type === 'datetime') && dayjs.isDayjs(value)) {
    return type === 'date' ? value.format('YYYY-MM-DD') : value.toISOString()
  }
  return value
}

export function apiValueToDate(value: unknown, type: FormFieldDefinition['type']): unknown {
  if ((type === 'date' || type === 'datetime') && typeof value === 'string' && value) return dayjs(value)
  return value
}

export function renderFormFields(
  schema: FormVersionSchema,
  values: Record<string, unknown>,
): Array<{
  key: string
  label: string
  field: FormFieldDefinition
  hidden: boolean
  required: boolean
  disabled: boolean
}> {
  const state = fieldVisibility(schema, values)
  return schema.mainFields
    .slice()
    .sort((left, right) => left.sort - right.sort)
    .map((field) => ({
      key: field.key,
      label: field.name,
      field,
      hidden: state.hidden.has(field.key),
      required: state.required.has(field.key),
      disabled: state.disabled.has(field.key),
    }))
}

export function DynamicField({ field, required, disabled }: {
  field: FormFieldDefinition
  required?: boolean
  disabled?: boolean
}) {
  return (
    <Form.Item
      name={field.key}
      label={field.name}
      help={field.helpText}
      rules={required && field.type !== 'photo' && field.type !== 'attachment' ? [{ required: true, message: `请填写${field.name}` }, ...formFieldRules(field)] : formFieldRules(field)}
      valuePropName={field.type === 'boolean' ? 'checked' : 'value'}
    >
      {disabled
        ? <Input disabled placeholder={`${field.name}当前不可填写`} />
        : formFieldInput(field)}
    </Form.Item>
  )
}
