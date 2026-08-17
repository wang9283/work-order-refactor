import React, { useMemo, useState } from 'react'
import { Button, List, Tag, Space, Input, Dialog, Tabs } from 'antd-mobile'
import { loadConfig, loadCurrentOrg, getVisibleTicketTypes, addTicket } from '@shared/store'
import { TICKET_STATUS } from '@shared/constants'

const STATUS_TABS = [
  { key: 'all', title: '全部' },
  { key: 'pending', title: '待开始' },
  { key: 'inProgress', title: '执行中' },
  { key: 'waitingData', title: '待数据' },
  { key: 'timeout', title: '已超时' },
  { key: 'completed', title: '已完成' },
]

export default function TaskList({ onOpenTicket, status, onStatusChange }) {
  const [config, setConfig] = useState(() => loadConfig())
  const [quickCode, setQuickCode] = useState('')
  const orgId = loadCurrentOrg()
  const activeStatus = status || 'all'

  const visibleTypes = useMemo(() => getVisibleTicketTypes(config, orgId), [config, orgId])
  const myTickets = useMemo(() => {
    const list = config.tickets.filter((t) => t.orgId === orgId)
    if (activeStatus === 'all') return list
    return list.filter((t) => t.status === activeStatus)
  }, [config, orgId, activeStatus])

  const refresh = () => setConfig(loadConfig())

  const createTask = (ticketTypeId) => {
    const ticket = addTicket(config, ticketTypeId, orgId)
    if (ticket) {
      refresh()
      onOpenTicket(ticket.id)
    }
  }

  const quickCreate = () => {
    const type = visibleTypes.find((t) => t.code.toUpperCase() === quickCode.trim().toUpperCase())
    if (!type) {
      Dialog.alert({ content: '编码不存在或该类型不可用' })
      return
    }
    createTask(type.id)
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input placeholder="输入工单类型编码，如 PROD" value={quickCode} onChange={setQuickCode} style={{ flex: 1 }} />
        <Button color="primary" onClick={quickCreate}>快速新建</Button>
      </div>

      <List header="可执行工单类型">
        {visibleTypes.length === 0 && <div style={{ padding: '16px 0', color: '#999', textAlign: 'center' }}>暂无可执行类型</div>}
        {visibleTypes.map((type) => (
          <List.Item
            key={type.id}
            description={`${type.code} · ${type.formId ? '表单已绑定' : '未绑定表单'}`}
            extra={<Button size="small" color="primary" fill="outline" onClick={() => createTask(type.id)}>新建任务</Button>}
          >
            <Space>
              <span>{type.name}</span>
              {type.typeOrigin === 'group_standard' ? <Tag color="primary">集团标准</Tag> : <Tag color="warning">本组织</Tag>}
            </Space>
          </List.Item>
        ))}
      </List>


        <Tabs activeKey={activeStatus} onChange={onStatusChange} style={{ marginTop: 12 }}>
          {STATUS_TABS.map((s) => (
            <Tabs.Tab title={s.title} key={s.key} />
          ))}
        </Tabs>

      <List header="我的工单" style={{ marginTop: 12 }}>
        {myTickets.length === 0 && <div style={{ padding: '16px 0', color: '#999', textAlign: 'center' }}>暂无工单</div>}
        {myTickets.map((ticket) => {
          const type = config.ticketTypes.find((t) => t.id === ticket.ticketTypeId)
          const st = TICKET_STATUS[ticket.status] || { label: ticket.status, color: 'default' }
          return (
            <List.Item
              key={ticket.id}
              description={`${type?.name || '未知类型'} · ${ticket.createdAt}`}
              extra={<Tag color={st.color}>{st.label}</Tag>}
              onClick={() => onOpenTicket(ticket.id)}
            >
              {ticket.ticketNo || type?.code || ticket.ticketTypeId}
            </List.Item>
          )
        })}
      </List>
    </div>
  )
}
