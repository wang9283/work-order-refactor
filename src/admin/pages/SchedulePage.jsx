import React, { useMemo, useState } from 'react'
import { Button, Table, Tag, Space, Modal, Form, Input, Select, DatePicker, Popconfirm, message, Card } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { saveConfig } from '@shared/store'

const emptySchedule = (orgId) => ({ id: '', date: dayjs(), orgId, personId: undefined, shiftId: undefined, status: '出勤' })

export default function SchedulePage({ config, orgId, onRefresh }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form] = Form.useForm()

  const schedules = useMemo(() => {
    if (orgId === 'group') return config.schedules || []
    return (config.schedules || []).filter((s) => s.orgId === orgId)
  }, [config, orgId])

  const persons = useMemo(() => (config.personnel || []).filter((p) => p.orgId === orgId || orgId === 'group'), [config, orgId])
  const shifts = useMemo(() => (config.shifts || []).filter((s) => s.orgId === orgId || orgId === 'group'), [config, orgId])

  const openCreate = () => {
    setEditingId(null)
    form.setFieldsValue({ ...emptySchedule(orgId === 'group' ? 'sub_qd' : orgId) })
    setModalOpen(true)
  }

  const openEdit = (record) => {
    setEditingId(record.id)
    form.setFieldsValue({ ...record, date: dayjs(record.date, 'YYYY-MM-DD') })
    setModalOpen(true)
  }

  const handleSave = () => {
    const values = form.getFieldsValue()
    if (!values.personId || !values.date || !values.shiftId) return message.warning('请补全排班信息')
    const payload = { ...values, date: values.date.format ? values.date.format('YYYY-MM-DD') : values.date }
    if (editingId) {
      const idx = config.schedules.findIndex((s) => s.id === editingId)
      config.schedules[idx] = { ...config.schedules[idx], ...payload }
    } else {
      config.schedules.push({ id: 'sch_' + Date.now(), ...payload })
    }
    saveConfig(config)
    message.success('已保存')
    setModalOpen(false)
    onRefresh()
  }

  const columns = [
    { title: '日期', dataIndex: 'date', width: 120 },
    { title: '人员', dataIndex: 'personId', width: 120, render: (v) => config.personnel.find((p) => p.id === v)?.name || v },
    { title: '组织', dataIndex: 'orgId', width: 160, render: (v) => config.orgs.find((o) => o.id === v)?.name || v },
    { title: '班次', dataIndex: 'shiftId', width: 110, render: (v) => config.shifts.find((s) => s.id === v)?.name || v },
    { title: '状态', dataIndex: 'status', width: 90, render: (v) => ({ 出勤: <Tag color="green">出勤</Tag>, 请假: <Tag color="orange">请假</Tag>, 休息: <Tag>休息</Tag> }[v] || v) },
    {
      title: '操作', key: 'action', width: 180, fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <a onClick={() => openEdit(record)}>编辑</a>
          <Popconfirm title="Demo 阶段只保留入口，删除逻辑未实现。确认？" onConfirm={() => message.info('Demo 阶段删除逻辑未实现')}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card title="月排班" extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增排班</Button>}>
      <Table rowKey="id" columns={columns} dataSource={schedules} pagination={{ pageSize: 8 }} size="middle" />

      <Modal title={editingId ? '编辑排班' : '新增排班'} open={modalOpen} onOk={handleSave} onCancel={() => setModalOpen(false)} width={520}>
        <Form form={form} layout="vertical">
          <Form.Item name="date" label="日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="personId" label="人员" rules={[{ required: true }]}>
            <Select options={persons.map((p) => ({ label: `${p.name}（${p.code}）`, value: p.id }))} />
          </Form.Item>
          <Form.Item name="shiftId" label="班次" rules={[{ required: true }]}>
            <Select options={shifts.map((s) => ({ label: s.name, value: s.id }))} />
          </Form.Item>
          <Form.Item name="orgId" label="组织">
            <Select disabled={orgId !== 'group'} options={config.orgs.filter((o) => o.level === 'subsidiary').map((o) => ({ label: o.name, value: o.id }))} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select options={[{ label: '出勤', value: '出勤' }, { label: '请假', value: '请假' }, { label: '休息', value: '休息' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
