import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ApartmentOutlined,
  BranchesOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tree,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type {
  Company,
  Crew,
  CrewMembership,
  OrgReferenceData,
  Person,
  ProductionBase,
  ProductionLine,
  Qualification,
  Secondment,
  WorkArea,
} from '@contracts/index'
import { api, can, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'
import { formatDate, formatDateTime } from '@next/shared/format'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'

type Section = 'structure' | 'people' | 'secondment' | 'access'
type Entity = 'base' | 'area' | 'line' | 'crew' | 'person' | 'secondment' | 'qualification'

interface AccessOptions {
  accounts: Array<{ id: string; username: string; displayName: string; personId: string | null }>
  roles: Array<{ id: string; code: string; name: string; builtIn: boolean }>
  scopes: Array<{ label: string; type: 'group' | 'company' | 'base' | 'work_area'; id: string }>
}

interface AccessAssignment {
  id: string
  accountId: string
  roleId: string
  roleCode: string
  roleName: string
  scope: { type: string; id: string }
  validFrom: string | null
  validTo: string | null
}

const statusColor: Record<string, string> = { active: 'green', inactive: 'gold', archived: 'default' }
const statusLabel: Record<string, string> = { active: '启用', inactive: '停用', archived: '已归档' }
const secondmentLabel: Record<string, string> = {
  planned: '待生效', active: '执行中', completed: '已完成', cancelled: '已取消',
}

function StatusTag({ status }: { status: string }) {
  return <Tag color={statusColor[status]}>{statusLabel[status] || status}</Tag>
}

export default function OrgWorkspace({ initialSection = 'structure' }: { initialSection?: Section }) {
  const { user } = useAuth()
  const { message } = App.useApp()
  const [section, setSection] = useState<Section>(initialSection)
  const [tree, setTree] = useState<OrgReferenceData | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [secondments, setSecondments] = useState<Secondment[]>([])
  const [members, setMembers] = useState<CrewMembership[]>([])
  const [selectedCrew, setSelectedCrew] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drawer, setDrawer] = useState<{ entity: Entity; record?: Record<string, unknown> } | null>(null)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextTree, nextPeople, nextSecondments] = await Promise.all([
        api.get<OrgReferenceData>('/org/tree'),
        api.getPage<Person>('/org/people', { pageSize: 200 }),
        api.getPage<Secondment>('/org/secondments', { pageSize: 200 }),
      ])
      setTree(nextTree)
      setPeople(nextPeople.items)
      setSecondments(nextSecondments.items)
      setSelectedCrew((current) => current || nextTree.crews[0]?.id || '')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!selectedCrew) return
    api.get<CrewMembership[]>(`/org/crews/${selectedCrew}/members`)
      .then(setMembers)
      .catch((reason) => message.error(errorMessage(reason)))
  }, [selectedCrew, message])

  const baseName = useMemo(
    () => new Map((tree?.bases || []).map((item) => [item.id, item.name])),
    [tree],
  )
  const personName = useMemo(
    () => new Map(people.map((item) => [item.id, `${item.name} · ${item.employeeCode}`])),
    [people],
  )
  const companyName = useMemo(
    () => new Map((tree?.companies || []).map((item) => [item.id, item.name])),
    [tree],
  )

  const open = (entity: Entity, record?: Record<string, unknown>) => {
    setDrawer({ entity, record })
    form.resetFields()
    form.setFieldsValue(record || {})
  }

  const save = async () => {
    if (!drawer) return
    const values = await form.validateFields()
    const { entity, record } = drawer
    const id = record?.id as string | undefined
    const pathMap: Record<Entity, string> = {
      base: '/org/bases',
      area: '/org/work-areas',
      line: '/org/production-lines',
      crew: '/org/crews',
      person: '/org/people',
      secondment: '/org/secondments',
      qualification: '/org/qualifications',
    }
    try {
      if (id) await api.put(`${pathMap[entity]}/${id}`, { ...values, revision: record?.revision })
      else await api.post(pathMap[entity], values)
      message.success(id ? '已保存' : '已创建')
      setDrawer(null)
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const archive = async (entity: Entity, record: Record<string, unknown>) => {
    const pathMap: Record<Entity, string> = {
      base: '/org/bases',
      area: '/org/work-areas',
      line: '/org/production-lines',
      crew: '/org/crews',
      person: '/org/people',
      secondment: '/org/secondments',
      qualification: '/org/qualifications',
    }
    try {
      await api.delete(`${pathMap[entity]}/${record.id}?revision=${record.revision}`)
      message.success(entity === 'secondment' ? '借调已取消' : '已归档')
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  if (loading) return <LoadingBlock rows={7} />
  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />
  if (!tree) return null

  const canAtBase = (capability: 'org.manage' | 'person.manage' | 'secondment.manage', baseId: string) => {
    const base = tree.bases.find((item) => item.id === baseId)
    return Boolean(user?.grants.some((grant) => {
      if (grant.capability !== capability) return false
      if (grant.type === 'group') return true
      if (grant.type === 'base') return grant.id === baseId
      if (grant.type === 'company') return Boolean(base && grant.id === base.companyId)
      const area = tree.workAreas.find((item) => item.id === grant.id)
      return area?.baseId === baseId
    }))
  }
  const canManageOrg = can(user, 'org.manage', { type: 'group', id: 'group' })
    || tree.bases.some((base) => canAtBase('org.manage', base.id))
  const canManagePeople = people.some((person) => canAtBase('person.manage', person.homeBaseId))
  const canManageSecondment = user?.grants.some((grant) => grant.capability === 'secondment.manage') || false
  const isGroupAdmin = user?.grants.some((grant) => grant.capability === 'access.manage' && grant.type === 'group') || false

  const treeData = [{
    key: 'group-root',
    title: <b>东方希望集团</b>,
    icon: <ApartmentOutlined />,
    children: tree.companies.filter((company) => !company.isGroup).map((company) => ({
      key: company.id,
      title: company.shortName || company.name,
      children: tree.bases.filter((base) => base.companyId === company.id).map((base) => ({
        key: base.id,
        title: base.name,
        children: tree.workAreas.filter((area) => area.baseId === base.id).map((area) => ({
          key: area.id,
          title: area.name,
          children: [
            ...tree.productionLines.filter((line) => line.workAreaId === area.id).map((line) => ({
              key: line.id,
              title: `产线 · ${line.name}`,
            })),
            ...tree.crews.filter((crew) => crew.workAreaId === area.id).map((crew) => ({
              key: crew.id,
              title: `班组 · ${crew.name}`,
            })),
          ],
        })),
      })),
    })),
  }]

  const areaColumns: ColumnsType<WorkArea> = [
    { title: '编码', dataIndex: 'code', width: 120 },
    { title: '工区', dataIndex: 'name', render: (value, row) => <Space direction="vertical" size={0}><b>{value}</b><small>{baseName.get(row.baseId)}</small></Space> },
    { title: '上级工区', dataIndex: 'parentId', render: (value: string | null) => value ? tree.workAreas.find((item) => item.id === value)?.name : '基地直属' },
    { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <StatusTag status={value} /> },
    {
      title: '操作', width: 150,
      render: (_, row) => <Space>
        {canAtBase('org.manage', row.baseId) && <Button type="link" icon={<EditOutlined />} onClick={() => open('area', row as unknown as Record<string, unknown>)}>编辑</Button>}
        {canAtBase('org.manage', row.baseId) && <Popconfirm title="归档此工区？" onConfirm={() => void archive('area', row as unknown as Record<string, unknown>)}><Button type="link" danger icon={<DeleteOutlined />}>归档</Button></Popconfirm>}
      </Space>,
    },
  ]

  const lineColumns: ColumnsType<ProductionLine> = [
    { title: '编码', dataIndex: 'code', width: 120 },
    { title: '产线', dataIndex: 'name' },
    { title: '工区', dataIndex: 'workAreaId', render: (value: string) => tree.workAreas.find((item) => item.id === value)?.name || '—' },
    { title: '基地', dataIndex: 'baseId', render: (value: string) => baseName.get(value) || '—' },
    { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <StatusTag status={value} /> },
    {
      title: '操作', width: 150,
      render: (_, row) => <Space>
        {canAtBase('org.manage', row.baseId) && <Button type="link" icon={<EditOutlined />} onClick={() => open('line', row as unknown as Record<string, unknown>)}>编辑</Button>}
        {canAtBase('org.manage', row.baseId) && <Popconfirm title="归档此产线？" onConfirm={() => void archive('line', row as unknown as Record<string, unknown>)}><Button type="link" danger>归档</Button></Popconfirm>}
      </Space>,
    },
  ]

  const crewColumns: ColumnsType<Crew> = [
    { title: '编码', dataIndex: 'code', width: 120 },
    { title: '班组', dataIndex: 'name' },
    { title: '工区', dataIndex: 'workAreaId', render: (value: string) => tree.workAreas.find((item) => item.id === value)?.name || '—' },
    { title: '班组长', dataIndex: 'leaderPersonId', render: (value: string | null) => value ? personName.get(value) : '未指定' },
    { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <StatusTag status={value} /> },
    {
      title: '操作', width: 210,
      render: (_, row) => <Space>
        <Button type="link" icon={<TeamOutlined />} onClick={() => setSelectedCrew(row.id)}>成员</Button>
        {canAtBase('org.manage', row.baseId) && <Button type="link" icon={<EditOutlined />} onClick={() => open('crew', row as unknown as Record<string, unknown>)}>编辑</Button>}
        {canAtBase('org.manage', row.baseId) && <Popconfirm title="归档此班组？" onConfirm={() => void archive('crew', row as unknown as Record<string, unknown>)}><Button type="link" danger>归档</Button></Popconfirm>}
      </Space>,
    },
  ]

  const personColumns: ColumnsType<Person> = [
    { title: '工号', dataIndex: 'employeeCode', width: 110 },
    { title: '姓名', dataIndex: 'name', render: (value, row) => <Space direction="vertical" size={0}><b>{value}</b><small>{row.mobile || '无手机号'}</small></Space> },
    { title: '所属公司', dataIndex: 'homeCompanyId', render: (value: string) => companyName.get(value) || '—' },
    { title: '归属基地', dataIndex: 'homeBaseId', render: (value: string) => baseName.get(value) || '—' },
    {
      title: '作业资格', dataIndex: 'qualifications',
      render: (value: Person['qualifications']) => value.length
        ? <Space wrap>{value.map((item) => <Tag key={item.id} color={item.validTo && item.validTo < new Date().toISOString().slice(0, 10) ? 'red' : 'blue'}>{item.qualificationName}</Tag>)}</Space>
        : <Typography.Text type="secondary">未登记</Typography.Text>,
    },
    { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <StatusTag status={value} /> },
    {
      title: '操作', width: 150,
      render: (_, row) => <Space>
        {canAtBase('person.manage', row.homeBaseId) && <Button type="link" icon={<EditOutlined />} onClick={() => open('person', row as unknown as Record<string, unknown>)}>编辑</Button>}
        {canAtBase('person.manage', row.homeBaseId) && <Popconfirm title="归档此人员？" onConfirm={() => void archive('person', row as unknown as Record<string, unknown>)}><Button type="link" danger>归档</Button></Popconfirm>}
      </Space>,
    },
  ]

  const secondmentColumns: ColumnsType<Secondment> = [
    { title: '人员', dataIndex: 'personId', render: (value: string) => personName.get(value) || value },
    {
      title: '借出 → 借入',
      render: (_, row) => <Space direction="vertical" size={0}>
        <span>{companyName.get(row.fromCompanyId)} / {baseName.get(row.fromBaseId)}</span>
        <b>{companyName.get(row.toCompanyId)} / {baseName.get(row.toBaseId)}</b>
      </Space>,
    },
    { title: '有效期', render: (_, row) => `${formatDate(row.startDate)} 至 ${formatDate(row.endDate)}` },
    { title: '事由', dataIndex: 'purpose', ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: string) => <Tag color={value === 'active' ? 'green' : value === 'planned' ? 'gold' : 'default'}>{secondmentLabel[value] || value}</Tag> },
    {
      title: '操作', width: 150,
      render: (_, row) => <Space>
        {canManageSecondment && <Button type="link" icon={<EditOutlined />} onClick={() => open('secondment', row as unknown as Record<string, unknown>)}>编辑</Button>}
        {canManageSecondment && row.status !== 'cancelled' && row.status !== 'completed' && <Popconfirm title="取消此借调？" onConfirm={() => void archive('secondment', row as unknown as Record<string, unknown>)}><Button type="link" danger>取消</Button></Popconfirm>}
      </Space>,
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="GROUP · ORGANIZATION CONTROL"
        title="组织、人员与授权"
        description="公司负责工资主体，基地、工区、产线和班组承接实际作业；借调同时保留来源归属与接收归属。"
        actions={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>}
      />
      <Segmented
        block
        value={section}
        onChange={(value) => setSection(value as Section)}
        options={[
          { label: '组织与作业结构', value: 'structure', icon: <ApartmentOutlined /> },
          { label: '人员与资格', value: 'people', icon: <TeamOutlined /> },
          { label: '借调管理', value: 'secondment', icon: <UserSwitchOutlined /> },
          { label: '角色与数据范围', value: 'access', icon: <SafetyCertificateOutlined /> },
        ]}
        style={{ marginBottom: 20 }}
      />

      {section === 'structure' && (
        <Row gutter={[18, 18]}>
          <Col xs={24} xl={6}>
            <Card className="surface-card org-tree-card" title="集团组织树" extra={<Tag>{tree.bases.length} 个基地</Tag>}>
              <Tree showIcon defaultExpandAll treeData={treeData} />
            </Card>
          </Col>
          <Col xs={24} xl={18}>
            <Tabs
              items={[
                {
                  key: 'bases',
                  label: '生产基地',
                  children: <SimpleTable
                    rows={tree.bases}
                    columns={[
                      { title: '编码', dataIndex: 'code', width: 120 },
                      { title: '基地', dataIndex: 'name' },
                      { title: '所属公司', dataIndex: 'companyId', render: (value: string) => companyName.get(value) || '—' },
                      { title: '地址', dataIndex: 'address' },
                      { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <StatusTag status={value} /> },
                      {
                        title: '操作', width: 150,
                        render: (_: unknown, row: ProductionBase) => <Space>
                          {canAtBase('org.manage', row.id) && <Button type="link" icon={<EditOutlined />} onClick={() => open('base', row as unknown as Record<string, unknown>)}>编辑</Button>}
                          {canAtBase('org.manage', row.id) && <Popconfirm title="归档此基地？" onConfirm={() => void archive('base', row as unknown as Record<string, unknown>)}><Button type="link" danger>归档</Button></Popconfirm>}
                        </Space>,
                      },
                    ]}
                    onAdd={canManageOrg ? () => open('base') : undefined}
                  />,
                },
                {
                  key: 'areas',
                  label: '工区',
                  children: <SimpleTable rows={tree.workAreas} columns={areaColumns} onAdd={canManageOrg ? () => open('area') : undefined} />,
                },
                {
                  key: 'lines',
                  label: '产线',
                  children: <SimpleTable rows={tree.productionLines} columns={lineColumns} onAdd={canManageOrg ? () => open('line') : undefined} />,
                },
                {
                  key: 'crews',
                  label: '班组与成员',
                  children: <>
                    <SimpleTable rows={tree.crews} columns={crewColumns} onAdd={canManageOrg ? () => open('crew') : undefined} />
                    <Card className="surface-card" style={{ marginTop: 18 }} title="班组成员有效期" extra={<Select style={{ width: 240 }} value={selectedCrew || undefined} onChange={setSelectedCrew} options={tree.crews.map((item) => ({ value: item.id, label: item.name }))} />}>
                      <Table
                        rowKey="id"
                        size="small"
                        pagination={false}
                        dataSource={members}
                        locale={{ emptyText: <Empty description="当前日期没有有效成员" /> }}
                        columns={[
                          { title: '人员', dataIndex: 'personId', render: (value: string) => personName.get(value) || value },
                          { title: '角色', dataIndex: 'role', render: (value: string) => ({ leader: '班组长', operator: '操作员', support: '协作人员' } as Record<string, string>)[value] || value },
                          { title: '生效', dataIndex: 'validFrom', render: formatDate },
                          { title: '失效', dataIndex: 'validTo', render: formatDate },
                        ]}
                      />
                    </Card>
                  </>,
                },
              ]}
            />
          </Col>
        </Row>
      )}

      {section === 'people' && (
        <Card className="surface-card" title="人员、资格与归属" extra={canManagePeople && <Button type="primary" icon={<PlusOutlined />} onClick={() => open('person')}>新增人员</Button>}>
          <Table rowKey="id" columns={personColumns} dataSource={people} pagination={{ pageSize: 12 }} />
        </Card>
      )}

      {section === 'secondment' && (
        <Card className="surface-card" title="跨基地借调" extra={canManageSecondment && <Button type="primary" icon={<PlusOutlined />} onClick={() => open('secondment')}>发起借调</Button>}>
          <Typography.Paragraph type="secondary">
            借调记录分开保存接收作业基地与发放公司。工单计价使用实际作业基地的单价版本，月度工资归集到月底所在公司。
          </Typography.Paragraph>
          <Table rowKey="id" columns={secondmentColumns} dataSource={secondments} pagination={{ pageSize: 10 }} />
        </Card>
      )}

      {section === 'access' && (
        <AccessPanel enabled={isGroupAdmin} />
      )}

      <Drawer
        title={drawer?.record?.id ? '编辑主数据' : '新增主数据'}
        width={480}
        open={Boolean(drawer)}
        onClose={() => setDrawer(null)}
        extra={<Button type="primary" onClick={() => void save()}>保存</Button>}
      >
        {drawer && (
          <Form form={form} layout="vertical" initialValues={drawer.record}>
            <EntityFields
              entity={drawer.entity}
              tree={tree}
              people={people}
              editing={Boolean(drawer.record?.id)}
            />
          </Form>
        )}
      </Drawer>
    </div>
  )
}

function SimpleTable<T extends { id: string; status: string }>({
  rows,
  columns,
  onAdd,
}: {
  rows: T[]
  columns: ColumnsType<T>
  onAdd?: () => void
}) {
  return (
    <Card
      className="surface-card"
      extra={onAdd && <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>新增</Button>}
    >
      <Table rowKey="id" size="middle" columns={columns} dataSource={rows} pagination={{ pageSize: 10 }} />
    </Card>
  )
}

function EntityFields({
  entity,
  tree,
  people,
  editing,
}: {
  entity: Entity
  tree: OrgReferenceData
  people: Person[]
  editing: boolean
}) {
  const companyOptions = tree.companies.map((company: Company) => ({ value: company.id, label: company.name }))
  const baseOptions = tree.bases.map((base: ProductionBase) => ({ value: base.id, label: base.name }))
  const areaOptions = tree.workAreas.map((area: WorkArea) => ({ value: area.id, label: area.name }))
  const personOptions = people.map((person: Person) => ({ value: person.id, label: `${person.name} · ${person.employeeCode}` }))
  const commonStatus = (
    <Form.Item name="status" label="状态" initialValue="active">
      <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} />
    </Form.Item>
  )

  if (entity === 'base') return <>
    <Form.Item name="code" label="基地编码" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="基地名称" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="companyId" label="所属公司" rules={[{ required: true }]}><Select options={companyOptions} /></Form.Item>
    <Form.Item name="address" label="地址"><Input /></Form.Item>
    {commonStatus}
  </>

  if (entity === 'area') return <>
    <Form.Item name="code" label="工区编码" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="工区名称" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="baseId" label="所属基地" rules={[{ required: true }]}><Select disabled={editing} options={baseOptions} /></Form.Item>
    <Form.Item name="parentId" label="上级工区"><Select allowClear options={areaOptions} /></Form.Item>
    <Form.Item name="managerPersonId" label="工区负责人"><Select allowClear showSearch options={personOptions} /></Form.Item>
    {commonStatus}
  </>

  if (entity === 'line') return <>
    <Form.Item name="code" label="产线编码" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="产线名称" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="baseId" label="所属基地" rules={[{ required: true }]}><Select disabled={editing} options={baseOptions} /></Form.Item>
    <Form.Item name="workAreaId" label="所属工区" rules={[{ required: true }]}><Select options={areaOptions} /></Form.Item>
    {commonStatus}
  </>

  if (entity === 'crew') return <>
    <Form.Item name="code" label="班组编码" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="班组名称" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="baseId" label="所属基地" rules={[{ required: true }]}><Select disabled={editing} options={baseOptions} /></Form.Item>
    <Form.Item name="workAreaId" label="所属工区" rules={[{ required: true }]}><Select options={areaOptions} /></Form.Item>
    <Form.Item name="leaderPersonId" label="班组长"><Select allowClear showSearch options={personOptions} /></Form.Item>
    {commonStatus}
  </>

  if (entity === 'person') return <>
    <Form.Item name="employeeCode" label="工号" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="mobile" label="手机号"><Input /></Form.Item>
    <Form.Item name="homeCompanyId" label="所属公司（工资主体）" rules={[{ required: true }]}><Select options={companyOptions.filter((item) => item.value !== 'group')} /></Form.Item>
    <Form.Item name="homeBaseId" label="归属基地" rules={[{ required: true }]}><Select options={baseOptions} /></Form.Item>
    {commonStatus}
  </>

  if (entity === 'secondment') return <>
    <Form.Item name="personId" label="借调人员" rules={[{ required: true }]}><Select showSearch options={personOptions} /></Form.Item>
    <Row gutter={12}>
      <Col span={12}><Form.Item name="fromCompanyId" label="借出公司" rules={[{ required: true }]}><Select options={companyOptions.filter((item) => item.value !== 'group')} /></Form.Item></Col>
      <Col span={12}><Form.Item name="fromBaseId" label="借出基地" rules={[{ required: true }]}><Select options={baseOptions} /></Form.Item></Col>
    </Row>
    <Row gutter={12}>
      <Col span={12}><Form.Item name="toCompanyId" label="接收公司" rules={[{ required: true }]}><Select options={companyOptions.filter((item) => item.value !== 'group')} /></Form.Item></Col>
      <Col span={12}><Form.Item name="toBaseId" label="实际作业基地" rules={[{ required: true }]}><Select options={baseOptions} /></Form.Item></Col>
    </Row>
    <Row gutter={12}>
      <Col span={12}><Form.Item name="startDate" label="开始日期" rules={[{ required: true }]}><Input placeholder="2026-10-01" /></Form.Item></Col>
      <Col span={12}><Form.Item name="endDate" label="结束日期" rules={[{ required: true }]}><Input placeholder="2026-10-31" /></Form.Item></Col>
    </Row>
    <Form.Item name="purpose" label="借调事由"><Input.TextArea rows={3} /></Form.Item>
    <Form.Item name="status" label="状态" initialValue="planned">
      <Select options={Object.entries(secondmentLabel).map(([value, label]) => ({ value, label }))} />
    </Form.Item>
  </>

  return <>
    <Form.Item name="code" label="资格编码" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="资格名称" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
    {commonStatus}
  </>
}

function AccessPanel({ enabled }: { enabled: boolean }) {
  const { message } = App.useApp()
  const [options, setOptions] = useState<AccessOptions | null>(null)
  const [rows, setRows] = useState<AccessAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    if (!enabled) { setLoading(false); return }
    try {
      const [nextOptions, nextRows] = await Promise.all([
        api.get<AccessOptions>('/org/access/options'),
        api.get<AccessAssignment[]>('/org/access/assignments'),
      ])
      setOptions(nextOptions)
      setRows(nextRows)
    } catch (reason) {
      message.error(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [enabled, message])

  useEffect(() => { void load() }, [load])

  if (!enabled) {
    return <Card className="surface-card"><Empty description="仅集团管理员可维护跨基地角色授权" /></Card>
  }
  if (loading) return <LoadingBlock />

  const accountName = new Map((options?.accounts || []).map((item) => [item.id, item.displayName]))
  const scopeName = new Map((options?.scopes || []).map((item) => [`${item.type}:${item.id}`, item.label]))

  const add = async () => {
    const values = await form.validateFields()
    try {
      await api.post('/org/access/assignments', {
        accountId: values.accountId,
        roleId: values.roleId,
        scope: { type: values.scopeType, id: values.scopeId },
        validFrom: null,
        validTo: null,
      })
      message.success('授权已添加')
      form.resetFields()
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const remove = async (id: string) => {
    try {
      await api.delete(`/org/access/assignments/${id}`)
      message.success('授权已撤销')
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  return (
    <Row gutter={[18, 18]}>
      <Col xs={24} xl={9}>
        <Card className="surface-card" title="新增授权">
          <Typography.Paragraph type="secondary">
            能力由角色定义，数据范围单独授予。集团管理员可授权到公司、基地或工区；基地管理员不能自行扩大范围。
          </Typography.Paragraph>
          <Form form={form} layout="vertical">
            <Form.Item name="accountId" label="账号" rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" options={options?.accounts.map((item) => ({ value: item.id, label: `${item.displayName} · ${item.username}` }))} />
            </Form.Item>
            <Form.Item name="roleId" label="角色" rules={[{ required: true }]}>
              <Select options={options?.roles.map((item) => ({ value: item.id, label: item.name }))} />
            </Form.Item>
            <Form.Item name="scopeId" label="数据范围" rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={options?.scopes.map((item) => ({ value: `${item.type}:${item.id}`, label: item.label }))}
                onChange={(value: string) => {
                  const [type, id] = value.split(':')
                  form.setFieldsValue({ scopeType: type, scopeId: id })
                }}
              />
            </Form.Item>
            <Form.Item name="scopeType" hidden><Input /></Form.Item>
            <Button type="primary" block onClick={() => void add()}>添加授权</Button>
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={15}>
        <Card className="surface-card" title="当前授权">
          <Table
            rowKey="id"
            size="small"
            dataSource={rows}
            pagination={{ pageSize: 12 }}
            columns={[
              { title: '账号', dataIndex: 'accountId', render: (value: string) => accountName.get(value) || value },
              { title: '角色', dataIndex: 'roleName' },
              {
                title: '数据范围',
                render: (_, row: AccessAssignment) => scopeName.get(`${row.scope.type}:${row.scope.id}`) || row.scope.id,
              },
              { title: '生效', dataIndex: 'validFrom', render: formatDateTime },
              {
                title: '操作', width: 90,
                render: (_, row: AccessAssignment) => <Popconfirm title="撤销此授权？" onConfirm={() => void remove(row.id)}><Button type="link" danger>撤销</Button></Popconfirm>,
              },
            ]}
          />
        </Card>
      </Col>
    </Row>
  )
}

export function QualificationPanel({ rows, canManage }: { rows: Qualification[]; canManage: boolean }) {
  return (
    <Descriptions title="集团作业资格" extra={canManage ? <Tag color="green">可维护</Tag> : <Tag>只读</Tag>}>
      {rows.map((item) => (
        <Descriptions.Item key={item.id} label={item.name}>{item.description || item.code}</Descriptions.Item>
      ))}
    </Descriptions>
  )
}
