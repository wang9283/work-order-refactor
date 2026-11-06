import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Checkbox, Col, Form, Input, Modal, Row, Select, Table, Tag } from 'antd'
import type { BusinessCatalogItem, Material } from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'
import { useAntFormUnsavedChanges } from '@next/shared/unsaved-changes'

const yesNo = [{ value: true, label: '是' }, { value: false, label: '否' }]

export default function MaterialsWorkspace() {
  const { user } = useAuth()
  const { message } = App.useApp()
  const [materials, setMaterials] = useState<Material[]>([])
  const [catalog, setCatalog] = useState<BusinessCatalogItem[]>([])
  const [editing, setEditing] = useState<Material | 'new' | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form] = Form.useForm()
  useAntFormUnsavedChanges(form, Boolean(editing), editing === 'new' ? '新增产品' : '编辑产品')
  const canManage = Boolean(user?.grants.some((grant) => grant.capability === 'business_catalog.manage' && grant.type === 'group'))
  const reload = useCallback(async () => {
    try {
      setError('')
      const [materialData, catalogData] = await Promise.all([
        api.get<Material[]>('/materials'),
        api.get<BusinessCatalogItem[]>('/business-catalogs'),
      ])
      setMaterials(materialData)
      setCatalog(catalogData)
    } catch (reason) { setError(errorMessage(reason)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void reload() }, [reload])
  const postOptions = useMemo(
    () => catalog.filter((item) => item.kind === 'production_post' && item.status === 'active')
      .map((item) => ({ value: item.id, label: item.name })),
    [catalog],
  )
  const postName = useMemo(() => new Map(catalog.map((item) => [item.id, item.name])), [catalog])
  const open = (item?: Material) => {
    form.resetFields()
    form.setFieldsValue(item
      ? { ...item, postIds: item.postCatalogIds }
      : { code: '', name: '', status: 'active', smallPack: false, postIds: [] })
    setEditing(item || 'new')
  }
  const save = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const payload = {
        code: values.code, name: values.name, abbr: values.abbr || null, spec: values.spec || null,
        model: values.model || null, materialTypeId: values.materialTypeId, smallPack: Boolean(values.smallPack),
        postIds: values.postIds || [], status: values.status,
      }
      if (editing && editing !== 'new') await api.put(`/materials/${editing.id}`, { ...payload, revision: editing.revision })
      else await api.post('/materials', payload)
      setEditing(null)
      await reload()
      message.success('产品已保存')
    } catch (reason) { if (reason instanceof Error) message.error(errorMessage(reason)) } finally { setSaving(false) }
  }
  if (loading) return <LoadingBlock />
  if (error) return <ErrorBlock message={error} onRetry={() => void reload()} />
  return <div className="workspace-stack">
    <PageHeader title="物料档案" description="维护产品主数据：物料类别（产线）决定计价维度，产品决定参与工序/岗位；生产工单选择产品后按参与工序默认本单岗位。" />
    <Card className="surface-card" title="产品" extra={canManage && <Button type="primary" onClick={() => open()}>新增产品</Button>}>
      <Table<Material> rowKey="id" dataSource={materials} pagination={{ pageSize: 15 }} scroll={{ x: 900 }} columns={[
        { title: '编码', dataIndex: 'code', width: 140 },
        { title: '名称', dataIndex: 'name', width: 200 },
        { title: '简称', dataIndex: 'abbr', width: 100, render: (value: string | null) => value || '—' },
        { title: '规格', dataIndex: 'spec', width: 120, render: (value: string | null) => value || '—' },
        { title: '型号', dataIndex: 'model', width: 100, render: (value: string | null) => value || '—' },
        { title: '物料类别', dataIndex: 'materialTypeName', width: 120 },
        { title: '小包装', dataIndex: 'smallPack', width: 80, render: (value: boolean) => value ? '是' : '否' },
        { title: '参与工序', render: (_, item) => item.postCatalogIds.map((id) => postName.get(id) || id).join('、') || '—' },
        { title: '状态', dataIndex: 'status', width: 80, render: (status: string) => <Tag color={status === 'active' ? 'green' : 'default'}>{status === 'active' ? '启用' : '停用'}</Tag> },
        { title: '操作', width: 80, render: (_, item) => canManage ? <Button size="small" onClick={() => open(item)}>编辑</Button> : '—' },
      ]} />
    </Card>
    <Modal title={editing === 'new' ? '新增产品' : '修改产品与参与工序'} open={Boolean(editing)} width={640}
      confirmLoading={saving} onCancel={() => setEditing(null)} onOk={() => void save()}>
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col span={12}><Form.Item name="code" label="编码" rules={[{ required: true, min: 2 }]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="abbr" label="简称"><Input /></Form.Item></Col>
          <Col span={12}>
            <Form.Item name="materialTypeId" label="物料类别（产线）" rules={[{ required: true, message: '请选择物料类别' }]}>
              <Select options={catalog.filter((item) => item.kind === 'material_type' && item.status === 'active')
                .map((item) => ({ value: item.id, label: item.name }))} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="spec" label="规格"><Input /></Form.Item></Col>
          <Col span={8}><Form.Item name="model" label="型号"><Input /></Form.Item></Col>
          <Col span={8}><Form.Item name="smallPack" label="小包装类型" rules={[{ required: true }]}><Select options={yesNo} /></Form.Item></Col>
        </Row>
        <Form.Item name="postIds" label="参与工序/岗位" rules={[{ required: true, message: '至少选择一个参与工序' }]}>
          <Checkbox.Group options={postOptions} />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}>
          <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} />
        </Form.Item>
      </Form>
    </Modal>
  </div>
}
