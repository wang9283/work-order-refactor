import React, { useMemo, useState } from 'react'
import { Button, List, Tag, Space, Toast, Popup } from 'antd-mobile'
import { loadConfig, loadCurrentOrg, saveConfig } from '@shared/store'

const statusColor = { 出勤: 'success', 请假: 'warning', 休息: 'default' }

export default function DaySchedule() {
  const [config, setConfig] = useState(() => loadConfig())
  const orgId = loadCurrentOrg()
  const [assigningTicketId, setAssigningTicketId] = useState(null)

  const today = new Date().toISOString().slice(0, 10)

  const attendance = useMemo(() => {
    return (config.schedules || []).filter((s) => s.orgId === orgId && s.date === today)
  }, [config, orgId, today])

  const pendingTickets = useMemo(() => {
    return (config.tickets || []).filter((t) => t.orgId === orgId && ['unassigned', 'pending'].includes(t.status))
  }, [config, orgId])

  const personnel = useMemo(() => (config.personnel || []).filter((p) => p.orgId === orgId && p.status === 'active'), [config, orgId])

  const personName = (id) => personnel.find((p) => p.id === id)?.name || '未指派'

  const typeName = (id) => config.ticketTypes.find((t) => t.id === id)?.name || id

  const assign = (personId) => {
    const ticket = config.tickets.find((t) => t.id === assigningTicketId)
    if (ticket) {
      ticket.assigneeId = personId
      ticket.status = 'pending'
      saveConfig(config)
      Toast.show({ content: `已改派给 ${personName(personId)}` })
    }
    setAssigningTicketId(null)
    setConfig(loadConfig())
  }

  return (
    <div style={{ padding: 12 }}>
      <List header={`今日出勤 · ${today}`}>
        {attendance.length === 0 && <div style={{ padding: '12px 0', color: '#999', textAlign: 'center' }}>暂无排班记录</div>}
        {attendance.map((s) => (
          <List.Item
            key={s.id}
            description={`${config.shifts.find((x) => x.id === s.shiftId)?.name || '—'}`}
            extra={<Tag color={statusColor[s.status] || 'default'}>{s.status}</Tag>}
          >
            {personName(s.personId)}
          </List.Item>
        ))}
      </List>

      <List header="今日待处理" style={{ marginTop: 12 }}>
        {pendingTickets.length === 0 && <div style={{ padding: '12px 0', color: '#999', textAlign: 'center' }}>暂无待处理任务</div>}
        {pendingTickets.map((t) => (
          <List.Item
            key={t.id}
            description={`${typeName(t.ticketTypeId)} · 当前：${personName(t.assigneeId)}`}
            extra={<Button size="small" color="primary" fill="outline" onClick={() => setAssigningTicketId(t.id)}>改派</Button>}
          >
            {t.id}
          </List.Item>
        ))}
      </List>

      <Popup
        visible={!!assigningTicketId}
        onMaskClick={() => setAssigningTicketId(null)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 12 }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 12px' }}>选择改派人员</div>
        <List>
          {personnel.map((p) => (
            <List.Item key={p.id} onClick={() => assign(p.id)} extra={<Tag color="primary">{p.code}</Tag>}>
              {p.name}
            </List.Item>
          ))}
        </List>
      </Popup>
    </div>
  )
}
