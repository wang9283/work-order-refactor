import SchemaEditor from './SchemaEditor'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  EditOutlined,
  FileTextOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
  Upload,
} from 'antd'
import type { UploadFile } from 'antd'
import type {
  FormFieldDefinition,
  FormTemplate,
  FormVersion,
  FormVersionSchema,
  HandoverShiftProfile,
  OrgReferenceData,
  TicketCatalog,
  TicketType,
  WorkProfile,
} from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'
import { formatDateTime } from '@next/shared/format'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'
import { useAntFormUnsavedChanges } from '@next/shared/unsaved-changes'

type Section = 'forms' | 'types' | 'profiles' | 'excel'

const sectionHash: Record<Section, string> = {
  forms: '#/templates',
  types: '#/ticket-types',
  profiles: '#/profiles',
  excel: '#/excel',
}

interface FormDetail extends FormTemplate {
  versions: FormVersion[]
  canEdit: boolean
}

interface TicketTypeDetail extends TicketType {
  versions: Array<{
    id: string
    versionNo: number
    status: string
    formVersionId: string
    formSchema: FormVersionSchema
    workProfiles: WorkProfile[]
    publishedAt: string | null
    revision: number
  }>
  canEdit: boolean
  standardLocked: boolean
}

interface ExcelColumn {
  sourceColumn: string
  targetFieldKey: string
  inferredType: string
  sampleValues: string[]
  warnings: string[]
}

interface ExcelPreview {
  importId: string
  ownerType: 'group' | 'company'
  ownerId: string
  sheetName: string
  columns: ExcelColumn[]
  sampleRows: string[][]
  warnings: string[]
}

const fieldTypeLabel: Record<string, string> = {
  text: '单行文本', textarea: '多行文本', number: '数字', date: '日期', datetime: '日期时间',
  single_select: '单选', multi_select: '多选', boolean: '开关', photo: '拍照', attachment: '附件',
}

const statusLabel: Record<string, string> = {
  draft: '草稿', published: '已发布', retired: '已停用', archived: '已归档',
}

function blankField(index: number): FormFieldDefinition {
  return {
    id: `field_${Date.now()}_${index}`,
    key: `field_${index}`,
    name: `字段 ${index}`,
    type: 'text',
    required: false,
    strategy: 'optional',
    sort: index,
    isCore: false,
    editableByLocal: true,
  }
}

export default function TemplateWorkspace({ initialSection = 'forms', embedded = false }: { initialSection?: Section; embedded?: boolean }) {
  const { user } = useAuth()
  const { message } = App.useApp()
  const [section, setSection] = useState<Section>(initialSection)
  const [forms, setForms] = useState<FormDetail[]>([])
  const [types, setTypes] = useState<TicketType[]>([])
  const [catalog, setCatalog] = useState<TicketCatalog | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string>()
  const [org, setOrg] = useState<OrgReferenceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formDrawer, setFormDrawer] = useState<{ detail?: FormDetail; version?: FormVersion } | null>(null)
  const [typeDrawer, setTypeDrawer] = useState(false)
  const [profileDrawer, setProfileDrawer] = useState<HandoverShiftProfile | 'new' | null>(null)
  const [profiles, setProfiles] = useState<HandoverShiftProfile[]>([])
  const [form] = Form.useForm()
  const [typeForm] = Form.useForm()
  const [profileForm] = Form.useForm()
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>()
  useAntFormUnsavedChanges(form, Boolean(formDrawer), '表单模板')
  useAntFormUnsavedChanges(typeForm, typeDrawer, '工单类型')
  useAntFormUnsavedChanges(profileForm, Boolean(profileDrawer), '交接班配置')

  const isGroupAdmin = user?.grants.some((grant) => grant.type === 'group' && grant.capability === 'form.manage') || false

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [formPage, catalogData, orgData, profileData] = await Promise.all([
        api.getPage<FormTemplate>('/forms', { pageSize: 200 }),
        api.get<TicketCatalog>('/ticket-catalog'),
        api.get<OrgReferenceData>('/org/tree'),
        api.get<HandoverShiftProfile[]>('/handover-profiles'),
      ])
      const formDetails = await Promise.all(formPage.items.map((item) => api.get<FormDetail>(`/forms/${item.id}`)))
      setForms(formDetails)
      setCatalog(catalogData)
      setTypes(catalogData.types)
      setSelectedGroupId((current) => current && catalogData.groups.some((group) => group.id === current)
        ? current
        : catalogData.groups[0]?.id)
      setOrg(orgData)
      setProfiles(profileData)
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

  const ownerName = useMemo(() => {
    const map = new Map((org?.companies || []).map((company) => [company.id, company.name]))
    map.set('group', '饲料总部')
    return map
  }, [org])

  const openForm = async (detail?: FormDetail) => {
    if (!detail) {
      const schema: FormVersionSchema = { mainFields: [blankField(1)], subForms: [], conditionRules: [] }
      form.setFieldsValue({
        code: '', name: '', ownerType: isGroupAdmin ? 'group' : 'company',
        ownerId: isGroupAdmin ? 'group' : org?.companies.find((item) => !item.isGroup)?.id,
        schemaText: JSON.stringify(schema, null, 2),
      })
      setFormDrawer({})
      return
    }
    const draft = detail.versions.find((version) => version.status === 'draft')
    form.setFieldsValue({
      code: detail.code,
      name: detail.name,
      ownerType: detail.ownerType,
      ownerId: detail.ownerId,
      schemaText: JSON.stringify((draft || detail.versions[0])?.schema, null, 2),
    })
    setFormDrawer({ detail, version: draft || detail.versions[0] })
  }

  const saveForm = async () => {
    const values = await form.validateFields()
    let schema: FormVersionSchema
    try {
      schema = JSON.parse(values.schemaText)
    } catch {
      message.error('表单结构不是有效 JSON')
      return
    }
    try {
      if (!formDrawer?.detail) {
        await api.post('/forms', {
          code: values.code,
          name: values.name,
          ownerType: values.ownerType,
          ownerId: values.ownerId,
          source: 'native',
          schema,
        })
        message.success('表单模板已创建')
      } else if (formDrawer.version?.status === 'draft') {
        await api.put(`/forms/${formDrawer.detail.id}/versions/${formDrawer.version.id}`, {
          schema,
          revision: formDrawer.version.revision,
        })
        message.success('草稿已保存')
      } else {
        await api.post(`/forms/${formDrawer.detail.id}/versions`, {
          fromVersionId: formDrawer.version?.id,
          schema,
        })
        message.success('已生成新草稿版本')
      }
      setFormDrawer(null)
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const publish = async (detail: FormDetail, version: FormVersion) => {
    try {
      await api.post(`/forms/${detail.id}/versions/${version.id}/publish`, { revision: version.revision })
      message.success(`V${version.versionNo} 已发布，历史版本将保持只读`)
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const createVersion = async (detail: FormDetail, version: FormVersion) => {
    try {
      await api.post(`/forms/${detail.id}/versions`, { fromVersionId: version.id })
      message.success('已复制为新草稿版本')
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const saveType = async () => {
    const values = await typeForm.validateFields()
    try {
      const publishedForm = forms.find((item) => item.id === values.formTemplateId)
      const publishedVersion = publishedForm?.versions.find((item) => item.status === 'published')
      if (!publishedForm || !publishedVersion) {
        message.error('请先发布表单版本')
        return
      }
      await api.post('/ticket-types', {
        code: values.code,
        name: values.name,
        categoryId: values.categoryId,
        ownerType: values.ownerType,
        ownerId: values.ownerId,
        formTemplateId: publishedForm.id,
        formVersionId: publishedVersion.id,
        workProfiles: [],
        locked: isGroupAdmin,
      })
      message.success('工单类型草稿已创建')
      setTypeDrawer(false)
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const openProfile = (record?: HandoverShiftProfile) => {
    profileForm.resetFields()
    if (record) {
      setSelectedFactoryId(record.factoryId)
      profileForm.setFieldsValue(record)
    } else {
      const firstFactory = org?.factories[0]
      const firstShift = org?.shiftTemplates.find((shift) => shift.baseId === firstFactory?.baseId)
      setSelectedFactoryId(firstFactory?.id)
      profileForm.setFieldsValue({
        factoryId: firstFactory?.id,
        shiftTemplateId: firstShift?.id,
        crewIds: [],
        assignmentMode: 'roster_first',
        handoverRequired: true,
        earlyStartMinutes: 30,
        lateEndMinutes: 30,
        instruction: '',
        status: 'active',
      })
    }
    setProfileDrawer(record || 'new')
  }

  const saveProfile = async () => {
    if (!org) return
    const values = await profileForm.validateFields()
    const factory = org.factories.find((item) => item.id === values.factoryId)
    try {
      const payload = {
        ...values,
        siteId: undefined,
        revision: profileDrawer && profileDrawer !== 'new' ? profileDrawer.revision : undefined,
      }
      if (profileDrawer && profileDrawer !== 'new') {
        await api.put(`/handover-profiles/${profileDrawer.id}`, payload)
        message.success('交接班配置已保存')
      } else {
        await api.post('/handover-profiles', {
          ...payload,
          name: values.name || `${factory?.name || '饲料厂'} · ${org.shiftTemplates.find((item) => item.id === values.shiftTemplateId)?.name || '班次'}`,
        })
        message.success('交接班配置已创建')
      }
      setProfileDrawer(null)
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const archiveProfile = async (record: HandoverShiftProfile) => {
    try {
      await api.delete(`/handover-profiles/${record.id}?revision=${record.revision}`)
      message.success('交接班配置已归档')
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  if (loading) return <LoadingBlock rows={6} />
  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />
  if (!org) return null

  return (
    <div>
      {!embedded && <PageHeader
        eyebrow="GROUP STANDARD · LOCAL CONFIGURATION"
        title="其他工单模板与类型"
        description="维护其他工单填写内容与类型。"
        actions={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>}
      />}
      <Tabs
        activeKey={section}
        tabBarStyle={embedded ? { display: 'none' } : undefined}
        onChange={(key) => {
          setSection(key as Section)
          window.location.hash = sectionHash[key as Section]
        }}
        items={[
          { key: 'forms', label: '表单模板与版本', children: <FormsPanel forms={forms} ownerName={ownerName} isGroupAdmin={isGroupAdmin} onOpen={openForm} onPublish={publish} onVersion={createVersion} /> },
          { key: 'types', label: '工单类型', children: <TypesPanel catalog={catalog} selectedGroupId={selectedGroupId} onGroupChange={setSelectedGroupId} ownerName={ownerName} onTriggers={(type) => {
            if (!type.systemManaged) window.location.hash = `#/trigger-rules?typeId=${encodeURIComponent(type.id)}`
          }} canCreate={Boolean(user?.grants.some((grant) => grant.capability === 'ticket_type.manage'))} onCreate={() => {
            typeForm.resetFields()
            const firstBase = org.bases[0]
            const firstFactory = org.factories.find((factory) => factory.baseId === firstBase?.id) || org.factories[0]
            typeForm.setFieldsValue({
              categoryId: selectedGroupId || catalog?.groups[0]?.id,
              ownerType: isGroupAdmin ? 'group' : 'company',
              ownerId: isGroupAdmin ? 'group' : org.companies.find((item) => !item.isGroup)?.id,
              siteId: firstBase?.id,
              factoryId: firstFactory?.id,
              crewId: org.crews.find((crew) => crew.factoryId === firstFactory?.id)?.id,
              shiftTemplateId: org.shiftTemplates.find((shift) => shift.baseId === firstBase?.id)?.id,
              generationMode: 'schedule',
              handoverGrouping: 'shift',
              handoverRequired: true,
              earlyStartMinutes: 30,
              lateEndMinutes: 30,
              assignmentMode: 'roster_first',
            })
            setTypeDrawer(true)
          }} /> },
        ]}
      />


      <Drawer
        width={620}
        open={profileDrawer !== null}
        onClose={() => setProfileDrawer(null)}
        title={profileDrawer && profileDrawer !== 'new' ? '编辑交接班配置' : '新增交接班配置'}
        extra={<Button type="primary" onClick={() => void saveProfile()}>保存</Button>}
      >
        <Form
          form={profileForm}
          layout="vertical"
          onValuesChange={(changed) => {
            if ('factoryId' in changed) {
              const factory = org?.factories.find((item) => item.id === changed.factoryId)
              setSelectedFactoryId(changed.factoryId)
              profileForm.setFieldsValue({
                shiftTemplateId: org?.shiftTemplates.find((shift) => shift.baseId === factory?.baseId)?.id,
                crewIds: [],
              })
            }
          }}
        >
          <Form.Item name="name" label="配置名称" rules={[{ required: true, min: 2 }]}>
            <Input placeholder="如：酱料生产班 · 白班交接" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="factoryId" label="饲料厂" rules={[{ required: true }]}>
                <Select options={org.factories.map((factory) => ({ value: factory.id, label: factory.name }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="shiftTemplateId" label="班次" rules={[{ required: true }]}>
                <Select
                  options={org.shiftTemplates
                    .filter((shift) => shift.baseId === org.factories.find((factory) => factory.id === selectedFactoryId)?.baseId)
                    .map((shift) => ({ value: shift.id, label: `${shift.name} ${shift.startTime}-${shift.endTime}` }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="crewIds" label="参与生产班" rules={[{ required: true }]}>
            <Select
              mode="multiple"
              options={org.crews
                .filter((crew) => crew.factoryId === selectedFactoryId)
                .map((crew) => ({ value: crew.id, label: crew.name }))}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="assignmentMode" label="人员匹配">
                <Select options={[
                  { value: 'roster_first', label: '排班优先' },
                  { value: 'manual', label: '人工指派' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="earlyStartMinutes" label="允许提前（分钟）">
                <InputNumber min={0} max={1440} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="lateEndMinutes" label="允许延后（分钟）">
                <InputNumber min={0} max={1440} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="instruction" label="交接说明">
            <Input.TextArea rows={4} maxLength={500} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="handoverRequired" label="要求交接确认">
                <Select options={[{ value: true, label: '是' }, { value: false, label: '否' }]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="状态">
                <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Drawer>

      <Drawer
        width={620}
        open={Boolean(formDrawer)}
        onClose={() => setFormDrawer(null)}
        title={formDrawer?.detail ? `${formDrawer.detail.name} · 表单结构` : '新建表单模板'}
        extra={<Button type="primary" onClick={() => void saveForm()}>保存草稿</Button>}
      >
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={10}><Form.Item name="code" label="模板编码" rules={[{ required: true }]}><Input disabled={Boolean(formDrawer?.detail)} /></Form.Item></Col>
            <Col span={14}><Form.Item name="name" label="模板名称" rules={[{ required: true }]}><Input disabled={Boolean(formDrawer?.detail)} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={10}>
              <Form.Item name="ownerType" label="归属" rules={[{ required: true }]}>
                <Select disabled={Boolean(formDrawer?.detail)} options={isGroupAdmin ? [{ value: 'group', label: '饲料总部标准' }, { value: 'company', label: '公司本地' }] : [{ value: 'company', label: '公司本地' }]} />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="ownerId" label="归属公司" rules={[{ required: true }]}>
                <Select disabled={Boolean(formDrawer?.detail)} options={[{ value: 'group', label: '饲料总部' }, ...org.companies.filter((item) => !item.isGroup).map((item) => ({ value: item.id, label: item.name }))]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="schemaText" label="表单字段" rules={[{ required: true }]}>
            <SchemaEditor />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        width={560}
        open={typeDrawer}
        onClose={() => setTypeDrawer(false)}
        title="新增工单类型"
        extra={<Button type="primary" onClick={() => void saveType()}>保存草稿</Button>}
      >
        <Form form={typeForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><Form.Item name="code" label="类型编码" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="类型名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Form.Item name="categoryId" label="所属类型分组" rules={[{ required: true }]}>
            <Select options={(catalog?.groups || []).filter((group) => group.status === 'active').map((group) => ({
              value: group.id,
              label: group.name,
            }))} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={10}><Form.Item name="ownerType" label="归属"><Select options={isGroupAdmin ? [{ value: 'group', label: '总部标准' }, { value: 'company', label: '公司本地' }] : [{ value: 'company', label: '公司本地' }]} /></Form.Item></Col>
            <Col span={14}><Form.Item name="ownerId" label="归属公司"><Select options={[{ value: 'group', label: '饲料总部' }, ...org.companies.filter((item) => !item.isGroup).map((item) => ({ value: item.id, label: item.name }))]} /></Form.Item></Col>
          </Row>
          <Form.Item name="formTemplateId" label="已发布表单" rules={[{ required: true }]}>
            <Select options={forms.filter((item) => item.versions.some((version) => version.status === 'published')).map((item) => ({ value: item.id, label: `${item.name} · ${ownerName.get(item.ownerId)}` }))} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}

function FormsPanel({
  forms,
  ownerName,
  isGroupAdmin,
  onOpen,
  onPublish,
  onVersion,
}: {
  forms: FormDetail[]
  ownerName: Map<string, string>
  isGroupAdmin: boolean
  onOpen: (detail?: FormDetail) => void
  onPublish: (detail: FormDetail, version: FormVersion) => void
  onVersion: (detail: FormDetail, version: FormVersion) => void
}) {
  return (
    <Card className="surface-card" title="表单模板" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => onOpen()}>新建表单</Button>}>
      {forms.length === 0
        ? <Empty description="尚无表单模板" />
        : <Collapse
          accordion
          items={forms.map((detail) => ({
            key: detail.id,
            label: <Space>
              <b>{detail.name}</b>
              <Tag>{detail.code}</Tag>
              <Tag color={detail.ownerType === 'group' ? 'gold' : 'blue'}>{ownerName.get(detail.ownerId) || detail.ownerId}</Tag>
              {detail.source === 'excel' && <Tag color="cyan">Excel 生成</Tag>}
            </Space>,
            extra: detail.currentPublishedVersionId && <Tag color="green">已发布</Tag>,
            children: (
              <Timeline
                items={detail.versions.map((version) => ({
                  color: version.status === 'published' ? 'green' : version.status === 'draft' ? 'blue' : 'gray',
                  children: (
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Space wrap>
                        <b>V{version.versionNo}</b>
                        <Tag>{statusLabel[version.status]}</Tag>
                        <span>{version.schema.mainFields.length} 个主字段 / {version.schema.subForms.length} 个子表</span>
                        {version.publishedAt && <small>{formatDateTime(version.publishedAt)}</small>}
                      </Space>
                      <Space wrap>
                        <Button size="small" icon={<EditOutlined />} onClick={() => onOpen(detail)}>
                          {version.status === 'draft' ? '编辑草稿' : '查看结构'}
                        </Button>
                        {version.status === 'draft' && detail.canEdit && (
                          <Popconfirm title="发布后该版本永久只读，确认发布？" onConfirm={() => onPublish(detail, version)}>
                            <Button size="small" type="primary" icon={<CheckCircleOutlined />}>发布 V{version.versionNo}</Button>
                          </Popconfirm>
                        )}
                        {version.status === 'published' && detail.canEdit && (
                          <Button size="small" icon={<CopyOutlined />} onClick={() => onVersion(detail, version)}>基于此版本新建草稿</Button>
                        )}
                        {version.status === 'published' && detail.ownerType === 'group' && !isGroupAdmin && <Tag icon={<LockOutlined />}>总部标准只读</Tag>}
                      </Space>
                    </Space>
                  ),
                }))}
              />
            ),
          }))}
        />}
    </Card>
  )
}

function TypesPanel({
  catalog,
  selectedGroupId,
  onGroupChange,
  ownerName,
  canCreate,
  onCreate,
  onTriggers,
}: {
  catalog: TicketCatalog | null
  selectedGroupId?: string
  onGroupChange: (id: string) => void
  ownerName: Map<string, string>
  canCreate: boolean
  onCreate: () => void
  onTriggers: (type: TicketType) => void
}) {
  const groups = catalog?.groups || []
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || groups[0]
  const types = selectedGroup?.types || []
  return (
    <Card
      className="surface-card"
      title="工单类型"
      extra={canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>新增类型</Button>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '190px minmax(0, 1fr)', gap: 18 }}>
        <div style={{ borderRight: '1px solid #f0f0f0', paddingRight: 12 }}>
          <Typography.Text type="secondary">类型分组</Typography.Text>
          <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 10 }}>
            {groups.map((group) => (
              <Button
                key={group.id}
                type={selectedGroup?.id === group.id ? 'primary' : 'text'}
                block
                onClick={() => onGroupChange(group.id)}
                style={{ justifyContent: 'space-between', textAlign: 'left' }}
              >
                <span>{group.name}</span>
                <small>{group.types.length}</small>
              </Button>
            ))}
          </Space>
        </div>
        <div>
          <div style={{ marginBottom: 12 }}>
            <Typography.Title level={5} style={{ margin: 0 }}>{selectedGroup?.name || '类型分组'}</Typography.Title>
            <Typography.Text type="secondary">选择具体类型维护标准来源与启停状态；系统内置项只读展示。</Typography.Text>
          </div>
          {types.length === 0
            ? <Empty description="该分组暂无工单类型" />
            : <Table
              rowKey="id"
              dataSource={types}
              pagination={{ pageSize: 12 }}
              rowClassName={(row) => row.systemManaged ? 'template-type-readonly' : ''}
              columns={[
                {
                  title: '工单类型',
                  dataIndex: 'name',
                  render: (value: string, row) => <Space direction="vertical" size={0}>
                    <Space><b>{value}</b>{row.systemManaged && <Tag color="default">系统内置</Tag>}</Space>
                    <small>{row.code} · {ownerName.get(row.ownerId) || row.ownerId}</small>
                  </Space>,
                },
                {
                  title: '标准来源',
                  dataIndex: 'origin',
                  render: (value: string) => value === 'group_standard'
                    ? <Tag color="gold" icon={<LockOutlined />}>饲料总部标准</Tag>
                    : <Tag color="blue">公司本地</Tag>,
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  render: (value: string) => <Tag color={value === 'published' ? 'green' : value === 'draft' ? 'blue' : 'default'}>{statusLabel[value] || value}</Tag>,
                },
                { title: '修订', dataIndex: 'revision', width: 80 },
                {
                  title: '操作',
                  width: 120,
                  render: (_, row) => row.systemManaged
                    ? <Typography.Text type="secondary">只读</Typography.Text>
                    : <Button size="small" onClick={() => onTriggers(row)}>触发规则</Button>,
                },
              ]}
            />}
        </div>
      </div>
    </Card>
  )
}

function ProfilesPanel({
  profiles,
  org,
  canManage,
  onCreate,
  onEdit,
  onArchive,
}: {
  profiles: HandoverShiftProfile[]
  org: OrgReferenceData
  canManage: boolean
  onCreate: () => void
  onEdit: (record: HandoverShiftProfile) => void
  onArchive: (record: HandoverShiftProfile) => void
}) {
  const factoryName = new Map(org.factories.map((factory) => [factory.id, factory.name]))
  const crewName = new Map(org.crews.map((crew) => [crew.id, crew.name]))
  const shiftName = new Map(org.shiftTemplates.map((shift) => [shift.id, `${shift.name} ${shift.startTime}-${shift.endTime}`]))
  return (
    <Card className="surface-card" title="交接班式作业配置" extra={canManage && <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>新增配置</Button>}>
      <Alert
        type="info"
        showIcon
        icon={<ThunderboltOutlined />}
        message="参照交接班表组织作业"
        description="每条配置绑定一个饲料厂、一个班次和多个生产班。创建工单时选中配置后自动带出作业基地、班次和默认生产班；没有匹配人员的工单进入待指派。"
        style={{ marginBottom: 18 }}
      />
      <Table
        rowKey="id"
        dataSource={profiles}
        pagination={{ pageSize: 12 }}
        columns={[
          {
            title: '配置',
            dataIndex: 'name',
            render: (value: string, row) => <Space direction="vertical" size={0}>
              <b>{value}</b>
              <small>{org.bases.find((base) => base.id === row.siteId)?.name}</small>
            </Space>,
          },
          { title: '饲料厂', dataIndex: 'factoryId', render: (value: string) => factoryName.get(value) || value },
          { title: '班次', dataIndex: 'shiftTemplateId', render: (value: string) => shiftName.get(value) || value },
          {
            title: '生产班',
            dataIndex: 'crewIds',
            render: (value: string[]) => <Space wrap>{value.map((id) => <Tag key={id}>{crewName.get(id) || id}</Tag>)}</Space>,
          },
          {
            title: '交接',
            dataIndex: 'handoverRequired',
            render: (value: boolean, row) => <Space direction="vertical" size={0}>
              <Tag color={value ? 'gold' : 'default'}>{value ? '需确认' : '无需确认'}</Tag>
              <small>提前 {row.earlyStartMinutes} / 延后 {row.lateEndMinutes} 分钟</small>
            </Space>,
          },
          {
            title: '操作',
            width: 180,
            render: (_, row) => canManage && <Space>
              <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(row)}>编辑</Button>
              <Popconfirm title="归档此交接班配置？" onConfirm={() => onArchive(row)}>
                <Button type="link" danger>归档</Button>
              </Popconfirm>
            </Space>,
          },
        ]}
      />
    </Card>
  )
}

function ExcelPanel({
  isGroupAdmin,
  companies,
  onDone,
}: {
  isGroupAdmin: boolean
  companies: OrgReferenceData['companies']
  onDone: () => void
}) {
  const { message } = App.useApp()
  const [step, setStep] = useState(0)
  const [files, setFiles] = useState<UploadFile[]>([])
  const [preview, setPreview] = useState<ExcelPreview | null>(null)
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [commitForm] = Form.useForm()

  const upload = async () => {
    const raw = files[0]?.originFileObj
    if (!raw) { message.error('请选择 .xlsx 文件'); return }
    const body = new FormData()
    body.append('file', raw)
    const ownerType = isGroupAdmin ? 'group' : 'company'
    const ownerId = isGroupAdmin ? 'group' : companies.find((item) => !item.isGroup)?.id || ''
    try {
      const result = await api.upload<ExcelPreview>('/excel/imports/preview', body, {
        'X-Owner-Type': ownerType,
        'X-Owner-Id': ownerId,
      })
      setPreview(result)
      setMappings(Object.fromEntries(result.columns.map((column) => [column.sourceColumn, column.targetFieldKey])))
      setStep(1)
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const commit = async () => {
    if (!preview) return
    const values = await commitForm.validateFields()
    try {
      await api.post(`/excel/imports/${preview.importId}/commit`, { ...values, mappings })
      message.success('草稿表单已生成，发布前可继续调整')
      setStep(3)
      onDone()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  return (
    <Card className="surface-card">
      <Steps
        current={step}
        items={[
          { title: '上传 Excel' },
          { title: '识别字段' },
          { title: '确认映射' },
          { title: '生成草稿' },
        ]}
        style={{ marginBottom: 26 }}
      />
      {step === 0 && (
        <Upload.Dragger
          accept=".xlsx"
          maxCount={1}
          fileList={files}
          beforeUpload={() => false}
          onChange={({ fileList }) => setFiles(fileList.slice(-1))}
        >
          <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
          <p className="ant-upload-text">上传交接班表或作业记录 Excel</p>
          <p className="ant-upload-hint">第一行为字段名称；第二行可用 type:number、type:date、type:single_select 等声明类型，缺省时自动推断。</p>
        </Upload.Dragger>
      )}
      {step === 0 && <Button type="primary" disabled={!files.length} onClick={() => void upload()} style={{ marginTop: 18 }}>开始识别</Button>}
      {step === 1 && preview && (
        <>
          <Alert
            type={preview.warnings.length ? 'warning' : 'success'}
            showIcon
            message={`工作表“${preview.sheetName}”识别到 ${preview.columns.length} 列`}
            description={preview.warnings.join('；') || '字段类型已识别，可继续确认映射。'}
            style={{ marginBottom: 18 }}
          />
          <Table
            rowKey="sourceColumn"
            pagination={false}
            dataSource={preview.columns}
            columns={[
              { title: 'Excel 列', dataIndex: 'sourceColumn' },
              { title: '识别类型', dataIndex: 'inferredType', render: (value: string) => <Tag>{value}</Tag> },
              { title: '样例值', dataIndex: 'sampleValues', render: (values: string[]) => values.join('、') || '—' },
              { title: '提示', dataIndex: 'warnings', render: (values: string[]) => values.join('；') || '—' },
            ]}
          />
          <Button type="primary" onClick={() => setStep(2)} style={{ marginTop: 18 }}>确认映射</Button>
        </>
      )}
      {step === 2 && preview && (
        <Row gutter={[24, 18]}>
          <Col xs={24} xl={14}>
            <Typography.Title level={4}>字段映射</Typography.Title>
            {preview.columns.map((column) => (
              <div key={column.sourceColumn} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <Input value={column.sourceColumn} disabled />
                <Input
                  value={mappings[column.sourceColumn] || ''}
                  onChange={(event) => setMappings((current) => ({ ...current, [column.sourceColumn]: event.target.value }))}
                  placeholder="字段标识，留空表示忽略"
                />
              </div>
            ))}
          </Col>
          <Col xs={24} xl={10}>
            <Typography.Title level={4}>生成草稿</Typography.Title>
            <Form form={commitForm} layout="vertical" initialValues={{ ownerType: preview.ownerType, ownerId: preview.ownerId }}>
              <Form.Item name="templateName" label="表单名称" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="templateCode" label="模板编码" rules={[{ required: true }, { pattern: /^[A-Za-z][A-Za-z0-9_-]*$/, message: '以字母开头，仅字母数字下划线短横线' }]}><Input /></Form.Item>
              <Form.Item name="ownerType" hidden><Input /></Form.Item>
              <Form.Item name="ownerId" hidden><Input /></Form.Item>
              <Button type="primary" block onClick={() => void commit()}>生成草稿表单</Button>
            </Form>
          </Col>
        </Row>
      )}
      {step === 3 && (
        <div style={{ textAlign: 'center', padding: '46px 0' }}>
          <CheckCircleOutlined style={{ fontSize: 54, color: '#2f855a' }} />
          <Typography.Title level={3}>草稿已生成</Typography.Title>
          <Typography.Paragraph type="secondary">请回到“表单模板与版本”检查字段、规则和子表，确认后再发布。</Typography.Paragraph>
          <Button onClick={() => { setStep(0); setFiles([]); setPreview(null) }}>继续导入</Button>
        </div>
      )}
    </Card>
  )
}
