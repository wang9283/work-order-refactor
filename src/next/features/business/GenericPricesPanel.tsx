import { useCallback, useEffect, useState } from 'react'
import { App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Table } from 'antd'
import dayjs from 'dayjs'
import type { OrgReferenceData, PriceRuleVersion, TicketType } from '@contracts/index'
import { businessTicketTypeIds } from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'
import { ErrorBlock, LoadingBlock } from '@next/shared/ui'
import { formatDateTime } from '@next/shared/format'
import { useAntFormUnsavedChanges } from '@next/shared/unsaved-changes'

export default function GenericPricesPanel() {
  const { user, activeBase, contextVersion } = useAuth()
  const { message } = App.useApp()
  const [org, setOrg] = useState<OrgReferenceData | null>(null)
  const [types, setTypes] = useState<TicketType[]>([])
  const [prices, setPrices] = useState<PriceRuleVersion[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  useAntFormUnsavedChanges(form, editing, '其他工单预计单价')
  const reload = useCallback(async () => {
    try {
      setError('')
      const [nextOrg, typePage, pricePage] = await Promise.all([api.get<OrgReferenceData>('/org/tree'), api.getPage<TicketType>('/ticket-types', { pageSize: 200 }), api.getPage<PriceRuleVersion>('/prices', { pageSize: 200 })])
      setOrg(nextOrg); setTypes(typePage.items.filter((type) => !Object.values(businessTicketTypeIds).some((id) => id === type.id))); setPrices(pricePage.items)
    } catch (reason) { setError(errorMessage(reason)) }
  }, [activeBase?.id, contextVersion])
  useEffect(() => { void reload() }, [reload])
  const save = async () => {
    try {
      const values = await form.validateFields(); setSaving(true)
      if (!activeBase) throw new Error('当前没有可用生产基地')
      await api.post('/prices', { ticketTypeId: values.ticketTypeId, siteId: activeBase.id, unit: values.unit, unitPriceMicros: Math.round(values.unitPrice * 1_000_000), effectiveFrom: values.effectiveFrom.toISOString(), effectiveTo: values.effectiveTo?.toISOString() || null })
      setEditing(false); await reload(); message.success('预计单价已发布')
    } catch (reason) { if (reason instanceof Error) message.error(errorMessage(reason)) } finally { setSaving(false) }
  }
  if (error) return <ErrorBlock message={error} onRetry={() => void reload()} />
  if (!org) return <LoadingBlock />
  return <>
    <Card className="surface-card" title="其他工单预计单价" extra={user?.grants.some((grant) => grant.capability === 'price.manage') && <Button type="primary" onClick={() => { form.resetFields(); form.setFieldsValue({ unit: '吨', effectiveFrom: dayjs().startOf('day') }); setEditing(true) }}>发布预计单价</Button>}>
      <Table<PriceRuleVersion> rowKey="id" dataSource={prices.filter((price) => types.some((type) => type.id === price.ticketTypeId))} columns={[
        { title: '工单类型', render: (_, price) => types.find((type) => type.id === price.ticketTypeId)?.name || price.ticketTypeId }, { title: '基地', render: (_, price) => org.bases.find((base) => base.id === price.siteId)?.name || price.siteId },
        { title: '预计单价', render: (_, price) => `${(price.unitPriceMicros / 1_000_000).toFixed(4)} 元/${price.unit}` }, { title: '版本', dataIndex: 'versionNo' }, { title: '生效时间', dataIndex: 'effectiveFrom', render: formatDateTime },
      ]} />
    </Card>
    <Modal title="发布其他工单预计单价" open={editing} onCancel={() => setEditing(false)} onOk={() => void save()} confirmLoading={saving}>
      <Form form={form} layout="vertical">
        <Form.Item name="ticketTypeId" label="工单类型" rules={[{ required: true }]}><Select options={types.filter((type) => type.status === 'published').map((type) => ({ value: type.id, label: type.name }))} /></Form.Item>
        <Form.Item name="unit" label="单位" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="unitPrice" label="预计单价（元）" rules={[{ required: true }]}><InputNumber min={0} precision={4} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="effectiveFrom" label="生效时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item><Form.Item name="effectiveTo" label="失效时间"><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
      </Form>
    </Modal>
  </>
}
