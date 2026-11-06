import { useCallback, useEffect, useMemo, useState } from 'react'
import { PlusOutlined, ReloadOutlined, DeleteOutlined, SettingOutlined } from '@ant-design/icons'
import { App, Alert, Button, Card, DatePicker, Descriptions, Drawer, Empty, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import type { OperationsContext, OperationsRoster, RosterAssignment, RosterCandidate, SanitationSummary } from '@contracts/operations'
import { operationsApi } from '@next/shared/operations-api'
import { errorMessage } from '@next/shared/api'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'
import { useAntFormUnsavedChanges, useSnapshotUnsavedChanges } from '@next/shared/unsaved-changes'

type CrewRow = OperationsContext['crews'][number]
type RosterDraft = { crewId: string; shiftTemplateId: string; dates: string[]; note: string }
type EditTarget = { roster?: OperationsRoster; crewId?: string; workDate?: string }

export default function PlanningWorkspace() {
  const { message } = App.useApp()
  const [context, setContext] = useState<OperationsContext | null>(null)
  const [month, setMonth] = useState<Dayjs>(dayjs().startOf('month'))
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [crewId, setCrewId] = useState<string>()
  const [rosters, setRosters] = useState<OperationsRoster[]>([])
  const [sanitation, setSanitation] = useState<SanitationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [draft, setDraft] = useState<RosterAssignment[]>([])
  const [saving, setSaving] = useState(false)
  const [candidates, setCandidates] = useState<RosterCandidate[]>([])
  const [detailRoster, setDetailRoster] = useState<OperationsRoster | null>(null)
  const [coverPreview, setCoverPreview] = useState(false)
  const [form] = Form.useForm<RosterDraft>()
  useAntFormUnsavedChanges(form, Boolean(editing), '排班安排')
  useSnapshotUnsavedChanges(draft, Boolean(editing), '排班人员')
  const editingCrew = Form.useWatch('crewId', form)
  const editingDates = Form.useWatch('dates', form)
  const editingShiftTemplateId = Form.useWatch('shiftTemplateId', form)
  const editingDateKey = editingDates?.join(',') || ''
  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const dateFrom = month.startOf('month').format('YYYY-MM-DD')
      const dateTo = month.endOf('month').format('YYYY-MM-DD')
      const [nextContext, records, sanitationRows] = await Promise.all([
        operationsApi.context(),
        operationsApi.rosters({ dateFrom, dateTo, scope: 'managed' }),
        operationsApi.sanitationSummary({ dateFrom, dateTo, scope: 'managed' }),
      ])
      setContext(nextContext); setRosters(records); setSanitation(sanitationRows)
    } catch (reason) { setError(errorMessage(reason)) } finally { setLoading(false) }
  }, [month])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => { if (!editingCrew || !editingDates?.[0]) { setCandidates([]); return }; void operationsApi.rosterCandidates(editingCrew, editingDates[0]).then(setCandidates).catch(reason => message.error(errorMessage(reason))) }, [editingCrew, editingDates?.[0], message])
  useEffect(() => { setCoverPreview(false) }, [editingCrew, editingDateKey, editingShiftTemplateId, draft])
  useEffect(() => {
    const focus = (event: Event) => {
      const value = (event as CustomEvent<string>).detail
      if (value) { const next = dayjs(value); setMonth(next.startOf('month')); setDate(next) }
    }
    window.addEventListener('planning-date-focus', focus)
    return () => window.removeEventListener('planning-date-focus', focus)
  }, [])
  const crews = context?.crews || []
  const plannable = crews.filter((crew) => crew.canPlanMonth)
  const today = context?.today || dayjs().format('YYYY-MM-DD')
  const currentMonthEditable = month.endOf('month').format('YYYY-MM-DD') >= today
  const visible = rosters.filter((roster) => !crewId || roster.crewId === crewId)
  const days = useMemo(() => Array.from({ length: month.daysInMonth() }, (_, index) => month.date(index + 1)), [month])
  const byCrewDate = useMemo(() => {
    const map = new Map<string, OperationsRoster[]>()
    for (const roster of rosters) {
      const key = `${roster.crewId}:${roster.workDate}`
      map.set(key, [...(map.get(key) || []), roster])
    }
    return map
  }, [rosters])
  const sanitationByDate = useMemo(() => {
    const map = new Map<string, SanitationSummary[]>()
    for (const item of sanitation) map.set(item.workDate, [...(map.get(item.workDate) || []), item])
    return map
  }, [sanitation])
  const open = (target: EditTarget = {}) => {
    const record = target.roster
    const requestedDate = record?.workDate || target.workDate
    if (!record && requestedDate && requestedDate < today) {
      message.warning('历史日期排班只读')
      return
    }
    if (!record && !requestedDate && !currentMonthEditable) {
      message.warning('历史月份排班只读')
      return
    }
    const nextCrew = record?.crewId || target.crewId || crewId || plannable[0]?.id
    const siteId = crews.find((crew) => crew.id === nextCrew)?.siteId
    form.setFieldsValue({
      crewId: nextCrew,
      shiftTemplateId: record?.shiftTemplateId || context?.shifts.find((shift) => shift.siteId === siteId && shift.status === 'active')?.id,
      dates: [requestedDate || (date.format('YYYY-MM-DD') < today ? today : date.format('YYYY-MM-DD'))],
      note: record?.note || '',
    })
    setDraft(record?.assignments.map((assignment) => ({ personId: assignment.personId, postId: assignment.postId })) || [])
    setCoverPreview(false)
    setEditing(target)
  }
  const editableRoster = (record: OperationsRoster) => {
    const crew = crews.find((item) => item.id === record.crewId)
    if (!crew?.canPlanMonth) return false
    if (record.workDate < today) return false
    if (record.source === 'daily' && record.workDate === today) return false
    return true
  }
  const previewRows = useMemo(() => (editingDates || []).map((workDate) => {
    const crew = crews.find((item) => item.id === editingCrew)
    const existing = rosters.find((record) => record.workDate === workDate && record.crewId === editingCrew && record.shiftTemplateId === editingShiftTemplateId)
    return { workDate, crewName: crew?.name || '', shiftName: context?.shifts.find((item) => item.id === editingShiftTemplateId)?.name || '', existing, before: existing?.assignments.map((item) => item.personName || item.personId).join('、') || '—', after: draft.map((item) => context?.people.find((person) => person.id === item.personId)?.name || item.personId).join('、') || '—' }
  }), [editingDates, editingCrew, editingShiftTemplateId, crews, context, rosters, draft])
  const covered = previewRows.filter((row) => row.existing)
  const save = async (confirmed = false) => {
    try {
      const values = await form.validateFields()
      const filtered = values.dates.filter((workDate) => {
        if (workDate < today) return false
        const existing = rosters.find((record) => record.workDate === workDate && record.crewId === values.crewId && record.shiftTemplateId === values.shiftTemplateId)
        return !(existing && existing.source === 'daily' && existing.workDate === context?.today)
      })
      if (!filtered.length) { message.warning('当天调整由 App 日程页处理，PC 不覆盖'); return }
      if (!draft.length || draft.some((assignment) => !assignment.personId)) { message.warning('请至少安排一名人员，并补全人员选择'); return }
      const keys = draft.map((assignment) => `${assignment.personId}:${assignment.postId || ''}`)
      if (new Set(keys).size !== keys.length) { message.warning('同一人员的同一岗位不能重复安排'); return }
      const rows = previewRows.filter((row) => filtered.includes(row.workDate))
      if (!confirmed && rows.some((row) => row.existing)) { setCoverPreview(true); return }
      setSaving(true)
      await operationsApi.saveRosters({ mode: 'monthly', records: rows.map((row) => ({
        workDate: row.workDate, crewId: values.crewId, shiftTemplateId: values.shiftTemplateId,
        revision: row.existing?.revision || 0, assignments: draft, note: values.note,
      })) })
      setEditing(null); setCoverPreview(false); await reload(); message.success(`已保存 ${rows.length} 天的排班安排`)
    } catch (reason) { message.error(errorMessage(reason)) } finally { setSaving(false) }
  }
  if (loading && !context) return <LoadingBlock />
  if (error) return <ErrorBlock message={error} onRetry={() => void reload()} />
  const selectedRows = visible.filter((record) => record.workDate === date.format('YYYY-MM-DD'))
  const people = candidates.filter(candidate => candidate.qualified)
  const editingSite = context?.crews.find((crew) => crew.id === editingCrew)?.siteId
  const columns: ColumnsType<CrewRow> = [
    { title: '班组 / 作业组', dataIndex: 'name', key: 'crew', width: 190, fixed: 'left', render: (_: string, crew) => <Space direction="vertical" size={0}><b>{crew.name}</b><small>{context?.people.filter((person) => person.crewIds.includes(crew.id)).length || 0} 名正式成员</small>{crew.id === 'crew_ops_wash' && <Tag color="blue">洗消工单</Tag>}</Space> },
    ...days.map((day) => {
      const key = day.format('YYYY-MM-DD')
      const weekend = [0, 6].includes(day.day())
      const isToday = day.isSame(context?.today || dayjs(), 'day')
      return {
        title: <span className={isToday ? 'planning-today-head' : ''}>{day.format('DD')} {['日','一','二','三','四','五','六'][day.day()]}</span>,
        key, width: 106, align: 'center' as const,
        onHeaderCell: () => ({ className: `${weekend ? 'planning-weekend' : ''} ${isToday ? 'planning-today' : ''}` }),
        onCell: () => ({ className: `${weekend ? 'planning-weekend' : ''} ${isToday ? 'planning-today' : ''}` }),
        render: (_: unknown, crew: CrewRow) => {
          const records = byCrewDate.get(`${crew.id}:${key}`) || []
          const washOrders = crew.id === 'crew_ops_wash' ? sanitationByDate.get(key) || [] : []
          return <div className="planning-month-cell">
            {records.map((record) => <button key={record.id} type="button" className={`planning-month-entry ${record.source === 'daily' ? 'is-daily' : ''}`} onClick={() => setDetailRoster(record)} title={`${record.shiftName} ${record.shiftStartTime}–${record.shiftEndTime}`}>
              <b>{record.shiftName}</b><span>{record.assignments.length} 人{record.crossDay ? ' · 跨天' : ''}{record.source === 'daily' ? ' · 日调整' : ''}</span>
            </button>)}
            {washOrders.map((order) => <a key={order.ticketId} className="planning-wash-order" href={`#/tickets?ticketId=${encodeURIComponent(order.ticketId)}`} onClick={() => window.dispatchEvent(new CustomEvent('operations-ticket-focus', { detail: order.ticketId }))} title={`${order.ticketNo}${order.plateNumber ? ` · ${order.plateNumber}` : ''}`}>
              {order.kind === 'vehicle' ? '车辆洗消' : '厂区洗消'} · {order.assignmentIssue ? '待分配' : order.status === 'completed' ? '已完成' : '执行中'}
            </a>)}
            {!records.length && crew.canPlanMonth && key >= today && <button type="button" className="planning-empty-cell" onClick={() => open({ crewId: crew.id, workDate: key })}>未安排</button>}
          </div>
        },
      }
    }),
  ]
  return <div className="workspace-stack">
    <PageHeader title="排班计划" description="按作业组与排班归属日查看整月安排；点击班次查人员，App 当天调整在本页同步显示。" actions={<Space><Button icon={<SettingOutlined />} onClick={() => { window.location.hash = '#/crews' }}>班组与班次</Button><Button onClick={() => { window.location.hash = '#/other-config?section=dispatch' }}>默认派单</Button><Button icon={<ReloadOutlined />} onClick={() => void reload()}>刷新</Button><Button type="primary" icon={<PlusOutlined />} disabled={!plannable.length || !currentMonthEditable} onClick={() => open()}>批量安排</Button></Space>} />
    <Card className="surface-card" size="small"><Space wrap>
      <Typography.Text strong>排班月份</Typography.Text><DatePicker picker="month" allowClear={false} value={month} onChange={(value) => { if (value) { setMonth(value.startOf('month')); setDate(value.startOf('month')) } }} />
      <Select aria-label="排班班组" allowClear placeholder="全部管理班组" value={crewId} onChange={setCrewId} style={{ minWidth: 200 }} options={crews.filter((crew) => crew.canManage).map((crew) => ({ value: crew.id, label: crew.name }))} />
      <Tag>{visible.length} 项安排</Tag><Tag color="gold">{visible.filter((record) => record.source === 'daily').length} 项日调整</Tag>
    </Space></Card>
    <Alert type="info" showIcon message="跨天班次按结束日归属并保留实际开工日。空白表示未安排，不等于休息；班次维护和默认派单在各自低频入口。" />
    <Card className="surface-card" loading={loading}>
      <Table<CrewRow> className="planning-month-table" rowKey="id" pagination={false} size="small" bordered dataSource={crews.filter((crew) => !crewId || crew.id === crewId)} columns={columns} scroll={{ x: 190 + days.length * 106, y: 520 }} />
    </Card>
    <Card className="surface-card" size="small">
      <Space wrap><Typography.Text strong>查看日期</Typography.Text><DatePicker allowClear={false} value={date} onChange={(value) => { if (value) { setDate(value); setMonth(value.startOf('month')) } }} /><Tag>夜班 20:00–次日 08:00</Tag><Tag>常日班 08:00–17:00</Tag><small>白班 08:00–20:00 可在班次维护中自定义</small></Space>
    </Card>
    <Card className="surface-card" title={`${date.format('M月D日')} · 实际安排`} extra={<Button disabled={!plannable.length} onClick={() => open({ workDate: date.format('YYYY-MM-DD') })}>安排当天</Button>}>
      <Table<OperationsRoster> rowKey="id" pagination={false} dataSource={selectedRows} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当天尚未安排，可新增或批量应用本月安排" /> }} columns={[
        { title: '班次 / 班组', render: (_, record) => <Space direction="vertical" size={0}><b>{record.shiftName} {record.shiftStartTime}–{record.shiftEndTime}</b><span>{record.crewName}{record.crossDay ? ` · ${record.shiftStartDate} 开工，按 ${record.attributionDate} 结束日归属` : ''}</span></Space> },
        { title: '岗位人员', render: (_, record) => record.assignments.map((assignment, index) => <Tag color={assignment.temporary ? 'gold' : 'default'} key={`${assignment.personId}:${assignment.postId}:${index}`}>{assignment.personName || context?.people.find((person) => person.id === assignment.personId)?.name} · {assignment.postName || context?.posts.find((post) => post.id === assignment.postId)?.name || '班组作业'}{assignment.temporary ? ` · 替班（原属${assignment.homeCrewName}）` : ''}</Tag>) },
        { title: '安排来源', render: (_, record) => <Tag color={record.source === 'daily' ? 'gold' : 'green'}>{record.source === 'daily' ? '日调整' : '月排班'}</Tag> },
         { title: '备注', dataIndex: 'note' }, { title: '操作', render: (_, record) => editableRoster(record) ? <Button size="small" onClick={() => open({ roster: record })}>编辑安排</Button> : '—' },
      ]} />
    </Card>
    <Drawer title="排班详情" width={720} open={Boolean(detailRoster)} onClose={() => setDetailRoster(null)} extra={detailRoster && editableRoster(detailRoster) && <Button type="primary" onClick={() => { const target = detailRoster; setDetailRoster(null); open({ roster: target }) }}>编辑安排</Button>}>
      {detailRoster && <>
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="作业组">{detailRoster.crewName}</Descriptions.Item><Descriptions.Item label="班次">{detailRoster.shiftName} {detailRoster.shiftStartTime}–{detailRoster.shiftEndTime}</Descriptions.Item>
          <Descriptions.Item label="归属日">{detailRoster.attributionDate}</Descriptions.Item><Descriptions.Item label="实际开工日">{detailRoster.shiftStartDate}</Descriptions.Item>
          <Descriptions.Item label="安排来源">{detailRoster.source === 'daily' ? 'App 当天调整' : 'PC 月排班'}</Descriptions.Item><Descriptions.Item label="版本">revision {detailRoster.revision}</Descriptions.Item>
          <Descriptions.Item label="安排人数">{detailRoster.assignments.length} 人</Descriptions.Item><Descriptions.Item label="备注">{detailRoster.note || '—'}</Descriptions.Item>
        </Descriptions>
        <Typography.Title level={5} style={{ marginTop: 20 }}>岗位人员</Typography.Title>
        <Space wrap>{detailRoster.assignments.map((assignment, index) => <Tag key={index} color={assignment.temporary ? 'gold' : 'default'}>{assignment.personName || context?.people.find((person) => person.id === assignment.personId)?.name} · {assignment.postName || '班组作业'}{assignment.temporary ? ` · 替班（原属${assignment.homeCrewName}）` : ''}</Tag>)}</Space>
        {detailRoster.source === 'daily' && <Alert style={{ marginTop: 20 }} type="warning" showIcon message="当天调整由 App 日程页维护，PC 保留同一份记录且不改写为月排班。" />}
      </>}
    </Drawer>
    <Modal title={editing?.roster ? '编辑岗位人员' : '批量安排岗位人员'} open={Boolean(editing)} width={860} onCancel={() => { setEditing(null); setCoverPreview(false) }} onOk={() => void save(coverPreview)} confirmLoading={saving} okText={coverPreview ? '确认覆盖并保存' : '保存排班'}>
      <Form form={form} layout="vertical"><Space align="start" style={{ display: 'flex' }}>
        <Form.Item name="crewId" label="班组" rules={[{ required: true }]} style={{ flex: 1 }}><Select disabled={Boolean(editing?.roster)} style={{ minWidth: 210 }} options={plannable.map((crew) => ({ value: crew.id, label: crew.name }))} onChange={() => { setDraft([]); form.setFieldValue('shiftTemplateId', undefined) }} /></Form.Item>
        <Form.Item name="shiftTemplateId" label="班次" rules={[{ required: true }]} style={{ flex: 1 }}><Select disabled={Boolean(editing?.roster)} style={{ minWidth: 250 }} options={context?.shifts.filter((shift) => shift.siteId === editingSite && shift.status === 'active').map((shift) => ({ value: shift.id, label: `${shift.name} ${shift.startTime}–${shift.endTime}` }))} /></Form.Item>
      </Space>
        <Form.Item name="dates" label="应用日期（可多选）" rules={[{ required: true, type: 'array', min: 1 }]} extra={<Button size="small" type="link" style={{ padding: 0 }} onClick={() => form.setFieldValue('dates', days.filter((item) => item.format('YYYY-MM-DD') >= today).map((item) => item.format('YYYY-MM-DD')))}>选择整月</Button>}><Select mode="multiple" maxTagCount={5} disabled={Boolean(editing?.roster)} options={days.map((item) => ({ value: item.format('YYYY-MM-DD'), label: `${month.format('M月')}${item.date()}日`, disabled: item.format('YYYY-MM-DD') < today }))} /></Form.Item>
        <Typography.Paragraph type="secondary">所选日期的同班组、同班次将采用以下安排；已生成工单保留原参与人员。</Typography.Paragraph>
        {coverPreview && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`将覆盖 ${covered.length} 个已有安排`} description={<Table size="small" pagination={false} rowKey="workDate" dataSource={covered} columns={[{ title: '日期', dataIndex: 'workDate', width: 120 }, { title: '班组 / 班次', render: (_, row) => `${row.crewName} · ${row.shiftName}` }, { title: '改前人员', dataIndex: 'before' }, { title: '改后人员', dataIndex: 'after' }]} />} />}
        <Table<RosterAssignment> rowKey={(_, index) => String(index)} pagination={false} size="small" dataSource={draft} columns={[
          { title: '人员', render: (_, assignment, index) => <Select aria-label={`排班人员${index + 1}`} showSearch optionFilterProp="label" value={assignment.personId || undefined} style={{ width: '100%', minWidth: 180 }} options={people.map((person) => ({ value: person.personId, label: `${person.personName} · ${person.employeeCode}${person.temporary ? `（替班 · 原属${person.homeCrewName}）` : ''}` }))} onChange={(personId) => setDraft((current) => current.map((entry, i) => i === index ? { ...entry, personId } : entry))} /> },
          { title: '岗位', render: (_, assignment, index) => <Select aria-label={`排班岗位${index + 1}`} allowClear placeholder="班组作业" value={assignment.postId || undefined} style={{ width: '100%', minWidth: 180 }} options={context?.posts.map((post) => ({ value: post.id, label: post.name }))} onChange={(postId) => setDraft((current) => current.map((entry, i) => i === index ? { ...entry, postId: postId || null } : entry))} /> },
          { title: '', width: 45, render: (_, __, index) => <Button aria-label="删除排班人员" type="text" danger icon={<DeleteOutlined />} onClick={() => setDraft((current) => current.filter((_, i) => i !== index))} /> },
        ]} />
        <Button icon={<PlusOutlined />} onClick={() => setDraft((current) => [...current, { personId: '', postId: null }])} style={{ margin: '12px 0' }}>添加人员</Button>
        <Form.Item name="note" label="安排备注"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  </div>
}
