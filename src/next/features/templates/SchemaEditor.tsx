import { useState } from 'react'
import { Button, Card, Input, InputNumber, Select, Space, Switch, Typography } from 'antd'
import type { FormFieldDefinition, FormVersionSchema } from '@contracts/index'

const types = { text: '文本', textarea: '多行文本', number: '数字', date: '日期', datetime: '日期时间', single_select: '单选', multi_select: '多选', boolean: '是/否' }
export default function SchemaEditor({ value, onChange }: { value?: string; onChange?: (value: string) => void }) {
  const [preview,setPreview] = useState(false)
  let schema: FormVersionSchema
  try { schema = JSON.parse(value || '{}') } catch { return <Typography.Text type="danger">表单结构无法读取，请重新打开模板。</Typography.Text> }
  schema.mainFields ||= []
  schema.subForms ||= []
  schema.conditionRules ||= []
  const update = () => {
    const keys = new Set([...schema.mainFields.map(f=>f.key), ...schema.subForms.flatMap(sub=>[sub.key,...sub.fields.map(f=>f.key)])])
    schema.conditionRules = schema.conditionRules.filter(rule=>keys.has(rule.fieldKey)).map(rule=>({...rule,targetKeys:rule.targetKeys.filter(key=>keys.has(key))})).filter(rule=>rule.targetKeys.length)
    onChange?.(JSON.stringify(schema))
  }
  const addField = (fields: FormFieldDefinition[]) => {
    const key = `field_${Date.now()}`
    fields.push({ id: key, key, name: '新字段', type: 'text', required: false, strategy: 'optional', sort: fields.length, isCore: false, editableByLocal: true }); update()
  }
  const fieldsEditor = (fields: FormFieldDefinition[]) => <Space direction="vertical" style={{ width: '100%' }}>
    {fields.map((field, index) => <Card key={field.id} size="small" title={`字段 ${index + 1}`} extra={<Button danger onClick={() => { fields.splice(index, 1); update() }}>删除</Button>}>
      <Space direction="vertical" style={{ width: '100%' }}>
        {(field.type === 'photo' || field.type === 'attachment') && <Typography.Text type="warning">历史文件字段，请删除或改成普通字段后保存新版本。</Typography.Text>}
        <Input aria-label="字段名称" addonBefore="名称" value={field.name} onChange={(e) => { field.name = e.target.value; update() }} />

        <Select aria-label="字段类型" style={{ width: '100%' }} value={field.type} options={Object.entries(types).map(([value, label]) => ({ value, label }))} onChange={(type) => { field.type = type; update() }} />
        <Space>必填<Switch checked={field.required} onChange={(checked) => { field.required = checked; field.strategy = checked ? 'blocking' : 'optional'; update() }} /></Space>
        {(field.type === 'single_select' || field.type === 'multi_select') && <Input.TextArea aria-label="选项" placeholder="每行一个选项" value={field.options?.map((o) => o.label).join('\n')} onChange={(e) => { field.options = e.target.value.split('\n').filter(Boolean).map((label) => ({ label, value: label })); update() }} />}
        <Input addonBefore="填写提示" value={field.placeholder} onChange={(e) => { field.placeholder = e.target.value; update() }} />
      </Space>
    </Card>)}
    <Button onClick={() => addField(fields)}>添加字段</Button>
  </Space>
  const previewFields = (fields: FormFieldDefinition[]) => fields.filter(f=>f.type!=='photo'&&f.type!=='attachment').map(f=><div key={f.id}><Typography.Text>{f.required?'* ':''}{f.name}</Typography.Text>{f.type==='boolean'?<Switch/>:f.type==='single_select'||f.type==='multi_select'?<Select style={{width:'100%'}} mode={f.type==='multi_select'?'multiple':undefined} options={f.options}/>:f.type==='number'?<InputNumber style={{width:'100%'}}/>:<Input placeholder={f.placeholder} type={f.type==='date'?'date':'text'}/>}</div>)
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Button onClick={()=>setPreview(!preview)}>{preview?'收起预览':'预览填写效果'}</Button>
    {preview&&<Card title="填写预览"><Space direction="vertical" style={{width:'100%'}}>{previewFields(schema.mainFields)}{schema.subForms.map(sub=><Card key={sub.id} size="small" title={sub.name}>{previewFields(sub.fields)}</Card>)}</Space></Card>}
    {fieldsEditor(schema.mainFields)}
    {schema.subForms.map((sub, index) => <Card key={sub.id} title={<Input aria-label="明细表名称" value={sub.name} onChange={(e) => { sub.name = e.target.value; update() }} />} extra={<Button danger onClick={() => { schema.subForms.splice(index, 1); update() }}>删除明细表</Button>}>
      <Space style={{ marginBottom: 12 }}>最少行数<InputNumber min={0} value={sub.minRecords} onChange={(n) => { sub.minRecords = n || 0; update() }} />最多行数<InputNumber min={1} value={sub.maxRecords} onChange={(n) => { sub.maxRecords = n || 100; update() }} /></Space>
      {fieldsEditor(sub.fields)}
    </Card>)}
    <Button onClick={() => { const key = `detail_${Date.now()}`; schema.subForms.push({ id: key, key, name: '明细表', sort: schema.subForms.length, minRecords: 0, maxRecords: 100, fields: [] }); update() }}>添加明细表</Button>
  </Space>
}
