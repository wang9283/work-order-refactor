import React, { useMemo, useState } from 'react'
import { Button, Table, Tag, Space, Drawer, Form, Input, Select, InputNumber, Switch, Popconfirm, message, Card, Alert } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { saveConfig } from '@shared/store'

const DICT_TYPES = ['洗消类型', '生产线', '物料单位']

const emptyDict = (orgId) => ({ id: '', type: '洗消类型', code: '', name: '', orgId: orgId === 'group' ? 'group' : orgId, enabled: true, sort: 1 })

export default function DataDictManage({ config, orgId, onRefresh }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form] = Form.useForm()

  const visibleItems = useMemo(() => {
    const items = config.dictionaries || []
    if (orgId === 'group') return items
    return items.filter((d) => d.orgId === 'group' || d.orgId === orgId)
  }, [config, orgId])

  const openCreate = () => {
    setEditingId(null)
    form.setFieldsValue({ ...emptyDict(orgId) })
    setDrawerOpen(true)
  }

  const openEdit = (record) => {
    setEditingId(record.id)
    form.setFieldsValue({ ...record })
    setDrawerOpen(true)
  }

  const handleSave = () => {
    const values = form.getFieldsValue()
    if (!values.name || !values.code) return message.warning('请填写名称和编码')
    const exists = (config.dictionaries || []).find((d) => d.code === values.code && d.id !== editingId)
    if (exists) return message.warning('编码已存在')
    if (editingId) {
      const idx = config.dictionaries.findIndex((d) => d.id === editingId)
      config.dictionaries[idx] = { ...config.dictionaries[idx], ...values }
    } else {
      config.dictionaries.push({ id: 'dict_' + Date.now(), ...values })
    }
    saveConfig(config)
    message.success('已保存')
    setDrawerOpen(false)
    onRefresh()
  }

  const toggle = (record, enabled) => {
    record.enabled = enabled
    saveConfig(config)
    message.success(enabled ? '已启用' : '已停用')
    onRefresh()
  }

  const columns = [
    { title: '字典类型', dataIndex: 'type', width: 120 },
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '编码', dataIndex: 'code', width: 150 },
    { title: '所属组织', dataIndex: 'orgId', width: 160, render: (v) => config.orgs.find((o) => o.id === v)?.name || v },
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
      title="数据字典"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建字典项</Button>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="本页维护通用枚举（洗消类型、生产线、物料单位等）。任务大类属于专用业务字典，请前往「工单类型配置 > 任务大类」页面维护。"
      />
      <Table rowKey="id" columns={columns} dataSource={visibleItems} pagination={{ pageSize: 8 }} size="middle" />

      <Drawer
        title={editingId ? '编辑字典项' : '新建字典项'}
        width={520}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" onClick={handleSave}>保存</Button></Space>}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="type" label="字典类型" rules={[{ required: true }]}>
            <Select options={DICT_TYPES.map((t) => ({ label: t, value: t }))} />
          </Form.Item>
          <Form.Item name="name" label="字典项名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="code" label="字典项编码（全局唯一）" rules={[{ required: true }]}>
            <Input disabled={!!editingId} />
          </Form.Item>
          <Form.Item name="orgId" label="所属组织">
            <Select disabled={orgId !== 'group'} options={config.orgs.filter((o) => o.level !== 'region').map((o) => ({ label: o.name, value: o.id }))} />
          </Form.Item>
          <Space size={16}>
            <Form.Item name="sort" label="排序"><InputNumber min={1} /></Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
          </Space>
        </Form>
      </Drawer>
    </Card>
  )
}
