import React, { useMemo } from 'react'
import { List } from 'antd-mobile'
import { loadConfig, loadCurrentOrg } from '@shared/store'

export default function MobileHome({ onNavigate }) {
  const config = loadConfig()
  const orgId = loadCurrentOrg()

  const stats = useMemo(() => {
    const tickets = (config.tickets || []).filter((t) => t.orgId === orgId)
    const today = new Date().toISOString().slice(0, 10)
    const todayTickets = tickets.filter((t) => (t.createdAt || '').startsWith(today))
    return [
      { key: 'pending', label: '今日待开始', value: todayTickets.filter((t) => t.status === 'pending').length },
      { key: 'inProgress', label: '今日执行中', value: todayTickets.filter((t) => t.status === 'inProgress').length },
      { key: 'completed', label: '今日已完成', value: todayTickets.filter((t) => t.status === 'completed').length },
    ]
  }, [config, orgId])

  return (
    <div style={{ padding: 12 }}>
      <List header="首页">
        {stats.map((s) => (
          <List.Item
            key={s.key}
            description="点击查看对应任务列表"
            extra={<span style={{ fontSize: 18, fontWeight: 600, color: '#1677ff' }}>{s.value}</span>}
            onClick={() => onNavigate(s.key)}
          >
            {s.label}
          </List.Item>
        ))}
      </List>
    </div>
  )
}
