import { useState } from 'react'
import { App, Button, Form, Input, Modal, Select, Table, Tag, TimePicker, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import type { OperationsContext } from '@contracts/operations'
import { operationsApi } from '@next/shared/operations-api'
import { errorMessage } from '@next/shared/api'
import { useAntFormUnsavedChanges } from '@next/shared/unsaved-changes'

type Shift = OperationsContext['shifts'][number]
export default function ShiftManagement({ context, onSaved }: { context: OperationsContext; onSaved: () => void }) {
  const { message } = App.useApp()
  const [editing, setEditing] = useState<Shift | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<{ name: string; siteId: string; startTime: Dayjs; endTime: Dayjs; status: 'active' | 'inactive' }>()
  useAntFormUnsavedChanges(form, Boolean(editing), editing === 'new' ? '新增班次' : '编辑班次')
  const open = (shift: Shift | 'new') => {
    form.setFieldsValue(shift === 'new' ? { name: '', siteId: context.crews.find(crew => crew.canPlanMonth)?.siteId, startTime: dayjs('08:00', 'HH:mm'), endTime: dayjs('17:00', 'HH:mm'), status: 'active' } : { name: shift.name, siteId: shift.siteId, startTime: dayjs(shift.startTime, 'HH:mm'), endTime: dayjs(shift.endTime, 'HH:mm'), status: shift.status })
    setEditing(shift)
  }
  const save = async () => {
    try {
      const values = await form.validateFields(); setSaving(true)
      await operationsApi.saveShift({ id: editing === 'new' ? undefined : editing?.id, siteId: values.siteId, name: values.name.trim(), startTime: values.startTime.format('HH:mm'), endTime: values.endTime.format('HH:mm'), status: values.status, revision: editing === 'new' ? 0 : editing?.revision || 0 })
      setEditing(null); onSaved(); message.success('班次已保存；历史排班保留原时间快照')
    } catch (reason) { message.error(errorMessage(reason)) } finally { setSaving(false) }
  }
  const sites = [...new Map(context.crews.filter(crew => crew.canPlanMonth).map(crew => [crew.siteId, crew.siteId])).values()]
  return <>
    <Typography.Paragraph type="secondary">结束时间早于或等于开始时间即跨天。夜班按结束日归属；班次变更不改写历史排班。</Typography.Paragraph>
    <Table<Shift> rowKey="id" dataSource={context.shifts} pagination={false} columns={[
      { title: '班次', dataIndex: 'name' }, { title: '起止时间', render: (_, row) => `${row.startTime}–${row.endTime}` },
      { title: '跨天', render: (_, row) => row.crossDay ? <Tag color="blue">跨天 · 按结束日</Tag> : '当天' },
      { title: '状态', render: (_, row) => <Tag color={row.status === 'active' ? 'green' : 'default'}>{row.status === 'active' ? '启用' : '停用'}</Tag> },
      { title: '操作', render: (_, row) => <Button type="link" onClick={() => open(row)}>编辑</Button> },
    ]} />
    <Button type="primary" style={{ marginTop: 16 }} disabled={!sites.length} onClick={() => open('new')}>新增班次</Button>
    <Modal title={editing === 'new' ? '新增班次' : '编辑班次'} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => void save()} confirmLoading={saving} okText="保存班次">
      <Form form={form} layout="vertical"><Form.Item name="siteId" label="所属基地" rules={[{ required: true }]}><Select disabled={editing !== 'new'} options={sites.map(id => ({ value: id, label: context.crews.find(crew => crew.siteId === id)?.name.includes('基地') ? id : `演示基地 · ${id}` }))} /></Form.Item>
        <Form.Item name="name" label="班次名称" rules={[{ required: true, whitespace: true }]}><Input placeholder="如：白班、夜班、常日班" /></Form.Item>
        <Form.Item name="startTime" label="开始时间" rules={[{ required: true }]}><TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="endTime" label="结束时间" rules={[{ required: true }]}><TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="status" label="状态"><Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} /></Form.Item>
      </Form>
    </Modal>
  </>
}
