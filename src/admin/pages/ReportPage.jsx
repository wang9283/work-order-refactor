import React, { useMemo } from 'react'
import { Card, Table, Tag, Tabs, Row, Col, Statistic, Space } from 'antd'
import { TICKET_STATUS } from '@shared/constants'

export default function ReportPage({ config, orgId }) {
  const tickets = useMemo(() => {
    if (orgId === 'group') return config.tickets || []
    return (config.tickets || []).filter((t) => t.orgId === orgId)
  }, [config, orgId])

  const typeName = (id) => config.ticketTypes.find((t) => t.id === id)?.name || id
  const orgName = (id) => config.orgs.find((o) => o.id === id)?.name || id

  const summaryColumns = [
    { title: '工单编号', dataIndex: 'ticketNo', width: 220 },
    { title: '工单类型', dataIndex: 'ticketTypeId', width: 140, render: typeName },
    { title: '组织', dataIndex: 'orgId', width: 160, render: orgName },
    { title: '状态', dataIndex: 'status', width: 100, render: (v) => <Tag color={TICKET_STATUS[v]?.color}>{TICKET_STATUS[v]?.label}</Tag> },
    { title: '生成时间', dataIndex: 'createdAt', width: 160 },
  ]

  const completedCount = tickets.filter((t) => t.status === 'completed').length
  const timeoutCount = tickets.filter((t) => t.status === 'timeout').length
  const waitingCount = tickets.filter((t) => t.status === 'waitingData').length

  return (
    <Card title="报表中心">
      <Tabs items={[
        {
          key: 'summary',
          label: '工单汇总',
          children: (
            <>
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={6}><Statistic title="工单总数" value={tickets.length} /></Col>
                <Col span={6}><Statistic title="已完成" value={completedCount} /></Col>
                <Col span={6}><Statistic title="已超时" value={timeoutCount} /></Col>
                <Col span={6}><Statistic title="待数据" value={waitingCount} /></Col>
              </Row>
              <Table rowKey="id" columns={summaryColumns} dataSource={tickets} pagination={{ pageSize: 8 }} size="middle" />
            </>
          ),
        },
        {
          key: 'completion',
          label: '任务完成情况',
          children: (
            <Table
              rowKey="id"
              columns={[
                { title: '工单编号', dataIndex: 'ticketNo', width: 220 },
                { title: '类型', dataIndex: 'ticketTypeId', width: 140, render: typeName },
                { title: '组织', dataIndex: 'orgId', width: 160, render: orgName },
                { title: '状态', dataIndex: 'status', width: 100, render: (v) => <Tag color={TICKET_STATUS[v]?.color}>{TICKET_STATUS[v]?.label}</Tag> },
                { title: '执行人', dataIndex: 'assigneeId', width: 120, render: (v) => config.personnel.find((p) => p.id === v)?.name || '未指派' },
                { title: '是否超时完成', key: 'overtime', width: 120, render: (_, r) => (r.overtimeCompleted ? <Tag color="orange">超时完成</Tag> : '—') },
              ]}
              dataSource={tickets}
              pagination={{ pageSize: 8 }}
              size="middle"
            />
          ),
        },
      ]} />
    </Card>
  )
}
