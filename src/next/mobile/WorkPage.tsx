import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, Form, Input, Tag, Toast } from 'antd-mobile'
import type { OperationsContext, OperationsTicket } from '@contracts/operations'
import { operationsApi } from '@next/shared/operations-api'
import { errorMessage } from '@next/shared/api'
import { DynamicMobileDetail, DynamicMobileForm, dynamicPayload, initialDynamicValues, validationMessage } from './DynamicForm'
import { DateControl, Empty, ErrorNotice, FullScreen, TicketState, quantityText } from './components'
import { SanitationWork } from './SanitationWork'
import { useSnapshotUnsavedChanges } from '@next/shared/unsaved-changes'

export function WorkPage({ context, date, onDateChange, version, onChange }: { context: OperationsContext; date: string; onDateChange: (date: string) => void; version: number; onChange: () => void }) {
  const [tickets, setTickets] = useState<OperationsTicket[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState<OperationsTicket | null>(null)
  const [creating, setCreating] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setTickets((await operationsApi.workloads({
        dateFrom: date,
        dateTo: date,
        scope: 'mine',
        ticketTypeId: typeFilter || undefined,
        status: statusFilter || undefined,
      })).tickets)
    }
    catch (reason) { setError(errorMessage(reason)) }
    finally { setLoading(false) }
  }, [date, statusFilter, typeFilter])
  useEffect(() => { void load() }, [load, version])
  async function open(ticket: OperationsTicket) {
    try { setActive(await operationsApi.ticket(ticket.id)) } catch (reason) { Toast.show({ icon: 'fail', content: errorMessage(reason) }) }
  }
  return <>
    <div className="mobile-page-toolbar">
      <DateControl value={date} onChange={onDateChange} />
      <div className="mobile-inline-filters">
        <label><span className="mobile-sr-only">工单类型</span><select aria-label="工单类型筛选" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
          <option value="">全部类型</option>
          {context.ticketCatalog.types.filter(item => item.status === 'published' || item.status === 'retired').map(item => <option key={item.id} value={item.id}>{item.categoryName} · {item.name}</option>)}
        </select></label>
        <label><span className="mobile-sr-only">工单状态</span><select aria-label="工单状态筛选" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="">全部状态</option>
          <option value="pending_assignment">待分配</option>
          <option value="pending_start">待开始</option>
          <option value="in_progress">执行中</option>
          <option value="completed">已完单</option>
          <option value="cancelled">已取消</option>
        </select></label>
      </div>
      <Button color="primary" size="small" onClick={() => setCreating(true)}>＋ 新建工单</Button>
    </div>
    {error && <ErrorNotice message={error} retry={() => void load()} />}
    {loading ? <Empty>正在读取作业…</Empty> : !error && <div className="mobile-card-list">
      {!tickets.length && <Empty>这一天暂无本人作业</Empty>}
      {tickets.map(ticket => <Card className="mobile-work-card" key={ticket.id} onClick={() => void open(ticket)}>
        <div className="mobile-row"><span className="mobile-card-number">{ticket.ticketNo}</span><TicketState ticket={ticket} /></div>
        <h3>{ticket.title}</h3>
        <div className="mobile-inline-tags"><Tag fill="outline">{ticket.ticketTypeName}</Tag><span>{ticket.ticketCategoryName} · {ticket.crewName || '未分班组'} · {ticket.shiftName || '未指定班次'}</span></div>
        <p className="mobile-card-note">{ticket.businessKind !== 'generic' ? ticket.source === 'demo_sync' ? '演示同步 · 状态随业务记录更新' : '系统作业 · 查看同步状态' : ticket.createdByMe ? ticket.completed ? '本人自建 · 已完单' : '本人自建 · 可自主完单' : ticket.completed ? '参与作业 · 已完单' : '参与作业 · 待执行人完单'}</p>
        {ticket.quantity != null && <div className="mobile-row"><span className="mobile-muted">整单数量</span><b>{quantityText(ticket.quantity)} {ticket.workItems[0]?.unit || ''}</b></div>}
        <div className="mobile-card-link">查看作业详情 <span>›</span></div>
      </Card>)}
    </div>}
    {creating && <CreateWork context={context} date={date} onClose={() => setCreating(false)} onSaved={ticket => { setCreating(false); setActive(ticket); onChange() }} />}
    {active && <WorkDetail ticket={active} personId={context.personId} onClose={() => setActive(null)} onSaved={ticket => { setActive(ticket); onChange() }} />}
  </>
}

function CreateWork({ context, date, onClose, onSaved }: { context: OperationsContext; date: string; onClose: () => void; onSaved: (ticket: OperationsTicket) => void }) {
  const ownCrewIds = context.people.find(person => person.id === context.personId)?.crewIds || []
  const crews = context.crews.filter(crew => ownCrewIds.includes(crew.id))
  const initialTemplate = context.selfCreateTemplates.length === 1 ? context.selfCreateTemplates[0] : undefined
  const [templateId, setTemplateId] = useState(initialTemplate?.id || '')
  const [plateNumber, setPlateNumber] = useState('')
  const [crewId, setCrewId] = useState(crews.length === 1 ? crews[0].id : '')
  const [shiftId, setShiftId] = useState('')
  const [workDate, setWorkDate] = useState(date)
  const [busy, setBusy] = useState(false)
  const [dynamicValues, setDynamicValues] = useState<Record<string, unknown>>(
    () => initialTemplate ? initialDynamicValues(initialTemplate.formSchema) : {},
  )
  const [form] = Form.useForm()
  const requestId = useRef(`app-${crypto.randomUUID()}`)
  const template = context.selfCreateTemplates.find(item => item.id === templateId)
  const sanitationKind = template?.sanitationKind
  const crew = crews.find(item => item.id === crewId)
  const shifts = context.shifts.filter(item => item.siteId === crew?.siteId)
  useSnapshotUnsavedChanges(
    { templateId, plateNumber, crewId, shiftId, workDate, dynamicValues },
    true,
    '新建工单',
  )
  useEffect(() => {
    form.resetFields()
    const next = template ? initialDynamicValues(template.formSchema) : {}
    form.setFieldsValue(next)
    setDynamicValues(next)
  }, [form, template])
  async function create() {
    if (!template) { Toast.show('请选择工单类型'); return }
    if (!crew) { Toast.show('请选择本人所属班组'); return }
    if (!workDate) { Toast.show('请选择作业日期'); return }
    setBusy(true)
    try {
      const ticket = sanitationKind ? await operationsApi.createSanitation({ kind: sanitationKind, workDate, plateNumber, clientRequestId: requestId.current }) : await (async () => { const raw = await form.validateFields(); return operationsApi.selfCreate({ ticketTypeId: template.id, crewId, shiftTemplateId: shiftId || null, workDate, clientRequestId: requestId.current, ...dynamicPayload(template.formSchema, raw) }) })()
      Toast.show({ icon: 'success', content: sanitationKind ? '已按当天排班确定执行人' : '工单已创建，完成后可自主完单' }); onSaved(ticket)
    } catch (reason) { Toast.show({ icon: 'fail', content: validationMessage(reason) || errorMessage(reason) }) }
    finally { setBusy(false) }
  }
  return <FullScreen title="新建工单" onClose={onClose} footer={<Button block size="large" color="primary" loading={busy} disabled={!context.personId || !context.selfCreateTemplates.length || Boolean(sanitationKind === 'vehicle' && !plateNumber.trim())} onClick={() => void create()}>创建工单</Button>}>
    <div className="mobile-notice">{sanitationKind ? '执行人由工单类型的默认作业组和当天排班确定，不能自选班组。无有效人员时进入待分配。' : '其他现场作业由本人登记，组织归属从所选班组带出。'}</div>
    {!context.personId && <Empty>当前账号未关联员工，暂时无法自建工单</Empty>}
    {!crews.length && <Empty>未找到本人有效班组，请联系管理员维护人员归属</Empty>}
    {!context.selfCreateTemplates.length && <Empty>暂无已发布的其他工单类型，请联系管理员配置</Empty>}
    <Card><div className="mobile-detail-field"><span>执行人员</span><b>{context.people.find(person => person.id === context.personId)?.name || '未关联员工'}</b></div>
      <label className="mobile-edit-field"><span>工单类型 <em>必选</em></span><select value={templateId} onChange={event => setTemplateId(event.target.value)}><option value="">请选择工单类型</option>{context.selfCreateTemplates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {!sanitationKind && <label className="mobile-edit-field"><span>本人班组 <em>必选</em></span><select value={crewId} onChange={event => { setCrewId(event.target.value); setShiftId('') }}><option value="">请选择所属班组</option>{crews.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className="mobile-edit-field"><span>作业日期 <em>必选</em></span><input type="date" value={workDate} onChange={event => setWorkDate(event.target.value)} /></label>
      {!sanitationKind && <label className="mobile-edit-field"><span>班次</span><select value={shiftId} onChange={event => setShiftId(event.target.value)}><option value="">未指定</option>{shifts.map(item => <option key={item.id} value={item.id}>{item.name} {item.startTime}–{item.endTime}</option>)}</select></label>}
      {sanitationKind === 'vehicle' && <label className="mobile-edit-field"><span>车牌号 <em>必填</em></span><input aria-label="车牌号" value={plateNumber} placeholder="如：京A88888" onChange={event => setPlateNumber(event.target.value)} /></label>}
    </Card>
    {template && !sanitationKind && <Card><Form form={form} layout="vertical" onValuesChange={(_, values) => setDynamicValues(values)}><DynamicMobileForm schema={template.formSchema} form={form} /></Form></Card>}
  </FullScreen>
}

export function WorkDetail({ ticket, personId, onClose, onSaved }: { ticket: OperationsTicket; personId: string | null; onClose: () => void; onSaved: (ticket: OperationsTicket) => void }) {
  const [busy, setBusy] = useState(false)
  const [dynamicValues, setDynamicValues] = useState<Record<string, unknown>>(
    () => ({
      ...initialDynamicValues(ticket.formSchema, ticket.values, ticket.subFormValues),
      __quantity: ticket.quantity ?? undefined,
    }),
  )
  const [form] = Form.useForm()
  useSnapshotUnsavedChanges(dynamicValues, ticket.canComplete, '作业完单')
  useEffect(() => {
    const next = {
      ...initialDynamicValues(ticket.formSchema, ticket.values, ticket.subFormValues),
      __quantity: ticket.quantity ?? undefined,
    }
    form.setFieldsValue(next)
    setDynamicValues(next)
  }, [form, ticket])
  async function complete() {
    setBusy(true)
    try {
      const raw = await form.validateFields()
      const updated = await operationsApi.completeSelf(ticket.id, { revision: ticket.revision, quantity: Number(raw.__quantity), ...dynamicPayload(ticket.formSchema, raw) })
      Toast.show({ icon: 'success', content: '已完单，可前往工作量核对并确认' }); onSaved(updated)
    } catch (reason) { Toast.show({ icon: 'fail', content: validationMessage(reason) || errorMessage(reason) }) }
    finally { setBusy(false) }
  }
  if (ticket.sanitation) return <FullScreen title="作业详情" onClose={onClose}><SanitationWork initial={ticket} onSaved={onSaved} /></FullScreen>
  return <FullScreen title="作业详情" onClose={onClose} footer={ticket.canComplete ? <Button block color="primary" size="large" loading={busy} onClick={() => void complete()}>自主完单</Button> : <Button block size="large" onClick={onClose}>返回作业</Button>}>
    <Card><div className="mobile-row"><span className="mobile-card-number">{ticket.ticketNo}</span><TicketState ticket={ticket} /></div><h2>{ticket.title}</h2><p className="mobile-muted">{ticket.workDate} · {ticket.crewName || '未分班组'} · {ticket.shiftName || '未指定班次'}</p>
      {ticket.businessKind !== 'generic' && <p className="mobile-hint">{ticket.source === 'demo_sync' ? '本地演示同步记录' : '系统作业记录'}，完工状态以业务系统同步结果为准。</p>}
      {ticket.completed && <div className="mobile-detail-field"><span>整单数量</span><b>{quantityText(ticket.quantity)} {ticket.workItems[0]?.unit || ''}</b></div>}
    </Card>
    {ticket.workItems.map(item => <Card key={item.id}><h3>{item.name}</h3>{item.assignments.filter(assignment => ticket.canManage || assignment.personId === personId).map(assignment => <div className="mobile-detail-field" key={assignment.personId}><span>{assignment.personName} · {assignment.shareBasisPoints / 100}%</span><b>{ticket.completed ? `${quantityText(assignment.quantity)} ${item.unit}` : '待完单'}</b></div>)}{item.unitPriceMicros != null && <p className="mobile-muted">预计单价 {(item.unitPriceMicros / 1_000_000).toFixed(4)} 元/{item.unit}</p>}</Card>)}
    <Card>{ticket.canComplete ? <Form form={form} layout="vertical" onValuesChange={(_, values) => setDynamicValues(values)}><DynamicMobileForm schema={ticket.formSchema} form={form} /><Form.Item name="__quantity" label="整单实际完成数量" rules={[{ required: true, message: '请填写实际完成数量' }, { validator: async (_, value) => { if (!Number.isFinite(Number(value)) || Number(value) <= 0) throw new Error('完成数量必须大于0') } }]}><Input type="number" inputMode="decimal" placeholder="请输入实际完成数量" /></Form.Item></Form> : <DynamicMobileDetail schema={ticket.formSchema} values={ticket.values} details={ticket.subFormValues} />}</Card>
  </FullScreen>
}
