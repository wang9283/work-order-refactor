import React, { useMemo, useState } from 'react'
import {
  Button, Table, Tag, Space, Drawer, Form, Input, Select, Switch, Divider,
  Card, Row, Col, Modal, InputNumber, Popconfirm, message, Radio,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { FIELD_TYPES, FIELD_STRATEGY } from '@shared/constants'
import { saveConfig } from '@shared/store'

const emptyField = () => ({
  id: '',
  key: '',
  name: '',
  type: 'text',
  required: false,
  readonly: false,
  strategy: 'optional',
  sourceSystemId: undefined,
  options: [],
  sort: 1,
})

const emptySubForm = () => ({ id: '', name: '', sort: 1, minRecords: 1, maxRecords: undefined, fields: [] })

export default function FormTemplateList({ config, orgId, onRefresh }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingFormId, setEditingFormId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [fieldModalOpen, setFieldModalOpen] = useState(false)
  const [fieldTarget, setFieldTarget] = useState('main')
  const [fieldForm] = Form.useForm()
  const [subFormModalOpen, setSubFormModalOpen] = useState(false)
  const [subFormForm] = Form.useForm()

  const forms = useMemo(() => {
    if (orgId === 'group') return config.forms
    return config.forms.filter((f) => f.visibility === 'group' || f.ownerOrgId === orgId)
  }, [config, orgId])

  const latestVersion = (f) => {
    if (!f?.versions?.length) return null
    return [...f.versions].sort((a, b) => b.versionNo - a.versionNo)[0]
  }

  const openCreate = () => {
    setEditingFormId(null)
    setDraft({ id: '', name: '', ownerOrgId: orgId, visibility: orgId === 'group' ? 'group' : 'org', orderRule: 'free', versions: [{ versionNo: 1, status: 'draft', mainFields: [], subForms: [], conditionRules: [] }] })
    setDrawerOpen(true)
  }

  const openEdit = (record) => {
    setEditingFormId(record.id)
    const copy = JSON.parse(JSON.stringify(record))
    const latest = [...copy.versions].sort((a, b) => b.versionNo - a.versionNo)[0]
    if (latest && latest.status === 'published') {
      copy.versions.push({
        versionNo: latest.versionNo + 1,
        status: 'draft',
        mainFields: JSON.parse(JSON.stringify(latest.mainFields || [])),
        subForms: JSON.parse(JSON.stringify(latest.subForms || [])),
        conditionRules: JSON.parse(JSON.stringify(latest.conditionRules || [])),
      })
    }
    setDraft(copy)
    setDrawerOpen(true)
  }

  const currentVersion = () => {
    if (!draft?.versions?.length) return null
    return [...draft.versions].sort((a, b) => b.versionNo - a.versionNo)[0]
  }

  const persist = (publish = false) => {
    const v = currentVersion()
    if (publish) {
      v.status = 'published'
      v.publishedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
    }
    draft.updatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
    if (editingFormId) {
      const idx = config.forms.findIndex((f) => f.id === editingFormId)
      if (idx >= 0) config.forms[idx] = draft
    } else {
      draft.id = 'form_' + Date.now()
      config.forms.push(draft)
    }
    saveConfig(config)
    message.success(publish ? '表单已发布' : '表单已保存')
    setDrawerOpen(false)
    onRefresh()
  }

  const columns = [
    { title: '表单名称', dataIndex: 'name', width: 180 },
    { title: '顺序规则', dataIndex: 'orderRule', width: 100, render: (v) => (v === 'strict' ? '严格顺序' : '自由顺序') },
    { title: '版本', key: 'version', width: 80, render: (_, r) => `v${latestVersion(r)?.versionNo || 0}` },
    { title: '主字段数', key: 'mainFields', width: 90, render: (_, r) => latestVersion(r)?.mainFields?.length || 0 },
    { title: '子表单数', key: 'subForms', width: 90, render: (_, r) => latestVersion(r)?.subForms?.length || 0 },
    { title: '状态', key: 'status', width: 100, render: (_, r) => {
      const v = latestVersion(r)
      return v?.status === 'published' ? <Tag color="green">已发布</Tag> : <Tag color="orange">编辑中</Tag>
    } },
    { title: '更新时间', dataIndex: 'updatedAt', width: 160 },
    {
      title: '操作', key: 'action', width: 180, fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <a onClick={() => openEdit(record)}>编辑</a>
          {latestVersion(record)?.status === 'draft' && <a onClick={() => {
            const v = latestVersion(record)
            if (!v?.mainFields?.length) return message.warning('主表单至少需要一个字段')
            v.status = 'published'
            v.publishedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
            record.updatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
            saveConfig(config)
            onRefresh()
          }}>发布</a>}
          <Popconfirm title="确认删除？" onConfirm={() => {
            config.forms = config.forms.filter((f) => f.id !== record.id)
            saveConfig(config)
            onRefresh()
          }}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const v = currentVersion()

  const openFieldModal = (target, record) => {
    setFieldTarget(target)
    if (record) {
      fieldForm.setFieldsValue({ ...record, optionsText: (record.options || []).map((o) => `${o.value}=${o.label}`).join('\n') })
    } else {
      fieldForm.resetFields()
      fieldForm.setFieldsValue({ ...emptyField(), sort: (target === 'main' ? v?.mainFields?.length : v?.subForms?.find((s) => s.id === target)?.fields?.length) || 0 + 1 })
    }
    setFieldModalOpen(true)
  }

  const handleFieldOk = () => {
    const values = fieldForm.getFieldsValue()
    if (!values.name || !values.key) return message.warning('请填写字段名称和Key')
    const field = {
      id: values.id || 'f_' + Date.now(),
      key: values.key,
      name: values.name,
      type: values.type,
      required: values.required,
      readonly: values.readonly,
      strategy: values.strategy,
      sourceSystemId: values.sourceSystemId,
      sort: values.sort || 1,
    }
    if (values.type === 'singleSelect' || values.type === 'multiSelect') {
      field.options = (values.optionsText || '').split('\n').map((s) => s.trim()).filter(Boolean).map((line) => {
        const idx = line.indexOf('=')
        return idx >= 0 ? { value: line.slice(0, idx).trim(), label: line.slice(idx + 1).trim() } : { value: line, label: line }
      })
    }
    if (fieldTarget === 'main') {
      if (values.id) {
        const idx = v.mainFields.findIndex((f) => f.id === values.id)
        v.mainFields[idx] = field
      } else v.mainFields.push(field)
    } else {
      const sub = v.subForms.find((s) => s.id === fieldTarget)
      if (values.id) {
        const idx = sub.fields.findIndex((f) => f.id === values.id)
        sub.fields[idx] = field
      } else sub.fields.push(field)
    }
    setFieldModalOpen(false)
  }

  const openSubFormModal = (record) => {
    if (record) subFormForm.setFieldsValue(record)
    else subFormForm.setFieldsValue({ ...emptySubForm(), sort: (v?.subForms?.length || 0) + 1 })
    setSubFormModalOpen(true)
  }

  const handleSubFormOk = () => {
    const values = subFormForm.getFieldsValue()
    if (!values.name) return message.warning('请填写子表单名称')
    if (values.maxRecords && values.maxRecords < values.minRecords) return message.warning('最大记录数不能小于最小记录数')
    if (values.id) {
      const idx = v.subForms.findIndex((s) => s.id === values.id)
      v.subForms[idx] = { ...v.subForms[idx], ...values }
    } else {
      v.subForms.push({ ...values, id: 'sf_' + Date.now(), fields: [] })
    }
    setSubFormModalOpen(false)
  }

  return (
    <>
      <Card title="工单模板构建" extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建表单</Button>}>
        <Table rowKey="id" columns={columns} dataSource={forms} pagination={{ pageSize: 8 }} size="middle" />
      </Card>

      <Drawer title={editingFormId ? '编辑表单' : '新建表单'} width={1080} open={drawerOpen} onClose={() => setDrawerOpen(false)}
        extra={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button onClick={() => persist(false)}>保存草稿</Button><Button type="primary" onClick={() => persist(true)}>保存并发布</Button></Space>}>
        {draft && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={16}>
              <Col span={10}>
                <Form.Item label="表单名称" required>
                  <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item label="子表单顺序规则">
                  <Radio.Group value={draft.orderRule} onChange={(e) => setDraft((d) => ({ ...d, orderRule: e.target.value }))} options={[{ label: '严格顺序', value: 'strict' }, { label: '自由顺序', value: 'free' }]} optionType="button" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="可见范围">
                  <Select value={draft.visibility} onChange={(val) => setDraft((d) => ({ ...d, visibility: val }))} options={[{ label: '集团全局可见', value: 'group' }, { label: '仅本组织', value: 'org' }]} />
                </Form.Item>
              </Col>
            </Row>

            <Divider orientation="left">主表单字段</Divider>
            <Button type="dashed" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => openFieldModal('main')}>添加字段</Button>
            <Table rowKey="id" size="small" dataSource={v?.mainFields || []} pagination={false} columns={fieldColumns(config, (record) => openFieldModal('main', record), (id) => { v.mainFields = v.mainFields.filter((f) => f.id !== id) })} />

            <Divider orientation="left">子表单</Divider>
            <Button type="dashed" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => openSubFormModal()}>添加子表单</Button>
            {(v?.subForms || []).map((sub) => (
              <Card key={sub.id} size="small" style={{ marginBottom: 12 }} title={`${sub.name}（至少${sub.minRecords}条${sub.maxRecords ? `，最多${sub.maxRecords}条` : ''}）`}
                extra={<Space><a onClick={() => openSubFormModal(sub)}>编辑</a><a style={{ color: '#ff4d4f' }} onClick={() => { v.subForms = v.subForms.filter((s) => s.id !== sub.id) }}>删除</a></Space>}>
                <Button type="dashed" icon={<PlusOutlined />} style={{ marginBottom: 8 }} onClick={() => openFieldModal(sub.id)}>添加字段</Button>
                <Table rowKey="id" size="small" dataSource={sub.fields} pagination={false} columns={fieldColumns(config, (record) => openFieldModal(sub.id, record), (id) => { sub.fields = sub.fields.filter((f) => f.id !== id) })} />
              </Card>
            ))}

              <Divider orientation="left">条件逻辑</Divider>
              <Button disabled style={{ marginBottom: 12 }}>条件逻辑（预留）</Button>

          </Space>
        )}
      </Drawer>

      <Modal title="字段配置" open={fieldModalOpen} onOk={handleFieldOk} onCancel={() => setFieldModalOpen(false)} width={640}>
        <Form form={fieldForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}><Form.Item name="name" label="字段名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="key" label="字段Key" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="type" label="字段类型" rules={[{ required: true }]}><Select options={FIELD_TYPES} /></Form.Item></Col>
            <Col span={12}><Form.Item name="strategy" label="完成策略" rules={[{ required: true }]}><Select options={Object.entries(FIELD_STRATEGY).map(([k, v]) => ({ label: v.label, value: k }))} /></Form.Item></Col>
            <Col span={8}><Form.Item name="required" label="必填" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={8}><Form.Item name="readonly" label="只读" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={8}><Form.Item name="sort" label="排序"><InputNumber min={1} /></Form.Item></Col>
            <Col span={24}><Form.Item name="sourceSystemId" label="外部数据来源"><Select allowClear options={config.externalSystems.map((s) => ({ label: s.name, value: s.id }))} /></Form.Item></Col>
            <Col span={24}><Form.Item name="optionsText" label="选项列表（每行 值=显示文本）"><Input.TextArea rows={3} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <Modal title="子表单配置" open={subFormModalOpen} onOk={handleSubFormOk} onCancel={() => setSubFormModalOpen(false)} width={520}>
        <Form form={subFormForm} layout="vertical">
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="name" label="子表单名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Row gutter={16}>
            <Col span={8}><Form.Item name="sort" label="排序" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item></Col>
            <Col span={8}><Form.Item name="minRecords" label="至少提交" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item></Col>
            <Col span={8}><Form.Item name="maxRecords" label="最多提交"><InputNumber min={0} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </>
  )
}

function fieldColumns(config, onEdit, onDelete) {
  return [
    { title: '排序', dataIndex: 'sort', width: 60 },
    { title: '字段名称', dataIndex: 'name', width: 130 },
    { title: 'Key', dataIndex: 'key', width: 130 },
    { title: '类型', dataIndex: 'type', width: 90, render: (v) => FIELD_TYPES.find((f) => f.value === v)?.label || v },
    { title: '策略', dataIndex: 'strategy', width: 100, render: (v) => <Tag color={FIELD_STRATEGY[v]?.color}>{FIELD_STRATEGY[v]?.label}</Tag> },
    { title: '必填', dataIndex: 'required', width: 60, render: (v) => (v ? '是' : '—') },
    { title: '外部来源', dataIndex: 'sourceSystemId', width: 130, render: (v) => config.externalSystems.find((s) => s.id === v)?.name || '—' },
    { title: '操作', key: 'action', width: 120, render: (_, record) => (
      <Space size="small">
        <a onClick={() => onEdit(record)}>编辑</a>
        <a style={{ color: '#ff4d4f' }} onClick={() => onDelete(record.id)}>删除</a>
      </Space>
    ) },
  ]
}
