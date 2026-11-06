import { useEffect, useState } from 'react'
import { App, Button, Card, Checkbox, Empty, Space, Table, Tabs, Tag, Typography } from 'antd'
import type { BusinessCatalogItem } from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'
import { useBusinessScope } from './useBusinessScope'
import BusinessPricesPanel from './BusinessPricesPanel'
import TriggerRulesWorkspace from '@next/features/templates/TriggerRulesWorkspace'
import { useUnsavedChanges } from '@next/shared/unsaved-changes'

export default function SiteBusinessWorkspace({ businessKind }: { businessKind: 'production' | 'loading' }) {
  const { user } = useAuth()
  const { message } = App.useApp()
  const { org, catalog, config, siteId, loading, error, reload } = useBusinessScope()
  const [draft, setDraft] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [section, setSection] = useState('options')
  useEffect(() => { setDraft(config?.items.filter((item) => item.enabled).map((item) => item.catalogId) || []) }, [config])
  const kinds = businessKind === 'production' ? ['material_type'] : ['loading_type']
  const relevant = catalog.filter((item) => kinds.includes(item.kind))
  const canManage = Boolean(siteId && user?.grants.some((grant) => grant.capability === 'ticket_type.manage'
    && (grant.type === 'group' || (grant.type === 'base' && grant.id === siteId))))
  const dirty = relevant.some((item) => draft.includes(item.id) !== Boolean(config?.items.find((saved) => saved.catalogId === item.id)?.enabled))
  useUnsavedChanges(dirty, businessKind === 'production' ? '生产配置' : '装卸配置')
  const toggle = (id: string, checked: boolean) => setDraft((previous) => checked ? [...new Set([...previous, id])] : previous.filter((item) => item !== id))
  const save = async () => {
    if (!siteId || !config) return
    setSaving(true)
    try {
      await api.put(`/sites/${encodeURIComponent(siteId)}/business-config`, { revision: config.revision,
        items: relevant.map((item) => ({ catalogId: item.id, enabled: draft.includes(item.id) })) })
      await reload(); message.success(businessKind === 'production' ? '生产配置已保存' : '装卸配置已保存')
    } catch (reason) { message.error(errorMessage(reason)) } finally { setSaving(false) }
  }
  if (loading && !org) return <LoadingBlock />
  if (error) return <ErrorBlock message={error} onRetry={() => void reload()} />
  const disabled = !canManage || loading || saving
  const choices = (kind: BusinessCatalogItem['kind']) => catalog.filter((item) => item.kind === kind)
  const checkboxList = (kind: BusinessCatalogItem['kind']) => <div className="business-options">
    {choices(kind).map((item) => <Checkbox key={item.id} checked={draft.includes(item.id)}
      disabled={disabled || (item.status === 'inactive' && !draft.includes(item.id))} onChange={(event) => toggle(item.id, event.target.checked)}>
      {item.name}{item.status === 'inactive' && <Tag>停用</Tag>}
    </Checkbox>)}
    {!choices(kind).length && <Empty description={<>暂无可选项，请先维护<a href="#/business-catalogs">作业字典</a>。</>} />}
  </div>
  return <div className="workspace-stack">
    <PageHeader title={businessKind === 'production' ? '生产配置' : '装卸配置'}
      description={businessKind === 'production' ? '维护基地料类、岗位预计单价和工单生成方式。' : '维护基地装卸类型、预计单价和工单生成方式。'} />
    <Tabs activeKey={section} onChange={setSection} items={[{ key: 'options', label: '基地适用项' }, { key: 'prices', label: '预计单价' }, { key: 'generation', label: '生成方式' }]} />
    {section === 'prices' ? <BusinessPricesPanel businessKind={businessKind} /> : section === 'generation' ? <TriggerRulesWorkspace key={businessKind} businessKind={businessKind} embedded /> : <>
    <Card className="surface-card" size="small"><div className="business-scope-bar">
      <Space wrap><Typography.Text strong>当前生产基地</Typography.Text><Tag color="green">{siteId || '未选择'}</Tag></Space>
      {canManage && <Button type="primary" disabled={!dirty || loading} loading={saving} onClick={() => void save()}>保存配置</Button>}
    </div></Card>
    {businessKind === 'production' ? <Card className="surface-card" title="物料类别" extra={`${choices('material_type').filter((item) => draft.includes(item.id)).length} 项适用`}>{checkboxList('material_type')}</Card> : <Card className="surface-card" title="装卸类型">
      <Table<BusinessCatalogItem> rowKey="id" pagination={false} size="small" dataSource={choices('loading_type')} columns={[
        { title: '适用', width: 70, render: (_, item) => <Checkbox aria-label={`启用${item.name}`} checked={draft.includes(item.id)} disabled={disabled || (item.status === 'inactive' && !draft.includes(item.id))} onChange={(event) => toggle(item.id, event.target.checked)} /> },
        { title: '作业类型', render: (_, item) => item.name.includes('-') ? item.name.split('-')[0] : '装卸' },
        { title: '装卸方式', render: (_, item) => item.name.includes('-') ? item.name.slice(item.name.indexOf('-') + 1) : item.name },
        { title: '状态', render: (_, item) => item.status === 'active' ? '启用' : '停用' },
      ]} />
    </Card>}
    <Typography.Paragraph type="secondary">基础选项在<a href="#/business-catalogs">作业字典</a>中维护。{businessKind === 'production' && <>产品参与工序在<a href="#/materials">产品物料</a>中维护。</>}</Typography.Paragraph>
    </>}
  </div>
}
