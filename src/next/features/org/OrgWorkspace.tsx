import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ApartmentOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
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
  Factory,
  ManagementGroup,
  OrgReferenceData,
  Person,
  PersonCrewHistory,
  ProductionBase,
  Qualification,
  Secondment,
} from '@contracts/index'
import { api, can, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'
import { crewRoleLabels } from '@next/shared/defaults'
import { formatDate, formatDateTime } from '@next/shared/format'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'
import { useAntFormUnsavedChanges } from '@next/shared/unsaved-changes'

type Section = 'structure' | 'people' | 'secondment' | 'access'
const sectionHash: Record<Section, string> = {
  structure: '#/org',
  people: '#/people',
  secondment: '#/people',
  access: '#/access',
}
type Entity = 'company' | 'managementGroup' | 'base' | 'factory' | 'crew' | 'person' | 'secondment' | 'qualification'

interface AccessOptions {
  accounts: Array<{ id: string; username: string; displayName: string; personId: string | null }>
  roles: Array<{ id: string; code: string; name: string; builtIn: boolean }>
  scopes: Array<{ label: string; type: 'group' | 'company' | 'base' | 'factory' | 'work_area'; id: string }>
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
  planned: '待生效', active: '执行中', expired: '已到期', completed: '已完成', cancelled: '已取消',
}

function effectiveSecondmentStatus(secondment: Secondment): string {
  if (secondment.status === 'completed' || secondment.status === 'cancelled') return secondment.status
  const today = new Date().toLocaleDateString('sv-SE')
  if (secondment.startDate > today) return 'planned'
  if (secondment.endDate < today) return 'expired'
  return 'active'
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
  const [personSearch, setPersonSearch] = useState('')
  const [personFactory, setPersonFactory] = useState<string | undefined>()
  const [personCrew, setPersonCrew] = useState<string | undefined>()
  const [secondments, setSecondments] = useState<Secondment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drawer, setDrawer] = useState<{ entity: Entity; record?: Record<string, unknown> } | null>(null)
  const [form] = Form.useForm()
  useAntFormUnsavedChanges(form, Boolean(drawer), '组织主数据')

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
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    setSection(initialSection)
  }, [initialSection])

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
      company: '/org/companies',
      managementGroup: '/org/management-groups',
      base: '/org/bases',
      factory: '/org/factories',
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

  if (loading) return <LoadingBlock rows={7} />
  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />
  if (!tree) return null

  const canAtBase = (
    capability: 'org.manage' | 'crew.manage' | 'person.manage' | 'secondment.manage',
    baseId: string,
    factoryId?: string | null,
  ) => {
    const base = tree.bases.find((item) => item.id === baseId)
    return Boolean(user?.grants.some((grant) => {
      if (grant.capability !== capability) return false
      if (grant.type === 'group') return true
      if (grant.type === 'base') return grant.id === baseId
      if (grant.type === 'company') return Boolean(base && grant.id === base.companyId)
      if (grant.type === 'factory') return grant.id === factoryId
      return false
    }))
  }
  const canManageOrg = can(user, 'org.manage', { type: 'group', id: 'group' })
    || tree.bases.some((base) => canAtBase('org.manage', base.id))
  const canManageCrews = can(user, 'crew.manage', { type: 'group', id: 'group' })
    || tree.crews.some((crew) => canAtBase('crew.manage', crew.baseId, crew.factoryId))
  const canManagePeople = people.some((person) => canAtBase('person.manage', person.homeBaseId, person.factoryId))
  const canManageSecondment = user?.grants.some((grant) => grant.capability === 'secondment.manage') || false
  const isGroupAdmin = user?.grants.some((grant) => grant.capability === 'access.manage' && grant.type === 'group') || false
  const isGroupOrgAdmin = user?.grants.some((grant) => grant.capability === 'org.manage' && grant.type === 'group') || false

  const treeData = [{
    key: 'group-root',
    title: <b>饲料总部</b>,
    icon: <ApartmentOutlined />,
    children: [
      ...tree.managementGroups.map((group) => ({ key: group.id, title: group.name,
        children: tree.factories.filter((factory) => factory.managementGroupId === group.id)
          .map((factory) => ({ key: factory.id, title: factory.name, isLeaf: true })) })),
      ...(tree.factories.some((factory) => !factory.managementGroupId) ? [{ key: 'unclassified', title: '待分类工厂',
        children: tree.factories.filter((factory) => !factory.managementGroupId).map((factory) => ({ key: factory.id, title: factory.name, isLeaf: true })) }] : []),
    ],
  }]

  const factoryColumns: ColumnsType<Factory> = [
    { title: '编码', dataIndex: 'code', width: 120 },
    {
      title: '饲料厂',
      dataIndex: 'name',
      render: (value: string, row) => <Space direction="vertical" size={0}>
        <b>{value}</b>
        <small>{baseName.get(row.baseId)} · {companyName.get(row.companyId)}</small>
      </Space>,
    },
    { title: '生产班', render: (_, row) => tree.crews.filter((crew) => crew.factoryId === row.id).length },
    { title: '人员', render: (_, row) => people.filter((person) => person.factoryId === row.id).length },
    { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <StatusTag status={value} /> },
    {
      title: '操作', width: 150,
      render: (_, row) => <Space>
        {canAtBase('org.manage', row.baseId, row.id) && <Button type="link" icon={<EditOutlined />} onClick={() => open('factory', row as unknown as Record<string, unknown>)}>编辑</Button>}
      </Space>,
    },
  ]

  const personColumns: ColumnsType<Person> = [
    { title: '工号', dataIndex: 'employeeCode', width: 110 },
    { title: '姓名', dataIndex: 'name', render: (value, row) => <Space direction="vertical" size={0}><b>{value}</b><small>{row.mobile || '无手机号'}</small></Space> },
    { title: '所属公司', dataIndex: 'homeCompanyId', render: (value: string) => companyName.get(value) || '—' },
    { title: '归属基地', dataIndex: 'homeBaseId', render: (value: string) => baseName.get(value) || '—' },
    { title: '归属饲料厂', dataIndex: 'factoryId', render: (value: string | null) => tree.factories.find((item) => item.id === value)?.name || '—' },
    {
      title: '当前班组', dataIndex: 'crew',
      render: (value: Person['crew']) => value
        ? <Space direction="vertical" size={0}>
            <b>{value.crewName}</b>
            <small>{formatDate(value.validFrom)} 起{value.validTo ? ` 至 ${formatDate(value.validTo)}` : ' 长期'}</small>
          </Space>
        : <Typography.Text type="secondary">未分配</Typography.Text>,
    },
    {
      title: '班组岗位', dataIndex: 'crew', key: 'crewRole', width: 96,
      render: (value: Person['crew']) => value
        ? <Tag>{crewRoleLabels[value.role] || value.role}</Tag>
        : <Typography.Text type="secondary">未分配</Typography.Text>,
    },
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
        {canAtBase('person.manage', row.homeBaseId, row.factoryId) && <Button type="link" icon={<EditOutlined />} onClick={() => open('person', row as unknown as Record<string, unknown>)}>编辑</Button>}
      </Space>,
    },
  ]

  const secondmentColumns: ColumnsType<Secondment> = [
    { title: '人员', dataIndex: 'personId', render: (value: string) => personName.get(value) || value },
    {
      title: '借出 → 借入',
      render: (_, row) => <Space direction="vertical" size={0}>
        <span>{companyName.get(row.fromCompanyId)} / {baseName.get(row.fromBaseId)}</span>
        <b>{companyName.get(row.toCompanyId)} / {baseName.get(row.toBaseId)} / {tree.factories.find((factory) => factory.id === row.toFactoryId)?.name || '接收工厂待确认'}</b>
      </Space>,
    },
    { title: '有效期', render: (_, row) => `${formatDate(row.startDate)} 至 ${formatDate(row.endDate)}` },
    { title: '事由', dataIndex: 'purpose', ellipsis: true },
    {
      title: '状态',
      width: 100,
      render: (_, row) => {
        const value = effectiveSecondmentStatus(row)
        const color = value === 'active' ? 'green' : value === 'planned' || value === 'expired' ? 'gold' : 'default'
        return <Tag color={color}>{secondmentLabel[value] || value}</Tag>
      },
    },
    {
      title: '操作', width: 150,
      render: (_, row) => <Space>
        {canManageSecondment && <Button type="link" icon={<EditOutlined />} onClick={() => open('secondment', row as unknown as Record<string, unknown>)}>编辑</Button>}
      </Space>,
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="GROUP · ORGANIZATION CONTROL"
        title={({ structure: '组织管理', people: '人员管理', secondment: '借调管理', access: '角色与数据范围' })[section]}
        description="维护组织、人员和授权；作业位置与班组通过独立入口管理。"
        actions={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>}
      />
      {section === 'structure' && (
        <Row gutter={[18, 18]}>
          <Col xs={24} xl={6}>
        <Card className="surface-card org-tree-card" title="组织结构" extra={<Tag>{tree.bases.length} 个基地</Tag>}>
              <Tree showIcon defaultExpandAll treeData={treeData} />
            </Card>
          </Col>
          <Col xs={24} xl={18}>
            <Tabs
              items={[
                {
                  key: 'groups', label: '管理分组',
                  children: <SimpleTable rows={tree.managementGroups} columns={[
                    { title: '编码', dataIndex: 'code' }, { title: '名称', dataIndex: 'name' },
                    { title: '状态', dataIndex: 'status', render: (value: string) => <StatusTag status={value} /> },
                    { title: '操作', render: (_: unknown, row: ManagementGroup) => isGroupOrgAdmin && <Button type="link" icon={<EditOutlined />} onClick={() => open('managementGroup', row as unknown as Record<string, unknown>)}>编辑</Button> },
                  ]} onAdd={isGroupOrgAdmin ? () => open('managementGroup') : undefined} />,
                },
                {
                  key: 'companies', label: '公司',
                  children: <SimpleTable rows={tree.companies.filter((company) => !company.isGroup)} columns={[
                    { title: '编码', dataIndex: 'code' }, { title: '名称', dataIndex: 'name' },
                    { title: '状态', dataIndex: 'status', render: (value: string) => <StatusTag status={value} /> },
                    { title: '操作', render: (_: unknown, row: Company) => isGroupOrgAdmin && <Button type="link" icon={<EditOutlined />} onClick={() => open('company', row as unknown as Record<string, unknown>)}>编辑</Button> },
                  ]} onAdd={isGroupOrgAdmin ? () => open('company') : undefined} />,
                },
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
                      { title: '实际基地', dataIndex: 'siteConfirmed', render: (value: boolean) => value ? <Tag color="green">已确认</Tag> : <Tag color="gold">待确认</Tag> },
                      { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <StatusTag status={value} /> },
                      {
                        title: '操作', width: 150,
                        render: (_: unknown, row: ProductionBase) => <Space>
                          {canAtBase('org.manage', row.id) && <Button type="link" icon={<EditOutlined />} onClick={() => open('base', row as unknown as Record<string, unknown>)}>编辑</Button>}
                        </Space>,
                      },
                    ]}
                    onAdd={canManageOrg ? () => open('base') : undefined}
                  />,
                },
                {
                  key: 'factories',
                  label: '饲料厂',
                  children: <SimpleTable rows={tree.factories} columns={factoryColumns} onAdd={canManageOrg ? () => open('factory') : undefined} />,
                },
              ]}
            />
          </Col>
        </Row>
      )}

      {section === 'people' && (
        <Card className="surface-card" title="人员、资格与归属" extra={canManagePeople && <Button type="primary" icon={<PlusOutlined />} onClick={() => open('person')}>新增人员</Button>}>
          <Space wrap style={{ marginBottom: 16 }}>
            <Input.Search placeholder="搜索姓名或工号" allowClear value={personSearch} onChange={(event) => setPersonSearch(event.target.value)} style={{ width: 240 }} />
            <Select placeholder="筛选归属饲料厂" allowClear value={personFactory} onChange={setPersonFactory} style={{ width: 220 }} options={tree.factories.map((factory) => ({ value: factory.id, label: factory.name }))} />
            <Select placeholder="筛选当前班组" allowClear value={personCrew} onChange={setPersonCrew} style={{ width: 220 }} options={tree.crews.filter((crew) => crew.status !== 'archived').map((crew) => ({ value: crew.id, label: crew.name }))} />
          </Space>
          <Table rowKey="id" columns={personColumns} dataSource={people.filter((person) => (!personFactory || person.factoryId === personFactory) && (!personCrew || person.crew?.crewId === personCrew) && `${person.name} ${person.employeeCode}`.toLowerCase().includes(personSearch.trim().toLowerCase()))} pagination={{ pageSize: 12 }} />
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
              personId={drawer.entity === 'person' ? drawer.record?.id as string | undefined : undefined}
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
  personId,
}: {
  entity: Entity
  tree: OrgReferenceData
  people: Person[]
  editing: boolean
  // Membership dates are maintained in 生产班组; the person form only mirrors them.
  personId?: string
}) {
  const entityForm = Form.useFormInstance()
  const { user } = useAuth()
  const companyOptions = tree.companies.map((company: Company) => ({ value: company.id, label: company.name }))
  const baseOptions = tree.bases.map((base: ProductionBase) => ({ value: base.id, label: base.name }))
  const personOptions = people.map((person: Person) => ({ value: person.id, label: `${person.name} · ${person.employeeCode}` }))
  const commonStatus = (
    <Form.Item name="status" label="状态" initialValue="active">
      <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} />
    </Form.Item>
  )

  if (entity === 'managementGroup') return <>
    <Form.Item name="code" label="分组编码" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="分组名称" rules={[{ required: true }]}><Input /></Form.Item>
    {commonStatus}
  </>

  if (entity === 'company') return <>
    <Form.Item name="code" label="公司编码" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="公司名称" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="shortName" label="简称"><Input /></Form.Item>
    <Form.Item name="payrollEnabled" label="可作为发薪公司" initialValue={true}><Select options={[{ value: true, label: '是' }, { value: false, label: '否' }]} /></Form.Item>
    {commonStatus}
  </>

  if (entity === 'base') return <>
    <Form.Item name="code" label="基地编码" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="基地名称" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="companyId" label="所属公司" rules={[{ required: true }]}><Select options={companyOptions} /></Form.Item>
    <Form.Item name="address" label="地址"><Input /></Form.Item>
    {editing && user?.grants.some((grant) => grant.capability === 'org.manage' && grant.type === 'group') && <Form.Item name="siteConfirmed" label="实际作业基地确认" extra="仅在明确该记录对应实际作业基地时确认，管理分组不能用于计价。"><Select options={[{ value: true, label: '已确认' }, { value: false, label: '待确认' }]} /></Form.Item>}
    {commonStatus}
  </>

  if (entity === 'factory') return <>
    <Form.Item name="code" label="饲料厂编码" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="饲料厂名称" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="baseId" label="所属基地" rules={[{ required: true }]}>
      <Select
        options={baseOptions}
        onChange={(baseId: string) => {
          entityForm.setFieldsValue({
            companyId: tree.bases.find((item) => item.id === baseId)?.companyId,
            factoryId: undefined,
          })
        }}
      />
    </Form.Item>
    <Form.Item name="companyId" label="工资主体公司" rules={[{ required: true }]}>
      <Select options={companyOptions.filter((item) => item.value !== 'group')} />
    </Form.Item>
    <Form.Item name="managementGroupId" label="管理分组"><Select allowClear options={tree.managementGroups.map((group) => ({ value: group.id, label: group.name }))} /></Form.Item>
    <Form.Item name="factoryType" label="工厂类型" initialValue="feed_mill">
      <Select options={[
        { value: 'direct_mill', label: '直属厂' },
        { value: 'feed_mill', label: '生产基地饲料厂' },
        { value: 'other', label: '其他工厂' },
      ]} />
    </Form.Item>
    <Form.Item name="managerPersonId" label="工厂负责人"><Select allowClear showSearch options={personOptions} /></Form.Item>
    <Form.Item name="sortOrder" label="显示顺序" initialValue={0}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
    <Form.Item name="address" label="地址"><Input /></Form.Item>
    {commonStatus}
  </>

  if (entity === 'crew') return <>
    <Form.Item name="code" label="生产班编码" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="生产班名称" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="baseId" label="所属基地" rules={[{ required: true }]}><Select disabled={editing} options={baseOptions} /></Form.Item>
    <Form.Item name="factoryId" label="所属饲料厂" rules={[{ required: true }]}>
      <Select
        options={tree.factories
          .filter((factory) => !entityForm.getFieldValue('baseId') || factory.baseId === entityForm.getFieldValue('baseId'))
          .map((factory) => ({ value: factory.id, label: factory.name }))}
      />
    </Form.Item>
    {commonStatus}
  </>

  if (entity === 'person') return <>
    <Form.Item name="employeeCode" label="工号" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="mobile" label="手机号"><Input /></Form.Item>
    <Form.Item name="homeCompanyId" label="所属公司（工资主体）" rules={[{ required: true }]}><Select options={companyOptions.filter((item) => item.value !== 'group')} /></Form.Item>
    <Form.Item name="homeBaseId" label="归属基地" rules={[{ required: true }]}>
      <Select
        options={baseOptions}
        onChange={() => entityForm.setFieldsValue({ factoryId: undefined })}
      />
    </Form.Item>
    <Form.Item name="factoryId" label="归属饲料厂">
      <Select
        allowClear
        options={tree.factories
          .filter((factory) => !entityForm.getFieldValue('homeBaseId') || factory.baseId === entityForm.getFieldValue('homeBaseId'))
          .map((factory) => ({ value: factory.id, label: factory.name }))}
      />
    </Form.Item>
    {commonStatus}
    {personId && <PersonCrewRelations personId={personId} />}
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
    <Form.Item name="toFactoryId" label="接收工厂" rules={[{ required: true }]}>
      <Select options={tree.factories.filter((factory) => factory.status === 'active').map((factory) => ({ value: factory.id, label: `${factory.name} · ${baseOptions.find((base) => base.value === factory.baseId)?.label || factory.baseId}` }))} />
    </Form.Item>
    <Row gutter={12}>
      <Col span={12}><Form.Item name="startDate" label="开始日期" rules={[{ required: true }]}><Input placeholder="2026-10-01" /></Form.Item></Col>
      <Col span={12}><Form.Item name="endDate" label="结束日期" rules={[{ required: true }]}><Input placeholder="2026-10-31" /></Form.Item></Col>
    </Row>
    <Form.Item name="purpose" label="借调事由"><Input.TextArea rows={3} /></Form.Item>
    <Form.Item name="status" label="状态" initialValue="planned">
      {/* 已到期由日期推导，不参与手工调整；取消与完成都在编辑中处理。 */}
      <Select options={Object.entries(secondmentLabel).filter(([value]) => value !== 'expired').map(([value, label]) => ({ value, label }))} />
    </Form.Item>
  </>

  return <>
    <Form.Item name="code" label="资格编码" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="name" label="资格名称" rules={[{ required: true }]}><Input /></Form.Item>
    <Form.Item name="description" label="说明"><Input.TextArea rows={3} /></Form.Item>
    {commonStatus}
  </>
}

/** Read-only crew relations of one person; editing stays in 生产班组. */
function PersonCrewRelations({ personId }: { personId: string }) {
  const [relations, setRelations] = useState<PersonCrewHistory[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    api.get<PersonCrewHistory[]>(`/org/people/${personId}/crew-relations`)
      .then((rows) => { if (alive) setRelations(rows) })
      .catch((reason) => { if (alive) setError(errorMessage(reason)) })
    return () => { alive = false }
  }, [personId])
  const relationTag: Record<PersonCrewHistory['relation'], string> = {
    current: 'green', future: 'blue', ended: 'default',
  }
  const relationText: Record<PersonCrewHistory['relation'], string> = {
    current: '当前', future: '未来', ended: '已结束',
  }
  return (
    <Card size="small" title="班组归属" style={{ marginTop: 8 }}>
      {error && <Typography.Text type="danger">{error}</Typography.Text>}
      {!error && !relations && <Typography.Text type="secondary">加载中…</Typography.Text>}
      {!error && relations && relations.length === 0 && (
        <Typography.Text type="secondary">未分配班组，请在「生产班组」的编辑中添加成员关系。</Typography.Text>
      )}
      {relations && relations.length > 0 && (
        <Table
          rowKey="membershipId"
          size="small"
          pagination={false}
          dataSource={relations}
          columns={[
            { title: '班组', dataIndex: 'crewName' },
            { title: '岗位', dataIndex: 'role', render: (value: string) => crewRoleLabels[value] || value },
            { title: '有效期', render: (_: unknown, row) => `${formatDate(row.validFrom)} 至 ${row.validTo ? formatDate(row.validTo) : '长期'}` },
            { title: '关系', dataIndex: 'relation', width: 80, render: (value: PersonCrewHistory['relation']) => <Tag color={relationTag[value]}>{relationText[value]}</Tag> },
          ]}
        />
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
        同一人员在任何日期只属于一个班组；调班请先在原班组结束关系，再到新班组登记。
      </Typography.Paragraph>
    </Card>
  )
}

function AccessPanel({ enabled }: { enabled: boolean }) {
  const { message } = App.useApp()
  const [options, setOptions] = useState<AccessOptions | null>(null)
  const [rows, setRows] = useState<AccessAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [editingAccount, setEditingAccount] = useState<string | null>(null)
  const [form] = Form.useForm()
  useAntFormUnsavedChanges(form, Boolean(editingAccount), '账号授权')

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
    return <Card className="surface-card"><Empty description="仅总部权限管理员可维护跨基地角色授权" /></Card>
  }
  if (loading) return <LoadingBlock />

  const accountName = new Map((options?.accounts || []).map((item) => [item.id, item.displayName]))
  const scopeName = new Map((options?.scopes || []).map((item) => [`${item.type}:${item.id}`, item.label]))
  const accountRows = (options?.accounts || [])
    .map((account) => ({
      account,
      assignments: rows.filter((row) => row.accountId === account.id),
    }))

  const editingAssignments = rows.filter((row) => row.accountId === editingAccount)

  const add = async () => {
    if (!editingAccount) return
    try {
      const values = await form.validateFields()
      await api.post('/org/access/assignments', {
        accountId: editingAccount,
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
    <Card className="surface-card" title="账号授权">
      <Typography.Paragraph type="secondary">
        能力由角色定义，数据范围单独授予。总部权限管理员可授权到公司、基地或具体饲料厂；添加与撤销统一在「编辑授权」中进行。
      </Typography.Paragraph>
      <Table
        rowKey={(row) => row.account.id}
        size="small"
        dataSource={accountRows}
        pagination={{ pageSize: 12 }}
        columns={[
          { title: '账号', render: (_: unknown, row) => <Space direction="vertical" size={0}><b>{row.account.displayName}</b><small>{row.account.username}</small></Space> },
          {
            title: '角色与数据范围',
            render: (_: unknown, row) => row.assignments.length
              ? <Space wrap>{row.assignments.map((item) => (
                  <Tag key={item.id}>{item.roleName} · {scopeName.get(`${item.scope.type}:${item.scope.id}`) || item.scope.id}</Tag>
                ))}</Space>
              : <Typography.Text type="secondary">未授权</Typography.Text>,
          },
          {
            title: '操作', width: 110,
            render: (_: unknown, row) => <Button type="link" icon={<EditOutlined />} onClick={() => { form.resetFields(); setEditingAccount(row.account.id) }}>编辑授权</Button>,
          },
        ]}
      />
      <Drawer
        title={`编辑授权 · ${editingAccount ? accountName.get(editingAccount) || editingAccount : ''}`}
        width={560}
        open={Boolean(editingAccount)}
        onClose={() => setEditingAccount(null)}
      >
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={editingAssignments}
          columns={[
            { title: '角色', dataIndex: 'roleName' },
            { title: '数据范围', render: (_: unknown, row: AccessAssignment) => scopeName.get(`${row.scope.type}:${row.scope.id}`) || row.scope.id },
            { title: '生效', dataIndex: 'validFrom', render: formatDateTime },
            {
              title: '操作', width: 80,
              render: (_: unknown, row: AccessAssignment) => (
                <Popconfirm title="撤销此授权？" onConfirm={() => void remove(row.id)}>
                  <Button type="link" danger>撤销</Button>
                </Popconfirm>
              ),
            },
          ]}
        />
        <Card size="small" title="添加授权" style={{ marginTop: 16 }}>
          <Form form={form} layout="vertical">
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
      </Drawer>
    </Card>
  )
}

export function QualificationPanel({ rows, canManage }: { rows: Qualification[]; canManage: boolean }) {
  return (
    <Descriptions title="饲料总部统一作业资格" extra={canManage ? <Tag color="green">可维护</Tag> : <Tag>只读</Tag>}>
      {rows.map((item) => (
        <Descriptions.Item key={item.id} label={item.name}>{item.description || item.code}</Descriptions.Item>
      ))}
    </Descriptions>
  )
}
