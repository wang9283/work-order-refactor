import React, { useState } from 'react'
import { Button, Table, Tag, Space, Drawer, Form, Input, TimePicker, Switch, InputNumber, Popconfirm, message, Card } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { saveConfig } from '@shared/store'

const emptyShift = (orgId) => ({ id: '', name: '', orgId, startTime: '08:00', endTime: '20:00', enabled: true, sort: 1 })

export default function ShiftManage({ config, orgId, onRefresh }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form] = Form.useForm()

  const shifts = (config.shifts || []).filter((s) => orgId === 'group' || s.orgId === orgId)

  const openCreate = () => {
    setEditingId(null)
    form.setFieldsValue({ ...emptyShift(orgId) })
    setDrawerOpen(true)
  }

  const openEdit = (record) => {
    setEditingId(record.id)
    form.setFieldsValue({ ...record, startTime: dayjs(record.startTime, 'HH:mm'), endTime: dayjs(record.endTime, 'HH:mm') })
    setDrawerOpen(true)
  }

  const handleSave = () => {
    const values = form.getFieldsValue()
    if (!values.name) return message.warning('请填写班次名称')
    const payload = {
      ...values,
      startTime: values.startTime ? values.startTime.format('HH:mm') : '08:00',
      endTime: values.endTime ? values.endTime.format('HH:mm') : '20:00',
    }
    if (editingId) {
      const idx = shifts.findIndex((s) => s.id === editingId)
      shifts[idx] = { ...shifts[idx], ...payload }
    } else {
      shifts.push({ id: 'shift_' + Date.now(), ...payload })
    }
    saveConfig(config)
    message.success('已保存')
    setDrawerOpen(false)
    onRefresh()
  }

  const toggle = (record, enabled) => {
    if (!enabled) {
      const used = (config.schedules || []).some((s) => s.shiftId === record.id)
      if (used) return message.warning('该班次已被排班表引用，不允许停用')
    }
    record.enabled = enabled
    saveConfig(config)
    message.success(enabled ? '已启用' : '已停用')
    onRefresh()
  }

  const columns = [
    { title: '班次名称', dataIndex: 'name', width: 140 },
    { title: '开始时间', dataIndex: 'startTime', width: 110 },
    { title: '结束时间', dataIndex: 'endTime', width: 110 },
    { title: '跨天', key: 'cross', width: 80, render: (_, r) => (r.endTime <= r.startTime ? <Tag color="purple">是</Tag> : '否') },
    { title: '排序', dataIndex: 'sort', width: 80 },
    { title: '状态', dataIndex: 'enabled', width: 90, render: (v) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
    {
      title: '操作', key: 'action', width: 180, fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <a onClick={() => openEdit(record)}>编辑</a>
          <a onClick={() => toggle(record, !record.enabled)}>{record.enabled ? '停用' : '启用'}</a>
          <Popconfirm title="Demo 阶段只保留入口，删除逻辑未实现。确认？" onConfirm={() => message.info('Demo 阶段删除逻辑未实现')}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="班次管理"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建班次</Button>}
    >
      <Table rowKey="id" columns={columns} dataSource={shifts} pagination={false} size="middle" />

      <Drawer
        title={editingId ? '编辑班次' : '新建班次'}
        width={520}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" onClick={handleSave}>保存</Button></Space>}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="班次名称" rules={[{ required: true }]}><Input placeholder="如 白班 / 夜班" /></Form.Item>
          <Space size={16}>
            <Form.Item name="startTime" label="开始时间" rules={[{ required: true }]}><TimePicker format="HH:mm" minuteStep={5} /></Form.Item>
            <Form.Item name="endTime" label="结束时间" rules={[{ required: true }]}><TimePicker format="HH:mm" minuteStep={5} /></Form.Item>
          </Space>
          <Form.Item name="orgId" label="所属组织" hidden><Input /></Form.Item>
          <Space size={16}>
            <Form.Item name="sort" label="排序"><InputNumber min={1} /></Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
          </Space>
        </Form>
      </Drawer>
    </Card>
  )
}
