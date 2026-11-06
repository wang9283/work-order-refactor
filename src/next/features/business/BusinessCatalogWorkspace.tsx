import { useCallback, useEffect, useState } from 'react'
import { App, Button, Card, Form, Input, Modal, Select, Table, Tabs, Tag } from 'antd'
import type { BusinessCatalogItem, BusinessCatalogKind } from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'
import { useAntFormUnsavedChanges } from '@next/shared/unsaved-changes'

const definitions: Record<BusinessCatalogKind, { label: string; path: string }> = {
  material_type: { label: '物料类别', path: 'material-types' }, production_post: { label: '工序/岗位', path: 'production-posts' }, loading_type: { label: '装卸类型', path: 'loading-types' },
}
export default function BusinessCatalogWorkspace() {
  const { user } = useAuth()
  const { message } = App.useApp()
  const [catalog, setCatalog] = useState<BusinessCatalogItem[]>([])
  const [kind, setKind] = useState<BusinessCatalogKind>('material_type')
  const [editing, setEditing] = useState<BusinessCatalogItem | 'new' | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form] = Form.useForm()
  useAntFormUnsavedChanges(form, Boolean(editing), `${editing === 'new' ? '新增' : '编辑'}作业字典`)
  const canManage = Boolean(user?.grants.some((grant) => grant.capability === 'business_catalog.manage' && grant.type === 'group'))
  const reload = useCallback(async () => {
    try { setError(''); setCatalog(await api.get<BusinessCatalogItem[]>('/business-catalogs')) }
    catch (reason) { setError(errorMessage(reason)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void reload() }, [reload])
  const open = (item?: BusinessCatalogItem) => { form.resetFields(); form.setFieldsValue(item || { code: '', name: '', status: 'active' }); setEditing(item || 'new') }
  const save = async () => {
    try {
      const values = await form.validateFields(); setSaving(true)
      if (editing && editing !== 'new') await api.put(`/business-catalogs/${definitions[kind].path}/${editing.id}`, { ...values, revision: editing.revision })
      else await api.post(`/business-catalogs/${definitions[kind].path}`, values)
      setEditing(null); await reload(); message.success('字典项已保存')
    } catch (reason) { if (reason instanceof Error) message.error(errorMessage(reason)) } finally { setSaving(false) }
  }
  if (loading) return <LoadingBlock />
  if (error) return <ErrorBlock message={error} onRetry={() => void reload()} />
  return <div className="workspace-stack">
    <PageHeader title="作业字典" description="统一维护生产物料类别、工序/岗位和装卸类型。各基地在生产配置、装卸配置中选择适用项，停用不影响历史工单。" />
    <Card className="surface-card" title="基础选项" extra={canManage && <Button type="primary" onClick={() => open()}>新增{definitions[kind].label}</Button>}>
      <Tabs activeKey={kind} onChange={(value) => setKind(value as BusinessCatalogKind)} items={Object.entries(definitions).map(([key, item]) => ({ key, label: item.label }))} />
      <Table<BusinessCatalogItem> rowKey="id" dataSource={catalog.filter((item) => item.kind === kind)} pagination={{ pageSize: 15 }} scroll={{ x: 500 }} columns={[
        { title: definitions[kind].label, dataIndex: 'name' }, { title: '编码', dataIndex: 'code' },
        { title: '状态', dataIndex: 'status', render: (status: string) => <Tag color={status === 'active' ? 'green' : 'default'}>{status === 'active' ? '启用' : '停用'}</Tag> },
        { title: '操作', render: (_, item) => canManage ? <Button size="small" onClick={() => open(item)}>编辑</Button> : '—' },
      ]} />
    </Card>
    <Modal title={`${editing === 'new' ? '新增' : '编辑'}${definitions[kind].label}`} open={Boolean(editing)} confirmLoading={saving} onCancel={() => setEditing(null)} onOk={() => void save()}>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label={`${definitions[kind].label}名称`} rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
        <Form.Item name="code" label="编码" rules={[{ required: true, min: 2 }]}><Input /></Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} /></Form.Item>
      </Form>
    </Modal>
  </div>
}
