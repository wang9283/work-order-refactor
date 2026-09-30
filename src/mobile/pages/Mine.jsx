import React from 'react'
import { List, Tag } from 'antd-mobile'

const ENTRIES = [
  { key: 'schedule', label: '日排班', desc: '出勤状态、待处理任务与改派' },
  { key: 'contribution', label: '贡献调节', desc: '工单完成后调整参与人比例' },
  { key: 'income', label: '收入核对', desc: '核对本组织已完成工单收入' },
]

export default function Mine({ orgName, roleName, onOpen }) {
  return (
    <div style={{ padding: 12 }}>
      <List header="账号">
        <List.Item extra={<Tag color="primary">{orgName}</Tag>}>{roleName}</List.Item>
      </List>
      <List header="管理功能（低频）" style={{ marginTop: 12 }}>
        {ENTRIES.map((e) => (
          <List.Item key={e.key} description={e.desc} arrow onClick={() => onOpen(e.key)}>
            {e.label}
          </List.Item>
        ))}
      </List>
      <div style={{ color: '#999', fontSize: 12, textAlign: 'center', marginTop: 16 }}>
        低频功能已收进「我的」，首页与任务更轻
      </div>
    </div>
  )
}