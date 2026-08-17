import React, { useMemo, useState } from 'react'
import { Button, Table, Tag, Space, Drawer, Form, Input, Select, InputNumber, Switch, Popconfirm, message, Card } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { saveConfig } from '@shared/store'

const emptyOrg = () => ({ id: '', name: '', code: '', level: 'subsidiary', parentId: undefined, enabled: true, sort: 1 })

export default function OrgManage({ config, orgId, onRefresh }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form] = Form.useForm()
  const isGroup = orgId === 'group'

  const parentOptions = useMemo(
    () => config.orgs.filter((o) => (o.level === 'group' || o.level === 'region') && o.enabled).map((o) => ({ label: o.name, value: o.id })),
    [config],
  )

  const openCreate = () => {
    setEditingId(null)
    form.setFieldsValue({ ...emptyOrg() })
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
    const exists = config.orgs.find((o) => o.code === values.code && o.id !== editingId)
    if (exists) return message.warning('组织编码已存在')
    if (editingId) {
      const idx = config.orgs.findIndex((o) => o.id === editingId)
      config.orgs[idx] = { ...config.orgs[idx], ...values }
    } else {
      config.orgs.push({ id: 'org_' + Date.now(), ...values })
    }
    saveConfig(config)
    message.success('已保存')
    setDrawerOpen(false)
    onRefresh()
  }

  const toggle = (record, enabled) => {
    if (!enabled) {
      const hasChild = config.orgs.some((o) => o.parentId === record.id && o.enabled)
      const hasType = config.ticketTypes.some((t) => t.ownerOrgId === record.id && t.status === 'published')
      const hasForm = config.forms.some((f) => f.ownerOrgId === record.id)
      if (hasChild || hasType || hasForm) return message.warning('该组织下仍有启用中的组织、工单类型或表单，不允许停用')
    }
    record.enabled = enabled
    saveConfig(config)
    message.success(enabled ? '已启用' : '已停用')
    onRefresh()
  }

  const columns = [
    { title: '组织名称', dataIndex: 'name', width: 200 },
    { title: '组织编码', dataIndex: 'code', width: 120 },
    { title: '层级', dataIndex: 'level', width: 100, render: (v) => ({ group: '集团', region: '片区', subsidiary: '子公司' }[v] || v) },
    { title: '上级组织', dataIndex: 'parentId', width: 180, render: (v) => config.orgs.find((o) => o.id === v)?.name || '—' },
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
      title="行政组织管理"
      extra={isGroup && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建组织</Button>}
    >
      <Table rowKey="id" columns={columns} dataSource={config.orgs} pagination={false} size="middle" />

      <Drawer
        title={editingId ? '编辑组织' : '新建组织'}
        width={520}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" onClick={handleSave}>保存</Button></Space>}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="组织名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="code" label="组织编码（如 QD / DZ）" rules={[{ required: true }]}>
            <Input disabled={!!editingId} />
          </Form.Item>
          <Form.Item name="level" label="层级" rules={[{ required: true }]}>
            <Select options={[{ label: '集团', value: 'group' }, { label: '片区', value: 'region' }, { label: '子公司', value: 'subsidiary' }]} />
          </Form.Item>
          <Form.Item name="parentId" label="上级组织">
            <Select allowClear options={parentOptions} />
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
