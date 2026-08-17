import React, { useMemo } from 'react'
import { Card, Table, Tag } from 'antd'

export default function IncomeCheckPage({ config, orgId }) {
  const rows = useMemo(() => {
    const completed = (config.tickets || []).filter((t) => t.status === 'completed')
    const list = orgId === 'group' ? completed : completed.filter((t) => t.orgId === orgId)
    return list.flatMap((t) => {
      const participants = t.participants || (t.assigneeId ? [{ personId: t.assigneeId, ratio: 100 }] : [])
      return participants.map((p) => ({
        id: `${t.id}_${p.personId}`,
        ticketNo: t.ticketNo || t.id,
        typeName: config.ticketTypes.find((x) => x.id === t.ticketTypeId)?.name || t.ticketTypeId,
        orgName: config.orgs.find((o) => o.id === t.orgId)?.name || t.orgId,
        personName: config.personnel.find((x) => x.id === p.personId)?.name || p.personId,
        ratio: p.ratio,
        amount: '—',
        status: '待核对',
      }))
    })
  }, [config, orgId])

  return (
    <Card title="收入核对">
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 10 }}
        size="middle"
        columns={[
          { title: '工单编号', dataIndex: 'ticketNo', width: 220 },
          { title: '工单类型', dataIndex: 'typeName', width: 140 },
          { title: '组织', dataIndex: 'orgName', width: 160 },
          { title: '参与人', dataIndex: 'personName', width: 120 },
          { title: '贡献比例', dataIndex: 'ratio', width: 100, render: (v) => `${v}%` },
          { title: '计件金额', dataIndex: 'amount', width: 120 },
          { title: '状态', dataIndex: 'status', width: 100, render: (v) => <Tag color="blue">{v}</Tag> },
        ]}
      />
    </Card>
  )
}
