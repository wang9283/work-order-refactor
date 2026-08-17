import React, { useMemo, useState } from 'react'
import { Button, Table, Tag, Space, Modal, Form, Input, Select, message, Card } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { saveConfig } from '@shared/store'

export default function ExternalSystemPage({ config, orgId, onRefresh }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form] = Form.useForm()
  const isGroup = orgId === 'group'

  const systems = useMemo(() => {
    if (isGroup) return config.externalSystems || []
    return (config.externalSystems || []).filter((s) => s.orgId === orgId || s.scope === 'all')
  }, [config, isGroup, orgId])

  const openCreate = () => {
    setEditingId(null)
    form.setFieldsValue({ name: '', systemCode: '', orgId: 'group', scope: 'all', enabled: true })
    setModalOpen(true)
  }

  const openEdit = (record) => {
    setEditingId(record.id)
    form.setFieldsValue({ ...record })
    setModalOpen(true)
  }

  const save = () => {
    const values = form.getFieldsValue()
    if (!values.name || !values.systemCode) return message.warning('请填写名称和编码')
    if (editingId) {
      const idx = config.externalSystems.findIndex((s) => s.id === editingId)
      config.externalSystems[idx] = { ...config.externalSystems[idx], ...values }
    } else {
      config.externalSystems.push({ id: 'ext_' + Date.now(), ...values, apiKey: null })
    }
    saveConfig(config)
    message.success('已保存')
    setModalOpen(false)
    onRefresh()
  }

  const genKey = (record) => {
    record.apiKey = 'sk-' + Math.random().toString(36).slice(2, 10).toUpperCase()
    saveConfig(config)
    message.success('已生成模拟 Key')
    onRefresh()
  }

  const revokeKey = (record) => {
    record.apiKey = null
    saveConfig(config)
    message.success('已吊销 Key')
    onRefresh()
  }

  const columns = [
    { title: '系统名称', dataIndex: 'name', width: 180 },
    { title: '系统编码', dataIndex: 'systemCode', width: 140 },
    { title: '所属组织', dataIndex: 'orgId', width: 160, render: (v) => config.orgs.find((o) => o.id === v)?.name || v },
    { title: '服务范围', dataIndex: 'scope', width: 120, render: (v) => (v === 'all' ? '全部子公司' : '本组织') },
    { title: '状态', dataIndex: 'enabled', width: 90, render: (v) => (v !== false ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
    {
      title: 'API Key', dataIndex: 'apiKey', width: 220,
      render: (v) => v ? <span style={{ fontFamily: 'monospace' }}>{v}</span> : '—',
    },
    {
      title: '操作', key: 'action', width: 260, fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          {isGroup && <a onClick={() => openEdit(record)}>编辑</a>}
          {isGroup && !record.apiKey && <a onClick={() => genKey(record)}>生成Key</a>}
          {isGroup && record.apiKey && <a onClick={() => revokeKey(record)} style={{ color: '#ff4d4f' }}>吊销Key</a>}
          {!isGroup && <span style={{ color: '#999' }}>只读</span>}
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="外部系统 / API Key"
      extra={isGroup && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建外部系统</Button>}
    >
      <Table rowKey="id" columns={columns} dataSource={systems} pagination={{ pageSize: 8 }} size="middle" />

      <Modal title={editingId ? '编辑外部系统' : '新建外部系统'} open={modalOpen} onOk={save} onCancel={() => setModalOpen(false)} width={520}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="系统名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="systemCode" label="系统编码" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="orgId" label="所属组织">
            <Select options={config.orgs.filter((o) => o.level !== 'region').map((o) => ({ label: o.name, value: o.id }))} />
          </Form.Item>
          <Form.Item name="scope" label="服务范围">
            <Select options={[{ label: '全部子公司', value: 'all' }, { label: '本组织', value: 'org' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
