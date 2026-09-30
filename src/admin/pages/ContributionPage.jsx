import React, { useMemo, useState } from 'react'
import { Card, Table, Button, Modal, InputNumber, Select, Space, Tag, message, Popconfirm } from 'antd'
import { saveConfig } from '@shared/store'
import { loadCurrentRole } from '@shared/store'
import { can } from '@shared/roles'

export default function ContributionPage({ config, orgId, onRefresh }) {
  const role = loadCurrentRole(orgId)
  const canEdit = can(role, 'editContribution')
  const [editingTicketId, setEditingTicketId] = useState(null)
  const [participants, setParticipants] = useState([])
  const [newPersonId, setNewPersonId] = useState(undefined)

  const tickets = useMemo(() => {
    const completed = (config.tickets || []).filter((t) => t.status === 'completed')
    return orgId === 'group' ? completed : completed.filter((t) => t.orgId === orgId)
  }, [config, orgId])

  const personnel = useMemo(() => (config.personnel || []).filter((p) => p.orgId === orgId || orgId === 'group'), [config, orgId])

  const openAdjust = (record) => {
    const existing = record.participants || []
    const initial = existing.length
      ? existing
      : record.assigneeId
        ? [{ personId: record.assigneeId, ratio: 100 }]
        : []
    setParticipants(initial)
    setEditingTicketId(record.id)
    setNewPersonId(undefined)
  }

  const updateRatio = (idx, ratio) => {
    setParticipants((list) => list.map((p, i) => (i === idx ? { ...p, ratio } : p)))
  }

  const removePerson = (idx) => {
    setParticipants((list) => list.filter((_, i) => i !== idx))
  }

  const addPerson = () => {
    if (!newPersonId) return message.warning('请选择人员')
    if (participants.some((p) => p.personId === newPersonId)) return message.warning('人员已存在')
    setParticipants((list) => [...list, { personId: newPersonId, ratio: 0 }])
    setNewPersonId(undefined)
  }

  const save = () => {
    const total = participants.reduce((sum, p) => sum + (Number(p.ratio) || 0), 0)
    if (Math.round(total) !== 100) return message.warning('贡献比例总和必须为 100%')
    const ticket = config.tickets.find((t) => t.id === editingTicketId)
    if (ticket) {
      ticket.participants = participants
      saveConfig(config)
      message.success('贡献比例已保存')
    }
    setEditingTicketId(null)
    onRefresh()
  }

  return (
    <Card title="贡献调节">
      <Table
        rowKey="id"
        dataSource={tickets}
        pagination={{ pageSize: 8 }}
        size="middle"
        columns={[
          { title: '工单编号', dataIndex: 'ticketNo', width: 220 },
          { title: '类型', dataIndex: 'ticketTypeId', width: 140, render: (v) => config.ticketTypes.find((t) => t.id === v)?.name || v },
          { title: '组织', dataIndex: 'orgId', width: 160, render: (v) => config.orgs.find((o) => o.id === v)?.name || v },
          { title: '当前执行人', dataIndex: 'assigneeId', width: 120, render: (v) => personnel.find((p) => p.id === v)?.name || '—' },
          {
            title: '操作', key: 'action', width: 120,
            render: (_, record) => (canEdit ? <Button size="small" type="primary" ghost onClick={() => openAdjust(record)}>调节</Button> : <span style={{ color: '#999' }}>—</span>),
          },
        ]}
      />

      <Modal title="贡献比例调节" open={!!editingTicketId} onOk={save} onCancel={() => setEditingTicketId(null)} width={640}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {participants.map((p, idx) => (
            <Space key={p.personId} style={{ width: '100%', justifyContent: 'space-between' }}>
              <span style={{ width: 160 }}>{personnel.find((x) => x.id === p.personId)?.name || p.personId}</span>
              <InputNumber min={0} max={100} value={p.ratio} onChange={(v) => updateRatio(idx, v)} style={{ width: 160 }} />
              <Popconfirm title="确认移除该参与人？" onConfirm={() => removePerson(idx)}>
                <Button danger size="small">移除</Button>
              </Popconfirm>
            </Space>
          ))}
          <Space>
            <Select
              placeholder="选择要增加的人员"
              value={newPersonId}
              onChange={setNewPersonId}
              style={{ width: 240 }}
              options={personnel.map((p) => ({ label: `${p.name}（${p.code}）`, value: p.id }))}
            />
            <Button onClick={addPerson}>增加</Button>
          </Space>
          <Tag color="blue">默认平均分配，总和需为 100%</Tag>
        </Space>
      </Modal>
    </Card>
  )
}
