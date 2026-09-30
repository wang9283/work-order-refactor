import React, { useMemo, useState } from 'react'
import { Card, Table, Tag, Space, Button, Modal, Input, Select, message } from 'antd'
import { saveConfig, pushNotificationForEvent } from '@shared/store'
import { loadCurrentRole } from '@shared/store'
import { can } from '@shared/roles'
import { TICKET_STATUS } from '@shared/constants'

export default function TicketManage({ config, orgId, onRefresh }) {
  const role = loadCurrentRole(orgId)
  const canManage = can(role, 'manageTickets')
  const [reviewTicketId, setReviewTicketId] = useState(null)
  const [reviewText, setReviewText] = useState('')
  const [forceTicketId, setForceTicketId] = useState(null)
  const [forceText, setForceText] = useState('')
  const [timeoutTicketId, setTimeoutTicketId] = useState(null)
  const [timeoutText, setTimeoutText] = useState('')
  const [filterStatus, setFilterStatus] = useState(undefined)

  const tickets = useMemo(() => {
    let list = config.tickets || []
    if (orgId !== 'group') list = list.filter((t) => t.orgId === orgId)
    if (filterStatus) list = list.filter((t) => t.status === filterStatus)
    return list
  }, [config, orgId, filterStatus])

  const typeName = (id) => config.ticketTypes.find((t) => t.id === id)?.name || id
  const personName = (id) => config.personnel.find((p) => p.id === id)?.name || '未指派'

  const submitReview = () => {
    if (!reviewText.trim()) return message.warning('请填写复核结论和原因')
    const ticket = config.tickets.find((t) => t.id === reviewTicketId)
    if (ticket) {
      ticket.reviewConclusion = reviewText.trim()
      ticket.status = 'timeout'
      saveConfig(config)
      message.success('复核完成')
    }
    setReviewTicketId(null)
    setReviewText('')
    onRefresh()
  }

  const mockArrive = (record) => {
    const type = config.ticketTypes.find((t) => t.id === record.ticketTypeId)
    const form = config.forms.find((f) => f.id === type?.formId)
    const version = form?.versions.find((v) => v.versionNo === record.formVersion) || form?.versions.find((v) => v.status === 'published')
    const values = record.values || {}
    ;(version?.mainFields || []).forEach((f) => {
      if (f.sourceSystemId) values[f.key] = '外部数据已回传'
    })
    record.values = values
    record.status = 'completed'
    pushNotificationForEvent(config, {
      orgId: record.orgId,
      ticketTypeId: record.ticketTypeId,
      ticketNo: record.ticketNo,
      typeName: type?.name || '',
      event: 'completed',
    })
    saveConfig(config)
    message.success('外部数据已模拟回传，工单完成')
    onRefresh()
  }

  const submitForce = () => {
    if (!forceText.trim()) return message.warning('请填写强制完结原因')
    const ticket = config.tickets.find((t) => t.id === forceTicketId)
    if (ticket) {
      ticket.forceReason = forceText.trim()
      ticket.status = 'closed'
      const type = config.ticketTypes.find((t) => t.id === ticket.ticketTypeId)
      pushNotificationForEvent(config, {
        orgId: ticket.orgId,
        ticketTypeId: ticket.ticketTypeId,
        ticketNo: ticket.ticketNo,
        typeName: type?.name || '',
        event: 'closed',
      })
      saveConfig(config)
      message.success('已强制完结')
    }
    setForceTicketId(null)
    setForceText('')
    onRefresh()
  }

  const submitTimeout = () => {
    if (!timeoutText.trim()) return message.warning('请填写超时完成理由')
    const ticket = config.tickets.find((t) => t.id === timeoutTicketId)
    if (ticket) {
      ticket.status = 'completed'
      ticket.overtimeCompleted = true
      ticket.overtimeReason = timeoutText.trim()
      const type = config.ticketTypes.find((t) => t.id === ticket.ticketTypeId)
      pushNotificationForEvent(config, {
        orgId: ticket.orgId,
        ticketTypeId: ticket.ticketTypeId,
        ticketNo: ticket.ticketNo,
        typeName: type?.name || '',
        event: 'completed',
      })
      saveConfig(config)
      message.success('已超时完成')
    }
    setTimeoutTicketId(null)
    setTimeoutText('')
    onRefresh()
  }

  return (
    <Card
      title="工单管理"
      extra={
        <Select
          placeholder="状态筛选"
          allowClear
          value={filterStatus}
          onChange={setFilterStatus}
          style={{ width: 180 }}
          options={Object.entries(TICKET_STATUS).map(([k, v]) => ({ label: v.label, value: k }))}
        />
      }
    >
      <Table
        rowKey="id"
        dataSource={tickets}
        pagination={{ pageSize: 10 }}
        size="middle"
        columns={[
          { title: '工单编号', dataIndex: 'ticketNo', width: 220 },
          { title: '类型', dataIndex: 'ticketTypeId', width: 140, render: typeName },
          { title: '组织', dataIndex: 'orgId', width: 160, render: (v) => config.orgs.find((o) => o.id === v)?.name || v },
          { title: '状态', dataIndex: 'status', width: 100, render: (v) => <Tag color={TICKET_STATUS[v]?.color}>{TICKET_STATUS[v]?.label}</Tag> },
          { title: '执行人', dataIndex: 'assigneeId', width: 120, render: personName },
          { title: '生成时间', dataIndex: 'createdAt', width: 160 },
          {
            title: '操作', key: 'action', width: 220, fixed: 'right',
            render: (_, record) => (
              <Space size="small">
                {canManage && record.status === 'timeout' && <a onClick={() => { setTimeoutTicketId(record.id); setTimeoutText('') }}>超时完成</a>}
                {canManage && record.status === 'timeout' && <a onClick={() => { setForceTicketId(record.id); setForceText('') }} style={{ color: '#ff4d4f' }}>强制完结</a>}
                {canManage && record.status === 'timeout' && <a onClick={() => { setReviewTicketId(record.id); setReviewText('') }}>复核</a>}
                {canManage && record.status === 'waitingData' && <a onClick={() => mockArrive(record)}>模拟数据到达</a>}
                {(!canManage || !['timeout', 'waitingData', 'closed', 'completed'].includes(record.status)) && <span style={{ color: '#999' }}>—</span>}
              </Space>
            ),
          },
        ]}
      />

      <Modal title="强制完结" open={!!forceTicketId} onOk={submitForce} onCancel={() => setForceTicketId(null)}>
        <Input.TextArea rows={3} value={forceText} onChange={(e) => setForceText(e.target.value)} placeholder="请输入强制完结原因（必填）" />
      </Modal>

        <Modal title="超时完成" open={!!timeoutTicketId} onOk={submitTimeout} onCancel={() => setTimeoutTicketId(null)}>
          <Input.TextArea rows={3} value={timeoutText} onChange={(e) => setTimeoutText(e.target.value)} placeholder="请输入超时完成理由（必填）" />
        </Modal>


      <Modal title="复核" open={!!reviewTicketId} onOk={submitReview} onCancel={() => setReviewTicketId(null)}>
        <Input.TextArea rows={3} value={reviewText} onChange={(e) => setReviewText(e.target.value)} placeholder="请输入复核结论和原因（必填）" />
      </Modal>
    </Card>
  )
}
