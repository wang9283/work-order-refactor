import React, { useState } from 'react'
import { Button, Table, Tag, Space, Modal, Form, Input, Select, Switch, Popconfirm, message, Card, Tabs } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { saveConfig } from '@shared/store'

export default function ProductionLineMaterial({ config, orgId, onRefresh }) {
  const [lineModalOpen, setLineModalOpen] = useState(false)
  const [lineEditingId, setLineEditingId] = useState(null)
  const [lineForm] = Form.useForm()
  const [matModalOpen, setMatModalOpen] = useState(false)
  const [matEditingId, setMatEditingId] = useState(null)
  const [matForm] = Form.useForm()

  const lines = (config.productionLines || []).filter((l) => orgId === 'group' || l.orgId === orgId)
  const materials = (config.materials || []).filter((m) => orgId === 'group' || m.orgId === orgId)

  const openLineModal = (record) => {
    setLineEditingId(record?.id || null)
    lineForm.setFieldsValue(record || { id: '', name: '', code: '', orgId, enabled: true, sort: 1 })
    setLineModalOpen(true)
  }

  const saveLine = () => {
    const values = lineForm.getFieldsValue()
    if (!values.name || !values.code) return message.warning('请填写名称和编码')
    if (lineEditingId) {
      const idx = config.productionLines.findIndex((l) => l.id === lineEditingId)
      config.productionLines[idx] = { ...config.productionLines[idx], ...values }
    } else {
      config.productionLines.push({ id: 'pl_' + Date.now(), ...values })
    }
    saveConfig(config)
    message.success('已保存')
    setLineModalOpen(false)
    onRefresh()
  }

  const openMatModal = (record) => {
    setMatEditingId(record?.id || null)
    matForm.setFieldsValue(record || { id: '', name: '', code: '', unit: '吨', orgId, enabled: true })
    setMatModalOpen(true)
  }

  const saveMat = () => {
    const values = matForm.getFieldsValue()
    if (!values.name || !values.code) return message.warning('请填写名称和编码')
    if (matEditingId) {
      const idx = config.materials.findIndex((m) => m.id === matEditingId)
      config.materials[idx] = { ...config.materials[idx], ...values }
    } else {
      config.materials.push({ id: 'mat_' + Date.now(), ...values })
    }
    saveConfig(config)
    message.success('已保存')
    setMatModalOpen(false)
    onRefresh()
  }

  const commonColumns = (orgName) => [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '编码', dataIndex: 'code', width: 140 },
    { title: '所属组织', dataIndex: 'orgId', width: 160, render: (v) => orgName(v) },
    { title: '状态', dataIndex: 'enabled', width: 90, render: (v) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
  ]

  const orgName = (v) => config.orgs.find((o) => o.id === v)?.name || v

  return (
    <Card title="生产线 / 物料档案">
      <Tabs items={[
        {
          key: 'lines',
          label: '生产线',
          children: (
            <>
              <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => openLineModal()}>新建生产线</Button>
              <Table rowKey="id" size="middle" pagination={false} dataSource={lines} columns={[
                ...commonColumns(orgName),
                { title: '排序', dataIndex: 'sort', width: 80 },
                { title: '操作', key: 'action', width: 180, render: (_, record) => (
                  <Space size="small">
                    <a onClick={() => openLineModal(record)}>编辑</a>
                    <a onClick={() => {
                      record.enabled = !record.enabled
                      saveConfig(config)
                      onRefresh()
                    }}>{record.enabled ? '停用' : '启用'}</a>
                    <Popconfirm title="Demo 阶段只保留入口，删除逻辑未实现。确认？" onConfirm={() => message.info('Demo 阶段删除逻辑未实现')}>
                      <a style={{ color: '#ff4d4f' }}>删除</a>
                    </Popconfirm>
                  </Space>
                ) },
              ]} />
            </>
          ),
        },
        {
          key: 'materials',
          label: '物料档案',
          children: (
            <>
              <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => openMatModal()}>新建物料</Button>
              <Table rowKey="id" size="middle" pagination={false} dataSource={materials} columns={[
                ...commonColumns(orgName),
                { title: '单位', dataIndex: 'unit', width: 100 },
                { title: '操作', key: 'action', width: 180, render: (_, record) => (
                  <Space size="small">
                    <a onClick={() => openMatModal(record)}>编辑</a>
                    <a onClick={() => {
                      record.enabled = !record.enabled
                      saveConfig(config)
                      onRefresh()
                    }}>{record.enabled ? '停用' : '启用'}</a>
                    <Popconfirm title="Demo 阶段只保留入口，删除逻辑未实现。确认？" onConfirm={() => message.info('Demo 阶段删除逻辑未实现')}>
                      <a style={{ color: '#ff4d4f' }}>删除</a>
                    </Popconfirm>
                  </Space>
                ) },
              ]} />
            </>
          ),
        },
      ]} />

      <Modal title={lineEditingId ? '编辑生产线' : '新建生产线'} open={lineModalOpen} onOk={saveLine} onCancel={() => setLineModalOpen(false)} width={520}>
        <Form form={lineForm} layout="vertical">
          <Form.Item name="name" label="生产线名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="code" label="生产线编码" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="orgId" label="所属组织"><Select options={config.orgs.filter((o) => o.level === 'subsidiary').map((o) => ({ label: o.name, value: o.id }))} /></Form.Item>
          <Space size={16}>
            <Form.Item name="sort" label="排序"><Input /></Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal title={matEditingId ? '编辑物料' : '新建物料'} open={matModalOpen} onOk={saveMat} onCancel={() => setMatModalOpen(false)} width={520}>
        <Form form={matForm} layout="vertical">
          <Form.Item name="name" label="物料名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="code" label="物料编码" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="unit" label="单位"><Input /></Form.Item>
          <Form.Item name="orgId" label="所属组织"><Select options={config.orgs.filter((o) => o.level === 'subsidiary').map((o) => ({ label: o.name, value: o.id }))} /></Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
