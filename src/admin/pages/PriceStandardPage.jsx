import React from 'react'
import { Card, Table, Tag, Tabs } from 'antd'

export default function PriceStandardPage({ config }) {
  const typeName = (id) => config.ticketTypes.find((t) => t.id === id)?.name || id

  const priceColumns = [
    { title: '工单类型', dataIndex: 'ticketTypeId', width: 160, render: typeName },
    { title: '单价', dataIndex: 'price', width: 120 },
    { title: '单位', dataIndex: 'unit', width: 100 },
    { title: '生效日期', dataIndex: 'effectiveDate', width: 140 },
    { title: '状态', dataIndex: 'status', width: 100, render: (v) => <Tag color={v === 'published' ? 'green' : 'orange'}>{v === 'published' ? '已发布' : '草稿'}</Tag> },
  ]

  const pieceColumns = [
    { title: '工单类型', dataIndex: 'ticketTypeId', width: 160, render: typeName },
    { title: '计件方式', dataIndex: 'method', width: 120 },
    { title: '单价/包干价', dataIndex: 'price', width: 140 },
    { title: '单位', dataIndex: 'unit', width: 100 },
    { title: '生效日期', dataIndex: 'effectiveDate', width: 140 },
    { title: '状态', dataIndex: 'status', width: 100, render: (v) => <Tag color={v === 'published' ? 'green' : 'orange'}>{v === 'published' ? '已发布' : '草稿'}</Tag> },
  ]

  return (
    <Card title="单价 / 计件标准">
      <Tabs items={[
        { key: 'price', label: '单价标准', children: <Table rowKey="id" dataSource={config.priceStandards || []} columns={priceColumns} pagination={false} size="middle" /> },
        { key: 'piece', label: '计件标准', children: <Table rowKey="id" dataSource={config.pieceStandards || []} columns={pieceColumns} pagination={false} size="middle" /> },
      ]} />
    </Card>
  )
}
