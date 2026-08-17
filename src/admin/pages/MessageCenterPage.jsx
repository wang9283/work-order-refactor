import React, { useMemo } from 'react'
import { Card, Table, Tag, Space, Button, message } from 'antd'
import { saveConfig } from '@shared/store'

export default function MessageCenterPage({ config, orgId, onRefresh }) {
  const messages = useMemo(() => {
    if (orgId === 'group') return config.messages || []
    return (config.messages || []).filter((m) => m.orgId === orgId)
  }, [config, orgId])

  const markAll = () => {
    messages.forEach((m) => { m.read = true })
    saveConfig(config)
    message.success('已全部标记为已读')
    onRefresh()
  }

  return (
    <Card title="站内消息" extra={<Button onClick={markAll}>全部已读</Button>}>
      <Table
        rowKey="id"
        dataSource={messages}
        pagination={{ pageSize: 10 }}
        size="middle"
        columns={[
          { title: '标题', dataIndex: 'title', width: 180 },
          { title: '内容', dataIndex: 'content', width: 320 },
          { title: '类型', dataIndex: 'type', width: 120, render: (v) => <Tag color={v === '系统通知' ? 'orange' : 'blue'}>{v}</Tag> },
          { title: '组织', dataIndex: 'orgId', width: 160, render: (v) => config.orgs.find((o) => o.id === v)?.name || v },
          { title: '时间', dataIndex: 'createdAt', width: 160 },
          { title: '状态', dataIndex: 'read', width: 90, render: (v) => (v ? <Tag>已读</Tag> : <Tag color="red">未读</Tag>) },
        ]}
      />
    </Card>
  )
}
