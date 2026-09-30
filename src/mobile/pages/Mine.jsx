import React, { useState } from 'react'
import { List, Tag, Popup, CheckList, Space } from 'antd-mobile'
import { loadCurrentOrg } from '@shared/store'
import { ROLE_LABELS, availableRoles } from '@shared/roles'

// 低频管理功能 + 各自可见的角色（App 端视角权限入口）
const ENTRIES = [
  { key: 'schedule', label: '日排班', desc: '出勤状态、待处理任务与改派', roles: ['subsidiary_manager'] },
  { key: 'contribution', label: '贡献调节', desc: '工单完成后调整参与人比例', roles: ['subsidiary_owner'] },
  { key: 'income', label: '收入核对', desc: '核对本组织已完成工单收入', roles: ['subsidiary_owner'] },
]

export default function Mine({ orgName, role, onRoleChange, onOpen }) {
  const [switchOpen, setSwitchOpen] = useState(false)
  const orgId = loadCurrentOrg()
  const visibleEntries = ENTRIES.filter((e) => e.roles.includes(role))

  return (
    <div style={{ padding: 12 }}>
      <List header="账号">
        <List.Item extra={<Tag color="primary">{orgName}</Tag>}>
          <Space direction="vertical">
            <span>{ROLE_LABELS[role] || role}</span>
          </Space>
        </List.Item>
        <List.Item
          arrow
          onClick={() => setSwitchOpen(true)}
          description="仅影响功能可见性与操作权限，不修改账号"
        >
          切换角色视角（演示）
        </List.Item>
      </List>

      <List header="管理功能（低频）" style={{ marginTop: 12 }}>
        {visibleEntries.length === 0 && (
          <div style={{ padding: '16px 0', color: '#999', textAlign: 'center' }}>当前角色无管理功能</div>
        )}
        {visibleEntries.map((e) => (
          <List.Item key={e.key} description={e.desc} arrow onClick={() => onOpen(e.key)}>
            {e.label}
          </List.Item>
        ))}
      </List>

      <div style={{ color: '#999', fontSize: 12, textAlign: 'center', marginTop: 16 }}>
        低频功能已收进「我的」，首页与任务更轻
      </div>

      <Popup
        visible={switchOpen}
        onMaskClick={() => setSwitchOpen(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 12 }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>切换角色视角</div>
        <div style={{ fontSize: 12, color: '#999', margin: '6px 0 8px' }}>
          影响「我的」管理功能与任务操作权限，不修改账号。
        </div>
        <CheckList
          defaultValue={[role]}
          onChange={(val) => {
            if (val[0] && val[0] !== role) onRoleChange(val[0])
            setSwitchOpen(false)
          }}
        >
          {availableRoles(orgId).map((r) => (
            <CheckList.Item key={r} value={r}>
              {ROLE_LABELS[r]}
            </CheckList.Item>
          ))}
        </CheckList>
      </Popup>
    </div>
  )
}