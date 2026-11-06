import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Checkbox, Tag, TextArea, Toast } from 'antd-mobile'
import type { OperationsContext, OperationsFeedback, OperationsTicket, OperationsWorkItem } from '@contracts/operations'
import { operationsApi } from '@next/shared/operations-api'
import { errorMessage } from '@next/shared/api'
import { WorkDetail } from './WorkPage'
import { DateControl, Empty, ErrorNotice, FullScreen, ScopeControl, quantityText } from './components'
import { useSnapshotUnsavedChanges } from '@next/shared/unsaved-changes'

function confirmed(ticket: OperationsTicket, personId: string | null) {
  const own = ticket.workItems.flatMap(item => item.assignments.filter(row => row.personId === personId))
  return own.length > 0 && own.every(row => Boolean(row.confirmedAt))
}

export function WorkloadPage({ context, date, onDateChange, version, onChange }: { context: OperationsContext; date: string; onDateChange: (date: string) => void; version: number; onChange: () => void }) {
  const [managed, setManaged] = useState(false)
  const [crewId, setCrewId] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [tickets, setTickets] = useState<OperationsTicket[]>([])
  const [feedback, setFeedback] = useState<OperationsFeedback[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState<OperationsTicket | null>(null)
  const [allocation, setAllocation] = useState<{ ticket: OperationsTicket; item: OperationsWorkItem } | null>(null)
  const [feedbackTicket, setFeedbackTicket] = useState<OperationsTicket | null>(null)
  const [responding, setResponding] = useState<OperationsFeedback | null>(null)
  const managedCrews = context.crews.filter(crew => crew.canManage)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    const query = {
      dateFrom: date,
      dateTo: date,
      scope: managed ? 'managed' as const : 'mine' as const,
      crewId: managed ? crewId || undefined : undefined,
      ticketTypeId: typeFilter || undefined,
    }
    try {
      const [result, messages] = await Promise.all([operationsApi.workloads(query), operationsApi.feedback(query)])
      setTickets(result.tickets.filter(ticket => ticket.completed)); setFeedback(messages); setSelected([])
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setLoading(false) }
  }, [date, managed, crewId, typeFilter])
  useEffect(() => { void load() }, [load, version])
  const pending = tickets.filter(ticket => !confirmed(ticket, context.personId) && ticket.workItems.some(item => item.assignments.some(row => row.personId === context.personId)))
  const perUnit = new Map<string, number>()
  for (const ticket of tickets) for (const item of ticket.workItems) {
    for (const row of item.assignments.filter(row => managed || row.personId === context.personId)) perUnit.set(item.unit, (perUnit.get(item.unit) || 0) + row.quantity)
  }
  async function confirmSelected() {
    if (!selected.length) return
    setBusy(true)
    try {
      await operationsApi.confirm(selected)
      Toast.show({ icon: 'success', content: `已确认 ${selected.length} 张工单` }); onChange()
    } catch (reason) { Toast.show({ icon: 'fail', content: errorMessage(reason) }) }
    finally { setBusy(false) }
  }
  return <>
    <div className="mobile-page-toolbar">
      <DateControl value={date} onChange={onDateChange} />
      <label className="mobile-select-label"><span>工单类型</span><select aria-label="工作量工单类型筛选" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
        <option value="">全部类型</option>
        {context.ticketCatalog.types.filter(item => item.status === 'published' || item.status === 'retired').map(item => <option key={item.id} value={item.id}>{item.categoryName} · {item.name}</option>)}
      </select></label>
    </div>
    <ScopeControl managed={managed} onChange={setManaged} crewId={crewId} onCrewChange={setCrewId} crews={managedCrews} />
    {error && <ErrorNotice message={error} retry={() => void load()} />}
    {loading ? <Empty>正在读取工作量…</Empty> : !error && <>
      <div className="mobile-workload-summary"><div><strong>{tickets.length}</strong><span>已完工单</span></div>{!managed && <div><strong>{pending.length}</strong><span>待本人确认</span></div>}<div className="mobile-unit-totals">{Array.from(perUnit).map(([unit, quantity]) => <span key={unit}><b>{quantityText(quantity)}</b> {unit}</span>)}{!perUnit.size && <span>暂无工作量</span>}<small>{managed ? '各岗位人员分配量' : '本人分配量'}</small></div></div>
      {!managed && Boolean(pending.length) && <div className="mobile-batch-select"><Checkbox checked={selected.length === pending.length} indeterminate={selected.length > 0 && selected.length < pending.length} onChange={checked => setSelected(checked ? pending.map(ticket => ticket.id) : [])}>全选待确认</Checkbox><span>已选 {selected.length} 张</span></div>}
      <div className={`mobile-card-list ${!managed && pending.length ? 'has-batch-action' : ''}`}>
        {!tickets.length && <Empty>这一天暂无已完成工单</Empty>}
        {tickets.map(ticket => {
          const ownConfirmed = confirmed(ticket, context.personId)
          const messages = feedback.filter(message => message.ticketId === ticket.id)
          return <Card className="mobile-workload-card" key={ticket.id}>
            <div className="mobile-row">{!managed && !ownConfirmed ? <Checkbox checked={selected.includes(ticket.id)} onChange={checked => setSelected(ids => checked ? [...new Set([...ids, ticket.id])] : ids.filter(id => id !== ticket.id))}><span className="mobile-card-number">{ticket.ticketNo}</span></Checkbox> : <span className="mobile-card-number">{ticket.ticketNo}</span>}<Tag color={managed ? 'default' : ownConfirmed ? 'success' : 'warning'} fill="outline">{managed ? ticket.ticketTypeName : ownConfirmed ? '本人已确认' : '待本人确认'}</Tag></div>
            <h3>{ticket.title}</h3><p className="mobile-muted">{ticket.crewName} · {ticket.shiftName || '未指定班次'}</p>
            {ticket.workItems.map(item => <div className="mobile-workload-item" key={item.id}><div className="mobile-row"><b>{item.name}</b>{managed && ticket.canManage && <Button size="small" fill="none" color="primary" onClick={() => setAllocation({ ticket, item })}>调整分配</Button>}</div>
              {item.assignments.filter(row => managed || row.personId === context.personId).map(row => <div className="mobile-allocation-read" key={row.personId}><span>{managed ? row.personName : '本人'}<small>{row.shareBasisPoints / 100}% · {row.confirmedAt ? '已确认' : '未确认'}</small></span><strong>{quantityText(row.quantity)} <small>{item.unit}</small></strong></div>)}
              {item.unitPriceMicros != null && <p className="mobile-price-note">预计单价 {(item.unitPriceMicros / 1_000_000).toFixed(4)} 元/{item.unit}，实际计薪由薪酬系统核算。</p>}
            </div>)}
            {messages.map(message => <div className={`mobile-feedback ${message.status}`} key={message.id}><div className="mobile-row"><b>{managed ? `${message.personName}的反馈` : '我的反馈'}</b><Tag color={message.status === 'resolved' ? 'success' : 'warning'} fill="outline">{message.status === 'resolved' ? '已处理' : '待处理'}</Tag></div><p>{message.message}</p>{message.response && <p className="mobile-feedback-response">处理回复：{message.response}</p>}{managed && message.status === 'open' && ticket.canManage && <Button block size="small" onClick={() => setResponding(message)}>处理反馈</Button>}</div>)}
            <div className="mobile-card-actions"><Button size="small" fill="none" onClick={() => setActive(ticket)}>查看工单</Button>{!managed && <Button size="small" fill="none" color="primary" onClick={() => setFeedbackTicket(ticket)}>反馈异议</Button>}</div>
          </Card>
        })}
      </div>
      {!managed && Boolean(pending.length) && <div className="mobile-batch-action"><Button block color="primary" size="large" loading={busy} disabled={!selected.length} onClick={() => void confirmSelected()}>确认已选 {selected.length} 张工单</Button></div>}
    </>}
    {active && <WorkDetail ticket={active} personId={context.personId} onClose={() => setActive(null)} onSaved={updated => { setActive(updated); onChange() }} />}
    {allocation && <AllocationEditor context={context} ticket={allocation.ticket} item={allocation.item} onClose={() => setAllocation(null)} onSaved={() => { setAllocation(null); onChange() }} />}
    {feedbackTicket && <FeedbackEditor ticket={feedbackTicket} onClose={() => setFeedbackTicket(null)} onSaved={() => { setFeedbackTicket(null); onChange() }} />}
    {responding && <FeedbackEditor feedback={responding} onClose={() => setResponding(null)} onSaved={() => { setResponding(null); onChange() }} />}
  </>
}

type AllocationRow = { personId: string; shareBasisPoints: number }

function distribute(rows: AllocationRow[], total = 10000): AllocationRow[] {
  if (!rows.length) return []
  const weight = rows.reduce((sum, row) => sum + row.shareBasisPoints, 0)
  const scaled = rows.map(row => ({ ...row, shareBasisPoints: Math.floor(total * (weight > 0 ? row.shareBasisPoints / weight : 1 / rows.length)) }))
  let remaining = total - scaled.reduce((sum, row) => sum + row.shareBasisPoints, 0)
  const order = rows.map((row, index) => ({ index, remainder: total * (weight > 0 ? row.shareBasisPoints / weight : 1 / rows.length) % 1, id: row.personId })).sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id))
  for (const row of order) { if (remaining <= 0) break; scaled[row.index].shareBasisPoints++; remaining-- }
  return scaled
}

function AllocationEditor({ context, ticket, item, onClose, onSaved }: { context: OperationsContext; ticket: OperationsTicket; item: OperationsWorkItem; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<AllocationRow[]>(item.assignments.map(row => ({ personId: row.personId, shareBasisPoints: row.shareBasisPoints })))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useSnapshotUnsavedChanges({ rows, reason }, true, '人员分配调整')
  const members = context.people.filter(person => person.crewIds.includes(ticket.crewId || '') || item.assignments.some(row => row.personId === person.id))
  const people = [...members, ...item.assignments.filter(row => !members.some(person => person.id === row.personId)).map(row => ({ id: row.personId, name: row.personName, employeeCode: '', crewIds: [] }))]
  const totalQuantity = item.assignments.reduce((sum, row) => sum + row.quantity, 0)
  function toggle(personId: string, checked: boolean) {
    if (!checked) setRows(current => distribute(current.filter(row => row.personId !== personId)))
    else setRows(current => {
      const share = Math.floor(10000 / (current.length + 1))
      return [...distribute(current, 10000 - share), { personId, shareBasisPoints: current.length ? share : 10000 }]
    })
  }
  function changeShare(personId: string, percent: number) {
    if (!Number.isFinite(percent)) return
    setRows(current => {
      if (current.length === 1) return [{ personId, shareBasisPoints: 10000 }]
      const basis = Math.min(10000, Math.max(0, Math.round(percent * 100)))
      const others = distribute(current.filter(row => row.personId !== personId), 10000 - basis)
      return current.map(row => row.personId === personId ? { ...row, shareBasisPoints: basis } : others.find(other => other.personId === row.personId)!)
    })
  }
  async function save() {
    if (!rows.length) { Toast.show('请至少选择一位参与人员'); return }
    if (!reason.trim()) { Toast.show('请填写调整原因'); return }
    setBusy(true)
    try {
      await operationsApi.adjustAssignments(ticket.id, item.id, { revision: ticket.revision, assignments: rows, reason: reason.trim() })
      Toast.show({ icon: 'success', content: '分配已更新，员工原确认状态保留' }); onSaved()
    } catch (error) { Toast.show({ icon: 'fail', content: errorMessage(error) }) }
    finally { setBusy(false) }
  }
  return <FullScreen title="调整人员分配" onClose={onClose} footer={<Button block size="large" color="primary" loading={busy} disabled={!rows.length} onClick={() => void save()}>保存分配</Button>}>
    <Card><span className="mobile-card-number">{ticket.ticketNo}</span><h2>{item.name}</h2><div className="mobile-row"><span>作业总量</span><strong>{quantityText(totalQuantity)} {item.unit}</strong></div><p className="mobile-hint">调整个人比例时，其余人员按当前比例配平。整单总量不变，员工原确认状态保留。</p></Card>
    <Card><div className="mobile-row"><b>参与人员</b><span className="mobile-muted">已选 {rows.length} 人</span></div>{people.map(person => {
      const row = rows.find(row => row.personId === person.id)
      return <div className="mobile-allocation-editor-row" key={person.id}>
        <Checkbox checked={Boolean(row)} onChange={checked => toggle(person.id, checked)}>{person.name}</Checkbox>
        {row && <><div className="mobile-share-control"><Button size="small" aria-label={`减少${person.name}比例`} disabled={rows.length === 1} onClick={() => changeShare(person.id, row.shareBasisPoints / 100 - 5)}>−</Button><label><input aria-label={`${person.name}贡献比例`} type="number" inputMode="decimal" min={0} max={100} step={0.01} value={row.shareBasisPoints / 100} disabled={rows.length === 1} onChange={event => changeShare(person.id, Number(event.target.value))} /><span>%</span></label><Button size="small" aria-label={`增加${person.name}比例`} disabled={rows.length === 1} onClick={() => changeShare(person.id, row.shareBasisPoints / 100 + 5)}>＋</Button></div><strong className="mobile-quantity-preview">{quantityText(totalQuantity * row.shareBasisPoints / 10000)} {item.unit}</strong></>}
      </div>
    })}<div className="mobile-allocation-total"><b>合计 {rows.reduce((sum, row) => sum + row.shareBasisPoints, 0) / 100}%</b><span>{quantityText(totalQuantity)} {item.unit}</span></div></Card>
    <Card><h3>调整原因 <em>必填</em></h3><TextArea value={reason} onChange={setReason} rows={3} maxLength={500} placeholder="请说明本次人员分配调整原因" /></Card>
  </FullScreen>
}

function FeedbackEditor({ ticket, feedback, onClose, onSaved }: { ticket?: OperationsTicket; feedback?: OperationsFeedback; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useSnapshotUnsavedChanges(text, true, feedback ? '反馈处理结果' : '工作量反馈')
  async function save() {
    if (!text.trim()) { Toast.show(feedback ? '请填写处理回复' : '请填写反馈内容'); return }
    setBusy(true)
    try {
      if (feedback) await operationsApi.resolveFeedback(feedback.id, feedback.revision, text.trim())
      else if (ticket) await operationsApi.createFeedback(ticket.id, text.trim())
      Toast.show({ icon: 'success', content: feedback ? '反馈已处理' : '反馈已提交给本组负责人' }); onSaved()
    } catch (reason) { Toast.show({ icon: 'fail', content: errorMessage(reason) }) }
    finally { setBusy(false) }
  }
  return <FullScreen title={feedback ? '处理工作量反馈' : '反馈工作量异议'} onClose={onClose} footer={<Button block size="large" color="primary" loading={busy} onClick={() => void save()}>{feedback ? '保存处理回复' : '提交反馈'}</Button>}>
    <Card><b>{feedback?.ticketNo || ticket?.ticketNo}</b>{ticket && <h3>{ticket.title}</h3>}{feedback && <><p className="mobile-muted">{feedback.personName}的反馈</p><p>{feedback.message}</p></>}</Card>
    <Card><h3>{feedback ? '处理回复' : '反馈内容'}</h3><TextArea value={text} onChange={setText} rows={6} maxLength={1000} showCount placeholder={feedback ? '说明核对结果与分配处理情况' : '请说明具体哪项工作量需要核对'} /></Card>
  </FullScreen>
}
