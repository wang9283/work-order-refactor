import { useCallback, useEffect, useState } from 'react'
import { App, Button, Card, Drawer, Form, Input, Select, Space, Table, Typography } from 'antd'
import type { OrgReferenceData, ProductionLine, WorkArea } from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'
import { useAuth } from '@next/shared/auth'
import { useAntFormUnsavedChanges } from '@next/shared/unsaved-changes'

type Kind = 'area' | 'line' | 'factory'

export default function WorkAreasWorkspace() {
  const { message } = App.useApp()
  const { user } = useAuth()
  const [data, setData] = useState<OrgReferenceData | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ kind: Kind; row?: WorkArea | ProductionLine } | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [form] = Form.useForm()
  const selectedFactory = Form.useWatch('factoryId', form)
  useAntFormUnsavedChanges(form, Boolean(editing), editing?.row ? '编辑作业位置' : '新增作业位置')
  const load = useCallback(async () => {
    try { setData(await api.get<OrgReferenceData>('/org/tree')); setError('') }
    catch (e) { setError(errorMessage(e)) }
  }, [])
  useEffect(() => { void load() }, [load])
  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />
  if (!data) return <LoadingBlock rows={7} />
  const canManage = (factoryId: string | null) => {
    if (!factoryId) return Boolean(user?.grants.some((grant) => grant.capability === 'org.manage' && grant.type === 'group'))
    const factory = data.factories.find((item) => item.id === factoryId)
    return !!factory && Boolean(user?.grants.some((grant) => grant.capability === 'org.manage' && (
      grant.type === 'group' || (grant.type === 'company' && grant.id === factory.companyId)
      || (grant.type === 'base' && grant.id === factory.baseId) || (grant.type === 'factory' && grant.id === factory.id)
    )))
  }
  const open = (kind: Kind, row?: WorkArea | ProductionLine, preset?: { factoryId: string | null; parentId?: string | null }) => {
    setEditing({ kind, row }); form.resetFields()
    const area = row && kind === 'line' ? data.workAreas.find((item) => item.id === (row as ProductionLine).workAreaId) : undefined
    form.setFieldsValue({
      ...row,
      status: row ? (row.status === 'archived' ? 'inactive' : row.status) : 'active',
      factoryId: preset?.factoryId ?? (kind === 'area' ? (row as WorkArea | undefined)?.factoryId : area?.factoryId),
      parentId: preset ? (preset.parentId ?? null) : undefined,
    })
  }
  // 组织行的写入入口只放在抽屉里，列表不再直接新增。
  const openFactory = (id: string) => { setFactoryId(id); setEditing(null) }
  const save = async () => {
    try {
      const values = await form.validateFields()
      if (!editing) return
      const factory = data.factories.find((item) => item.id === values.factoryId)
      if (!factory) throw new Error('请选择工厂')
      const path = editing.kind === 'area' ? '/org/work-areas' : '/org/production-lines'
      const payload = { ...values, baseId: factory.baseId, parentId: values.parentId || null, managerPersonId: null }
      if (editing.row) await api.put(`${path}/${editing.row.id}`, { ...payload, revision: editing.row.revision })
      else await api.post(path, payload)
      setEditing(null); await load(); message.success('已保存')
    } catch (e) { message.error(errorMessage(e)) }
  }
  const areas = data.workAreas.filter((item) => item.status !== 'archived')
  type LocationRow = { id: string; name: string; code: string; status: string; factoryId: string | null; source?: WorkArea; children?: LocationRow[] }
  const locationRows = (parentId: string | null, factoryId: string): LocationRow[] => areas.filter((area) => area.factoryId === factoryId && area.parentId === parentId).map((area) => {
    const children = locationRows(area.id, factoryId)
    return { ...area, source: area, children: children.length ? children : undefined }
  })
  const editingArea = editing?.row && editing.kind === 'area' ? editing.row as WorkArea : undefined
  const childAreas = editingArea ? areas.filter((area) => area.parentId === editingArea.id) : []
  const factoryName = data.factories.find((item) => item.id === factoryId)?.name || ''
  const topAreas = factoryId ? areas.filter((area) => area.factoryId === factoryId && !area.parentId) : []
  return <div>
    <PageHeader eyebrow="WORK LOCATIONS" title="作业区域" description="按实际需要逐层维护作业位置，名称与层级由管理员设置。" actions={<Button onClick={() => void load()}>刷新</Button>} />
    <Card>
      <Table<LocationRow> rowKey="id" pagination={false} dataSource={data.factories.filter((factory) => factory.status !== 'archived').map((factory) => {
        const children = locationRows(null, factory.id)
        return { id: `org:${factory.id}`, name: factory.name, code: factory.code, status: factory.status, factoryId: factory.id, children: children.length ? children : undefined }
      })} columns={[
        { title: '组织 / 作业位置', dataIndex: 'name' },
        { title: '编码', dataIndex: 'code' },
        { title: '状态', dataIndex: 'status', render: (status: string) => status === 'active' ? '启用' : '停用' },
        { title: '操作', width: 150, render: (_: unknown, row: LocationRow) => canManage(row.factoryId) && (row.source
          ? <Button type="link" onClick={() => open('area', row.source)}>编辑作业位置</Button>
          : <Button type="link" onClick={() => openFactory(row.factoryId!)}>编辑作业位置</Button>) },
      ]} />
    </Card>
    <Drawer title={`作业位置 · ${factoryName}`} open={Boolean(factoryId && !editing)} onClose={() => setFactoryId(null)}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button type="primary" onClick={() => open('area', undefined, { factoryId: factoryId! })}>新增下级位置</Button>
        {topAreas.length === 0 && <Typography.Text type="secondary">暂无作业位置，点击“新增下级位置”创建。</Typography.Text>}
        {topAreas.map((area) => (
          <Card key={area.id} size="small" title={area.name} extra={<Button type="link" onClick={() => open('area', area)}>编辑</Button>}>
            <Typography.Text type="secondary">
              {area.status === 'active' ? '启用' : '停用'} · 编码 {area.code}
              {` · 下级 ${areas.filter((child) => child.parentId === area.id).length} 个`}
            </Typography.Text>
          </Card>
        ))}
      </Space>
    </Drawer>
    <Drawer title={`${editing?.row ? '编辑' : '新增'}作业位置`} open={!!editing} onClose={() => setEditing(null)} extra={<Button type="primary" onClick={() => void save()}>保存</Button>}>
      <Form form={form} layout="vertical">
        <Form.Item name="code" label="编码" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="factoryId" label="所属组织" rules={[{ required: true }]}><Select disabled={!!editing?.row} onChange={() => form.setFieldsValue({ parentId: null, workAreaId: undefined })} options={data.factories.filter((item) => item.status === 'active' && canManage(item.id)).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
        {editing?.kind === 'area' ? <Form.Item name="parentId" label="上级位置"><Select allowClear options={areas.filter((area) => area.factoryId === selectedFactory && area.id !== editing.row?.id).map((area) => ({ value: area.id, label: area.name }))} /></Form.Item>
          : <Form.Item name="workAreaId" label="上级位置" rules={[{ required: true }]}><Select options={areas.filter((area) => area.factoryId === selectedFactory).map((area) => ({ value: area.id, label: area.name }))} /></Form.Item>}
        <Form.Item name="status" label="状态"><Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} /></Form.Item>
      </Form>
      {editingArea && canManage(editingArea.factoryId) && (
        <Card size="small" title="下级位置" style={{ marginTop: 8 }} extra={<Button size="small" onClick={() => open('area', undefined, { factoryId: editingArea.factoryId, parentId: editingArea.id })}>新增下级</Button>}>
          {childAreas.length === 0 && <Typography.Text type="secondary">暂无下级位置。</Typography.Text>}
          {childAreas.map((area) => (
            <div key={area.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>{area.name}</span><span>{area.status === 'active' ? '启用' : '停用'}</span>
            </div>
          ))}
        </Card>
      )}
    </Drawer>
  </div>
}
