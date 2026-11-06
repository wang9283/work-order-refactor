import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Tag, TextArea, Toast } from 'antd-mobile'
import type { OperationsContext, OperationsRoster, RosterAssignment, RosterCandidate } from '@contracts/operations'
import { operationsApi } from '@next/shared/operations-api'
import { errorMessage } from '@next/shared/api'
import { DateControl, Empty, ErrorNotice, FullScreen, ScopeControl } from './components'
import { useSnapshotUnsavedChanges } from '@next/shared/unsaved-changes'

export function SchedulePage({ context, date, onDateChange, version, onChange }: { context: OperationsContext; date: string; onDateChange: (date: string) => void; version: number; onChange: () => void }) {
  const [managed, setManaged] = useState(false)
  const [crewId, setCrewId] = useState('')
  const [rosters, setRosters] = useState<OperationsRoster[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<OperationsRoster | 'new' | null>(null)
  const managedCrews = context.crews.filter(crew => crew.canManage)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRosters(await operationsApi.rosters({ dateFrom: date, dateTo: date, scope: managed ? 'managed' : 'mine', crewId: managed ? crewId || undefined : undefined })) }
    catch (reason) { setError(errorMessage(reason)) }
    finally { setLoading(false) }
  }, [date, managed, crewId])
  useEffect(() => { void load() }, [load, version])
  return <>
    <div className="mobile-page-toolbar"><DateControl value={date} onChange={onDateChange} /></div>
    <ScopeControl managed={managed} onChange={setManaged} crewId={crewId} onCrewChange={setCrewId} crews={managedCrews} />
    {managed && <div className="mobile-section-action"><p className="mobile-hint">当天换人、加人和岗位调整与 PC 排班同步。</p><Button color="primary" size="small" disabled={date !== context.today} onClick={() => setEditing('new')}>＋ 添加当天安排</Button>{date !== context.today && <p className="mobile-muted">App 仅调整今天的安排；月度计划请在 PC 维护。</p>}</div>}
    {error && <ErrorNotice message={error} retry={() => void load()} />}
    {loading ? <Empty>正在读取日程…</Empty> : !error && <div className="mobile-card-list">
      {!rosters.length && <Empty>{managed ? '当天暂无本组安排，可添加当天安排' : '这一天暂无本人安排'}</Empty>}
      {rosters.map(roster => <Card key={roster.id} className="mobile-roster-card">
        <div className="mobile-row"><h3>{roster.shiftName}</h3><Tag color={roster.source === 'daily' ? 'warning' : 'default'} fill="outline">{roster.source === 'daily' ? '当天调整' : '月排班'}</Tag></div>
        <p className="mobile-muted">{roster.crewName} · {roster.shiftStartTime}–{roster.shiftEndTime}{roster.crossDay ? ` · 实际开工 ${roster.shiftStartDate}，按结束日归属` : ''}</p>
        {roster.assignments.filter(assignment => managed || assignment.personId === context.personId).map((assignment, index) => <div className="mobile-detail-field" key={`${assignment.personId}-${assignment.postId}-${index}`}><b>{assignment.personName || context.people.find(person => person.id === assignment.personId)?.name || assignment.personId}{assignment.temporary && <small className="mobile-block-note">临时替班 · 原属{assignment.homeCrewName}</small>}</b><span>{assignment.postName || context.posts.find(post => post.id === assignment.postId)?.name || '班组作业'}</span></div>)}
        {roster.note && <p className="mobile-hint">调整说明：{roster.note}</p>}
        {managed && managedCrews.some(crew => crew.id === roster.crewId) && <Button block fill="outline" color="primary" disabled={date !== context.today} onClick={() => setEditing(roster)}>换人 / 加人 / 调整岗位</Button>}
      </Card>)}
    </div>}
    {editing && <RosterEditor context={context} roster={editing === 'new' ? null : editing} defaultCrewId={crewId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange() }} />}
  </>
}

function RosterEditor({ context, roster, defaultCrewId, onClose, onSaved }: { context: OperationsContext; roster: OperationsRoster | null; defaultCrewId: string; onClose: () => void; onSaved: () => void }) {
  const crews = context.crews.filter(crew => crew.canManage)
  const [crewId, setCrewId] = useState(roster?.crewId || defaultCrewId || (crews.length === 1 ? crews[0].id : ''))
  const [shiftId, setShiftId] = useState(roster?.shiftTemplateId || '')
  const [assignments, setAssignments] = useState<RosterAssignment[]>(roster?.assignments.map(row => ({ personId: row.personId, postId: row.postId })) || [])
  const [note, setNote] = useState(roster?.note || '')
  const [busy, setBusy] = useState(false)
  const [candidates, setCandidates] = useState<RosterCandidate[]>([])
  useSnapshotUnsavedChanges({ crewId, shiftId, assignments, note }, true, '当天排班调整')
  const crew = crews.find(item => item.id === crewId)
  const shifts = context.shifts.filter(item => item.siteId === crew?.siteId)
  const people = candidates.filter(candidate => candidate.qualified).map(candidate => ({ id: candidate.personId, name: candidate.personName, employeeCode: candidate.employeeCode, temporary: candidate.temporary, homeCrewName: candidate.homeCrewName }))
  useEffect(() => { if (!crewId) { setCandidates([]); return }; void operationsApi.rosterCandidates(crewId, context.today).then(setCandidates).catch(reason => Toast.show(errorMessage(reason))) }, [crewId, context.today])
  function changeRow(index: number, patch: Partial<RosterAssignment>) { setAssignments(rows => rows.map((row, current) => current === index ? { ...row, ...patch } : row)) }
  async function save() {
    if (!crewId || !shiftId) { Toast.show('请选择班组和班次'); return }
    if (!assignments.length || assignments.some(row => !row.personId)) { Toast.show('请添加并选择安排人员'); return }
    if (new Set(assignments.map(row => `${row.personId}:${row.postId || ''}`)).size !== assignments.length) { Toast.show('同一员工的同一岗位不能重复安排'); return }
    setBusy(true)
    try {
      await operationsApi.saveRosters({ mode: 'daily', records: [{ workDate: context.today, crewId, shiftTemplateId: shiftId, revision: roster?.revision || 0, assignments, note }] })
      Toast.show({ icon: 'success', content: '当天安排已保存，PC 可读取相同结果' }); onSaved()
    } catch (reason) { Toast.show({ icon: 'fail', content: errorMessage(reason) }) }
    finally { setBusy(false) }
  }
  return <FullScreen title="调整当天安排" onClose={onClose} footer={<Button block color="primary" size="large" loading={busy} onClick={() => void save()}>保存当天安排</Button>}>
    <div className="mobile-notice"><strong>{context.today}</strong><span>排班修改只影响安排，不会改写已有工单人员记录。</span></div>
    <Card><label className="mobile-edit-field"><span>班组</span><select value={crewId} disabled={Boolean(roster)} onChange={event => { setCrewId(event.target.value); setShiftId(''); setAssignments([]) }}><option value="">请选择班组</option>{crews.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="mobile-edit-field"><span>班次</span><select value={shiftId} disabled={Boolean(roster)} onChange={event => setShiftId(event.target.value)}><option value="">请选择班次</option>{shifts.map(item => <option key={item.id} value={item.id}>{item.name} {item.startTime}–{item.endTime}</option>)}</select></label>
    </Card>
    <Card><div className="mobile-row"><h3>作业人员</h3><span className="mobile-muted">{assignments.length} 项安排</span></div>
      {assignments.map((row, index) => <div className="mobile-assignment-edit" key={index}>
        <div className="mobile-row"><b>人员 {index + 1}</b><Button size="small" fill="none" color="danger" onClick={() => setAssignments(rows => rows.filter((_, current) => current !== index))}>移除</Button></div>
        <label className="mobile-edit-field"><span>员工</span><select aria-label={`人员${index + 1}`} value={row.personId} onChange={event => changeRow(index, { personId: event.target.value })}><option value="">请选择具备资格的人员</option>{people.map(person => <option key={person.id} value={person.id}>{person.name} {person.employeeCode}{person.temporary ? `（替班 · 原属${person.homeCrewName}）` : ''}</option>)}</select></label>
        <label className="mobile-edit-field"><span>岗位</span><select aria-label={`人员${index + 1}岗位`} value={row.postId || ''} onChange={event => changeRow(index, { postId: event.target.value || null })}><option value="">未指定岗位</option>{context.posts.map(post => <option key={post.id} value={post.id}>{post.name}</option>)}</select></label>
      </div>)}
      <Button block fill="outline" disabled={!crewId} onClick={() => setAssignments(rows => [...rows, { personId: '', postId: null }])}>＋ 加入人员</Button>
      {!people.length && crewId && <p className="mobile-hint">暂无符合本组资格的可安排人员，请先维护资格或人员归属。</p>}
    </Card>
    <Card><h3>调整说明</h3><TextArea value={note} onChange={setNote} placeholder="如：请假替班、临时加人" rows={3} maxLength={500} /></Card>
  </FullScreen>
}
