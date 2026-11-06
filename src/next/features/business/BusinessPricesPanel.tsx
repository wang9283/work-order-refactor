import { useCallback, useEffect, useRef, useState } from 'react'
import { App, Button, Card, DatePicker, Empty, Form, Input, InputNumber, Modal, Select, Space, Table, Typography } from 'antd'
import type { BusinessCatalogItem, BusinessPriceRuleVersion } from '@contracts/index'
import dayjs from 'dayjs'
import { api, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'
import { ErrorBlock, LoadingBlock } from '@next/shared/ui'
import { formatDateTime } from '@next/shared/format'
import { useBusinessScope } from './useBusinessScope'
import { useAntFormUnsavedChanges } from '@next/shared/unsaved-changes'

type Dimension = { catalogId: string; materialTypeId: string | null }
export default function BusinessPricesPanel({ businessKind }: { businessKind: 'production' | 'loading' }) {
  const { user } = useAuth()
  const { message } = App.useApp()
  const { org, catalog, siteId, config, loading, error, reload } = useBusinessScope()
  const [prices, setPrices] = useState<BusinessPriceRuleVersion[]>([])
  const [priceError, setPriceError] = useState('')
  const [editing, setEditing] = useState<Dimension | null>(null)
  const [history, setHistory] = useState<Dimension | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  useAntFormUnsavedChanges(form, Boolean(editing), '预计价格版本')
  const requestId = useRef(0)
  const loadPrices = useCallback(async () => {
    const current = ++requestId.current
    setPriceError(''); setPrices([])
    if (!siteId) return
    try {
      const data = await api.get<BusinessPriceRuleVersion[]>(`/business-prices?siteId=${encodeURIComponent(siteId)}&kind=${businessKind}`)
      if (current === requestId.current) setPrices(data)
    } catch (reason) { if (current === requestId.current) setPriceError(errorMessage(reason)) }
  }, [siteId, businessKind])
  useEffect(() => { void loadPrices(); return () => { requestId.current += 1 } }, [loadPrices])
  const enabled = (kind: BusinessCatalogItem['kind']) => catalog.filter((item) => item.kind === kind && item.status === 'active'
    && config && config.siteId === siteId && config.items.some((entry) => entry.catalogId === item.id && entry.enabled))
  const rows = businessKind === 'production'
    ? catalog.filter((item) => item.kind === 'production_post' && item.status === 'active')
    : enabled('loading_type')
  const materials = enabled('material_type')
  const canManage = Boolean(siteId && user?.grants.some((grant) => grant.capability === 'price.manage'
    && (grant.type === 'group' || (grant.type === 'base' && grant.id === siteId))))
  const versions = (dimension: Dimension) => prices.filter((price) => price.catalogId === dimension.catalogId && price.materialTypeId === dimension.materialTypeId)
    .sort((a, b) => b.versionNo - a.versionNo)
  const open = (dimension: Dimension) => {
    form.resetFields(); form.setFieldsValue({ unit: '吨', effectiveFrom: dayjs().startOf('day') }); setEditing(dimension)
  }
  const save = async () => {
    if (!siteId || !editing) return
    try {
      const values = await form.validateFields(); setSaving(true)
      await api.post('/business-prices', { siteId, kind: businessKind, ...editing, unit: values.unit,
        unitPriceMicros: Math.round(values.unitPrice * 1_000_000), effectiveFrom: values.effectiveFrom.toISOString(), effectiveTo: values.effectiveTo?.toISOString() || null })
      setEditing(null); await loadPrices(); message.success('价格版本已发布')
    } catch (reason) { if (reason instanceof Error) message.error(errorMessage(reason)) } finally { setSaving(false) }
  }
  if (loading && !org) return <LoadingBlock />
  if (error) return <ErrorBlock message={error} onRetry={() => void reload()} />
  const priceCell = (dimension: Dimension) => {
    const rules = versions(dimension)
    const now = Date.now()
    const current = rules.find((rule) => rule.status === 'published' && Date.parse(rule.effectiveFrom) <= now && (!rule.effectiveTo || Date.parse(rule.effectiveTo) >= now))
    return <Space direction="vertical" size={4}>
      <span>{current ? `${(current.unitPriceMicros / 1_000_000).toFixed(4)} 元/${current.unit}` : '未配置'}</span>
      <Space wrap>{canManage && <Button size="small" onClick={() => open(dimension)}>发布版本</Button>}
        {rules.length > 0 && <Button type="link" size="small" onClick={() => setHistory(dimension)}>历史版本（{rules.length}）</Button>}</Space>
    </Space>
  }
  return <div className="workspace-stack">
    <Card className="surface-card" size="small"><Space wrap><Typography.Text strong>当前生产基地</Typography.Text><Typography.Text>{siteId || '未选择'}</Typography.Text></Space>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>{businessKind === 'production' ? '按工序/岗位和物料类别维护本基地预计单价。' : '按装卸类型维护本基地预计单价。'}班次、产线和执行人不影响价格。</Typography.Paragraph>
    </Card>
    {priceError && <ErrorBlock message={priceError} onRetry={() => void loadPrices()} />}
    <Card className="surface-card" title={businessKind === 'production' ? '工序/岗位 × 物料类别' : '装卸类型预计价格'}>
      {!rows.length || (businessKind === 'production' && !materials.length) ? <Empty description={<>请先在<a href={businessKind === 'production' ? '#/production-config' : '#/loading-config'}>{businessKind === 'production' ? '生产配置' : '装卸配置'}</a>中启用基地适用{businessKind === 'production' ? '物料类别' : '项'}。</>} /> :
        <Table<BusinessCatalogItem> rowKey="id" pagination={false} loading={loading} dataSource={rows} scroll={{ x: businessKind === 'production' ? Math.max(520, 180 + materials.length * 250) : 520 }} columns={[
          { title: businessKind === 'production' ? '工序/岗位' : '装卸类型', dataIndex: 'name', width: 180, fixed: 'left' },
          ...(businessKind === 'production' ? materials.map((material) => ({ title: material.name, key: material.id, width: 250,
            render: (_: unknown, post: BusinessCatalogItem) => priceCell({ catalogId: post.id, materialTypeId: material.id }) }))
            : [{ title: '预计单价', key: 'price', render: (_: unknown, item: BusinessCatalogItem) => priceCell({ catalogId: item.id, materialTypeId: null }) }]),
        ]} />}
    </Card>
    <Modal title="发布预计价格版本" open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => void save()} confirmLoading={saving}>
      <Typography.Paragraph>{catalog.find((item) => item.id === editing?.catalogId)?.name}{editing?.materialTypeId ? ` · ${catalog.find((item) => item.id === editing.materialTypeId)?.name}` : ''}</Typography.Paragraph>
      <Form form={form} layout="vertical">
        <Form.Item name="unit" label="计量单位" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="unitPrice" label="预计单价（元）" rules={[{ required: true }]}><InputNumber min={0} precision={4} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="effectiveFrom" label="生效时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="effectiveTo" label="失效时间"><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="价格版本历史" width={720} open={Boolean(history)} onCancel={() => setHistory(null)} footer={null}>
      <Table<BusinessPriceRuleVersion> rowKey="id" size="small" dataSource={history ? versions(history) : []} columns={[
        { title: '版本', dataIndex: 'versionNo' }, { title: '预计单价', render: (_, rule) => `${(rule.unitPriceMicros / 1_000_000).toFixed(4)} 元/${rule.unit}` },
        { title: '生效时间', dataIndex: 'effectiveFrom', render: formatDateTime }, { title: '失效时间', dataIndex: 'effectiveTo', render: (value: string | null) => value ? formatDateTime(value) : '—' },
      ]} />
    </Modal>
  </div>
}
