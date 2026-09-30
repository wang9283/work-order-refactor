import React, { useMemo, useState } from 'react'
import { Button, List, Tag, Space, Input, Dialog, Tabs } from 'antd-mobile'
import { loadConfig, loadCurrentOrg, getVisibleTicketTypes, getResolvedTicketType, addTicket } from '@shared/store'
import { TICKET_STATUS } from '@shared/constants'

// 内部 8 态 → 用户分组：待办 / 进行中 / 已结束；待数据、已超时仅在真发生时动态露出
const STATUS_GROUPS = {
  todo: ['unassigned', 'pending'],
  doing: ['inProgress'],
  waiting: ['waitingData'],
  timeout: ['timeout'],
  done: ['completed', 'closed', 'cancelled'],
}
const LEGACY_KEY = { pending: 'todo', inProgress: 'doing', completed: 'done', waitingData: 'waiting' }

export default function TaskList({ onOpenTicket, status, onStatusChange }) {
  const [config, setConfig] = useState(() => loadConfig())
  const [quickCode, setQuickCode] = useState('')
  const orgId = loadCurrentOrg()

  const visibleTypes = useMemo(() => getVisibleTicketTypes(config, orgId), [config, orgId])
  const orgTickets = useMemo(() => config.tickets.filter((t) => t.orgId === orgId), [config, orgId])

  const tabs = useMemo(() => {
    const base = [
      { key: 'all', title: '全部' },
      { key: 'todo', title: '待办' },
      { key: 'doing', title: '进行中' },
    ]
    if (orgTickets.some((t) => t.status === 'waitingData')) base.push({ key: 'waiting', title: '待数据' })
    if (orgTickets.some((t) => t.status === 'timeout')) base.push({ key: 'timeout', title: '已超时' })
    base.push({ key: 'done', title: '已结束' })
    return base
  }, [orgTickets])

  const requestedKey = LEGACY_KEY[status || 'all'] || status || 'all'
  const activeStatus = tabs.some((t) => t.key === requestedKey) ? requestedKey : 'all'

  const myTickets = useMemo(() => {
    if (activeStatus === 'all') return orgTickets
    const group = STATUS_GROUPS[activeStatus] || []
    return orgTickets.filter((t) => group.includes(t.status))
  }, [orgTickets, activeStatus])

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

  // 截止时间：优先取工单自身截止；否则由启用的时限窗口推导（当日 + 结束时间）
  const deadlineOf = (ticket) => {
    if (ticket.deadline) return ticket.deadline
    const t = getResolvedTicketType(config, ticket.ticketTypeId, orgId)
    if (t?.timeWindow?.enabled && ticket.createdAt) {
      return `${ticket.createdAt.slice(0, 10)} ${t.timeWindow.endTime}`
    }
    return ''
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
        {tabs.map((s) => (
          <Tabs.Tab title={s.title} key={s.key} />
        ))}
      </Tabs>

      <List header="我的工单" style={{ marginTop: 12 }}>
        {myTickets.length === 0 && <div style={{ padding: '16px 0', color: '#999', textAlign: 'center' }}>暂无工单</div>}
        {myTickets.map((ticket) => {
          const type = getResolvedTicketType(config, ticket.ticketTypeId, orgId)
          const st = TICKET_STATUS[ticket.status] || { label: ticket.status, color: 'default' }
          const deadline = deadlineOf(ticket)
          return (
            <List.Item
              key={ticket.id}
              description={
                <span style={{ fontSize: 12, color: '#999' }}>
                  {ticket.ticketNo || type?.code || ticket.ticketTypeId}
                  {deadline ? ` · 截止 ${deadline}` : ''}
                </span>
              }
              extra={<Tag color={st.color}>{st.label}</Tag>}
              onClick={() => onOpenTicket(ticket.id)}
            >
              {type?.name || '未知类型'}
            </List.Item>
          )
        })}
      </List>
    </div>
  )
}