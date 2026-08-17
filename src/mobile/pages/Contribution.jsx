import React, { useMemo, useState } from 'react'
import { Button, List, Tag, Toast, Popup, Stepper, Space } from 'antd-mobile'
import { loadConfig, loadCurrentOrg, saveConfig } from '@shared/store'

export default function Contribution() {
  const [config, setConfig] = useState(() => loadConfig())
  const orgId = loadCurrentOrg()
  const [editingTicketId, setEditingTicketId] = useState(null)
  const [participants, setParticipants] = useState([])
  const [adding, setAdding] = useState(false)

  const completedTickets = useMemo(() => {
    return (config.tickets || []).filter((t) => t.status === 'completed' && t.orgId === orgId)
  }, [config, orgId])

  const personnel = useMemo(() => (config.personnel || []).filter((p) => p.orgId === orgId && p.status === 'active'), [config, orgId])

  const openAdjust = (record) => {
    setEditingTicketId(record.id)
    const existing = record.participants || []
    setParticipants(existing.length ? existing : record.assigneeId ? [{ personId: record.assigneeId, ratio: 100 }] : [])
  }

  const updateRatio = (idx, ratio) => {
    setParticipants((list) => list.map((p, i) => (i === idx ? { ...p, ratio } : p)))
  }

  const removePerson = (idx) => {
    setParticipants((list) => list.filter((_, i) => i !== idx))
  }

  const addPerson = (personId) => {
    if (participants.some((p) => p.personId === personId)) {
      Toast.show({ content: '人员已存在' })
      return
    }
    setParticipants((list) => [...list, { personId, ratio: 0 }])
    setAdding(false)
  }

  const save = () => {
    const total = participants.reduce((sum, p) => sum + (Number(p.ratio) || 0), 0)
    if (Math.round(total) !== 100) return Toast.show({ content: '贡献比例总和必须为 100%' })
    const ticket = config.tickets.find((t) => t.id === editingTicketId)
    if (ticket) {
      ticket.participants = participants
      saveConfig(config)
      Toast.show({ content: '贡献比例已保存' })
    }
    setEditingTicketId(null)
    setConfig(loadConfig())
  }

  return (
    <div style={{ padding: 12 }}>
      <List header="已完成工单">
        {completedTickets.length === 0 && <div style={{ padding: '12px 0', color: '#999', textAlign: 'center' }}>暂无已完成工单</div>}
        {completedTickets.map((t) => (
          <List.Item
            key={t.id}
            description={`${config.ticketTypes.find((x) => x.id === t.ticketTypeId)?.name || t.ticketTypeId}`}
            extra={<Button size="small" color="primary" fill="outline" onClick={() => openAdjust(t)}>调节</Button>}
          >
            {t.ticketNo}
          </List.Item>
        ))}
      </List>

      <Popup
        visible={!!editingTicketId}
        onMaskClick={() => setEditingTicketId(null)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 12 }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 12px' }}>贡献比例调节</div>
        {participants.map((p, idx) => (
          <List.Item
            key={p.personId + idx}
            extra={<Button size="mini" color="danger" fill="none" onClick={() => removePerson(idx)}>删除</Button>}
          >
            <Space direction="vertical">
              <span>{personnel.find((x) => x.id === p.personId)?.name || p.personId}</span>
              <Stepper min={0} max={100} value={p.ratio} onChange={(v) => updateRatio(idx, v)} />
            </Space>
          </List.Item>
        ))}
        <Button block fill="outline" style={{ margin: '8px 0' }} onClick={() => setAdding(true)}>增加人员</Button>
        <Button block color="primary" onClick={save}>保存</Button>
      </Popup>

      <Popup
        visible={adding}
        onMaskClick={() => setAdding(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 12 }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 12px' }}>选择人员</div>
        <List>
          {personnel.map((p) => (
            <List.Item key={p.id} onClick={() => addPerson(p.id)} extra={<Tag color="primary">{p.code}</Tag>}>{p.name}</List.Item>
          ))}
        </List>
      </Popup>
    </div>
  )
}
