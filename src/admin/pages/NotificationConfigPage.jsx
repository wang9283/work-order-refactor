import React, { useMemo, useState } from 'react'
import {
  Card, Table, Tag, Space, Button, Drawer, Form, Input, InputNumber, Select, Switch, Divider,
  Alert, Popconfirm, message, Row, Col,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import {
  NOTIFY_EVENTS, NOTIFY_TARGETS, NOTIFY_CHANNELS, NOTIFY_ROLES, NOTIFY_REMINDER_OPERATORS,
} from '@shared/constants'
import { saveConfig, getVisibleNotificationRules } from '@shared/store'

const emptyRule = (orgId) => ({
  id: '',
  name: '',
  scope: orgId === 'group' ? 'group' : orgId,
  ticketTypeId: undefined,
  event: undefined,
  enabled: true,
  targets: ['executor'],
  roles: [],
  personIds: [],
  channels: ['site'],
  template: '您有一条新的「{typeName}」工单 {ticketNo} 待处理',
  reminderOperator: 'gte',
  reminderDays: 3,
  createdAt: '',
  updatedAt: '',
})

export default function NotificationConfigPage({ config, orgId, onRefresh }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(emptyRule(orgId))
  const [form] = Form.useForm()

  const rules = useMemo(() => getVisibleNotificationRules(config, orgId), [config, orgId])

  // 首版只开放「创建 / 完成」事件与「站内消息」渠道；历史规则的其他值保留可编辑
  const eventOptions = useMemo(() => {
    const base = NOTIFY_EVENTS.filter((e) => ['created', 'completed'].includes(e.value))
    const legacy = NOTIFY_EVENTS.find((e) => e.value === draft.event)
    return legacy && !['created', 'completed'].includes(draft.event) ? [...base, legacy] : base
  }, [draft.event])

  const channelOptions = useMemo(() => {
    const base = NOTIFY_CHANNELS.filter((c) => c.value === 'site')
    const legacy = (draft.channels || []).filter((v) => v !== 'site').map((v) => NOTIFY_CHANNELS.find((c) => c.value === v)).filter(Boolean)
    return [...base, ...legacy]
  }, [draft.channels])

  const visibleTicketTypes = useMemo(() => {
    if (orgId === 'group') return config.ticketTypes || []
    return (config.ticketTypes || []).filter((t) => (
      t.typeOrigin === 'group_standard' || t.ownerOrgId === orgId
    ))
  }, [config, orgId])

  const visiblePersonnel = useMemo(() => {
    if (orgId === 'group') return config.personnel || []
    return (config.personnel || []).filter((p) => p.orgId === orgId)
  }, [config, orgId])

  const typeName = (id) => config.ticketTypes.find((t) => t.id === id)?.name || id
  const eventMeta = (v) => NOTIFY_EVENTS.find((e) => e.value === v) || { label: v, color: 'default' }
  const targetMeta = (v) => NOTIFY_TARGETS.find((t) => t.value === v) || { label: v }
  const channelMeta = (v) => NOTIFY_CHANNELS.find((c) => c.value === v) || { label: v }
  const roleMeta = (v) => NOTIFY_ROLES.find((r) => r.value === v) || { label: v }
  const personName = (id) => config.personnel.find((p) => p.id === id)?.name || id

  const openCreate = () => {
    const rule = emptyRule(orgId)
    setEditingId(null)
    setDraft(rule)
    form.setFieldsValue({
      name: '',
      scope: rule.scope,
      ticketTypeId: undefined,
      event: 'created',
      enabled: true,
      targets: ['executor'],
      roles: [],
      personIds: [],
      channels: ['site'],
      template: rule.template,
      reminderOperator: 'gte',
      reminderDays: 3,
    })
    setDrawerOpen(true)
  }

  const openEdit = (record) => {
    setEditingId(record.id)
    setDraft(JSON.parse(JSON.stringify(record)))
    form.setFieldsValue({ ...record })
    setDrawerOpen(true)
  }

  const save = () => {
    const values = form.getFieldsValue()
    if (!values.name || !values.ticketTypeId || !values.event) {
      return message.warning('请填写规则名称、工单类型和触发事件')
    }
    if (!values.targets || values.targets.length === 0) {
      return message.warning('请至少选择一个通知对象')
    }
    if (!values.channels || values.channels.length === 0) {
      return message.warning('请至少选择一个通知渠道')
    }
    if ((values.event === 'overdue' || values.event === 'nearDeadline') && (!values.reminderDays || values.reminderDays < 1)) {
      return message.warning('超期/临期提醒请填写提醒天数（至少1天）')
    }
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
    if (editingId) {
      const idx = config.notificationRules.findIndex((r) => r.id === editingId)
      if (idx >= 0) {
        config.notificationRules[idx] = {
          ...config.notificationRules[idx],
          ...values,
          updatedAt: now,
        }
      }
    } else {
      config.notificationRules.push({
        id: 'nr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        ...values,
        createdAt: now,
        updatedAt: now,
      })
    }
    saveConfig(config)
    message.success('通知规则已保存')
    setDrawerOpen(false)
    onRefresh()
  }

  const toggleEnabled = (record) => {
    record.enabled = !record.enabled
    record.updatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
    saveConfig(config)
    message.success(record.enabled ? '已启用' : '已停用')
    onRefresh()
  }

  const remove = (record) => {
    config.notificationRules = config.notificationRules.filter((r) => r.id !== record.id)
    saveConfig(config)
    message.success('已删除')
    onRefresh()
  }

  const canEdit = (record) => orgId === 'group' || record.scope !== 'group'

  const columns = [
    { title: '规则名称', dataIndex: 'name', width: 180 },
    { title: '工单类型', dataIndex: 'ticketTypeId', width: 140, render: typeName },
    {
      title: '触发事件', dataIndex: 'event', width: 110,
      render: (v) => <Tag color={eventMeta(v).color}>{eventMeta(v).label}</Tag>,
    },
    {
      title: '提醒条件', key: 'reminder', width: 140,
      render: (_, r) => {
        if (r.event === 'overdue') return `超期 ≥ ${r.reminderDays ?? 3} 天`
        if (r.event === 'nearDeadline') return `临期 ≤ ${r.reminderDays ?? 2} 天`
        return '—'
      },
    },
    {
      title: '通知对象', dataIndex: 'targets', width: 200,
      render: (_, r) => {
        const tags = (r.targets || []).map((t) => <Tag key={t}>{targetMeta(t).label}</Tag>)
        if ((r.targets || []).includes('role') && r.roles?.length) {
          tags.push(<Tag key="roles" color="geekblue">{r.roles.map(roleMeta).map((x) => x.label).join('、')}</Tag>)
        }
        if ((r.targets || []).includes('person') && r.personIds?.length) {
          tags.push(<Tag key="persons" color="purple">{r.personIds.map(personName).join('、')}</Tag>)
        }
        return tags.length ? <Space wrap>{tags}</Space> : '—'
      },
    },
    {
      title: '通知渠道', dataIndex: 'channels', width: 180,
      render: (v) => (v || []).map((c) => <Tag key={c} color="cyan">{channelMeta(c).label}</Tag>),
    },
    {
      title: '作用域', dataIndex: 'scope', width: 110,
      render: (v) => (v === 'group' ? <Tag color="blue">集团标准</Tag> : <Tag>本组织</Tag>),
    },
    {
      title: '状态', dataIndex: 'enabled', width: 90,
      render: (v) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    { title: '更新时间', dataIndex: 'updatedAt', width: 160 },
    {
      title: '操作', key: 'action', width: 180, fixed: 'right',
      render: (_, record) => canEdit(record) ? (
        <Space size="small">
          <a onClick={() => openEdit(record)}>编辑</a>
          <a onClick={() => toggleEnabled(record)}>{record.enabled ? '停用' : '启用'}</a>
          <Popconfirm title="确认删除该通知规则？" onConfirm={() => remove(record)}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Space>
      ) : <span style={{ color: '#999' }}>集团标准只读</span>,
    },
  ]

  const targets = Form.useWatch('targets', form) || draft.targets || []
  const event = Form.useWatch('event', form) || draft.event

  return (
    <Card
      title="工单通知提醒配置"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建通知规则</Button>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="按工单类型和触发事件配置通知对象与渠道；超期/临期支持配置提醒天数。当前 Demo 会同步生成站内消息，App 推送/短信为配置展示。"
      />

      <Table
        rowKey="id"
        columns={columns}
        dataSource={rules}
        pagination={{ pageSize: 10 }}
        size="middle"
        locale={{ emptyText: '暂无通知规则，点击右上角新建' }}
      />

      <Drawer
        title={editingId ? '编辑通知规则' : '新建通知规则'}
        width={720}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" onClick={save}>保存</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" initialValues={draft}>
          <Divider orientation="left">基础信息</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}>
                <Input placeholder="如：生产任务-创建通知" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="scope" label="作用域">
                <Select
                  disabled
                  options={[
                    { label: '集团标准', value: 'group' },
                    ...config.orgs.filter((o) => o.level === 'subsidiary').map((o) => ({ label: o.name, value: o.id })),
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="ticketTypeId" label="适用工单类型" rules={[{ required: true, message: '请选择工单类型' }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={visibleTicketTypes.map((t) => ({ label: `${t.name}（${t.code}）`, value: t.id }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="event" label="触发事件" rules={[{ required: true, message: '请选择触发事件' }]}>
                <Select
                  options={eventOptions}
                  onChange={(v) => {
                    if (v === 'overdue') {
                      form.setFieldsValue({ reminderOperator: 'gte', reminderDays: form.getFieldValue('reminderDays') || 3 })
                    }
                    if (v === 'nearDeadline') {
                      form.setFieldsValue({ reminderOperator: 'lte', reminderDays: form.getFieldValue('reminderDays') || 2 })
                    }
                  }}
                />
              </Form.Item>
            </Col>
          </Row>

          {event === 'overdue' && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="reminderOperator" label="超期条件" rules={[{ required: true, message: '请选择条件' }]}>
                  <Select options={NOTIFY_REMINDER_OPERATORS.filter((o) => o.value === 'gte').map((o) => ({ label: o.label, value: o.value }))} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="reminderDays" label="超期天数" rules={[{ required: true, message: '请输入天数' }]}>
                  <InputNumber min={1} max={365} addonAfter="天" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          )}

          {event === 'nearDeadline' && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="reminderOperator" label="临期条件" rules={[{ required: true, message: '请选择条件' }]}>
                  <Select options={NOTIFY_REMINDER_OPERATORS.filter((o) => o.value === 'lte').map((o) => ({ label: o.label, value: o.value }))} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="reminderDays" label="临期天数" rules={[{ required: true, message: '请输入天数' }]}>
                  <InputNumber min={0} max={365} addonAfter="天" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          )}

          <Form.Item name="enabled" label="是否启用" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>

          <Divider orientation="left">通知设置</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="targets" label="通知对象" rules={[{ required: true, message: '请选择通知对象' }]}>
                <Select mode="multiple" options={NOTIFY_TARGETS.map((t) => ({ label: t.label, value: t.value }))} placeholder="可多选" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="channels" label="通知渠道" rules={[{ required: true, message: '请选择通知渠道' }]}>
                <Select mode="multiple" options={channelOptions} placeholder="可多选" />
              </Form.Item>
            </Col>
          </Row>

          {targets.includes('role') && (
            <Form.Item name="roles" label="指定角色">
              <Select mode="multiple" options={NOTIFY_ROLES.map((r) => ({ label: r.label, value: r.value }))} placeholder="选择需要通知的角色" />
            </Form.Item>
          )}

          {targets.includes('person') && (
            <Form.Item name="personIds" label="指定人员">
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                options={visiblePersonnel.map((p) => ({ label: `${p.name}（${p.code}）`, value: p.id }))}
                placeholder="选择需要通知的人员"
              />
            </Form.Item>
          )}

          <Divider orientation="left">通知内容模板</Divider>
          <Form.Item name="template" label="内容模板">
            <Input.TextArea
              rows={4}
              placeholder="支持占位符：{typeName} 工单类型、{ticketNo} 工单编号、{event} 触发事件"
            />
          </Form.Item>
          <Alert
            type="warning"
            showIcon
            message="可用占位符：{typeName}、{ticketNo}、{event}。实际短信/App 推送接入时，可在此扩展模板变量。"
          />
        </Form>
      </Drawer>
    </Card>
  )
}
