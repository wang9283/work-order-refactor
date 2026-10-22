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
  OrgReferenceData,
  TicketType,
  WorkProfile,
} from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'
import { formatDateTime } from '@next/shared/format'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'

type Section = 'forms' | 'types' | 'profiles' | 'excel'

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

export default function TemplateWorkspace({ initialSection = 'forms' }: { initialSection?: Section }) {
  const { user } = useAuth()
  const { message } = App.useApp()
  const [section, setSection] = useState<Section>(initialSection)
  const [forms, setForms] = useState<FormDetail[]>([])
  const [types, setTypes] = useState<TicketType[]>([])
  const [org, setOrg] = useState<OrgReferenceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formDrawer, setFormDrawer] = useState<{ detail?: FormDetail; version?: FormVersion } | null>(null)
  const [typeDrawer, setTypeDrawer] = useState(false)
  const [form] = Form.useForm()
  const [typeForm] = Form.useForm()

  const isGroupAdmin = user?.grants.some((grant) => grant.type === 'group' && grant.capability === 'form.manage') || false

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [formPage, typePage, orgData] = await Promise.all([
        api.getPage<FormTemplate>('/forms', { pageSize: 200 }),
        api.getPage<TicketType>('/ticket-types', { pageSize: 200 }),
        api.get<OrgReferenceData>('/org/tree'),
      ])
      const formDetails = await Promise.all(formPage.items.map((item) => api.get<FormDetail>(`/forms/${item.id}`)))
      setForms(formDetails)
      setTypes(typePage.items)
      setOrg(orgData)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const ownerName = useMemo(() => {
    const map = new Map((org?.companies || []).map((company) => [company.id, company.name]))
    map.set('group', '集团总部')
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
      const profile = {
        siteId: values.siteId,
        workAreaId: values.workAreaId || null,
        productionLineId: values.productionLineId || null,
        crewId: values.crewId || null,
        shiftTemplateId: values.shiftTemplateId || null,
        generationMode: values.generationMode || 'schedule',
        handoverGrouping: values.handoverGrouping || 'shift',
        handoverRequired: Boolean(values.handoverRequired),
        timeWindowStart: values.timeWindowStart || null,
        timeWindowEnd: values.timeWindowEnd || null,
        earlyStartMinutes: values.earlyStartMinutes ?? 30,
        lateEndMinutes: values.lateEndMinutes ?? 30,
        assignmentMode: values.assignmentMode || 'roster_first',
      }
      let categoryId = values.categoryId
      if (!categoryId) {
        const created = await api.post<{ id: string }>('/ticket-categories', {
          code: values.code,
          name: values.name,
          ownerType: values.ownerType,
          ownerId: values.ownerId,
        })
        categoryId = created.id
      }
      await api.post('/ticket-types', {
        code: values.code,
        name: values.name,
        categoryId,
        ownerType: values.ownerType,
        ownerId: values.ownerId,
        formTemplateId: publishedForm.id,
        formVersionId: publishedVersion.id,
        workProfiles: [profile],
      })
      message.success('工单类型草稿已创建')
      setTypeDrawer(false)
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
      <PageHeader
        eyebrow="GROUP STANDARD · LOCAL CONFIGURATION"
        title="工单标准与交接班配置"
        description="总部发布的表单与工单类型整份只读；子公司可复制为本地类型。工单按基地、工区、产线、班组和班次生成，Excel 只生成草稿，发布仍需人工确认。"
        actions={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>}
      />
      <Tabs
        activeKey={section}
        onChange={(key) => setSection(key as Section)}
        items={[
          { key: 'forms', label: '表单模板与版本', children: <FormsPanel forms={forms} ownerName={ownerName} isGroupAdmin={isGroupAdmin} onOpen={openForm} onPublish={publish} onVersion={createVersion} /> },
          { key: 'types', label: '工单类型', children: <TypesPanel types={types} ownerName={ownerName} canCreate={Boolean(user?.grants.some((grant) => grant.capability === 'ticket_type.manage'))} onCreate={() => {
            typeForm.resetFields()
            typeForm.setFieldsValue({
              ownerType: isGroupAdmin ? 'group' : 'company',
              ownerId: isGroupAdmin ? 'group' : org.companies.find((item) => !item.isGroup)?.id,
              generationMode: 'schedule',
              handoverGrouping: 'shift',
              handoverRequired: true,
              earlyStartMinutes: 30,
              lateEndMinutes: 30,
              assignmentMode: 'roster_first',
            })
            setTypeDrawer(true)
          }} /> },
          { key: 'profiles', label: '交接班式作业配置', children: <ProfilesPanel types={types} ownerName={ownerName} /> },
          { key: 'excel', label: 'Excel 转表单', children: <ExcelPanel isGroupAdmin={isGroupAdmin} companies={org.companies} onDone={() => void load()} /> },
        ]}
      />

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
                <Select disabled={Boolean(formDrawer?.detail)} options={isGroupAdmin ? [{ value: 'group', label: '集团标准' }, { value: 'company', label: '子公司本地' }] : [{ value: 'company', label: '子公司本地' }]} />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="ownerId" label="归属公司" rules={[{ required: true }]}>
                <Select disabled={Boolean(formDrawer?.detail)} options={[{ value: 'group', label: '集团总部' }, ...org.companies.filter((item) => !item.isGroup).map((item) => ({ value: item.id, label: item.name }))]} />
              </Form.Item>
            </Col>
          </Row>
          <Alert
            type="info"
            showIcon
            message="表单结构以 JSON 编辑，适合首版联调"
            description="字段定义遵循 FormVersionSchema：mainFields / subForms / conditionRules。发布后版本永久只读，后续修改会生成新版本。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item name="schemaText" label="表单结构" rules={[{ required: true }]}>
            <Input.TextArea className="schema-editor" rows={22} spellCheck={false} />
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
          <Row gutter={12}>
            <Col span={10}><Form.Item name="ownerType" label="归属"><Select options={isGroupAdmin ? [{ value: 'group', label: '集团标准' }, { value: 'company', label: '子公司本地' }] : [{ value: 'company', label: '子公司本地' }]} /></Form.Item></Col>
            <Col span={14}><Form.Item name="ownerId" label="归属公司"><Select options={[{ value: 'group', label: '集团总部' }, ...org.companies.filter((item) => !item.isGroup).map((item) => ({ value: item.id, label: item.name }))]} /></Form.Item></Col>
          </Row>
          <Form.Item name="formTemplateId" label="已发布表单" rules={[{ required: true }]}>
            <Select options={forms.filter((item) => item.versions.some((version) => version.status === 'published')).map((item) => ({ value: item.id, label: `${item.name} · ${ownerName.get(item.ownerId)}` }))} />
          </Form.Item>
          <Divider orientation="left">交接班式作业配置</Divider>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="siteId" label="实际作业基地" rules={[{ required: true }]}><Select options={org.bases.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="workAreaId" label="工区"><Select allowClear options={org.workAreas.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="productionLineId" label="产线"><Select allowClear options={org.productionLines.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="crewId" label="班组"><Select allowClear options={org.crews.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="shiftTemplateId" label="班次模板"><Select allowClear options={[{ value: 'shift_qd_day', label: '青岛白班' }, { value: 'shift_qd_night', label: '青岛夜班' }, { value: 'shift_dz_day', label: '德州白班' }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="generationMode" label="生成方式"><Select options={[{ value: 'schedule', label: '按排班生成' }, { value: 'manual', label: '手工创建' }, { value: 'api', label: '接口生成' }]} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="timeWindowStart" label="允许提前"><Input placeholder="07:30" /></Form.Item></Col>
            <Col span={8}><Form.Item name="timeWindowEnd" label="允许延后"><Input placeholder="20:30" /></Form.Item></Col>
            <Col span={8}><Form.Item name="handoverRequired" label="要求交接" valuePropName="checked"><Switch /></Form.Item></Col>
          </Row>
          <Form.Item name="assignmentMode" label="人员匹配"><Select options={[{ value: 'roster_first', label: '排班优先' }, { value: 'qualification', label: '资格优先' }, { value: 'manual', label: '人工指派' }]} /></Form.Item>
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
  types,
  ownerName,
  canCreate,
  onCreate,
}: {
  types: TicketType[]
  ownerName: Map<string, string>
  canCreate: boolean
  onCreate: () => void
}) {
  return (
    <Card className="surface-card" title="工单类型" extra={canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>新增类型</Button>}>
      <Table
        rowKey="id"
        dataSource={types}
        pagination={{ pageSize: 12 }}
        columns={[
          { title: '编码', dataIndex: 'code', width: 160 },
          { title: '类型', dataIndex: 'name', render: (value, row) => <Space direction="vertical" size={0}><b>{value}</b><small>{ownerName.get(row.ownerId) || row.ownerId}</small></Space> },
          { title: '来源', dataIndex: 'origin', render: (value: string) => value === 'group_standard' ? <Tag color="gold" icon={<LockOutlined />}>集团标准</Tag> : <Tag color="blue">子公司本地</Tag> },
          { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === 'published' ? 'green' : value === 'draft' ? 'blue' : 'default'}>{statusLabel[value] || value}</Tag> },
          { title: '修订', dataIndex: 'revision', width: 80 },
        ]}
      />
    </Card>
  )
}

function ProfilesPanel({ types, ownerName }: { types: TicketType[]; ownerName: Map<string, string> }) {
  return (
    <Card className="surface-card" title="按作业位置生成工单">
      <Alert
        type="info"
        showIcon
        icon={<ThunderboltOutlined />}
        message="参照交接班表组织作业"
        description="配置按实际作业基地、工区、产线、班组和班次生成工单；允许提前/延后时间窗口，可要求交接确认。没有匹配人员的工单进入待指派。"
        style={{ marginBottom: 18 }}
      />
      <Timeline
        items={types.map((type) => ({
          color: type.status === 'published' ? 'green' : 'blue',
          children: (
            <Space direction="vertical">
              <b>{type.name}</b>
              <small>{ownerName.get(type.ownerId) || type.ownerId} · {type.code}</small>
            </Space>
          ),
        }))}
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
    try {
      const result = await api.upload<ExcelPreview>('/excel/imports/preview', body)
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
            <Form form={commitForm} layout="vertical" initialValues={{ ownerType: isGroupAdmin ? 'group' : 'company', ownerId: isGroupAdmin ? 'group' : companies.find((item) => !item.isGroup)?.id }}>
              <Form.Item name="templateName" label="表单名称" rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="templateCode" label="模板编码" rules={[{ required: true }, { pattern: /^[A-Za-z][A-Za-z0-9_-]*$/, message: '以字母开头，仅字母数字下划线短横线' }]}><Input /></Form.Item>
              <Row gutter={12}>
                <Col span={10}><Form.Item name="ownerType" label="归属"><Select options={isGroupAdmin ? [{ value: 'group', label: '集团标准' }, { value: 'company', label: '子公司本地' }] : [{ value: 'company', label: '子公司本地' }]} /></Form.Item></Col>
                <Col span={14}><Form.Item name="ownerId" label="公司"><Select options={[{ value: 'group', label: '集团总部' }, ...companies.filter((item) => !item.isGroup).map((item) => ({ value: item.id, label: item.name }))]} /></Form.Item></Col>
              </Row>
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
