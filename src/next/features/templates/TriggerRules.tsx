import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Drawer, Form, Input, InputNumber, Select, Space, Table, Tag } from 'antd'
import type { BusinessCatalogItem, BusinessKind, Material, OrgReferenceData, SiteBusinessConfig } from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { useAntFormUnsavedChanges } from '@next/shared/unsaved-changes'

type Config = {
  ticketTypeId: string; siteId: string; factoryId: string; name: string; status: 'active' | 'inactive'
  businessKind: BusinessKind; materialId: string | null; materialTypeId: string | null
  businessItems: Array<{ catalogId: string; kind: 'production_post' | 'loading_type' }>
  productionPostIds?: string[]; loadingTypeId?: string
  mode: 'schedule' | 'event'; workAreaId: string | null; crewId: string | null; deadlineHours: number | null
  effectiveFrom: string; effectiveTo: string | null; frequency: 'daily' | 'weekly' | null
  time: string | null; weekdays: number[]; eventType: string | null
  conditions: Array<{ field: string; op: 'eq' | 'in'; values: Array<string | number | boolean> }>
}
type Rule = { id: string; current_version: number; config: Config }
type TriggerRun = { id: string; status: string; scheduled_at: string | null; ticket_id: string | null; error_message: string | null; attempts: number; created_at: string }
type TriggerType = { id: string; name: string; businessKind?: BusinessKind | null }

export default function TriggerRules({ type, org, canManage, defaultSiteId }: { type: TriggerType; org: OrgReferenceData; canManage: boolean; defaultSiteId?: string }) {
  const { message } = App.useApp()
  const [rules, setRules] = useState<Rule[]>([])
  const [editing, setEditing] = useState<Rule | 'new' | null>(null)
  const [viewing, setViewing] = useState<Rule | null>(null)
  const [runs, setRuns] = useState<TriggerRun[]>([])
  const [catalog, setCatalog] = useState<BusinessCatalogItem[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [siteConfig, setSiteConfig] = useState<SiteBusinessConfig | null>(null)
  const [form] = Form.useForm<Config>()
  useAntFormUnsavedChanges(form, editing !== null, editing === 'new' ? '新增触发规则' : '编辑触发规则')
  const mode = Form.useWatch('mode', form)
  const frequency = Form.useWatch('frequency', form)
  const siteId = Form.useWatch('siteId', form)
  const factoryId = Form.useWatch('factoryId', form)
  const materialId = Form.useWatch('materialId', form)
  const businessKind = type.businessKind || 'generic'
  const enabledBusinessIds = useMemo(() => new Set(siteConfig?.items.filter((item) => item.enabled).map((item) => item.catalogId) || []), [siteConfig])
  const businessOptions = (kind: BusinessCatalogItem['kind']) => catalog.filter((item) => item.kind === kind
    && item.status === 'active'
    && (kind === 'production_post' ? true : enabledBusinessIds.has(item.id))).map((item) => ({ value: item.id, label: item.name }))
  const load = useCallback(async () => {
    try { setRules((await api.get<Rule[]>('/trigger-rules')).filter((rule) => rule.config.ticketTypeId === type.id && (!defaultSiteId || rule.config.siteId === defaultSiteId))) }
    catch (error) { message.error(errorMessage(error)) }
  }, [defaultSiteId, message, type.id])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (businessKind === 'generic') return
    const selectedSiteId = siteId || defaultSiteId
    if (!selectedSiteId) {
      void Promise.all([api.get<BusinessCatalogItem[]>('/business-catalogs'), api.get<Material[]>('/materials')])
        .then(([items, materialData]) => { setCatalog(items); setMaterials(materialData) })
        .catch((error) => message.error(errorMessage(error)))
      setSiteConfig(null)
      return
    }
    void Promise.all([api.get<BusinessCatalogItem[]>('/business-catalogs'), api.get<SiteBusinessConfig>(`/sites/${encodeURIComponent(selectedSiteId)}/business-config`)
      .catch(() => null), api.get<Material[]>('/materials')]).then(([items, config, materialData]) => {
      setCatalog(items); setSiteConfig(config); setMaterials(materialData)
    })
      .catch((error) => message.error(errorMessage(error)))
  }, [businessKind, defaultSiteId, message, siteId])
  const open = (rule?: Rule) => {
    form.resetFields()
    const existing = rule?.config
    form.setFieldsValue(existing ? {
      ...existing,
      productionPostIds: existing.businessItems?.filter((item) => item.kind === 'production_post').map((item) => item.catalogId),
      loadingTypeId: existing.businessItems?.find((item) => item.kind === 'loading_type')?.catalogId,
    } : { ticketTypeId: type.id, businessKind, materialId: null, materialTypeId: null, businessItems: [], productionPostIds: [], loadingTypeId: undefined,
      siteId: defaultSiteId, name: '', status: 'inactive', mode: 'schedule',
      effectiveFrom: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), frequency: 'daily', time: '08:00', weekdays: [], conditions: [] })
    setEditing(rule || 'new')
  }
  const save = async () => {
    try {
      const values = await form.validateFields()
      const payload = { ...values, ticketTypeId: type.id, businessKind, workAreaId: values.workAreaId || null, crewId: values.crewId || null,
        materialId: businessKind === 'production' ? values.materialId || null : null,
        materialTypeId: businessKind === 'production' ? values.materialTypeId || null : null,
        businessItems: businessKind === 'production'
          ? (values.productionPostIds || []).map((catalogId) => ({ catalogId, kind: 'production_post' as const }))
          : businessKind === 'loading' && values.loadingTypeId ? [{ catalogId: values.loadingTypeId, kind: 'loading_type' as const }] : [],
        deadlineHours: values.deadlineHours || null, effectiveTo: values.effectiveTo || null,
        frequency: values.mode === 'schedule' ? values.frequency : null, time: values.mode === 'schedule' ? values.time : null,
        weekdays: values.weekdays || [], eventType: values.mode === 'event' ? values.eventType : null, conditions: values.conditions || [] }
      if (editing && editing !== 'new') await api.put(`/trigger-rules/${editing.id}`, { revision: editing.current_version, config: payload })
      else await api.post('/trigger-rules', payload)
      message.success('触发规则已保存'); setEditing(null); await load()
    } catch (error) { if (error instanceof Error) message.error(errorMessage(error)) }
  }
  const showRuns = async (rule: Rule) => {
    try { setRuns(await api.get<TriggerRun[]>(`/trigger-rules/${rule.id}/runs`)); setViewing(rule) }
    catch (error) { message.error(errorMessage(error)) }
  }
  const retry = async (id: string) => {
    try {
      const result = await api.post<TriggerRun>(`/trigger-runs/${id}/retry`, {})
      if (result.status === 'succeeded') message.success('补发成功')
      else message.error(result.error_message || '补发失败，请查看触发记录')
      if (viewing) await showRuns(viewing)
    }
    catch (error) { message.error(errorMessage(error)) }
  }
  return <>
    <Alert type="info" showIcon message={businessKind === 'generic' ? '手动开单始终可用；定时与事件规则按作业位置生成工单。' : '触发规则按基地启用的料类和岗位/装卸类型创建专用工单；生产规则可选产品，岗位按产品参与工序默认；价格按工单作业时间匹配。'} style={{ marginBottom: 16 }} />
    {canManage && <Button type="primary" onClick={() => open()} style={{ marginBottom: 12 }}>新增触发规则</Button>}
    <Table<Rule> rowKey="id" size="small" dataSource={rules} pagination={{ pageSize: 8 }} columns={[
      { title: '规则', render: (_, row) => row.config.name },
      { title: '基地', render: (_, row) => org.bases.find((item) => item.id === row.config.siteId)?.name || row.config.siteId },
      { title: '方式', render: (_, row) => row.config.mode === 'schedule' ? `${row.config.frequency === 'daily' ? '每天' : '每周'} ${row.config.time}` : `事件 · ${row.config.eventType}` },
      { title: '状态', render: (_, row) => <Tag color={row.config.status === 'active' ? 'green' : 'default'}>{row.config.status === 'active' ? '启用' : '停用'}</Tag> },
      { title: '版本', dataIndex: 'current_version' },
      { title: '操作', render: (_, row) => <Space><Button size="small" onClick={() => void showRuns(row)}>生成记录</Button>{canManage && <Button size="small" onClick={() => open(row)}>编辑</Button>}</Space> },
    ]} />
    <Drawer width={600} open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? '新增触发规则' : '编辑触发规则'} extra={<Button type="primary" onClick={() => void save()}>保存</Button>}>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="规则名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="siteId" label="实际作业基地" rules={[{ required: true }]}><Select disabled options={org.bases.map((x) => ({ value: x.id, label: x.name }))} /></Form.Item>
        {businessKind === 'production' && <>
          <Form.Item name="materialId" label="产品（可选）">
            <Select
              allowClear
              placeholder="选择产品后按参与工序默认岗位"
              showSearch
              optionFilterProp="label"
              options={materials.filter((item) => item.status === 'active').map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` }))}
              onChange={(value: string | undefined) => {
                const material = value ? materials.find((item) => item.id === value) : undefined
                const activePosts = catalog.filter((item) => item.kind === 'production_post' && item.status === 'active')
                form.setFieldsValue({
                  materialTypeId: material?.materialTypeId ?? null,
                  productionPostIds: material ? material.postCatalogIds.filter((id) => activePosts.some((post) => post.id === id)) : [],
                })
              }}
            />
          </Form.Item>
          <Form.Item name="materialTypeId" label="物料类别" rules={[{ required: !materialId, message: '选择产品或由物料类别带出' }]}>
            <Select disabled={Boolean(materialId)} options={businessOptions('material_type')} />
          </Form.Item>
          <Form.Item name="productionPostIds" label="工序/岗位" rules={[{ required: !materialId, message: '至少选择一个岗位，或选择产品按参与工序默认' }]}>
            <Select mode="multiple" options={businessOptions('production_post').filter((option) => {
              const material = materialId ? materials.find((item) => item.id === materialId) : undefined
              return !material || material.postCatalogIds.includes(option.value)
            })} />
          </Form.Item>
        </>}
        {businessKind === 'loading' && <Form.Item name="loadingTypeId" label="装卸类型" rules={[{ required: true }]}><Select options={businessOptions('loading_type')} /></Form.Item>}
        <Form.Item name="factoryId" label="作业组织" rules={[{ required: true }]}><Select disabled={editing !== 'new'} options={org.factories.filter((x) => x.baseId === siteId).map((x) => ({ value: x.id, label: x.name }))} onChange={() => form.setFieldsValue({ workAreaId: null, crewId: null })} /></Form.Item>
        <Form.Item name="workAreaId" label="作业位置"><Select allowClear options={org.workAreas.filter((x) => x.factoryId === factoryId && x.status === 'active').map((x) => ({ value: x.id, label: x.name }))} /></Form.Item>
        <Form.Item name="crewId" label="默认班组"><Select allowClear options={org.crews.filter((x) => x.factoryId === factoryId).map((x) => ({ value: x.id, label: x.name }))} /></Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} /></Form.Item>
        <Form.Item name="mode" label="触发方式" rules={[{ required: true }]}><Select options={[{ value: 'schedule', label: '定时生成' }, { value: 'event', label: '业务事件' }]} /></Form.Item>
        <Form.Item name="effectiveFrom" label="生效日期（YYYY-MM-DD）" rules={[{ required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ }]}><Input placeholder="2026-11-02" /></Form.Item>
        <Form.Item name="effectiveTo" label="失效日期（含当日，可选）" rules={[{ pattern: /^\d{4}-\d{2}-\d{2}$/ }]}><Input placeholder="YYYY-MM-DD" /></Form.Item>
        <Form.Item name="deadlineHours" label="生成后完成时限（小时，可选）"><InputNumber min={1} max={8760} precision={0} /></Form.Item>
        {mode === 'schedule' ? <>
          <Form.Item name="frequency" label="频率" rules={[{ required: true }]}><Select options={[{ value: 'daily', label: '每天' }, { value: 'weekly', label: '每周' }]} /></Form.Item>
          {frequency === 'weekly' && <Form.Item name="weekdays" label="星期" rules={[{ required: true }]}><Select mode="multiple" options={['日','一','二','三','四','五','六'].map((x, i) => ({ value: i, label: `周${x}` }))} /></Form.Item>}
          <Form.Item name="time" label="触发时间（北京时间）" rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ }]}><Input placeholder="08:00" /></Form.Item>
        </> : <>
          <Form.Item name="eventType" label="事件类型" rules={[{ required: true }]}><Input placeholder="例如 demo.material_arrived" /></Form.Item>
          <Alert type="info" message="事件接收接口为演示接口，尚未连接真实业务系统。" />
          <Form.List name="conditions">{(fields, { add, remove }) => <>
            {fields.map((field) => <Space key={field.key} align="baseline" wrap>
              <Form.Item name={[field.name, 'field']} rules={[{ required: true }]}><Input placeholder="字段名" /></Form.Item>
              <Form.Item name={[field.name, 'op']} rules={[{ required: true }]}><Select style={{ width: 110 }} options={[{ value: 'eq', label: '等于' }, { value: 'in', label: '属于' }]} /></Form.Item>
              <Form.Item name={[field.name, 'values']} rules={[{ required: true }]}><Select mode="tags" style={{ minWidth: 150 }} placeholder="值，回车添加" /></Form.Item>
              <Button onClick={() => remove(field.name)}>移除</Button>
            </Space>)}<Button onClick={() => add({ op: 'eq', values: [] })}>添加条件</Button>
          </>}</Form.List>
        </>}
      </Form>
    </Drawer>
    <Drawer width={760} open={Boolean(viewing)} onClose={() => setViewing(null)} title="触发记录">
      <Table<TriggerRun> rowKey="id" size="small" dataSource={runs} columns={[
        { title: '时间', render: (_, row) => row.scheduled_at || row.created_at },
        { title: '结果', dataIndex: 'status', render: (v: string) => ({ succeeded: '成功', missed: '漏触发', failed: '失败' }[v] || v) },
        { title: '工单', dataIndex: 'ticket_id' }, { title: '原因', dataIndex: 'error_message' },
        { title: '次数', dataIndex: 'attempts' },
        { title: '操作', render: (_, row) => canManage && row.status !== 'succeeded' ? <Button size="small" onClick={() => void retry(row.id)}>补发</Button> : null },
      ]} />
    </Drawer>
  </>
}
