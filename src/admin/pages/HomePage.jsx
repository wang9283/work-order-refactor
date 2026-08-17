import React from 'react'
import { Card, Col, Row, Statistic, Tag, Space } from 'antd'
import { TICKET_STATUS } from '@shared/constants'

export default function HomePage({ config, orgId }) {
  const types = orgId === 'group'
    ? config.ticketTypes
    : config.ticketTypes.filter((t) => t.typeOrigin === 'group_standard' || t.ownerOrgId === orgId)

  const tickets = config.tickets.filter((t) => t.orgId === orgId)

  const statusCount = (status) => tickets.filter((t) => t.status === status).length

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col span={6}><Card><Statistic title="工单类型数" value={types.length} /></Card></Col>
        <Col span={6}><Card><Statistic title="表单模板数" value={config.forms.length} /></Card></Col>
        <Col span={6}><Card><Statistic title="任务大类数" value={config.categories.length} /></Card></Col>
        <Col span={6}><Card><Statistic title="本组织工单数" value={tickets.length} /></Card></Col>
      </Row>
      <Card title="工单状态分布" style={{ marginTop: 16 }}>
        <Space wrap>
          {Object.entries(TICKET_STATUS).map(([key, val]) => (
            <Tag key={key} color={val.color} style={{ fontSize: 14, padding: '4px 12px' }}>
              {val.label}：{statusCount(key)}
            </Tag>
          ))}
        </Space>
      </Card>
    </div>
  )
}
