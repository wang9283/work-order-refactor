import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  ThunderboltOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
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
  Segmented,
  Select,
  Space,
  TreeSelect,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd'
import type {
  BusinessCatalogItem,
  BusinessPriceRuleVersion,
  HandoverShiftProfile,
  Material,
  OrgReferenceData,
  PayrollAccrual,
  PayrollConfirmCandidate,
  PayrollPeriod,
  PriceRuleVersion,
  Ticket,
  TicketBusinessWorkItem,
  TicketCatalog,
  TicketCatalogItem,
  TicketStatus,
} from '@contracts/index'
import dayjs, { type Dayjs } from 'dayjs'
import { api, errorMessage } from '@next/shared/api'
import { useAuth } from '@next/shared/auth'
import { labelOf } from '@next/shared/defaults'
import { formatDateTime } from '@next/shared/format'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'
import { DynamicField } from '@next/shared/form-render'
import BusinessPricesPanel from '@next/features/business/BusinessPricesPanel'
import { operationsApi } from '@next/shared/operations-api'
import type { OperationsTicket } from '@contracts/operations'
import SanitationDetail from '@next/shared/SanitationDetail'
import { useAntFormUnsavedChanges } from '@next/shared/unsaved-changes'

type Section = 'tickets' | 'prices' | 'payroll'

const sectionHash: Record<Section, string> = {
  tickets: '#/tickets',
  prices: '#/prices',
  payroll: '#/payroll',
}

interface TicketPage extends Array<Ticket> {
  counts?: Record<string, number>
}

interface Candidate {
  person: {
    id: string
    employeeCode: string
    name: string
    homeCompanyId: string
    homeBaseId: string
  }
  crewId: string | null
  crewName: string
  source: 'roster' | 'secondment' | 'manual'
  isCrewMember?: boolean
  role: 'lead' | 'member'
}

interface PriceForm {
  ticketTypeId: string
  siteId: string
  unit: string
  unitPrice: number
  effectiveFrom: Dayjs
  effectiveTo?: Dayjs
}

interface PayrollSummary {
  period: PayrollPeriod
  pendingPricing: Array<{ id: string; ticketNo: string; workDate: string; siteName: string }>
  companies: Array<{
    payrollCompanyId: string | null
    companyName: string
    personCount: number
    ticketCount: number
    amountMicros: number
    unconfirmedCount: number
    items: PayrollAccrual[]
  }>
}

interface EmployeeOption {
  id: string
  employeeCode: string
  name: string
}

interface TicketListFilters {
  statusGroup: 'all' | 'todo' | 'doing' | 'waiting' | 'done'
  status?: TicketStatus
  q?: string
  ticketCategoryId?: string
  ticketTypeId?: string
  workDateFrom?: string
  workDateTo?: string
  materialId?: string
  materialTypeId?: string
  productionPostId?: string
  productionLineId?: string
  loadingTypeId?: string
  plateNumber?: string
  personId?: string
  crewId?: string
  shiftTemplateId?: string
  source?: 'self' | 'demo_sync' | 'legacy'
}

const statusColor: Record<string, string> = {
  pending_assignment: 'orange',
  pending_start: 'gold',
  in_progress: 'processing',
  pending_data: 'cyan',
  overdue: 'red',
  completed: 'purple',
  closed: 'green',
  cancelled: 'default',
}

function money(micros: number | null | undefined): string {
  return `¥${((micros || 0) / 1_000_000).toFixed(2)}`
}

function monthText(value: Dayjs): string {
  return value.format('YYYY-MM')
}

// Display-only examples for the demo; these are not upstream field definitions.
const productionPostDemoFields: Record<string, Array<{ label: string; value: string }>> = {
  投料: [{ label: '投料口', value: '1 号投料口' }, { label: '原料批次', value: 'YL-20261106-01' }],
  小料配料: [{ label: '配料批次', value: 'PL-20261106-01' }, { label: '配料仓', value: '小料仓 A' }],
  中控: [{ label: '配方编号', value: 'PF-20261106-01' }, { label: '生产批次', value: 'PC-20261106-01' }],
  制粒: [{ label: '制粒机', value: '1 号制粒机' }, { label: '环模规格', value: 'Φ4.5 mm' }],
  接料: [{ label: '成品仓', value: '1 号成品仓' }, { label: '接料批次', value: 'JL-20261106-01' }],
  码盘: [{ label: '托盘类型', value: '标准托盘' }, { label: '码盘层数', value: '8 层' }],
  转运: [{ label: '起点仓位', value: '1 号成品仓' }, { label: '终点仓位', value: '发货暂存区' }],
  '膨化/舒化': [{ label: '膨化机', value: '1 号膨化机' }, { label: '生产批次', value: 'PH-20261106-01' }],
  打包: [{ label: '包装规格', value: '40 kg/袋' }, { label: '包装批次', value: 'BZ-20261106-01' }],
}

function ProductionPostDemoFields({ item }: { item: TicketBusinessWorkItem }) {
  const fields = productionPostDemoFields[item.name] || []
  if (!fields.length) return null
  return <Form layout="vertical" aria-label={`${item.name}岗位演示字段`} style={{ marginTop: 8 }}>
    <Typography.Text type="secondary">岗位演示字段 · 灰色只读</Typography.Text>
    <Row gutter={12}>
      {fields.map(field => <Col xs={24} sm={12} key={field.label}>
        <Form.Item label={field.label} style={{ marginTop: 8, marginBottom: 0 }}>
          <Input disabled value={field.value} aria-label={`${item.name}${field.label}`} />
        </Form.Item>
      </Col>)}
    </Row>
  </Form>
}

type LocationOption = { value: string; title: string; children?: LocationOption[] }
function locationOptions(areas: OrgReferenceData['workAreas'], parentId: string | null = null): LocationOption[] {
  return areas.filter(a=>a.parentId===parentId).map(a=>{const children=locationOptions(areas,a.id);return {value:a.id,title:a.name,children:children.length?children:undefined}})
}

function ticketPricingStatus(ticket: Ticket): 'pending' | 'confirmed' {
  if (ticket.businessKind === 'generic') return ticket.pricing?.status || 'pending'
  return ticket.businessWorkItems.length > 0 && ticket.businessWorkItems.every((item) => item.priceStatus === 'confirmed')
    ? 'confirmed' : 'pending'
}

export default function ExecutionWorkspace({ initialSection = 'tickets' }: { initialSection?: Section }) {
  const { user, activeBase } = useAuth()
  const { message } = App.useApp()
  const [section, setSection] = useState<Section>(initialSection)
  const [priceCategory, setPriceCategory] = useState<'production' | 'loading' | 'generic'>('production')
  const [org, setOrg] = useState<OrgReferenceData | null>(null)
  const [ticketTypes, setTicketTypes] = useState<TicketCatalogItem[]>([])
  const [ticketCatalog, setTicketCatalog] = useState<TicketCatalog | null>(null)
  const [businessCatalog, setBusinessCatalog] = useState<BusinessCatalogItem[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [operationsTickets, setOperationsTickets] = useState<OperationsTicket[]>([])
  const [selectedOperations, setSelectedOperations] = useState<OperationsTicket | null>(null)
  const [prices, setPrices] = useState<PriceRuleVersion[]>([])
  const [businessPriceRules, setBusinessPriceRules] = useState<BusinessPriceRuleVersion[]>([])
  const [payroll, setPayroll] = useState<PayrollSummary | null>(null)
  const [payrollCandidates, setPayrollCandidates] = useState<PayrollConfirmCandidate[]>([])
  const [people, setPeople] = useState<EmployeeOption[]>([])
  const [handoverProfiles, setHandoverProfiles] = useState<HandoverShiftProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [ticketFilters, setTicketFilters] = useState<TicketListFilters>({ statusGroup: 'all' })
  const [ticketDrawer, setTicketDrawer] = useState(false)
  const [priceDrawer, setPriceDrawer] = useState(false)
  const [payrollDrawer, setPayrollDrawer] = useState(false)
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [assignments, setAssignments] = useState<string[]>([])
  const [assigning, setAssigning] = useState(false)
  const [businessItemEdit, setBusinessItemEdit] = useState<TicketBusinessWorkItem | null>(null)
  const [businessSharePeople, setBusinessSharePeople] = useState<string[]>([])
  const [businessShares, setBusinessShares] = useState<Record<string, number>>({})
  const [businessPriceVersionId, setBusinessPriceVersionId] = useState<string>()
  const [businessPriceReason, setBusinessPriceReason] = useState('')
  const [businessEditMode, setBusinessEditMode] = useState<'assign' | 'price' | null>(null)
  const [ticketForm] = Form.useForm()
  const ticketFactoryId = Form.useWatch('factoryId', ticketForm)
  const ticketSiteId = Form.useWatch('siteId', ticketForm)
  const candidateRequest = useRef(0)
  const pendingTicketId = useRef<string | null>(new URLSearchParams(
    window.location.hash.includes('?')
      ? window.location.hash.slice(window.location.hash.indexOf('?') + 1)
      : '',
  ).get('ticketId'))
  const openDetailRef = useRef<(ticket: Ticket) => Promise<void>>(async () => {})
  const focusPendingRef = useRef<() => void>(() => {})
  const [priceForm] = Form.useForm<PriceForm>()
  const [ticketPriceForm] = Form.useForm<{ method: 'quantity_unit' | 'lump_sum'; unit?: string; unitPrice?: number; lumpSum?: number; reason: string }>()
  const ticketPricingMethod = Form.useWatch('method', ticketPriceForm)
  const [payrollForm] = Form.useForm<{
    payrollCompanyId: string
    personIds: string[]
  }>()
  const [workMonth, setWorkMonth] = useState<Dayjs>(dayjs())

  useAntFormUnsavedChanges(ticketForm, ticketDrawer, '新工单')
  useAntFormUnsavedChanges(priceForm, priceDrawer, '计价标准')
  useAntFormUnsavedChanges(ticketPriceForm, businessEditMode === 'price', '工单价格调整')
  useAntFormUnsavedChanges(payrollForm, payrollDrawer, '月底发放公司')

  const baseName = useMemo(
    () => new Map((org?.bases || []).map((item) => [item.id, item.name])),
    [org],
  )
  const factoryName = useMemo(
    () => new Map((org?.factories || []).map((item) => [item.id, item.name])),
    [org],
  )
  const crewName = useMemo(
    () => new Map((org?.crews || []).map((item) => [item.id, item.name])),
    [org],
  )
  const shiftName = useMemo(
    () => new Map((org?.shiftTemplates || []).map((item) => [item.id, item.name])),
    [org],
  )
  const handoverName = useMemo(
    () => new Map(handoverProfiles.map((item) => [item.id, item.name])),
    [handoverProfiles],
  )
  const typeName = useMemo(
    () => new Map(ticketTypes.map((item) => [item.id, item.name])),
    [ticketTypes],
  )
  const companyName = useMemo(
    () => new Map((org?.companies || []).map((item) => [item.id, item.name])),
    [org],
  )
  const personName = useMemo(
    () => new Map(people.map((person) => [person.id, `${person.name} · ${person.employeeCode}`])),
    [people],
  )
  const canCreate = Boolean(user?.grants.some((grant) => grant.capability === 'ticket.create'))
  const canAssign = Boolean(user?.grants.some((grant) => grant.capability === 'ticket.assign'))
  const canReview = Boolean(user?.grants.some((grant) => grant.capability === 'ticket.review'))
  const canPrice = Boolean(user?.grants.some((grant) => grant.capability === 'price.manage'))
  const canPayroll = Boolean(user?.grants.some((grant) => grant.capability === 'payroll.view'))
  const canConfirmPayroll = Boolean(user?.grants.some(
    (grant) => grant.capability === 'ticket.assign' || grant.capability === 'payroll.close',
  ))
  const canClose = Boolean(user?.grants.some(
    (grant) => grant.capability === 'payroll.close' && grant.type === 'group',
  ))
  const permissionAt = (
    capability: 'ticket.view' | 'ticket.create' | 'ticket.assign' | 'ticket.review',
    type: 'base' | 'factory',
    id: string,
  ) =>
    Boolean(user?.grants.some((grant) =>
      grant.capability === capability
      && (grant.type === 'group' || (grant.type === type && grant.id === id))
    ))

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [orgData, catalogData, ticketPage, pricePage, summary, payrollCandidateData, peoplePage, profileData, businessCatalogData, materialData, operationsData] = await Promise.all([
        api.get<OrgReferenceData>('/org/tree'),
        api.get<TicketCatalog>('/ticket-catalog'),
        api.getPage<Ticket>('/tickets', {
          pageSize: 200,
          ...ticketFilters,
        }),
        section === 'prices' ? api.getPage<PriceRuleVersion>('/prices', { pageSize: 200 }) : Promise.resolve({ items: [] as PriceRuleVersion[] }),
        section === 'payroll' ? api.get<PayrollSummary>(`/payroll/summary?workMonth=${monthText(workMonth)}`) : Promise.resolve(null),
        section === 'payroll' ? api.get<PayrollConfirmCandidate[]>(`/payroll/confirm-candidates?workMonth=${monthText(workMonth)}`) : Promise.resolve([]),
        api.getPage<EmployeeOption>('/org/people', { pageSize: 200 }),
        api.get<HandoverShiftProfile[]>('/handover-profiles'),
        api.get<BusinessCatalogItem[]>('/business-catalogs'),
        api.get<Material[]>('/materials'),
        operationsApi.workloads({ scope: 'managed' }),
      ])
      setOrg(orgData)
      setTicketCatalog(catalogData)
      setTicketTypes(catalogData.types)
      setTickets(ticketPage.items)
      setPrices(pricePage.items)
      setPayroll(summary)
      setPayrollCandidates(payrollCandidateData)
      setPeople(peoplePage.items)
      setHandoverProfiles(profileData)
      setBusinessCatalog(businessCatalogData)
      setMaterials(materialData)
      setOperationsTickets(operationsData.tickets)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [section, workMonth, ticketFilters])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    setSection(initialSection)
  }, [initialSection])

  useEffect(() => {
    const rememberFocus = (event: Event) => {
      pendingTicketId.current = (event as CustomEvent<string>).detail
      focusPendingRef.current()
    }
    window.addEventListener('operations-ticket-focus', rememberFocus)
    return () => window.removeEventListener('operations-ticket-focus', rememberFocus)
  }, [])

  const loadCandidates = async (values: {
    siteId?: string
    factoryId?: string
    crewId?: string
    workAreaId?: string
    productionLineId?: string
    workDate?: Dayjs
    eventTime?: Dayjs
  }) => {
    const requestId = ++candidateRequest.current
    if (!values.siteId || !values.factoryId || !values.workDate) {
      setCandidates([])
      return
    }
    try {
      const selectedLine = values.productionLineId
        ? org?.productionLines.find((line) => line.id === values.productionLineId)
        : undefined
      const resolvedWorkAreaId = values.workAreaId || selectedLine?.workAreaId
      if (!values.workAreaId && selectedLine?.workAreaId) {
        ticketForm.setFieldValue('workAreaId', selectedLine.workAreaId)
      }
      const query = new URLSearchParams({
        siteId: values.siteId,
        workDate: values.workDate.format('YYYY-MM-DD'),
        eventTime: (values.eventTime || values.workDate).toISOString(),
      })
      if (values.factoryId) query.set('factoryId', values.factoryId)
      if (values.crewId) query.set('crewId', values.crewId)
      if (resolvedWorkAreaId) query.set('workAreaId', resolvedWorkAreaId)
      if (values.productionLineId) query.set('productionLineId', values.productionLineId)
      const next = await api.get<Candidate[]>(`/tickets/candidates?${query.toString()}`)
      if (requestId !== candidateRequest.current) return
      setCandidates(next)
      ticketForm.setFieldsValue({ assignments: values.crewId ? next.filter((candidate) => candidate.isCrewMember).map((candidate) => candidate.person.id) : [] })
    } catch (reason) {
      message.error(errorMessage(reason))
      setCandidates([])
    }
  }

  const createTicket = async () => {
    const values = await ticketForm.validateFields()
    const clientRequestId = `ui-${crypto.randomUUID()}`
    try {
      await api.post('/tickets', {
        ticketTypeId: values.ticketTypeId,
        businessKind: 'generic',
        materialId: null,
        materialTypeId: null,
        businessItems: [],
        siteId: values.siteId,
        factoryId: values.factoryId || null,
        workAreaId: values.workAreaId || null,
        productionLineId: values.productionLineId || null,
        crewId: values.crewId || null,
        shiftTemplateId: values.shiftTemplateId || null,
        handoverShiftProfileId: values.handoverShiftProfileId || null,
        eventTime: values.eventTime.toISOString(),
        workDate: values.workDate.format('YYYY-MM-DD'),
        assignments: (values.assignments || []).map((personId: string) => ({
          personId,
          role: candidates.find((candidate) => candidate.person.id === personId)?.role || 'member',
        })),
        quantity: values.quantity ?? null,
        clientRequestId,
      })
      message.success('工单已创建')
      setTicketDrawer(false)
      ticketForm.resetFields()
      setCandidates([])
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const openDetail = async (ticket: Ticket) => {
    try {
      const detail = await api.get<Ticket>(`/tickets/${ticket.id}`)
      setSelected(detail)
      setSelectedOperations(await operationsApi.ticket(ticket.id).catch(() => null))
      setBusinessPriceRules(detail.businessKind === 'generic' ? [] : await api.get<BusinessPriceRuleVersion[]>(`/business-prices?siteId=${encodeURIComponent(detail.siteId)}`))
      ticketPriceForm.setFieldsValue({
        method: detail.pricing?.method || 'quantity_unit', unit: detail.pricing?.unit || '',
        unitPrice: detail.pricing?.unitPriceMicros == null ? undefined : detail.pricing.unitPriceMicros / 1_000_000,
        lumpSum: detail.pricing?.lumpSumCents == null ? undefined : detail.pricing.lumpSumCents / 100, reason: '',
      })
      setAssignments(detail.assignments.map((item) => item.personId))
      if (canAssign && ['pending_assignment', 'pending_start'].includes(detail.status)) {
        const query = new URLSearchParams({
          siteId: detail.siteId,
          workDate: detail.workDate,
          eventTime: detail.eventTime,
        })
        if (detail.factoryId) query.set('factoryId', detail.factoryId)
        if (detail.crewId) query.set('crewId', detail.crewId)
        setCandidates(await api.get<Candidate[]>(`/tickets/candidates?${query.toString()}`))
      } else {
        setCandidates([])
      }
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }
  openDetailRef.current = openDetail
  const focusPending = useCallback(() => {
    const ticketId = pendingTicketId.current
    if (!ticketId) return
    const row = tickets.find(ticket => ticket.id === ticketId)
    if (!row) return
    pendingTicketId.current = null
    void openDetailRef.current(row)
  }, [tickets])
  focusPendingRef.current = focusPending
  useEffect(() => { if (!loading) focusPending() }, [loading, focusPending])

  const openBusinessAssignmentEditor = (item: TicketBusinessWorkItem) => {
    setBusinessItemEdit(item)
    setBusinessEditMode('assign')
    setBusinessSharePeople(item.assignments.map((assignment) => assignment.personId))
    setBusinessShares(Object.fromEntries(item.assignments.map((assignment) => [assignment.personId, assignment.shareBasisPoints / 100])))
  }

  const saveBusinessAssignments = async () => {
    if (!selected || !businessItemEdit) return
    if (businessSharePeople.some((personId) => !Number.isFinite(businessShares[personId]))) {
      message.warning('请为每位人员填写贡献比例')
      return
    }
    setAssigning(true)
    try {
      const updated = await api.put<Ticket>(`/tickets/${selected.id}/business-work-items/${businessItemEdit.id}/assignments`, {
        revision: selected.revision,
        assignments: businessSharePeople.map((personId) => ({
          personId,
          role: candidates.find((candidate) => candidate.person.id === personId)?.role
            || selected.assignments.find((assignment) => assignment.personId === personId)?.role || 'member',
          shareBasisPoints: Math.round((businessShares[personId] ?? 0) * 100),
        })),
      })
      setSelected(updated)
      setBusinessEditMode(null)
      setBusinessItemEdit(null)
      message.success('岗位人员与贡献比例已保存')
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    } finally {
      setAssigning(false)
    }
  }

  const saveBusinessPrice = async () => {
    if (!selected || !businessItemEdit || !businessPriceVersionId) return
    if (!businessPriceReason.trim()) {
      message.warning('请填写改价原因')
      return
    }
    setAssigning(true)
    try {
      const updated = await api.put<Ticket>(`/tickets/${selected.id}/business-work-items/${businessItemEdit.id}/pricing`, {
        revision: selected.revision, priceRuleVersionId: businessPriceVersionId, reason: businessPriceReason.trim(),
      })
      setSelected(updated)
      setBusinessEditMode(null)
      setBusinessItemEdit(null)
      setBusinessPriceReason('')
      message.success('岗位价格已更新')
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    } finally {
      setAssigning(false)
    }
  }

  const saveAssignments = async () => {
    if (!selected) return
    if (!assignments.length) {
      message.warning('至少选择一名执行人员')
      return
    }
    setAssigning(true)
    try {
      const updated = await api.put<Ticket>(`/tickets/${selected.id}/assignments`, {
        assignments: assignments.map((personId) => ({
          personId,
          role: candidates.find((candidate) => candidate.person.id === personId)?.role || 'member',
        })),
        revision: selected.revision,
      })
      setSelected(updated)
      message.success('执行人员已更新')
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    } finally {
      setAssigning(false)
    }
  }

  const approve = async (ticket: Ticket) => {
    try {
      await api.post(`/tickets/${ticket.id}/approve`, {
        revision: ticket.revision,
        note: 'PC 审核通过',
      })
      message.success(ticketPricingStatus(ticket) === 'confirmed' ? '审核通过，已生成核算记录' : '审核通过，工单待定价')
      setSelected(null)
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const cancel = async (ticket: Ticket) => {
    try {
      await api.post(`/tickets/${ticket.id}/cancel`, {
        revision: ticket.revision,
        note: 'PC 取消工单',
      })
      message.success('工单已取消')
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const savePrice = async () => {
    const values = await priceForm.validateFields()
    try {
      await api.post('/prices', {
        ticketTypeId: values.ticketTypeId,
        siteId: values.siteId,
        unit: values.unit,
        unitPriceMicros: Math.round(values.unitPrice * 1_000_000),
        effectiveFrom: values.effectiveFrom.toISOString(),
        effectiveTo: values.effectiveTo?.toISOString() || null,
      })
      message.success('计价标准已发布')
      setPriceDrawer(false)
      priceForm.resetFields()
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const saveTicketPricing = async () => {
    if (!selected) return
    try {
      const values = await ticketPriceForm.validateFields()
      const pricing = values.method === 'lump_sum'
        ? { method: 'lump_sum', lumpSumCents: Math.round(values.lumpSum! * 100) }
        : { method: 'quantity_unit', unit: values.unit, unitPriceMicros: Math.round(values.unitPrice! * 1_000_000) }
      const updated = await api.put<Ticket>(`/tickets/${selected.id}/pricing`, {
        revision: selected.revision, reason: values.reason, ...pricing,
      })
      setSelected(updated)
      ticketPriceForm.setFieldValue('reason', '')
      message.success('本单计价已确认')
      await load()
    } catch (reason) {
      if (reason instanceof Error) message.error(errorMessage(reason))
    }
  }

  const closeMonth = async () => {
    if (!payroll) return
    try {
      await api.post('/payroll/close', {
        workMonth: payroll.period.workMonth,
        revision: payroll.period.revision || 1,
        replaceAccruals: [],
        additionalAccruals: [],
      })
      message.success('本月已关账锁定')
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  const confirmPayrollCompany = async () => {
    if (!payroll) return
    const values = await payrollForm.validateFields()
    try {
      await api.post('/payroll/confirm-company', {
        workMonth: payroll.period.workMonth,
        personIds: values.personIds,
        payrollCompanyId: values.payrollCompanyId,
      })
      message.success('月底发放公司已确认')
      setPayrollDrawer(false)
      payrollForm.resetFields()
      await load()
    } catch (reason) {
      message.error(errorMessage(reason))
    }
  }

  if (loading) return <LoadingBlock rows={8} />
  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />
  if (!org) return null

  return (
    <div>
      <PageHeader
        title={section === 'prices' ? '预计单价' : section === 'payroll' ? '历史月度核算' : '工单管理'}
        description={section === 'tickets' ? '查看生产、装卸与其他工单的来源、状态及实际作业记录。' : '历史兼容功能。日常工作量请到工作量管理。'}
        actions={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>}
      />
      {section === 'tickets' && (
        <TicketsPanel
          tickets={tickets}
          operationTickets={operationsTickets}
          catalog={ticketCatalog}
          filters={ticketFilters}
          onFiltersChange={setTicketFilters}
          materials={materials}
          businessCatalog={businessCatalog}
          org={org}
          people={people}
          baseName={baseName}
          factoryName={factoryName}
          crewName={crewName}
          shiftName={shiftName}
          typeName={typeName}
          canCreate={canCreate}
          onCreate={() => {
            ticketForm.resetFields()
            ticketForm.setFieldsValue({
              businessKind: 'generic',
              siteId: activeBase?.id,
              workDate: dayjs(),
              eventTime: dayjs(),
              assignments: [],
            })
            setCandidates([])
            setTicketDrawer(true)
          }}
          onOpen={openDetail}
          onCancel={cancel}
        />
      )}
      {section === 'prices' && <>
        <Tabs activeKey={priceCategory} onChange={(value) => setPriceCategory(value as typeof priceCategory)} items={[
          { key: 'production', label: '生产' }, { key: 'loading', label: '装卸' }, { key: 'generic', label: '其他工单' },
        ]} />
        {priceCategory !== 'generic' ? <BusinessPricesPanel key={priceCategory} businessKind={priceCategory} /> : <PricesPanel
          prices={prices}
          baseName={baseName}
          typeName={typeName}
          canCreate={canPrice}
          onCreate={() => {
            priceForm.resetFields()
            priceForm.setFieldsValue({
              siteId: activeBase?.id,
              unit: '件',
              effectiveFrom: dayjs().startOf('day'),
            })
            setPriceDrawer(true)
          }}
        />}
      </>}
      {section === 'payroll' && (
        <PayrollPanel
          summary={payroll}
          month={workMonth}
          canView={canPayroll}
          canClose={canClose}
          canConfirm={canConfirmPayroll}
          confirmCandidates={payrollCandidates}
          companyName={companyName}
          baseName={baseName}
          personName={personName}
          onMonthChange={setWorkMonth}
          onClose={closeMonth}
          onConfirm={() => {
            const candidateIds = payrollCandidates
              .filter((candidate) => !candidate.payrollCompanyId)
              .map((candidate) => candidate.personId)
            const accrualIds = payroll?.companies.flatMap((group) => group.items)
              .filter((item) => !item.payrollCompanyId)
              .map((item) => item.personId) || []
            payrollForm.resetFields()
            payrollForm.setFieldsValue({
              personIds: [...new Set([...candidateIds, ...accrualIds])],
              payrollCompanyId: org.companies.find((company) => company.payrollEnabled && !company.isGroup)?.id,
            })
            setPayrollDrawer(true)
          }}
        />
      )}

      <Drawer
        width={580}
        open={ticketDrawer}
        onClose={() => setTicketDrawer(false)}
        title="创建工单"
        extra={<Button type="primary" onClick={() => void createTicket()}>创建</Button>}
      >
        <Form
          form={ticketForm}
          layout="vertical"
          onValuesChange={(_, values) => {
            if ('siteId' in _) {
              ticketForm.setFieldsValue({
                factoryId: undefined,
                handoverShiftProfileId: undefined,
                crewId: undefined,
                shiftTemplateId: undefined,
                workAreaId: undefined,
                productionLineId: undefined,
              })
            }
            if ('factoryId' in _) {
              ticketForm.setFieldsValue({
                handoverShiftProfileId: undefined,
                crewId: undefined,
                shiftTemplateId: undefined,
                workAreaId: undefined,
                productionLineId: undefined,
              })
            }
            if ('siteId' in _ || 'workDate' in _ || 'eventTime' in _ || 'factoryId' in _ || 'crewId' in _ || 'workAreaId' in _ || 'productionLineId' in _) {
              void loadCandidates(ticketForm.getFieldsValue())
            }
          }}
        >
          <Form.Item name="ticketTypeId" label="工单类型" rules={[{ required: true }]}>
            <Select options={ticketTypes.filter((item) => item.status === 'published' && !item.systemManaged && !item.sanitationKind).map((item) => ({
              value: item.id,
              label: `${item.name} · ${item.ownerType === 'group' ? '饲料总部标准' : '公司本地'}`,
            }))} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="siteId" label="实际作业基地" rules={[{ required: true }]}><Select disabled options={org.bases.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="workDate" label="作业日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Form.Item name="factoryId" label="作业组织" rules={[{ required: true }]}>
            <Select
              options={org.factories
                .filter((factory) => permissionAt('ticket.create', 'factory', factory.id) || permissionAt('ticket.create', 'base', factory.baseId))
                .filter((factory) => !ticketSiteId || factory.baseId === ticketSiteId)
                .map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="crewId" label="生产班" rules={[{ required: true }]}>
                <Select
                  options={org.crews
                    .filter((crew) => crew.factoryId === ticketFactoryId)
                    .map((item) => ({ value: item.id, label: item.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="shiftTemplateId" label="班次">
                <Select allowClear options={org.shiftTemplates.filter((shift) => !ticketSiteId || shift.baseId === ticketSiteId).map((item) => ({ value: item.id, label: `${item.name} ${item.startTime}-${item.endTime}` }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="workAreaId" label="作业位置（可选）"><TreeSelect allowClear showSearch treeNodeFilterProp="title" treeData={locationOptions(org.workAreas.filter((area) => area.factoryId === ticketFactoryId && area.status === 'active'))} /></Form.Item>
          <Form.Item name="eventTime" label="计划开始" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="quantity" label="每人计划数量"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="assignments" label="执行人员">
            <Select
              mode="multiple"
              placeholder="先选择基地和日期，再从有效班组/借调范围选择"
              options={candidates.map((candidate) => ({
                value: candidate.person.id,
                label: `${candidate.person.name} · ${candidate.crewName} · ${candidate.source === 'secondment' ? '借调' : candidate.source === 'manual' ? '临时参与' : '班组成员'}`,
              }))}
            />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="未选择人员也能创建"
            description="无匹配人员的工单进入待指派；没有默认价格时可先执行，之后补定价。"
          />
        </Form>
      </Drawer>

      <Drawer
        width={620}
        open={priceDrawer}
        onClose={() => setPriceDrawer(false)}
        title="发布计价标准"
        extra={<Button type="primary" onClick={() => void savePrice()}>发布</Button>}
      >
        <Form form={priceForm} layout="vertical">
          <Form.Item name="ticketTypeId" label="工单类型" rules={[{ required: true }]}>
            <Select options={ticketTypes.filter((item) => item.status === 'published').map((item) => ({ value: item.id, label: item.name }))} />
          </Form.Item>
          <Form.Item name="siteId" label="实际作业基地" rules={[{ required: true }]}>
            <Select disabled options={org.bases.map((item) => ({ value: item.id, label: item.name }))} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={10}><Form.Item name="unit" label="计量单位" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={14}><Form.Item name="unitPrice" label="单价（元）" rules={[{ required: true }]}><InputNumber min={0} precision={4} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="effectiveFrom" label="生效时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="effectiveTo" label="失效时间"><DatePicker showTime style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
        </Form>
      </Drawer>

      <Drawer
        width={520}
        open={payrollDrawer}
        onClose={() => setPayrollDrawer(false)}
        title="确认月底发放公司"
        extra={<Button type="primary" onClick={() => void confirmPayrollCompany()}>确认</Button>}
      >
        <Alert
          type="info"
          showIcon
          message="发放公司与实际作业基地分开保存"
          description="这里确认的是工资核算与发放主体；计件单价仍按人员实际作业基地当时冻结的价格版本计算。"
          style={{ marginBottom: 20 }}
        />
        <Form form={payrollForm} layout="vertical">
          <Form.Item name="payrollCompanyId" label="月底发放公司" rules={[{ required: true }]}>
            <Select options={org.companies.filter((company) => company.payrollEnabled && !company.isGroup).map((company) => ({
              value: company.id,
              label: company.name,
            }))} />
          </Form.Item>
          <Form.Item name="personIds" label="待确认人员" rules={[{ required: true, message: '请选择至少一名人员' }]}>
            <Select
              mode="multiple"
              options={[...new Set([
                ...payrollCandidates.map((candidate) => candidate.personId),
                ...(payroll?.companies.flatMap((group) => group.items).map((item) => item.personId) || []),
              ])].map((personId) => ({
                value: personId,
                label: personName.get(personId) || personId,
              }))}
            />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        width="min(720px, 100vw)"
        open={Boolean(selected)}
        onClose={() => {
          setSelected(null)
          setSelectedOperations(null)
          setCandidates([])
          setAssignments([])
        }}
        title={selected ? `${selected.ticketNo} · 工单详情` : ''}
        extra={selected && ['completed', 'closed'].includes(selected.status) && <Button type="primary" onClick={() => { window.location.hash = `#/workloads?ticketId=${encodeURIComponent(selected.id)}&date=${selected.workDate}` }}>查看工作量与分配</Button>}
      >
        {selected && (
          <>
            {selectedOperations?.sanitation && <SanitationDetail ticket={selectedOperations} />}
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="状态"><Tag color={statusColor[selected.status]}>{labelOf(selected.status)}</Tag></Descriptions.Item>
              <Descriptions.Item label="来源">{operationsTickets.find((ticket) => ticket.id === selected.id)?.source === 'demo_sync' ? '业务同步（演示）' : operationsTickets.find((ticket) => ticket.id === selected.id)?.source === 'self' ? '员工自建' : '手工 / 历史工单'}</Descriptions.Item>
              <Descriptions.Item label="整单实际总量">{selected.quantity ?? '待完工'}</Descriptions.Item>
              {selected.businessKind === 'production' && <Descriptions.Item label="产品">{selected.materialName || '—'}</Descriptions.Item>}
              {selected.businessKind === 'production' && <Descriptions.Item label="料类">{selected.materialTypeName || '—'}</Descriptions.Item>}
              <Descriptions.Item label="作业基地">{selected.siteName}</Descriptions.Item>
              <Descriptions.Item label="作业组织">{selected.factoryName || '—'}</Descriptions.Item>
              <Descriptions.Item label="生产班">{String(selected.siteSnapshot.crewName || (selected.crewId ? crewName.get(selected.crewId) || selected.crewId : '—'))}</Descriptions.Item>
              <Descriptions.Item label="班次">{String(selected.siteSnapshot.shiftName || (selected.shiftTemplateId ? shiftName.get(selected.shiftTemplateId) || selected.shiftTemplateId : '—'))}</Descriptions.Item>
              <Descriptions.Item label="作业位置">{String(selected.siteSnapshot.productionLineName || selected.siteSnapshot.workAreaName || '—')}</Descriptions.Item>

              <Descriptions.Item label={selected.businessKind === 'generic' ? '本单计价' : '岗位价格'}>{selected.businessKind === 'generic'
                ? selected.pricing?.status !== 'confirmed' ? <Tag color="orange">待定价</Tag> : selected.pricing.method === 'lump_sum' ? `总包 ${money((selected.pricing.lumpSumCents ?? 0) * 10000)}` : `${money(selected.pricing.unitPriceMicros)} / ${selected.pricing.unit}`
                : <Tag color={ticketPricingStatus(selected) === 'confirmed' ? 'green' : 'orange'}>{selected.businessWorkItems.filter((item) => item.priceStatus === 'confirmed').length}/{selected.businessWorkItems.length} 项已定价</Tag>}</Descriptions.Item>
              <Descriptions.Item label="预计金额">{selected.amountMicros == null ? '—' : money(selected.amountMicros)}</Descriptions.Item>
              <Descriptions.Item label="作业日期">{selected.workDate}</Descriptions.Item>
              <Descriptions.Item label="计划开始">{formatDateTime(selected.eventTime)}</Descriptions.Item>
              <Descriptions.Item label="类型版本">{String(selected.ticketTypeSnapshot.typeVersionNo || '—')}</Descriptions.Item>
              <Descriptions.Item label="表单版本">{String(selected.ticketTypeSnapshot.formVersionNo || '—')}</Descriptions.Item>
            </Descriptions>
            {selected.businessKind !== 'generic' && <>
              <Divider orientation="left">岗位作业明细</Divider>
              <Table<TicketBusinessWorkItem> rowKey="id" size="small" pagination={false} dataSource={selected.businessWorkItems} columns={[
                { title: '岗位 / 类型', dataIndex: 'name' },
                { title: '岗位数量', render: (_: unknown, item) => item.quantity == null ? '待提交' : `${item.quantity} ${item.unit}` },
                { title: '预计单价', render: (_: unknown, item) => item.priceStatus === 'confirmed' ? `${money(item.unitPriceMicros)} / ${item.unit}` : <Tag color="orange">待定价</Tag> },
                { title: '金额', render: (_: unknown, item) => item.amountMicros == null ? '—' : money(item.amountMicros) },
                { title: '执行人员与比例', render: (_: unknown, item) => item.assignments.map((assignment) => `${assignment.personName} ${assignment.shareBasisPoints / 100}%`).join('、') || <Tag color="orange">待指派</Tag> },
                { title: '操作', render: (_: unknown, item) => <Space>
                  {canAssign && ['pending_assignment', 'pending_start'].includes(selected.status) && <Button size="small" onClick={() => openBusinessAssignmentEditor(item)}>人员 / 比例</Button>}
                </Space> },
              ]} expandable={selected.businessKind === 'production' ? {
                defaultExpandAllRows: true,
                rowExpandable: item => Boolean(productionPostDemoFields[item.name]?.length),
                expandedRowRender: item => <ProductionPostDemoFields item={item} />,
              } : undefined} />
            </>}
            {selected.businessKind === 'generic' && canPrice && selected.status !== 'cancelled' && <>
              <Divider orientation="left">本单定价</Divider>
              <Form form={ticketPriceForm} layout="vertical" initialValues={{ method: 'quantity_unit' }}>
                <Form.Item name="method" label="计价方式" rules={[{ required: true }]}><Select options={[{ value: 'quantity_unit', label: '产量 × 单价' }, { value: 'lump_sum', label: '总包均分' }]} /></Form.Item>
                {ticketPricingMethod === 'lump_sum' ? <Form.Item name="lumpSum" label="总包金额（元）" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item> : <Row gutter={12}>
                  <Col span={10}><Form.Item name="unit" label="单位" rules={[{ required: true }]}><Input /></Form.Item></Col>
                  <Col span={14}><Form.Item name="unitPrice" label="单价（元）" rules={[{ required: true }]}><InputNumber min={0} precision={4} style={{ width: '100%' }} /></Form.Item></Col>
                </Row>}
                <Form.Item name="reason" label="定价原因" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
                <Button type="primary" onClick={() => void saveTicketPricing()}>确认本单计价</Button>
              </Form>
            </>}
            <Divider orientation="left">冻结表单数据</Divider>
            {Object.keys(selected.values).length ? (
              <Descriptions column={1} size="small" bordered>
                {selected.formSchema.mainFields.map((field) => (
                  <Descriptions.Item key={field.key} label={field.name}>
                    {Array.isArray(selected.values[field.key])
                      ? (selected.values[field.key] as unknown[]).join('、')
                      : String(selected.values[field.key] ?? '—')}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="执行端尚未提交数据" />}
            {selected.formSchema.subForms.map(sub=><div key={sub.key}>
              <Divider orientation="left">{sub.name}</Divider>
              <Table<Record<string,unknown>> size="small" pagination={false} rowKey={(_,index)=>String(index)} dataSource={selected.subFormValues[sub.key] || []} columns={sub.fields.map(field=>({title:field.name,dataIndex:field.key,render:(value:unknown)=>Array.isArray(value)?value.join('、'):String(value ?? '—')}))}/>
            </div>)}
            {selected.businessKind === 'generic' && <><Divider orientation="left">执行人员与分摊</Divider>
            {canAssign && ['pending_assignment', 'pending_start'].includes(selected.status) && (
              <Space direction="vertical" style={{ width: '100%', marginBottom: 14 }}>
                <Select
                  mode="multiple"
                  value={assignments}
                  onChange={setAssignments}
                  placeholder="从本基地有效班组或借调人员中选择"
                  options={candidates.map((candidate) => ({
                    value: candidate.person.id,
                    label: `${candidate.person.name} · ${candidate.crewName} · ${candidate.source === 'secondment' ? '借调' : candidate.source === 'manual' ? '临时参与' : '班组成员'}`,
                  }))}
                />
                <Button
                  type="primary"
                  loading={assigning}
                  onClick={() => void saveAssignments()}
                >
                  保存人员调整
                </Button>
              </Space>
            )}
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={selected.assignments}
              columns={[
                { title: '人员', dataIndex: 'personName' },
                { title: '来源', dataIndex: 'assignmentSource', render: (value: string) => value === 'secondment' ? <Tag color="gold">借调</Tag> : <Tag>{value === 'manual' ? '临时参与' : '班组成员'}</Tag> },
                { title: '计划量', dataIndex: 'plannedQuantity' },
                { title: '实际量', dataIndex: 'actualQuantity', render: (value: number | null) => value ?? '—' },
              ]}
            />
            </>}
          </>
        )}
      </Drawer>

      <Modal open={businessEditMode === 'assign'} title={businessItemEdit ? `岗位人员与贡献比例 · ${businessItemEdit.name}` : ''}
        confirmLoading={assigning} onCancel={() => { setBusinessEditMode(null); setBusinessItemEdit(null) }} onOk={() => void saveBusinessAssignments()}>
        <Alert type="info" showIcon message="每个岗位的贡献比例需合计100%；单人默认100%。" style={{ marginBottom: 16 }} />
        <Select mode="multiple" style={{ width: '100%', marginBottom: 16 }} value={businessSharePeople} onChange={(next: string[]) => {
          setBusinessSharePeople(next)
          setBusinessShares((previous) => Object.fromEntries(next.map((personId) => [personId,
            previous[personId] ?? (next.length === 1 ? 100 : 0)])))
        }} placeholder="选择本基地有效班组或借调人员" options={candidates.map((candidate) => ({
          value: candidate.person.id,
          label: `${candidate.person.name} · ${candidate.crewName} · ${candidate.source === 'secondment' ? '借调' : candidate.source === 'manual' ? '临时参与' : '班组成员'}`,
        }))} />
        {businessSharePeople.map((personId) => <Row key={personId} align="middle" gutter={12} style={{ marginBottom: 8 }}>
          <Col span={14}>{personName.get(personId) || candidates.find((candidate) => candidate.person.id === personId)?.person.name || personId}</Col>
          <Col span={10}><InputNumber min={0} max={100} precision={2} addonAfter="%" style={{ width: '100%' }} value={businessShares[personId]}
            onChange={(value) => setBusinessShares((previous) => ({ ...previous, [personId]: Number(value ?? 0) }))} /></Col>
        </Row>)}
      </Modal>
      <Modal open={businessEditMode === 'price'} title={businessItemEdit ? `选择岗位价格版本 · ${businessItemEdit.name}` : ''}
        confirmLoading={assigning} onCancel={() => { setBusinessEditMode(null); setBusinessItemEdit(null) }} onOk={() => void saveBusinessPrice()}>
        <Form layout="vertical">
          <Form.Item label="适用于该基地、作业项和作业时间的价格" required>
            <Select value={businessPriceVersionId} onChange={setBusinessPriceVersionId} options={businessPriceRules.filter((rule) => rule.kind === selected?.businessKind
              && rule.catalogId === businessItemEdit?.catalogId && rule.materialTypeId === selected?.materialTypeId
              && rule.status === 'published' && rule.effectiveFrom <= (selected?.eventTime || '')
              && (!rule.effectiveTo || rule.effectiveTo >= (selected?.eventTime || ''))).map((rule) => ({ value: rule.id,
              label: `版本${rule.versionNo} · ${(rule.unitPriceMicros / 1_000_000).toFixed(4)}元/${rule.unit} · ${rule.effectiveFrom.slice(0, 10)}` }))} />
          </Form.Item>
          <Form.Item label="改价原因" required><Input value={businessPriceReason} onChange={(event) => setBusinessPriceReason(event.target.value)} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

function TicketsPanel({
  tickets,
  operationTickets,
  catalog,
  filters,
  onFiltersChange,
  materials,
  businessCatalog,
  org,
  people,
  baseName,
  factoryName,
  crewName,
  shiftName,
  typeName,
  canCreate,
  onCreate,
  onOpen,
  onCancel,
}: {
  tickets: Ticket[]
  operationTickets: OperationsTicket[]
  catalog: TicketCatalog | null
  filters: TicketListFilters
  onFiltersChange: (filters: TicketListFilters) => void
  materials: Material[]
  businessCatalog: BusinessCatalogItem[]
  org: OrgReferenceData
  people: EmployeeOption[]
  baseName: Map<string, string>
  factoryName: Map<string, string>
  crewName: Map<string, string>
  shiftName: Map<string, string>
  typeName: Map<string, string>
  canCreate: boolean
  onCreate: () => void
  onOpen: (ticket: Ticket) => void
  onCancel: (ticket: Ticket) => void
}) {
  const [showMore, setShowMore] = useState(false)
  const sources = new Map(operationTickets.map(ticket => [ticket.id, ticket.source]))
  const catalogTypes = new Map((catalog?.types || []).map(type => [type.id, type]))
  const selectedType = catalog?.types.find(type => type.id === filters.ticketTypeId)
  const selectedGroup = catalog?.groups.find(group => group.id === (selectedType?.categoryId || filters.ticketCategoryId))
  const isProduction = selectedGroup?.code === 'GROUP-PRODUCTION' || selectedType?.businessKind === 'production'
  const isLoading = selectedGroup?.code === 'GROUP-LOADING' || selectedType?.businessKind === 'loading'
  const isVehicle = selectedType?.sanitationKind === 'vehicle'
  const typeTree = (catalog?.groups || []).map(group => ({
    value: `category:${group.id}`,
    title: group.name,
    children: group.types.some(type => ['published', 'retired'].includes(type.status)) ? group.types
      .filter(type => ['published', 'retired'].includes(type.status))
      .map(type => ({
      value: `type:${type.id}`,
      title: type.name,
    })) : undefined,
  }))
  const typeScopeValue = filters.ticketTypeId
    ? `type:${filters.ticketTypeId}`
    : filters.ticketCategoryId ? `category:${filters.ticketCategoryId}` : undefined
  const changeTypeScope = (value?: string) => {
    const next: TicketListFilters = { ...filters, ticketCategoryId: undefined, ticketTypeId: undefined }
    if (value?.startsWith('category:')) {
      next.ticketCategoryId = value.slice('category:'.length)
    } else if (value?.startsWith('type:')) {
      const type = catalog?.types.find(item => item.id === value.slice('type:'.length))
      next.ticketTypeId = type?.id
      next.ticketCategoryId = type?.categoryId
    }
    const groupCode = catalog?.groups.find(group => group.id === next.ticketCategoryId)?.code
    if (groupCode !== 'GROUP-PRODUCTION' && next.ticketTypeId !== 'type_builtin_production') {
      next.materialId = undefined
      next.materialTypeId = undefined
      next.productionPostId = undefined
      next.productionLineId = undefined
    }
    if (groupCode !== 'GROUP-LOADING' && next.ticketTypeId !== 'type_builtin_loading') {
      next.loadingTypeId = undefined
    }
    const type = catalog?.types.find(item => item.id === next.ticketTypeId)
    if (type?.sanitationKind !== 'vehicle') next.plateNumber = undefined
    onFiltersChange(next)
  }
  const summary = (ticket: Ticket) => {
    if (ticket.businessKind === 'production') {
      return [ticket.materialTypeName, ticket.materialName].filter(Boolean).join('／') || '未填写产品／料类'
    }
    if (ticket.businessKind === 'loading') {
      return ticket.businessWorkItems.map(item => item.name).join('、') || '未填写装卸方式'
    }
    const sanitation = operationTickets.find(item => item.id === ticket.id)?.sanitation
    return sanitation?.kind === 'vehicle' ? `车辆 · ${sanitation.plateNumber || '未填写车牌号'}`
      : sanitation?.kind === 'facility' ? '厂区洗消' : '通用业务摘要'
  }
  return (
    <Card
      className="surface-card"
      title="工单列表"
      extra={canCreate && <Button icon={<PlusOutlined />} onClick={onCreate}>手工开单</Button>}
    >
      <Space wrap style={{ marginBottom: 14 }}>
        <DatePicker.RangePicker
          aria-label="作业日期范围"
          value={filters.workDateFrom || filters.workDateTo
            ? [filters.workDateFrom ? dayjs(filters.workDateFrom) : null, filters.workDateTo ? dayjs(filters.workDateTo) : null]
            : null}
          onChange={(range) => onFiltersChange({
            ...filters,
            workDateFrom: range?.[0]?.format('YYYY-MM-DD'),
            workDateTo: range?.[1]?.format('YYYY-MM-DD'),
          })}
          allowClear
          placeholder={['开始日期', '结束日期']}
        />
        <TreeSelect
          showSearch
          treeDefaultExpandAll
          treeNodeFilterProp="title"
          allowClear
          placeholder="类型分组 / 工单类型"
          style={{ width: 230 }}
          value={typeScopeValue}
          onChange={(value) => changeTypeScope(value as string | undefined)}
          treeData={typeTree}
        />
        <Input.Search
          aria-label="工单关键词"
          allowClear
          placeholder="工单号 / 来源单号"
          style={{ width: 190 }}
          defaultValue={filters.q}
          onSearch={(q) => onFiltersChange({ ...filters, q: q.trim() || undefined })}
        />
        <Select
          allowClear
          placeholder="精确状态"
          style={{ width: 130 }}
          value={filters.status}
          onChange={(status) => onFiltersChange({ ...filters, status: status as TicketStatus | undefined })}
          options={[
            ['pending_assignment', '待分配'], ['pending_start', '待开始'], ['in_progress', '执行中'],
            ['pending_data', '待补录'], ['overdue', '已超时'], ['completed', '已完单'],
            ['closed', '已关闭'], ['cancelled', '已取消'],
          ].map(([value, label]) => ({ value, label }))}
        />
        {isProduction && <>
          <Select allowClear showSearch optionFilterProp="label" placeholder="产品" style={{ width: 170 }}
            value={filters.materialId} onChange={(value) => onFiltersChange({ ...filters, materialId: value })}
            options={materials.filter(item => item.status === 'active').map(item => ({ value: item.id, label: `${item.name} · ${item.code}` }))} />
          <Select allowClear placeholder="料类" style={{ width: 130 }}
            value={filters.materialTypeId} onChange={(value) => onFiltersChange({ ...filters, materialTypeId: value })}
            options={businessCatalog.filter(item => item.kind === 'material_type' && item.status === 'active').map(item => ({ value: item.id, label: item.name }))} />
          <Select allowClear placeholder="工序" style={{ width: 130 }}
            value={filters.productionPostId} onChange={(value) => onFiltersChange({ ...filters, productionPostId: value })}
            options={businessCatalog.filter(item => item.kind === 'production_post' && item.status === 'active').map(item => ({ value: item.id, label: item.name }))} />
          <Select allowClear showSearch optionFilterProp="label" placeholder="实体产线" style={{ width: 170 }}
            value={filters.productionLineId} onChange={(value) => onFiltersChange({ ...filters, productionLineId: value })}
            options={org.productionLines.map(item => ({ value: item.id, label: item.name }))} />
        </>}
        {isLoading && <Select allowClear placeholder="装卸方式" style={{ width: 170 }}
          value={filters.loadingTypeId} onChange={(value) => onFiltersChange({ ...filters, loadingTypeId: value })}
          options={businessCatalog.filter(item => item.kind === 'loading_type' && item.status === 'active').map(item => ({ value: item.id, label: item.name }))} />}
        {isVehicle && <Input.Search aria-label="车牌号筛选" allowClear placeholder="车牌号" style={{ width: 150 }}
          defaultValue={filters.plateNumber} onSearch={(plateNumber) => onFiltersChange({ ...filters, plateNumber: plateNumber.trim() || undefined })} />}
        <Button type="link" onClick={() => setShowMore(current => !current)}>
          {showMore ? '收起条件' : '更多条件'}
        </Button>
      </Space>
      {showMore && <Space wrap style={{ marginBottom: 14 }}>
        <Select allowClear showSearch optionFilterProp="label" placeholder="人员" style={{ width: 170 }}
          value={filters.personId} onChange={(value) => onFiltersChange({ ...filters, personId: value })}
          options={people.map(person => ({ value: person.id, label: `${person.name} · ${person.employeeCode}` }))} />
        <Select allowClear placeholder="班组" style={{ width: 150 }}
          value={filters.crewId} onChange={(value) => onFiltersChange({ ...filters, crewId: value })}
          options={org.crews.map(crew => ({ value: crew.id, label: crew.name }))} />
        <Select allowClear placeholder="班次" style={{ width: 150 }}
          value={filters.shiftTemplateId} onChange={(value) => onFiltersChange({ ...filters, shiftTemplateId: value })}
          options={org.shiftTemplates.map(shift => ({ value: shift.id, label: shift.name }))} />
        <Select allowClear placeholder="工单来源" style={{ width: 150 }}
          value={filters.source} onChange={(value) => onFiltersChange({ ...filters, source: value as TicketListFilters['source'] })}
          options={[
            { value: 'demo_sync', label: '业务同步（演示）' },
            { value: 'self', label: '员工自建' },
            { value: 'legacy', label: '手工 / 历史' },
          ]} />
      </Space>}
      <Segmented
        value={filters.statusGroup}
        onChange={(value) => onFiltersChange({ ...filters, statusGroup: value as TicketListFilters['statusGroup'] })}
        options={[
          { label: '全部', value: 'all' },
          { label: '待开始', value: 'todo' },
          { label: '执行中', value: 'doing' },
          { label: '已结束', value: 'done' },
        ]}
        style={{ marginBottom: 18 }}
      />
      <Table
        rowKey="id"
        dataSource={tickets}
        pagination={{ pageSize: 15 }}
        scroll={{ x: 1450 }}
        onRow={(record) => ({ onClick: () => onOpen(record), style: { cursor: 'pointer' } })}
        columns={[
          { title: '工单号', dataIndex: 'ticketNo', width: 190, render: (value: string) => <b>{value}</b> },
          { title: '工单来源', width: 150, render: (_, row) => sources.get(row.id) === 'demo_sync' ? <Tag color="blue">业务同步（演示）</Tag> : sources.get(row.id) === 'self' ? <Tag color="green">员工自建</Tag> : <Tag>手工 / 历史</Tag> },
          { title: '工单类型', dataIndex: 'ticketTypeId', width: 150, render: (value: string, row) => <Space direction="vertical" size={0}><b>{typeName.get(value) || String(row.ticketTypeSnapshot.name || value)}</b><small>{catalogTypes.get(value)?.categoryName || (row.businessKind === 'production' ? '生产' : row.businessKind === 'loading' ? '装卸' : '业务分类')}</small></Space> },
          { title: '业务摘要', width: 220, render: (_, row) => summary(row) },
          { title: '作业基地', dataIndex: 'siteId', render: (value: string, row) => row.siteName || baseName.get(value) || value },
          { title: '作业组织', dataIndex: 'factoryId', render: (value: string | null, row) => row.factoryName || (value ? factoryName.get(value) || value : '—') },
          {
            title: '生产班 / 班次',
            render: (_, row) => <Space direction="vertical" size={0}>
              <span>{String(row.siteSnapshot.crewName || (row.crewId ? crewName.get(row.crewId) || row.crewId : '—'))}</span>
              <small>{String(row.siteSnapshot.shiftName || (row.shiftTemplateId ? shiftName.get(row.shiftTemplateId) || row.shiftTemplateId : '—'))}</small>
            </Space>,
          },
          { title: '作业日期', dataIndex: 'workDate', width: 120 },
          { title: '人员', dataIndex: 'assignments', render: (items: Ticket['assignments']) => items.map((item) => item.personName).join('、') || <Tag color="orange">待指派</Tag> },
          { title: '整单实际总量', dataIndex: 'quantity', render: (value: number | null) => value ?? '—' },
          { title: '状态', dataIndex: 'status', width: 110, render: (value: string) => <Tag color={statusColor[value]}>{labelOf(value)}</Tag> },
          { title: '计价', width: 100, render: (_, row) => ticketPricingStatus(row) === 'confirmed' ? <Tag color="green">已定价</Tag> : <Tag color="orange">待定价</Tag> },
          {
            title: '操作',
            width: 120,
            render: (_, record) => record.businessKind === 'generic' && !['closed', 'cancelled'].includes(record.status) && (
              <Popconfirm title="确认取消该工单？" onConfirm={() => onCancel(record)}>
                <Button size="small" danger icon={<CloseCircleOutlined />} onClick={(event) => event.stopPropagation()}>取消</Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </Card>
  )
}

function PricesPanel({
  prices,
  baseName,
  typeName,
  canCreate,
  onCreate,
}: {
  prices: PriceRuleVersion[]
  baseName: Map<string, string>
  typeName: Map<string, string>
  canCreate: boolean
  onCreate: () => void
}) {
  return (
    <Card className="surface-card" title="按实际作业基地生效的计价标准" extra={canCreate && <Button type="primary" icon={<ThunderboltOutlined />} onClick={onCreate}>发布标准</Button>}>
      <Alert
        type="info"
        showIcon
        message="借调计价规则"
        description="人员到另一基地作业时采用接收基地的工单类型单价；工资发放公司按月底确认，不混入实际作业基地字段。"
        style={{ marginBottom: 18 }}
      />
      <Table
        rowKey="id"
        dataSource={prices}
        pagination={{ pageSize: 15 }}
        columns={[
          { title: '工单类型', dataIndex: 'ticketTypeId', render: (value: string) => typeName.get(value) || value },
          { title: '作业基地', dataIndex: 'siteId', render: (value: string) => baseName.get(value) || value },
          { title: '版本', dataIndex: 'versionNo', width: 80, render: (value: number) => `V${value}` },
          { title: '单价', dataIndex: 'unitPriceMicros', render: (value: number, row) => `${money(value)} / ${row.unit}` },
          { title: '生效', dataIndex: 'effectiveFrom', render: formatDateTime },
          { title: '失效', dataIndex: 'effectiveTo', render: (value: string | null) => value ? formatDateTime(value) : '长期' },
          { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color="green">{labelOf(value)}</Tag> },
        ]}
      />
    </Card>
  )
}

function PayrollPanel({
  summary,
  month,
  canView,
  canClose,
  canConfirm,
  confirmCandidates,
  companyName,
  baseName,
  personName,
  onMonthChange,
  onClose,
  onConfirm,
}: {
  summary: PayrollSummary | null
  month: Dayjs
  canView: boolean
  canClose: boolean
  canConfirm: boolean
  confirmCandidates: PayrollConfirmCandidate[]
  companyName: Map<string, string>
  baseName: Map<string, string>
  personName: Map<string, string>
  onMonthChange: (value: Dayjs) => void
  onClose: () => void
  onConfirm: () => void
}) {
  if (!canView) return <Alert type="warning" showIcon message="当前账号没有计薪查看权限" />
  if (!summary) return <LoadingBlock />
  const total = summary.companies.reduce((sum, group) => sum + group.amountMicros, 0)
  const pendingCandidateCount = confirmCandidates.filter((candidate) => !candidate.payrollCompanyId).length
  const pendingAccrualCount = summary.companies.reduce((sum, group) => sum + group.unconfirmedCount, 0)
  const canConfirmAnything = pendingCandidateCount > 0 || pendingAccrualCount > 0
  return (
    <>
      <Card
        className="surface-card"
        title="计件与月度核算"
        extra={<Space><DatePicker picker="month" value={month} onChange={(value) => value && onMonthChange(value)} />{canConfirm && canConfirmAnything && summary.period.status !== 'closed' && <Button onClick={onConfirm}>确认发放公司</Button>}{canClose && summary.period.status !== 'closed' && <Popconfirm title="关账后本月计件将锁定，确认？" onConfirm={onClose}><Button type="primary" icon={<CheckCircleOutlined />}>月结锁定</Button></Popconfirm>}</Space>}
      >
        <Row gutter={[18, 18]} style={{ marginBottom: 20 }}>
          <Col span={8}><Card><Statistic title="本月计件金额" value={total / 1_000_000} precision={2} prefix="¥" /></Card></Col>
          <Col span={8}><Card><Statistic title="发放公司" value={summary.companies.filter((item) => item.payrollCompanyId).length} suffix="家" /></Card></Col>
          <Col span={8}><Card><Statistic title="期间状态" value={labelOf(summary.period.status)} prefix={<WalletOutlined />} /></Card></Col>
        </Row>
        {summary.pendingPricing.length > 0 && <Alert
          type="warning" showIcon style={{ marginBottom: 16 }}
          message={`${summary.pendingPricing.length} 张工单已审核、待定价，暂不能月结`}
          description={summary.pendingPricing.map((ticket) => `${ticket.ticketNo} · ${ticket.siteName} · ${ticket.workDate}`).join('；')}
        />}
        {confirmCandidates.length > 0 && (
          <Card
            type="inner"
            title="待确认工资主体人员"
            extra={<Tag color={pendingCandidateCount ? 'orange' : 'green'}>{pendingCandidateCount ? `${pendingCandidateCount} 人待确认` : '已全部确认'}</Tag>}
            style={{ marginBottom: 14 }}
          >
            {pendingCandidateCount > 0 && (
              <Alert
                type="warning"
                showIcon
                message="提交工单后即可确认月底发放公司"
                description="审核后会继承这里确认的公司，并单独保留实际作业基地。"
                style={{ marginBottom: 12 }}
              />
            )}
            <Table
              rowKey="personId"
              size="small"
              pagination={false}
              dataSource={confirmCandidates}
              columns={[
                { title: '人员', dataIndex: 'personId', render: (value: string, row) => personName.get(value) || row.personName },
                {
                  title: '本月工单',
                  dataIndex: 'ticketIds',
                  render: (value: string[], row) => (
                    <Space>
                      <span>{value.length} 张</span>
                      {row.ticketStatuses.map((status) => <Tag key={status}>{labelOf(status)}</Tag>)}
                    </Space>
                  ),
                },
                {
                  title: '月底发放公司',
                  dataIndex: 'payrollCompanyId',
                  render: (value: string | null) => value
                    ? <Tag color="green">{companyName.get(value) || value}</Tag>
                    : <Tag color="orange">待确认</Tag>,
                },
              ]}
            />
          </Card>
        )}
        {confirmCandidates.length === 0 && summary.companies.length === 0 && <Empty description="本月暂无已提交工单或计件记录" />}
        {summary.companies.map((group) => (
          <Card
            key={group.payrollCompanyId || 'pending'}
            type="inner"
            title={group.payrollCompanyId ? companyName.get(group.payrollCompanyId) || group.companyName : '待确认发放公司'}
            extra={<Space><Tag>{group.personCount} 人</Tag><Tag>{group.ticketCount} 张工单</Tag><b>{money(group.amountMicros)}</b></Space>}
            style={{ marginBottom: 14 }}
          >
            {group.unconfirmedCount > 0 && <Alert type="warning" showIcon message={`${group.unconfirmedCount} 条计件尚未确认月底发放公司`} style={{ marginBottom: 12 }} />}
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={group.items}
              columns={[
                { title: '人员', dataIndex: 'personId', render: (value: string) => personName.get(value) || value },
                { title: '实际作业基地', dataIndex: 'workSiteId', render: (value: string) => baseName.get(value) || value },
                { title: '核算依据', dataIndex: 'quantity', render: (value: number | null) => value == null ? '总包均分' : value },
                { title: '金额', dataIndex: 'amountMicros', render: money },
                { title: '状态', dataIndex: 'settlementStatus', render: (value: string) => <Tag>{labelOf(value)}</Tag> },
              ]}
            />
          </Card>
        ))}
      </Card>
    </>
  )
}
