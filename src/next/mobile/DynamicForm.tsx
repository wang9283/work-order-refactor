import { Button, Checkbox, DatePicker, Form, Input, Radio, Space, Switch, TextArea } from 'antd-mobile'
import type { FormInstance } from 'rc-field-form'
import type { FormFieldDefinition, FormVersionSchema } from '@contracts/index'
import dayjs from 'dayjs'
import { fieldVisibility } from '@next/shared/form-render'

function MobileField({ field, value, onChange, disabled }: {
  field: FormFieldDefinition; value?: unknown; onChange?: (value: unknown) => void; disabled?: boolean
}) {
  const placeholder = field.placeholder || `请输入${field.name}`
  if (field.type === 'photo' || field.type === 'attachment') return <span className="mobile-muted">{String(value || '历史文件字段')}</span>
  if (field.type === 'boolean') return <Switch checked={Boolean(value)} disabled={disabled} onChange={onChange} />
  if (field.type === 'textarea') return <TextArea value={String(value ?? '')} disabled={disabled} onChange={onChange} placeholder={placeholder} rows={3} />
  if (field.type === 'date' || field.type === 'datetime') return <DatePicker
    precision={field.type === 'date' ? 'day' : 'minute'} title={`选择${field.name}`}
    value={value ? dayjs(value as string | Date).toDate() : undefined}
    onConfirm={next => onChange?.(field.type === 'date' ? dayjs(next).format('YYYY-MM-DD') : next.toISOString())}
  >{(_, toggle) => <Button fill="none" disabled={disabled} onClick={() => toggle.open()}>{value ? dayjs(value as string | Date).format(field.type === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm') : placeholder}</Button>}</DatePicker>
  if (field.type === 'single_select') return <Radio.Group value={value as string | undefined} onChange={onChange} disabled={disabled}><Space direction="vertical">{field.options?.map(option => <Radio key={option.value} value={option.value}>{option.label}</Radio>)}</Space></Radio.Group>
  if (field.type === 'multi_select') return <Checkbox.Group value={value as string[] | undefined} onChange={onChange} disabled={disabled}><Space direction="vertical">{field.options?.map(option => <Checkbox key={option.value} value={option.value}>{option.label}</Checkbox>)}</Space></Checkbox.Group>
  return <Input type={field.type === 'number' ? 'number' : 'text'} inputMode={field.type === 'number' ? 'decimal' : undefined}
    value={String(value ?? '')} disabled={disabled} placeholder={placeholder} maxLength={field.validation?.maxLength}
    onChange={next => onChange?.(field.type === 'number' ? (next === '' ? undefined : Number(next)) : next)} />
}

function rulesFor(field: FormFieldDefinition, required = false) {
  if (field.type === 'photo' || field.type === 'attachment') return []
  return [{ validator: async (_: unknown, value: unknown) => {
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)
    if (empty) {
      if (required || field.required || field.strategy === 'blocking') throw new Error(`请填写${field.name}`)
      return
    }
    const validation = field.validation
    if (field.type === 'number') {
      const number = Number(value)
      if (!Number.isFinite(number)) throw new Error(`${field.name}必须是有效数字`)
      if (validation?.min !== undefined && number < validation.min) throw new Error(`${field.name}不能小于${validation.min}`)
      if (validation?.max !== undefined && number > validation.max) throw new Error(`${field.name}不能大于${validation.max}`)
    }
    if (typeof value === 'string') {
      if (validation?.minLength !== undefined && value.length < validation.minLength) throw new Error(`${field.name}至少${validation.minLength}个字符`)
      if (validation?.maxLength !== undefined && value.length > validation.maxLength) throw new Error(`${field.name}最多${validation.maxLength}个字符`)
      if (validation?.pattern) {
        let pattern: RegExp | undefined
        try { pattern = new RegExp(validation.pattern) } catch { /* Legacy invalid patterns do not block. */ }
        if (pattern && !pattern.test(value)) throw new Error(`${field.name}格式不正确`)
      }
    }
  } }]
}

export function initialDynamicValues(schema: FormVersionSchema, values: Record<string, unknown> = {}, details: Record<string, Array<Record<string, unknown>>> = {}) {
  return {
    ...Object.fromEntries(schema.mainFields.map(field => [field.key, values[field.key] ?? field.defaultValue])),
    __details: Object.fromEntries(schema.subForms.map(sub => [sub.key,
      (details[sub.key]?.length ? details[sub.key] : Array.from({ length: sub.minRecords }, () => ({} as Record<string, unknown>)))
        .map(row => Object.fromEntries(sub.fields.map(field => [field.key, row[field.key] ?? field.defaultValue]))),
    ])),
  }
}

export function dynamicPayload(schema: FormVersionSchema, raw: Record<string, unknown>) {
  const details = (raw.__details || {}) as Record<string, Array<Record<string, unknown>>>
  for (const sub of schema.subForms) {
    const count = details[sub.key]?.length || 0
    if (count < sub.minRecords) throw new Error(`${sub.name}至少填写${sub.minRecords}条`)
    if (count > sub.maxRecords) throw new Error(`${sub.name}最多填写${sub.maxRecords}条`)
  }
  const state = fieldVisibility(schema, raw)
  return {
    values: Object.fromEntries(schema.mainFields.filter(field => !state.hidden.has(field.key) && field.type !== 'photo' && field.type !== 'attachment').map(field => [field.key, raw[field.key] ?? null])),
    subFormValues: Object.fromEntries(schema.subForms.map(sub => [sub.key, (details[sub.key] || []).map(row => Object.fromEntries(sub.fields.filter(field => field.type !== 'photo' && field.type !== 'attachment').map(field => [field.key, row[field.key] ?? null])))])),
  }
}

export function DynamicMobileForm({ schema, form }: { schema: FormVersionSchema; form: FormInstance }) {
  const values = Form.useWatch([], form) || {}
  const visibility = fieldVisibility(schema, values)
  return <>
    {schema.mainFields.slice().sort((a, b) => a.sort - b.sort).filter(field => !visibility.hidden.has(field.key)).map(field => <Form.Item
      key={field.key} name={field.key} label={field.name} help={field.helpText} rules={rulesFor(field, visibility.required.has(field.key))}
    ><MobileField field={field} disabled={visibility.disabled.has(field.key)} /></Form.Item>)}
    {schema.subForms.slice().sort((a, b) => a.sort - b.sort).map(sub => <section className="mobile-subform" key={sub.key}>
      <h3>{sub.name}</h3>
      <Form.Array name={['__details', sub.key]}
        renderHeader={(row, operation) => <div className="mobile-row"><b>第 {row.index + 1} 条</b><Button size="small" fill="none" color="danger" disabled={(form.getFieldValue(['__details', sub.key])?.length || 0) <= sub.minRecords} onClick={() => operation.remove(row.index)}>删除</Button></div>}
        onAdd={operation => { if ((form.getFieldValue(['__details', sub.key])?.length || 0) < sub.maxRecords) operation.add(Object.fromEntries(sub.fields.map(field => [field.key, field.defaultValue]))) }}
        renderAdd={() => <span>＋ 添加{sub.name}</span>}
      >{rows => rows.map(row => <div key={row.key}>{sub.fields.slice().sort((a, b) => a.sort - b.sort).map(field => <Form.Item key={field.key} name={[row.index, field.key]} label={field.name} help={field.helpText} rules={rulesFor(field)}><MobileField field={field} /></Form.Item>)}</div>)}</Form.Array>
    </section>)}
  </>
}

function displayValue(field: FormFieldDefinition, value: unknown): string {
  if (value === null || value === undefined || value === '') return '未填写'
  if (field.type === 'boolean') return value ? '是' : '否'
  if (field.type === 'single_select' || field.type === 'multi_select') return (Array.isArray(value) ? value : [value]).map(item => field.options?.find(option => option.value === item)?.label || String(item)).join('、')
  if (field.type === 'date' || field.type === 'datetime') return dayjs(value as string).format(field.type === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function DynamicMobileDetail({ schema, values, details = {} }: { schema: FormVersionSchema; values: Record<string, unknown>; details?: Record<string, Array<Record<string, unknown>>> }) {
  const visibility = fieldVisibility(schema, values)
  return <>
    {schema.mainFields.slice().sort((a, b) => a.sort - b.sort).filter(field => !visibility.hidden.has(field.key)).map(field => <div className="mobile-detail-field" key={field.key}><span>{field.name}</span><b>{displayValue(field, values[field.key])}</b></div>)}
    {schema.subForms.slice().sort((a, b) => a.sort - b.sort).map(sub => <section className="mobile-subform" key={sub.key}><h3>{sub.name}</h3>{!details[sub.key]?.length && <p className="mobile-muted">无明细记录</p>}{details[sub.key]?.map((row, index) => <div className="mobile-detail-record" key={index}><b>第 {index + 1} 条</b>{sub.fields.map(field => <div className="mobile-detail-field" key={field.key}><span>{field.name}</span><b>{displayValue(field, row[field.key])}</b></div>)}</div>)}</section>)}
  </>
}

export function validationMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'errorFields' in reason) return '请检查并填写必填内容'
  if (Array.isArray(reason)) return '请检查并填写必填内容'
  return ''
}
