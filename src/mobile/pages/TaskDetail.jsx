import React, { useMemo, useState } from 'react'
import { NavBar, Button, Input, TextArea, Selector, Toast, Tag, List, Space, Popup, Collapse } from 'antd-mobile'
import { loadConfig, loadCurrentOrg, saveConfig, getResolvedTicketType, getFormById, getFormVersion, pushNotificationForEvent } from '@shared/store'
import { TICKET_STATUS, FIELD_STRATEGY } from '@shared/constants'

export default function TaskDetail({ ticketId, onBack }) {
  const [config, setConfig] = useState(() => loadConfig())
  const orgId = loadCurrentOrg()
  const ticket = config.tickets.find((t) => t.id === ticketId)
  const type = ticket ? getResolvedTicketType(config, ticket.ticketTypeId, orgId) : null
  const form = type ? getFormById(config, type.formId) : null
  const version = form ? getFormVersion(form, ticket?.formVersion || type?.formVersion) : null
  const [values, setValues] = useState(() => JSON.parse(JSON.stringify(ticket?.values || {})))
  const [subRecords, setSubRecords] = useState(() => (ticket?.subRecords || {}))
  const [forceOpen, setForceOpen] = useState(false)
  const [forceReason, setForceReason] = useState('')

  const setValue = (key, val) => setValues((v) => ({ ...v, [key]: val }))

  const setSubValue = (subFormId, recordIdx, key, val) => {
    setSubRecords((s) => {
      const next = { ...s }
      const records = next[subFormId] || []
      const rec = { ...(records[recordIdx] || {}) }
      rec[key] = val
      records[recordIdx] = rec
      next[subFormId] = records
      return next
    })
  }

  const addSubRecord = (subFormId) => {
    setSubRecords((s) => {
      const next = { ...s }
      const records = next[subFormId] || []
      records.push({})
      next[subFormId] = records
      return next
    })
  }

  const renderField = (field, value, onChange) => {
    if (field.type === 'singleSelect') {
      return (
        <Selector
          options={(field.options || []).map((o) => ({ label: o.label, value: o.value }))}
          value={value ? [value] : []}
          onChange={(arr) => onChange(arr[0])}
        />
      )
    }
    if (field.type === 'multiSelect') {
      return (
        <Selector
          multiple
          options={(field.options || []).map((o) => ({ label: o.label, value: o.value }))}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
        />
      )
    }
    if (field.type === 'photo' || field.type === 'attachment') {
      return <Button size="small" fill="outline">上传/拍照（原型）</Button>
    }
    if (field.type === 'datetime') {
      return <Input type="datetime-local" value={value || ''} onChange={onChange} />
    }
    if (field.type === 'number') {
      return <Input type="number" value={value ?? ''} onChange={onChange} />
    }
    return <TextArea value={value || ''} onChange={onChange} autoSize={{ minRows: 1, maxRows: 4 }} />
  }

  const submit = () => {
    if (!ticket) return
    const missingBlocking = []
    ;(version?.mainFields || []).forEach((f) => {
      const v = values[f.key]
      if (f.strategy === 'blocking' && !v) missingBlocking.push(f.name)
    })
    ;(version?.subForms || []).forEach((sub) => {
      const records = subRecords[sub.id] || []
      if (records.length < sub.minRecords) missingBlocking.push(`${sub.name}至少${sub.minRecords}条`)
      records.forEach((rec) => {
        sub.fields.forEach((f) => {
          const v = rec[f.key]
          if (f.strategy === 'blocking' && !v) missingBlocking.push(`${sub.name}-${f.name}`)
        })
      })
    })

    if (missingBlocking.length) {
      Toast.show({ content: `以下必填字段未填写：${missingBlocking.join('、')}` })
      return
    }
    doSubmit('completed')
  }

  const confirmForceSubmit = () => {
    if (!forceReason.trim()) return Toast.show({ content: '请填写超时完成理由' })
    ticket.overtimeCompleted = true
    ticket.overtimeReason = forceReason.trim()
    setForceOpen(false)
    doSubmit('completed')
  }

  const doSubmit = (nextStatus) => {
    ticket.status = nextStatus
    ticket.values = values
    ticket.subRecords = subRecords
    ticket.submittedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
    if (nextStatus === 'completed' || nextStatus === 'waitingData') {
      pushNotificationForEvent(config, {
        orgId,
        ticketTypeId: ticket.ticketTypeId,
        ticketNo: ticket.ticketNo,
        typeName: type.name,
        event: nextStatus,
      })
    }
    saveConfig(config)
    setConfig(loadConfig())
    Toast.show({ content: nextStatus === 'completed' ? '已完成' : '已提交完工，等待数据' })
    onBack()
  }

  if (!ticket || !type || !version) {
    return <div style={{ padding: 24 }}>工单不存在或配置缺失</div>
  }

  return (
    <div style={{ padding: 12 }}>
      <NavBar onBack={onBack} style={{ background: '#fff', marginBottom: 12 }}>任务详情</NavBar>
      <List header="基础信息">
        <List.Item extra={<Tag color={TICKET_STATUS[ticket.status]?.color}>{TICKET_STATUS[ticket.status]?.label}</Tag>}>
          {type.name}（{type.code}）
        </List.Item>
        {(version.mainFields || []).filter((f) => f.required).map((f) => (
          <List.Item key={f.key} description={f.help}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <span style={{ fontSize: 13, color: '#888' }}>{f.name} *</span>
              {renderField(f, values[f.key], (v) => setValue(f.key, v))}
            </Space>
          </List.Item>
        ))}
      </List>

      {(version.mainFields || []).some((f) => !f.required) && (
        <Collapse style={{ marginTop: 12, background: '#fff', borderRadius: 8 }}>
          <Collapse.Panel key="more" title="更多信息（选填）">
            {(version.mainFields || []).filter((f) => !f.required).map((f) => (
              <div key={f.key} style={{ padding: '8px 12px' }}>
                <div style={{ fontSize: 13, color: '#888' }}>{f.name}</div>
                {renderField(f, values[f.key], (v) => setValue(f.key, v))}
                {f.help && <div style={{ fontSize: 12, color: '#bbb' }}>{f.help}</div>}
              </div>
            ))}
          </Collapse.Panel>
        </Collapse>
      )}

      {(version.subForms || []).map((sub) => {
        const records = subRecords[sub.id] || []
        return (
          <List key={sub.id} header={`${sub.name}（${records.length}/${sub.maxRecords || '不限'}）`} style={{ marginTop: 12 }}>
            {records.map((rec, idx) => (
              <div key={idx} style={{ padding: '8px 12px', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#888' }}>记录 {idx + 1}</span>
                </div>
                {sub.fields.map((f) => (
                  <Space key={f.key} direction="vertical" style={{ width: '100%', marginTop: 8 }}>
                    <span style={{ fontSize: 13, color: '#888' }}>{f.name}{f.required ? ' *' : ''}</span>
                    {renderField(f, rec[f.key], (v) => setSubValue(sub.id, idx, f.key, v))}
                  </Space>
                ))}
              </div>
            ))}
            <List.Item>
              <Button size="small" fill="outline" onClick={() => addSubRecord(sub.id)}>+ 添加{sub.name}记录</Button>
            </List.Item>
          </List>
        )
      })}

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <Button block color="primary" onClick={submit}>提交完工</Button>
        {ticket.status === 'timeout' && (
          <Button block fill="outline" onClick={() => setForceOpen(true)}>超时完成</Button>
        )}
      </div>

        <Popup
          visible={forceOpen}
          onMaskClick={() => setForceOpen(false)}
          bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 12 }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 12px' }}>超时完成</div>
          <TextArea
            placeholder="请输入超时完成理由（必填）"
            value={forceReason}
            onChange={setForceReason}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
          <Button block color="primary" style={{ marginTop: 12 }} onClick={confirmForceSubmit}>确认超时完成</Button>
        </Popup>

    </div>
  )
}
