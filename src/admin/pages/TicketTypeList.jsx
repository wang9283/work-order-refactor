import React, { useMemo, useState } from 'react'
import {
  Button, Table, Tag, Space, Drawer, Form, Input, Select, Switch, Divider,
  Card, Row, Col, Alert, Popconfirm, message, TimePicker, InputNumber, Checkbox, Collapse,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
  TICKET_TYPE_STATUS, TRIGGER_TYPE, TRIGGER_FREQ, NOTIFY_TARGETS, NOTIFY_CHANNELS,
} from '@shared/constants'
import {
  getCategories, getVisibleForms, getLatestPublishedVersion, getFormById,
  saveConfig, nextCode, resolveTicketType,
} from '@shared/store'

const emptyType = (code) => ({
  id: '',
  name: '',
  code: code || '',
  categoryId: undefined,
  ownerOrgId: undefined,
  typeOrigin: 'group_standard',
  status: 'draft',
  formId: undefined,
  formVersion: 0,
  remark: '',
  triggerRules: [{ id: 'tr_' + Date.now(), type: 'manual', enabled: true, name: '手工创建' }],
  timeWindow: { enabled: false, startTime: '08:00', endTime: '18:00', earlyStartMinutes: 0, lateEndMinutes: 0 },
  notify: { enabled: false, targets: [], channels: [] },
  executorScope: { defaultExecutors: [], otherExecutors: [] },
  orgOverrides: {},
  generatedCount: 0,
})

export default function TicketTypeList({ config, orgId, onRefresh }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingBase, setEditingBase] = useState(null)
  const [form] = Form.useForm()
  const [draft, setDraft] = useState(emptyType(nextCode(config)))

  const visibleTypes = useMemo(() => {
    if (orgId === 'group') return config.ticketTypes
    return config.ticketTypes.filter((t) => t.typeOrigin === 'group_standard' || t.ownerOrgId === orgId)
  }, [config, orgId])

  const openCreate = () => {
    const code = nextCode(config, 'T')
    setDraft(emptyType(code))
    setEditingId(null)
    setEditingBase(null)
    form.setFieldsValue({ name: '', code, categoryId: undefined, ownerOrgId: orgId === 'group' ? 'group' : orgId, typeOrigin: orgId === 'group' ? 'group_standard' : 'subsidiary', formId: undefined, remark: '' })
    setDrawerOpen(true)
  }

  const openEdit = (record) => {
    setEditingId(record.id)
    setEditingBase(record)
    const effective = orgId === 'group' ? record : resolveTicketType(record, orgId)
    setDraft(JSON.parse(JSON.stringify(effective)))
    form.setFieldsValue({
      name: record.name,
      code: record.code,
      categoryId: record.categoryId,
      ownerOrgId: record.ownerOrgId,
      typeOrigin: record.typeOrigin,
      formId: record.formId,
      formVersion: record.formVersion,
      remark: record.remark,
    })
    setDrawerOpen(true)
  }

  const handleSave = (publish = false) => {
    const values = form.getFieldsValue()
    const idx = editingId ? config.ticketTypes.findIndex((t) => t.id === editingId) : -1

    // 子公司覆盖集团标准类型：只保存本组织覆盖层，不动集团基础配置
    if (idx >= 0 && orgId !== 'group' && config.ticketTypes[idx].typeOrigin === 'group_standard') {
      const rec = config.ticketTypes[idx]
      rec.orgOverrides = {
        ...(rec.orgOverrides || {}),
        [orgId]: {
          triggerRules: draft.triggerRules,
          timeWindow: draft.timeWindow,
          notify: draft.notify,
          executorScope: draft.executorScope || { defaultExecutors: [], otherExecutors: [] },
            apiEnabled: true,
        },
      }
      rec.updatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
      saveConfig(config)
      message.success('本组织覆盖配置已保存')
      setDrawerOpen(false)
      onRefresh()
      return
    }

    const payload = {
      ...draft,
      ...values,
      status: publish ? 'published' : idx >= 0 ? (config.ticketTypes[idx]?.status || 'draft') : 'draft',
      id: editingId || 't_' + Date.now(),
      updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    }
    if (payload.typeOrigin === 'group_standard') {
      payload.ownerOrgId = 'group'
    }
    if (idx >= 0) config.ticketTypes[idx] = payload
    else config.ticketTypes.push(payload)
    saveConfig(config)
    message.success(publish ? '已发布' : '已保存')
    setDrawerOpen(false)
    onRefresh()
  }

  const handlePublish = (record) => {
    record.status = 'published'
    record.updatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
    saveConfig(config)
    message.success('已发布')
    onRefresh()
  }

  const handleDisable = (record) => {
    record.status = 'disabled'
    saveConfig(config)
    message.success('已停用')
    onRefresh()
  }

  const handleDelete = (record) => {
    if (record.generatedCount > 0) {
      message.warning('已产生工单数据，不允许删除，只能停用')
      return
    }
    config.ticketTypes = config.ticketTypes.filter((t) => t.id !== record.id)
    saveConfig(config)
    message.success('已删除')
    onRefresh()
  }

  const formOptions = useMemo(() => getVisibleForms(config, orgId), [config, orgId])

  const columns = [
    {
      title: '名称', dataIndex: 'name', width: 220,
      render: (v, r) => (
        <Space size={4}>
          <span>{v}</span>
          <Tag>{r.typeOrigin === 'group_standard' ? '集团标准' : '子公司自有'}</Tag>
        </Space>
      ),
    },
    { title: '编码', dataIndex: 'code', width: 110 },
    {
      title: '任务大类', dataIndex: 'categoryId', width: 110,
      render: (v) => config.categories.find((c) => c.id === v)?.name || v,
    },
    {
      title: '表单', key: 'form', width: 180,
      render: (_, r) => {
        const f = getFormById(config, r.formId)
        return f ? `${f.name} v${r.formVersion || getLatestPublishedVersion(f)?.versionNo || '—'}` : '—'
      },
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v) => <Tag color={TICKET_TYPE_STATUS[v]?.color}>{TICKET_TYPE_STATUS[v]?.label}</Tag>,
    },
    {
      title: '操作', key: 'action', width: 220, fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <a onClick={() => openEdit(record)}>编辑</a>
          {record.status === 'draft' && <a onClick={() => handlePublish(record)}>发布</a>}
          {record.status === 'published' && <a onClick={() => handleDisable(record)}>停用</a>}
          {record.status === 'disabled' && <a onClick={() => { record.status = 'published'; saveConfig(config); onRefresh() }}>启用</a>}
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record)}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <Card
        title="工单类型配置"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建工单类型</Button>}
        style={{ marginBottom: 12 }}
      >
        <Table rowKey="id" columns={columns} dataSource={visibleTypes} pagination={{ pageSize: 8 }} size="middle" />
      </Card>

      <Drawer
        title={editingId ? '编辑工单类型' : '新建工单类型'}
        width={980}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button onClick={() => handleSave(false)}>保存草稿</Button>
            <Button type="primary" onClick={() => handleSave(true)}>保存并发布</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" initialValues={draft}>
          <Divider orientation="left">基础信息</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="name" label="工单类型名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="如：生产任务" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="code" label="类型编码（全局唯一）" rules={[{ required: true, message: '请输入编码' }]}>
                <Input disabled={editingId && config.ticketTypes.find((t) => t.id === editingId)?.status === 'published'} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="categoryId" label="任务大类" rules={[{ required: true, message: '请选择任务大类' }]}>
                <Select options={getCategories(config, orgId).map((c) => ({ label: c.name, value: c.id }))} />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">表单绑定</Divider>
          <Row gutter={16}>
            <Col span={10}>
              <Form.Item name="formId" label="绑定表单（仅已发布）" rules={[{ required: true, message: '请选择表单' }]}>
                <Select
                  options={formOptions.map((f) => ({ label: f.name, value: f.id }))}
                  onChange={(v) => {
                    const f = getFormById(config, v)
                    const ver = getLatestPublishedVersion(f)?.versionNo || 0
                    form.setFieldValue('formVersion', ver)
                    setDraft((d) => ({ ...d, formId: v, formVersion: ver }))
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="formVersion" label="绑定版本">
                <Select
                  options={(getFormById(config, form.getFieldValue('formId'))?.versions || [])
                    .filter((v) => v.status === 'published')
                    .sort((a, b) => b.versionNo - a.versionNo)
                    .map((v) => ({ label: `v${v.versionNo}`, value: v.versionNo }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">触发方式</Divider>
          <TriggerEditor value={draft.triggerRules} onChange={(rules) => setDraft((d) => ({ ...d, triggerRules: rules }))} />

          <Collapse
            style={{ background: '#fff', marginTop: 8 }}
            items={[
              {
                key: 'advanced',
                label: '高级设置（基础扩展 / 时限 / 执行人 / 通知）',
                children: (
                  <>
                    <Divider orientation="left" style={{ marginTop: 0 }}>基础扩展</Divider>
                    <Row gutter={16}>
                      <Col span={8}>
                        <Form.Item name="ownerOrgId" label="所属组织">
                          <Select
                            disabled={draft.typeOrigin === 'group_standard'}
                            options={config.orgs.filter((o) => o.level !== 'region').map((o) => ({ label: o.name, value: o.id }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="typeOrigin" label="类型来源">
                          <Select
                            disabled={editingId}
                            options={[
                              { label: '集团标准', value: 'group_standard' },
                              { label: '子公司自有', value: 'subsidiary' },
                            ]}
                            onChange={(v) => {
                              setDraft((d) => ({ ...d, typeOrigin: v, ownerOrgId: v === 'group_standard' ? 'group' : orgId }))
                            }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="remark" label="说明/备注">
                          <Input placeholder="选填" />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider orientation="left">时限窗口</Divider>
                    <TimeWindowEditor
                      value={draft.timeWindow}
                      onChange={(tw) => setDraft((d) => ({ ...d, timeWindow: tw }))}
                    />

                    <Divider orientation="left">执行人范围</Divider>
                    {orgId !== 'group' ? (
                      <Row gutter={16}>
                        <Col span={10}>
                          <Form.Item label="默认执行人（一人或多人）">
                            <Select
                              mode="multiple"
                              value={draft.executorScope?.defaultExecutors || []}
                              options={(config.personnel || []).filter((p) => p.orgId === orgId && p.status === 'active').map((p) => ({ label: `${p.name}（${p.code}）`, value: p.id }))}
                              onChange={(v) => setDraft((d) => ({ ...d, executorScope: { ...(d.executorScope || {}), defaultExecutors: v } }))}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={14}>
                          <Form.Item label="其他执行人（有资格执行）">
                            <Select
                              mode="multiple"
                              value={draft.executorScope?.otherExecutors || []}
                              options={(config.personnel || []).filter((p) => p.orgId === orgId && p.status === 'active').map((p) => ({ label: `${p.name}（${p.code}）`, value: p.id }))}
                              onChange={(v) => setDraft((d) => ({ ...d, executorScope: { ...(d.executorScope || {}), otherExecutors: v } }))}
                            />
                          </Form.Item>
                        </Col>
                      </Row>
                    ) : (
                      <Alert type="info" showIcon message="集团标准类型的执行人范围由各子公司独立维护；子公司自有类型请在对应子公司视角维护。" />
                    )}

                    <Divider orientation="left">生成通知</Divider>
                    <Row gutter={16}>
                      <Col span={6}>
                        <Form.Item label="是否启用生成通知">
                          <Switch checked={draft.notify?.enabled} onChange={(v) => setDraft((d) => ({ ...d, notify: { ...d.notify, enabled: v } }))} />
                        </Form.Item>
                      </Col>
                      {draft.notify?.enabled && (
                        <>
                          <Col span={9}>
                            <Form.Item label="通知对象">
                              <Select mode="multiple" value={draft.notify.targets} options={NOTIFY_TARGETS} onChange={(v) => setDraft((d) => ({ ...d, notify: { ...d.notify, targets: v } }))} />
                            </Form.Item>
                          </Col>
                          <Col span={9}>
                            <Form.Item label="通知渠道">
                              <Select mode="multiple" value={draft.notify.channels} options={NOTIFY_CHANNELS} onChange={(v) => setDraft((d) => ({ ...d, notify: { ...d.notify, channels: v } }))} />
                            </Form.Item>
                          </Col>
                        </>
                      )}
                    </Row>
                  </>
                ),
              },
            ]}
          />

          {orgId !== 'group' && (
            <Alert type="info" showIcon style={{ marginTop: 16 }} message="子公司视角：可覆盖本组织的触发、时限、通知与 API 开关；基础信息与表单绑定为只读。" />
          )}
        </Form>
      </Drawer>
    </>
  )
}

function TriggerEditor({ value, onChange }) {
  const rules = value || []
  const update = (idx, patch) => {
    const next = rules.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    onChange(next)
  }
  const add = () => {
    onChange([...rules, { id: 'tr_' + Date.now(), type: 'manual', enabled: true, name: '' }])
  }
  return (
    <div>
      {rules.length === 0 && <div style={{ color: '#999', marginBottom: 12 }}>暂无触发规则</div>}
      {rules.map((rule, idx) => (
        <Card key={rule.id} size="small" style={{ marginBottom: 12 }}>
          <Space wrap>
            <Select
              value={rule.type}
              style={{ width: 140 }}
              options={Object.entries(TRIGGER_TYPE).map(([k, v]) => ({ label: v.label, value: k }))}
              onChange={(v) => update(idx, { type: v })}
            />
            <Input
              value={rule.name}
              placeholder="规则名称"
              style={{ width: 180 }}
              onChange={(e) => update(idx, { name: e.target.value })}
            />
            <Switch checked={rule.enabled} checkedChildren="启用" unCheckedChildren="停用" onChange={(v) => update(idx, { enabled: v })} />
            <Button danger size="small" onClick={() => onChange(rules.filter((_, i) => i !== idx))}>删除</Button>
          </Space>
          {rule.type === 'cron' && (
            <Space wrap style={{ marginTop: 12 }}>
              <Select
                value={rule.freq}
                style={{ width: 120 }}
                options={TRIGGER_FREQ}
                onChange={(v) => update(idx, { freq: v })}
              />
              <Input value={rule.cronExpr} placeholder="cron表达式，如 0 8 * * *" style={{ width: 180 }} onChange={(e) => update(idx, { cronExpr: e.target.value })} />
              <TimePicker value={rule.times?.[0] ? dayjs(rule.times[0], 'HH:mm') : null} format="HH:mm" minuteStep={5} onChange={(v) => update(idx, { times: v ? [v.format('HH:mm')] : [] })} />
            </Space>
          )}
          {rule.type === 'once' && (
            <Input
              type="datetime-local"
              value={rule.onceAt}
              style={{ marginTop: 12 }}
              onChange={(e) => update(idx, { onceAt: e.target.value })}
            />
          )}
        </Card>
      ))}
      <Button type="dashed" onClick={add}>+ 添加触发规则</Button>
    </div>
  )
}

function TimeWindowEditor({ value, onChange }) {
  const tw = value || { enabled: false, startTime: '08:00', endTime: '18:00', earlyStartMinutes: 0, lateEndMinutes: 0 }
  const update = (patch) => onChange({ ...tw, ...patch })
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Space wrap>
        <span>启用时限管控</span>
        <Switch checked={tw.enabled} checkedChildren="启用" unCheckedChildren="不启用" onChange={(v) => update({ enabled: v })} />
      </Space>
      {tw.enabled && (
        <Space wrap>
          <span>开始时间</span>
          <TimePicker value={dayjs(tw.startTime, 'HH:mm')} format="HH:mm" minuteStep={5} onChange={(v) => update({ startTime: v ? v.format('HH:mm') : '08:00' })} />
          <span>结束时间</span>
          <TimePicker value={dayjs(tw.endTime, 'HH:mm')} format="HH:mm" minuteStep={5} onChange={(v) => update({ endTime: v ? v.format('HH:mm') : '18:00' })} />
          <span>提前开始(分)</span>
          <InputNumber min={0} value={tw.earlyStartMinutes} onChange={(v) => update({ earlyStartMinutes: v || 0 })} />
          <span>延后结束(分)</span>
          <InputNumber min={0} value={tw.lateEndMinutes} onChange={(v) => update({ lateEndMinutes: v || 0 })} />
        </Space>
      )}
    </Space>
  )
}
