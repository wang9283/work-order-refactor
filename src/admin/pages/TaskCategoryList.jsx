import React, { useMemo, useState } from 'react'
import { Button, Table, Tag, Space, Drawer, Form, Input, Select, Switch, InputNumber, Popconfirm, message, Card } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { saveConfig, nextCategoryCode } from '@shared/store'

const emptyCategory = (orgId) => ({
  id: '',
  name: '',
  code: '',
  orgId: orgId === 'group' ? 'group' : orgId,
  enabled: true,
  sort: 1,
})

export default function TaskCategoryList({ config, orgId, onRefresh }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form] = Form.useForm()

  const visibleCategories = useMemo(() => {
    if (orgId === 'group') return config.categories
    return config.categories.filter((c) => c.orgId === 'group' || c.orgId === orgId)
  }, [config, orgId])

  const openCreate = () => {
    setEditingId(null)
    form.setFieldsValue({ ...emptyCategory(orgId), code: nextCategoryCode(config) })
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
    const exists = config.categories.find((c) => c.code === values.code && c.id !== editingId)
    if (exists) return message.warning('编码已存在')
    if (editingId) {
      const idx = config.categories.findIndex((c) => c.id === editingId)
      config.categories[idx] = { ...config.categories[idx], ...values }
    } else {
      config.categories.push({ id: 'cat_' + Date.now(), ...values })
    }
    saveConfig(config)
    message.success('已保存')
    setDrawerOpen(false)
    onRefresh()
  }

  const toggle = (record, enabled) => {
    if (!enabled) {
      const used = config.ticketTypes.some((t) => t.categoryId === record.id && t.status === 'published')
      if (used) return message.warning('该任务大类下仍有已发布工单类型，不允许停用')
    }
    record.enabled = enabled
    saveConfig(config)
    message.success(enabled ? '已启用' : '已停用')
    onRefresh()
  }

  const columns = [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '编码', dataIndex: 'code', width: 140 },
    {
      title: '所属组织', dataIndex: 'orgId', width: 160,
      render: (v) => config.orgs.find((o) => o.id === v)?.name || v,
    },
    { title: '排序', dataIndex: 'sort', width: 80 },
    {
      title: '状态', dataIndex: 'enabled', width: 100,
      render: (v) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '操作', key: 'action', width: 180, fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <a onClick={() => openEdit(record)}>编辑</a>
          <a onClick={() => toggle(record, !record.enabled)}>{record.enabled ? '停用' : '启用'}</a>
          <Popconfirm title="Demo 阶段暂不实现删除逻辑，仅保留入口。确认保留？" onConfirm={() => message.info('Demo 阶段删除逻辑未实现')}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="任务大类"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建任务大类</Button>}
    >
      <Table rowKey="id" columns={columns} dataSource={visibleCategories} pagination={{ pageSize: 8 }} size="middle" />

      <Drawer
        title={editingId ? '编辑任务大类' : '新建任务大类'}
        width={520}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" onClick={handleSave}>保存</Button></Space>}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="大类名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="大类编码（大写字母/数字，全局唯一）" rules={[{ required: true }]}>
            <Input disabled={!!editingId} />
          </Form.Item>
          <Form.Item name="orgId" label="所属组织">
            <Select
              disabled={orgId !== 'group'}
              options={config.orgs.filter((o) => o.level !== 'region').map((o) => ({ label: o.name, value: o.id }))}
            />
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
