import { useEffect, useState } from 'react'
import { Card, Select, Space, Typography } from 'antd'
import type { BusinessKind, OrgReferenceData, TicketType } from '@contracts/index'
import { businessTicketTypeIds } from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'
import TriggerRules from './TriggerRules'

export default function TriggerRulesWorkspace({ businessKind, embedded = false }: { businessKind?: BusinessKind; embedded?: boolean }) {
  const { user, activeBase, contextVersion } = useAuth()
  const [org, setOrg] = useState<OrgReferenceData | null>(null)
  const [types, setTypes] = useState<TicketType[]>([])
  const [typeId, setTypeId] = useState<string>(new URLSearchParams(window.location.hash.split('?')[1] || '').get('typeId') || (businessKind === 'loading' ? businessTicketTypeIds.loading : businessKind === 'generic' ? '' : businessTicketTypeIds.production))
  const [error, setError] = useState('')
  const load = async () => {
    try {
      setError('')
      const [nextOrg, typePage] = await Promise.all([api.get<OrgReferenceData>('/org/tree'), api.getPage<TicketType>('/ticket-types', { pageSize: 200 })])
      const genericTypes = typePage.items.filter((item) => item.status === 'published' && !Object.values(businessTicketTypeIds).some((id) => id === item.id))
      setOrg(nextOrg); setTypes(genericTypes)
      if (businessKind === 'generic' && !typeId) setTypeId(genericTypes[0]?.id || '')
    } catch (reason) { setError(errorMessage(reason)) }
  }
  useEffect(() => { void load() }, [activeBase?.id, contextVersion])
  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />
  if (!org) return <LoadingBlock />
  const builtins = [{ id: businessTicketTypeIds.production, name: '生产', businessKind: 'production' as BusinessKind },
    { id: businessTicketTypeIds.loading, name: '装卸', businessKind: 'loading' as BusinessKind }].filter((item) => !businessKind || item.businessKind === businessKind)
  const current = builtins.find((item) => item.id === typeId) || types.find((item) => item.id === typeId)
  return <div className="workspace-stack">
    {!embedded && <PageHeader title="生成规则" description="维护工单生成方式，查看生成结果与补发记录。" />}
    <Card className="surface-card" size="small"><Space wrap>
      <Typography.Text strong>工单类型</Typography.Text><Select aria-label="规则工单类型" value={typeId} onChange={setTypeId} style={{ minWidth: 240 }} options={[
        ...(builtins.length ? [{ label: '专用工单', options: builtins.map((item) => ({ value: item.id, label: item.name })) }] : []),
        ...(!businessKind || businessKind === 'generic' ? [{ label: '其他工单', options: types.map((item) => ({ value: item.id, label: item.name })) }] : []),
      ]} />
      <Typography.Text strong>当前生产基地</Typography.Text><Typography.Text>{activeBase?.name || '未选择'}</Typography.Text>
    </Space></Card>
    <Card className="surface-card" title={current ? `${current.name} · 生成规则` : '生成规则'}>
      {current && <TriggerRules key={`${current.id}:${activeBase?.id || 'none'}`} type={current} org={org} defaultSiteId={activeBase?.id} canManage={Boolean(user?.grants.some((grant) => grant.capability === 'ticket.create'))} />}
    </Card>
  </div>
}
