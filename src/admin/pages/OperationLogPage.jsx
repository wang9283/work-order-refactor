import React, { useMemo, useState } from 'react'
import { Card, Table, Tag, Input, Select, Space } from 'antd'

export default function OperationLogPage({ config, orgId }) {
  const [keyword, setKeyword] = useState('')
  const [action, setAction] = useState(undefined)

  const logs = useMemo(() => {
    let list = config.logs || []
    if (orgId !== 'group') list = list.filter((l) => l.orgId === orgId)
    if (keyword) list = list.filter((l) => `${l.operator}${l.targetCode}${l.summary}`.includes(keyword))
    if (action) list = list.filter((l) => l.action === action)
    return list
  }, [config, orgId, keyword, action])

  return (
    <Card title="操作日志">
      <Space style={{ marginBottom: 16 }} wrap>
        <Input placeholder="搜索操作人/编码/摘要" value={keyword} onChange={setKeyword} style={{ width: 240 }} allowClear />
        <Select
          placeholder="操作类型"
          value={action}
          onChange={setAction}
          allowClear
          style={{ width: 180 }}
          options={[...new Set((config.logs || []).map((l) => l.action))].map((a) => ({ label: a, value: a }))}
        />
      </Space>
      <Table
        rowKey="id"
        dataSource={logs}
        pagination={{ pageSize: 10 }}
        size="middle"
        columns={[
          { title: '操作时间', dataIndex: 'operatedAt', width: 160 },
          { title: '操作人', dataIndex: 'operator', width: 120 },
          { title: '操作类型', dataIndex: 'action', width: 140, render: (v) => <Tag color="blue">{v}</Tag> },
          { title: '对象类型', dataIndex: 'targetType', width: 120 },
          { title: '对象编码', dataIndex: 'targetCode', width: 160 },
          { title: '组织', dataIndex: 'orgId', width: 160, render: (v) => config.orgs.find((o) => o.id === v)?.name || v },
          { title: '变更摘要', dataIndex: 'summary', width: 260 },
        ]}
      />
    </Card>
  )
}
