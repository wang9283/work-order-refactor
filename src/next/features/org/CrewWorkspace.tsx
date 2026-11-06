import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, DatePicker, Descriptions, Drawer, Form, Input, Popconfirm, Select, Space, Table, Tabs, Tag, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import type { Crew, CrewMembership, CrewScope, OrgReferenceData, Person, Secondment } from '@contracts/index'
import { ApiRequestError, api, errorMessage } from '@next/shared/api'
import { crewRoleLabels } from '@next/shared/defaults'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'
import { useAuth } from '@next/shared/auth'
import ShiftManagement from './ShiftManagement'
import { operationsApi } from '@next/shared/operations-api'
import type { OperationsContext } from '@contracts/operations'
import { useAntFormUnsavedChanges } from '@next/shared/unsaved-changes'

const today = () => new Date().toLocaleDateString('en-CA')
const roles = Object.entries(crewRoleLabels).map(([value, label]) => ({ value, label }))

type EditTab = 'info' | 'scopes' | 'members'

export default function CrewWorkspace() {
  const { message } = App.useApp()
  const { user } = useAuth()
  const [tree, setTree] = useState<OrgReferenceData | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [secondments, setSecondments] = useState<Secondment[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailCrew, setDetailCrew] = useState('')
  const [editCrew, setEditCrew] = useState<Crew | null>(null)
  const [editTab, setEditTab] = useState<EditTab>('info')
  const [createOpen, setCreateOpen] = useState(false)
  const [members, setMembers] = useState<CrewMembership[]>([])
  const [scopes, setScopes] = useState<CrewScope[]>([])
  const [membersHidden, setMembersHidden] = useState(false)
  const [asOf, setAsOf] = useState(today())
  const [form] = Form.useForm()
  const [createForm] = Form.useForm()
  const [scopeForm] = Form.useForm()
  const [memberForm] = Form.useForm()
  const [editingMember, setEditingMember] = useState<CrewMembership | null>(null)
  const [memberOpen, setMemberOpen] = useState(false)
  const [operationsContext, setOperationsContext] = useState<OperationsContext | null>(null)
  const [shiftOpen, setShiftOpen] = useState(false)
  const selectedBase = Form.useWatch('baseId', form)
  const createBase = Form.useWatch('baseId', createForm)
  useAntFormUnsavedChanges(form, Boolean(editCrew), '班组信息')
  useAntFormUnsavedChanges(createForm, createOpen, '新增班组')
  useAntFormUnsavedChanges(memberForm, memberOpen, '班组成员关系')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [next, p, s, operationData] = await Promise.all([
        api.get<OrgReferenceData>('/org/tree'),
        api.getPage<Person>('/org/people', { pageSize: 200 }),
        api.getPage<Secondment>('/org/secondments', { pageSize: 200 }),
        operationsApi.context(),
      ])
      setTree(next); setPeople(p.items); setSecondments(s.items); setError('')
      setOperationsContext(operationData)
      setEditCrew((current) => current ? next.crews.find((crew) => crew.id === current.id) || null : null)
      setDetailCrew((current) => next.crews.some((crew) => crew.id === current) ? current : '')
    } catch (e) { setError(errorMessage(e)) } finally { setLoading(false) }
  }, [])

  const loadDetail = useCallback(async (crewId: string) => {
    if (!crewId) { setMembers([]); setScopes([]); setMembersHidden(false); return }
    try {
      const [m, s] = await Promise.all([
        api.get<CrewMembership[]>(`/org/crews/${crewId}/members?all=true`),
        api.get<CrewScope[]>(`/org/crews/${crewId}/scopes`),
      ])
      setMembers(m); setScopes(s); setMembersHidden(false)
      scopeForm.setFieldsValue({ workAreaIds: s.flatMap((item) => item.workAreaId ? [item.workAreaId] : []) })
    } catch (e) {
      // 只读账号可能没有成员查看权限，页面只隐藏明细，不报错误。
      const text = errorMessage(e)
      if (text.includes('无权') || text.includes('403')) { setMembers([]); setScopes([]); setMembersHidden(true) }
      else message.error(text)
    }
  }, [scopeForm, message])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadDetail(editCrew?.id || detailCrew) }, [editCrew, detailCrew, loadDetail])

  const personName = useMemo(
    () => new Map(people.map((person) => [person.id, `${person.name} · ${person.employeeCode}`])),
    [people],
  )
  // Accounts without people-list access still get the names the crew read model returns.
  const memberLabel = (row: CrewMembership) => row.personName
    ? `${row.personName} · ${row.employeeCode || ''}`.trimEnd()
    : personName.get(row.personId) || row.personId

  if (loading && !tree) return <LoadingBlock rows={7} />
  if (error && !tree) return <ErrorBlock message={error} onRetry={() => void load()} />
  if (!tree) return null

  const canManage = (factoryId: string | null) => {
    if (!factoryId) return Boolean(user?.grants.some((grant) => grant.capability === 'crew.manage' && grant.type === 'group'))
    const factory = tree.factories.find((item) => item.id === factoryId)
    return !!factory && Boolean(user?.grants.some((grant) => grant.capability === 'crew.manage' && (
      grant.type === 'group' || (grant.type === 'company' && grant.id === factory.companyId)
      || (grant.type === 'base' && grant.id === factory.baseId) || (grant.type === 'factory' && grant.id === factory.id)
    )))
  }

  const openEdit = (row: Crew) => {
    setEditCrew(row); setEditTab('info')
    form.resetFields()
    form.setFieldsValue({ ...row, status: row.status === 'archived' ? 'inactive' : row.status })
  }

  const openCreate = () => {
    createForm.resetFields()
    createForm.setFieldsValue({ status: 'active' })
    setCreateOpen(true)
  }

  const saveCreate = async () => {
    try {
      const values = await createForm.validateFields()
      await api.post('/org/crews', { ...values, workAreaId: null, leaderPersonId: null })
      setCreateOpen(false); createForm.resetFields()
      await load()
      message.success('班组已创建')
    } catch (e) { message.error(errorMessage(e)) }
  }

  const saveInfo = async () => {
    if (!editCrew) return
    try {
      const values = await form.validateFields()
      const payload = { ...values, workAreaId: editCrew.workAreaId, leaderPersonId: editCrew.leaderPersonId }
      await api.put(`/org/crews/${editCrew.id}`, { ...payload, revision: editCrew.revision })
      await load(); await loadDetail(editCrew.id)
      message.success('基本信息已保存')
    } catch (e) { message.error(errorMessage(e)) }
  }

  const saveScopes = async () => {
    if (!editCrew) return
    try {
      const values = await scopeForm.validateFields()
      await api.put(`/org/crews/${editCrew.id}/scopes`, {
        workAreaIds: values.workAreaIds || [], productionLineIds: [], revision: editCrew.revision,
      })
      await load(); await loadDetail(editCrew.id)
      message.success('适用范围已保存')
    } catch (e) { message.error(errorMessage(e)) }
  }

  const openMember = (row?: CrewMembership) => {
    setEditingMember(row || null)
    memberForm.resetFields()
    memberForm.setFieldsValue(row
      ? { role: row.role, validFrom: dayjs(row.validFrom), validTo: row.validTo ? dayjs(row.validTo) : undefined }
      : { role: 'operator', validFrom: dayjs(), validTo: undefined })
    setMemberOpen(true)
  }

  const saveMember = async () => {
    const crewId = editCrew?.id || detailCrew
    if (!crewId) return
    try {
      const values = await memberForm.validateFields()
      const validFrom = (values.validFrom as Dayjs).format('YYYY-MM-DD')
      const validTo = values.validTo ? (values.validTo as Dayjs).format('YYYY-MM-DD') : null
      if (editingMember) {
        await api.put(`/org/crew-members/${editingMember.id}`, {
          role: values.role, validFrom, validTo,
          revision: editingMember.revision,
        })
      } else {
        await api.post(`/org/crews/${crewId}/members/batch`, {
          members: values.personIds.map((personId: string) => ({
            personId, role: values.role, validFrom, validTo,
          })),
        })
      }
      setMemberOpen(false); setEditingMember(null)
      await load(); await loadDetail(crewId)
      message.success('成员关系已保存')
    } catch (e) { message.error(errorMessage(e)) }
  }

  const endMember = async (member: CrewMembership) => {
    const crewId = editCrew?.id || detailCrew
    try {
      await api.put(`/org/crew-members/${member.id}/end`, { endDate: today(), revision: member.revision })
      await load(); await loadDetail(crewId)
      message.success('成员关系已结束，结束日当天仍有效')
    } catch (e) { message.error(errorMessage(e)) }
  }

  const crew = tree.crews.find((item) => item.id === (editCrew?.id || detailCrew))
  const areas = tree.workAreas.filter((area) => area.factoryId === crew?.factoryId && area.status === 'active')
  // A person already belonging to another crew on the same dates will be rejected by the server.
  const personOptions = people
    .filter((person) => person.status === 'active' && (
      person.factoryId === crew?.factoryId
      || secondments.some((item) => item.personId === person.id && item.toFactoryId === crew?.factoryId
        && ['planned', 'active'].includes(item.status))))
    .map((person) => ({
      value: person.id,
      label: person.crew
        ? `${person.name} · ${person.employeeCode}（${person.crew.crewName}${person.crew.validTo ? ` 至 ${person.crew.validTo}` : ' 长期'}）`
        : `${person.name} · ${person.employeeCode}`,
    }))

  const leaderCell = (row: Crew) => row.leaderPersonIds.length
    ? (
      <Space wrap size={4}>
        {row.leaderPersonIds.map((id, index) => (
          <Tag key={id} color="green">{row.leaderNames?.[index] || personName.get(id) || id}</Tag>
        ))}
      </Space>
    )
    : <Typography.Text type="secondary">未指定</Typography.Text>

  // The read-only detail drawer reuses the same table but never exposes write actions.
  const memberColumns = (readOnly: boolean) => [
    { title: '人员', render: (_: unknown, row: CrewMembership) => memberLabel(row) },
    { title: '岗位', dataIndex: 'role', render: (value: string) => crewRoleLabels[value] || value },
    { title: '生效日期', dataIndex: 'validFrom' },
    { title: '结束日期', dataIndex: 'validTo', render: (value: string | null) => value || '长期' },
    {
      title: '关系', render: (_: unknown, row: CrewMembership) => (
        <Tag color={row.validFrom > asOf ? 'blue' : row.validTo && row.validTo < asOf ? 'default' : 'green'}>
          {row.validFrom > asOf ? '未来' : row.validTo && row.validTo < asOf ? '已结束' : '当前'}
        </Tag>
      ),
    },
    ...(readOnly ? [] : [{
      title: '操作', render: (_: unknown, row: CrewMembership) => canManage(crew?.factoryId ?? null) && (
        <Space>
          <Button type="link" onClick={() => openMember(row)}>编辑关系</Button>
          {(!row.validTo || row.validTo >= asOf) && row.validFrom <= asOf && (
            <Popconfirm title="结束此成员关系？" onConfirm={() => void endMember(row)}>
              <Button type="link" danger>结束</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    }]),
  ]

  const memberTable = (readOnly: boolean) => <>
    <Space wrap style={{ marginBottom: 16 }}>
      <span>查看日期</span>
      <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: 170 }} />
      {!readOnly && canManage(crew?.factoryId ?? null) && <Button type="primary" onClick={() => openMember()}>批量添加成员</Button>}
    </Space>
    {readOnly && membersHidden && (
      <Typography.Paragraph type="secondary">当前账号无权查看该班组成员明细。</Typography.Paragraph>
    )}
    <Table rowKey="id" dataSource={members} pagination={{ pageSize: 10 }} columns={memberColumns(readOnly)} />
  </>

  return <div>
    <PageHeader
      eyebrow="PRODUCTION CREWS"
      title="生产班组"
      description="班组承接排班与派单，班次按基地配置；临时替班不改变正式成员关系。"
      actions={<Space><Button onClick={() => setShiftOpen(true)}>班次维护</Button><Button onClick={() => void load()}>刷新</Button></Space>}
    />
    <Card extra={tree.factories.some((factory) => canManage(factory.id)) && <Button type="primary" onClick={openCreate}>新增班组</Button>}>
      <Table rowKey="id" dataSource={tree.crews.filter((item) => item.status !== 'archived')} pagination={{ pageSize: 8 }} columns={[
        { title: '编码', dataIndex: 'code' },
        { title: '班组', dataIndex: 'name', render: (value: string, row: Crew) => <Button type="link" style={{ padding: 0 }} onClick={() => setDetailCrew(row.id)}>{value}</Button> },
        { title: '工厂', render: (_: unknown, row: Crew) => tree.factories.find((f) => f.id === row.factoryId)?.name || '—' },
        { title: '班组长', render: (_: unknown, row: Crew) => leaderCell(row) },
        { title: '成员人数', dataIndex: 'memberCount', width: 100 },
        { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={value === 'active' ? 'green' : 'gold'}>{value === 'active' ? '启用' : '停用'}</Tag> },
        {
          title: '操作', width: 110,
          render: (_: unknown, row: Crew) => canManage(row.factoryId) && <Button type="link" onClick={() => openEdit(row)}>编辑</Button>,
        },
      ]} />
    </Card>
    <Drawer title="基地班次" width={780} open={shiftOpen} onClose={() => setShiftOpen(false)}>{operationsContext && <ShiftManagement context={operationsContext} onSaved={() => void load()} />}</Drawer>

    <Drawer title={`${crew?.name || ''} · 班组详情`} width={760} open={Boolean(detailCrew && !editCrew)} onClose={() => setDetailCrew('')}>
      {crew && <Tabs items={[
        {
          key: 'info', label: '基本信息', children: (
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="编码">{crew.code}</Descriptions.Item>
              <Descriptions.Item label="所属基地">{tree.bases.find((x) => x.id === crew.baseId)?.name}</Descriptions.Item>
              <Descriptions.Item label="所属工厂">{tree.factories.find((x) => x.id === crew.factoryId)?.name || '—'}</Descriptions.Item>
              <Descriptions.Item label="班组长">{leaderCell(crew)}</Descriptions.Item>
              <Descriptions.Item label="成员人数">{crew.memberCount}</Descriptions.Item>
              <Descriptions.Item label="状态">{crew.status === 'active' ? '启用' : '停用'}</Descriptions.Item>
            </Descriptions>
          ),
        },
        {
          key: 'scopes', label: '适用范围', children: (
            <>
            {membersHidden && <Typography.Paragraph type="secondary">当前账号无权查看该班组的范围与成员明细。</Typography.Paragraph>}
            <Table rowKey="id" pagination={false} dataSource={scopes} columns={[
              { title: '适用作业位置', render: (_: unknown, row: CrewScope) => tree.workAreas.find((x) => x.id === (row.workAreaId || row.productionLineId))?.name || row.workAreaId || row.productionLineId || '—' },
            ]} />
            </>
          ),
        },
        { key: 'members', label: '成员关系', children: memberTable(true) },
      ]} />}
    </Drawer>

    <Drawer
      title={`编辑班组 · ${editCrew?.name || ''}`}
      width={820}
      open={Boolean(editCrew)}
      onClose={() => setEditCrew(null)}
    >
      {crew && <Tabs activeKey={editTab} onChange={(key) => setEditTab(key as EditTab)} items={[
        {
          key: 'info', label: '基本信息', children: (
            <Form form={form} layout="vertical" disabled={!canManage(crew.factoryId)}>
              <Form.Item name="code" label="编码" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="baseId" label="基地" rules={[{ required: true }]}>
                <Select disabled options={tree.bases.map((x) => ({ value: x.id, label: x.name }))} />
              </Form.Item>
              <Form.Item name="factoryId" label="工厂" rules={[{ required: true }]}>
                <Select options={tree.factories.filter((x) => x.baseId === selectedBase).map((x) => ({ value: x.id, label: x.name }))} />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} />
              </Form.Item>
              <Button type="primary" disabled={!canManage(crew.factoryId)} onClick={() => void saveInfo()}>保存基本信息</Button>
            </Form>
          ),
        },
        {
          key: 'scopes', label: '适用位置', children: (
            <Form form={scopeForm} layout="vertical" disabled={!canManage(crew.factoryId)}>
              <Form.Item name="workAreaIds" label="适用作业位置">
                <Select mode="multiple" options={areas.map((x) => ({ value: x.id, label: x.name }))} />
              </Form.Item>
              <Button type="primary" disabled={!canManage(crew.factoryId)} onClick={() => void saveScopes()}>保存适用范围</Button>
              <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
                已配置 {scopes.length} 项；未配置时不限制作业位置。
              </Typography.Paragraph>
            </Form>
          ),
        },
        { key: 'members', label: '成员关系', children: memberTable(false) },
      ]} />}
    </Drawer>

    <Drawer
      title={editingMember ? '编辑成员关系' : '批量添加成员'}
      open={memberOpen}
      onClose={() => { setMemberOpen(false); setEditingMember(null) }}
      extra={<Button type="primary" onClick={() => void saveMember()}>保存</Button>}
    >
      <Form form={memberForm} layout="vertical">
        {!editingMember && (
          <Form.Item name="personIds" label="人员" rules={[{ required: true }]} extra="已在其他班组的人员会由服务端按日期拦截。">
            <Select mode="multiple" showSearch optionFilterProp="label" options={personOptions} />
          </Form.Item>
        )}
        {editingMember && (
          <Form.Item label="人员"><Input disabled value={memberLabel(editingMember)} /></Form.Item>
        )}
        <Form.Item name="role" label="岗位" rules={[{ required: true }]}><Select options={roles} /></Form.Item>
        <Form.Item name="validFrom" label="生效日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="validTo" label="结束日期" extra="留空表示长期；借调人员的有效期必须完整落在借调期限内。"><DatePicker style={{ width: '100%' }} /></Form.Item>
      </Form>
    </Drawer>

    <Drawer
      title="新增班组"
      width={520}
      open={createOpen}
      onClose={() => setCreateOpen(false)}
      extra={<Button type="primary" onClick={() => void saveCreate()}>保存</Button>}
    >
      <Form form={createForm} layout="vertical" initialValues={{ status: 'active' }}>
        <Form.Item name="code" label="编码" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="baseId" label="基地" rules={[{ required: true }]}>
          <Select onChange={() => createForm.setFieldsValue({ factoryId: undefined })}
            options={tree.bases.filter((x) => x.siteConfirmed && x.status === 'active').map((x) => ({ value: x.id, label: x.name }))} />
        </Form.Item>
        <Form.Item name="factoryId" label="工厂" rules={[{ required: true }]}>
          <Select options={tree.factories.filter((x) => x.baseId === createBase && x.status === 'active' && canManage(x.id)).map((x) => ({ value: x.id, label: x.name }))} />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} />
        </Form.Item>
      </Form>
    </Drawer>
  </div>
}
