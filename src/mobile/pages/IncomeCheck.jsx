import React, { useMemo } from 'react'
import { List, Tag } from 'antd-mobile'
import { loadConfig, loadCurrentOrg } from '@shared/store'

export default function IncomeCheck() {
  const config = loadConfig()
  const orgId = loadCurrentOrg()

  const rows = useMemo(() => {
    const completed = (config.tickets || []).filter((t) => t.status === 'completed' && t.orgId === orgId)
    return completed.flatMap((t) => {
      const participants = t.participants || (t.assigneeId ? [{ personId: t.assigneeId, ratio: 100 }] : [])
      return participants.map((p) => ({
        id: `${t.id}_${p.personId}`,
        ticketNo: t.ticketNo || t.id,
        typeName: config.ticketTypes.find((x) => x.id === t.ticketTypeId)?.name || t.ticketTypeId,
        personName: config.personnel.find((x) => x.id === p.personId)?.name || p.personId,
        ratio: p.ratio,
      }))
    })
  }, [config, orgId])

  return (
    <div style={{ padding: 12 }}>
      <List header="收入核对（展示）">
        {rows.length === 0 && <div style={{ padding: '12px 0', color: '#999', textAlign: 'center' }}>暂无可核对收入</div>}
        {rows.map((r) => (
          <List.Item
            key={r.id}
            description={`${r.typeName} · ${r.personName}`}
            extra={<Tag color="blue">{r.ratio}%</Tag>}
          >
            {r.ticketNo}
          </List.Item>
        ))}
      </List>
    </div>
  )
}
