import React, { useMemo } from 'react'
import { List, Tag, NavBar } from 'antd-mobile'
import { loadConfig, loadCurrentOrg, saveConfig } from '@shared/store'

export default function Messages({ onBack }) {
  const config = loadConfig()
  const orgId = loadCurrentOrg()

  const messages = useMemo(() => {
    return (config.messages || []).filter((m) => m.orgId === orgId)
  }, [config, orgId])

  const markRead = (id) => {
    const msg = config.messages.find((m) => m.id === id)
    if (msg) {
      msg.read = true
      saveConfig(config)
    }
  }

  return (
    <div>
      <NavBar onBack={onBack} style={{ background: '#fff' }}>站内消息</NavBar>
      <List style={{ padding: 12 }}>
        {messages.length === 0 && <div style={{ padding: '12px 0', color: '#999', textAlign: 'center' }}>暂无消息</div>}
        {messages.map((m) => (
          <List.Item
            key={m.id}
            description={m.content}
            extra={m.read ? <Tag>已读</Tag> : <Tag color="red">未读</Tag>}
            onClick={() => markRead(m.id)}
          >
            {m.title}
          </List.Item>
        ))}
      </List>
    </div>
  )
}
