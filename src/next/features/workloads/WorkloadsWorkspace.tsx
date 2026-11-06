import { useCallback, useEffect, useState } from 'react'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import type { OperationsContext, OperationsFeedback, OperationsTicket, OperationsWorkItem, WorkloadExport, WorkloadResult } from '@contracts/operations'
import { operationsApi } from '@next/shared/operations-api'
import { errorMessage } from '@next/shared/api'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'
import { formatDateTime } from '@next/shared/format'
import { useSnapshotUnsavedChanges } from '@next/shared/unsaved-changes'

const kindLabel = { production: '生产', loading: '装卸', generic: '其他工单' }
const quantityText = (value: number) => Number(value.toFixed(4)).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
const confirmation = (ticket: OperationsTicket) => {
  const people = new Map(ticket.workItems.flatMap((item) => item.assignments).map((assignment) => [assignment.personId, assignment.confirmedAt]))
  return `${[...people.values()].filter(Boolean).length}/${people.size}`
}

export default function WorkloadsWorkspace() {
  const { message } = App.useApp()
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const linkedDate = params.get('date')
  const [range, setRange] = useState<[Dayjs, Dayjs]>(linkedDate ? [dayjs(linkedDate), dayjs(linkedDate)] : [dayjs().startOf('month'), dayjs().endOf('month')])
  const [crewId, setCrewId] = useState<string>()
  const [context, setContext] = useState<OperationsContext | null>(null)
  const [result, setResult] = useState<WorkloadResult | null>(null)
  const [feedback, setFeedback] = useState<OperationsFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('tickets')
  const [selected, setSelected] = useState<OperationsTicket | null>(null)
  const [editing, setEditing] = useState<{ ticket: OperationsTicket; item: OperationsWorkItem } | null>(null)
  const [allocations, setAllocations] = useState<Array<{ personId: string; shareBasisPoints: number }>>([])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [resolving, setResolving] = useState<OperationsFeedback | null>(null)
  const [response, setResponse] = useState('')
  const [exportData, setExportData] = useState<WorkloadExport | null>(null)
  const [exporting, setExporting] = useState(false)
  const [candidates, setCandidates] = useState<Array<{ personId: string; personName: string; employeeCode: string; qualified: boolean }>>([])
  useSnapshotUnsavedChanges(
    { allocations, reason },
    Boolean(editing),
    '工作量分配',
  )
  useSnapshotUnsavedChanges(response, Boolean(resolving), '反馈处理结果')
  const query = { dateFrom: range[0].format('YYYY-MM-DD'), dateTo: range[1].format('YYYY-MM-DD'), crewId, scope: 'managed' as const }
  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const input = { dateFrom: range[0].format('YYYY-MM-DD'), dateTo: range[1].format('YYYY-MM-DD'), crewId, scope: 'managed' as const }
      const [nextContext, workloads, records] = await Promise.all([operationsApi.context(), operationsApi.workloads(input), operationsApi.feedback(input)])
      setContext(nextContext); setResult(workloads); setFeedback(records)
    } catch (reason) { setError(errorMessage(reason)) } finally { setLoading(false) }
  }, [range, crewId])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => { if (!editing?.ticket.crewId) { setCandidates([]); return }; void operationsApi.rosterCandidates(editing.ticket.crewId, editing.ticket.workDate).then(setCandidates).catch(reason => message.error(errorMessage(reason))) }, [editing, message])
  useEffect(() => {
    const ticketId = new URLSearchParams(window.location.hash.split('?')[1] || '').get('ticketId')
    if (ticketId && result) {
      const ticket = result.tickets.find((entry) => entry.id === ticketId)
      if (ticket) setSelected(ticket)
    }
  }, [result])
  const open = async (ticketId: string) => {
    try { setSelected(await operationsApi.ticket(ticketId)) } catch (reason) { message.error(errorMessage(reason)) }
  }
  const beginAdjustment = (ticket: OperationsTicket, item: OperationsWorkItem) => {
    setEditing({ ticket, item }); setAllocations(item.assignments.map((assignment) => ({ personId: assignment.personId, shareBasisPoints: assignment.shareBasisPoints }))); setReason('')
  }
  const shareTotal = allocations.reduce((sum, assignment) => sum + assignment.shareBasisPoints, 0)
  const saveAdjustment = async () => {
    if (!editing) return
    if (!allocations.length || shareTotal !== 10000) { message.warning('人员贡献比例需合计 100%'); return }
    if (!reason.trim()) { message.warning('请填写调整原因'); return }
    setSaving(true)
    try {
      const ticket = await operationsApi.adjustAssignments(editing.ticket.id, editing.item.id, { revision: editing.ticket.revision, assignments: allocations, reason: reason.trim() })
      setSelected(ticket); setEditing(null); await reload(); message.success('分配已保存，已有员工确认保持有效')
    } catch (reason) { message.error(errorMessage(reason)) } finally { setSaving(false) }
  }
  const resolve = async () => {
    if (!resolving || !response.trim()) { message.warning('请填写处理结果'); return }
    setSaving(true)
    try {
      await operationsApi.resolveFeedback(resolving.id, resolving.revision, response.trim())
      setResolving(null); await reload(); message.success('反馈已处理')
    } catch (reason) { message.error(errorMessage(reason)) } finally { setSaving(false) }
  }
  const previewExport = async () => {
    setExporting(true)
    try { setExportData(await operationsApi.exportWorkloads(query)) } catch (reason) { message.error(errorMessage(reason)) } finally { setExporting(false) }
  }
  const download = () => {
    if (!exportData) return
    const rows = [['工单号', '作业日期', '作业项', '人员', '分配量', '单位', '贡献比例', '确认时间'], ...exportData.rows.map((row) => [row.ticketNo, row.workDate, row.workItemName, row.personName, String(row.quantity), row.unit, `${row.shareBasisPoints / 100}%`, row.confirmedAt || ''])]
    const csv = '\uFEFF' + rows.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `工作量_${query.dateFrom}_${query.dateTo}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }
  if (loading && !context) return <LoadingBlock />
  if (error) return <ErrorBlock message={error} onRetry={() => void reload()} />
  const tickets = result?.tickets.filter((ticket) => ticket.completed) || []
  const personalRows = tickets.flatMap((ticket) => ticket.workItems.flatMap((item) => item.assignments.map((assignment) => ({ ...assignment, id: `${ticket.id}:${item.id}:${assignment.personId}`, ticket, item }))))
  const openFeedback = feedback.filter((record) => record.status === 'open')
  const editingPeople = (() => {
    const current = context?.people.filter((person) => (editing?.ticket.crewId && person.crewIds.includes(editing.ticket.crewId)) || allocations.some((assignment) => assignment.personId === person.id)) || []
    const included = new Set(current.map((person) => person.id))
    const crossCrew = candidates
      .filter((candidate) => candidate.qualified && !included.has(candidate.personId))
      .map((candidate) => ({ id: candidate.personId, name: candidate.personName, employeeCode: candidate.employeeCode, crewIds: [] as string[] }))
    return [...current, ...crossCrew]
  })()
  return <div className="workspace-stack">
    <PageHeader title="工作量管理" description="核对整单工作量和人员分配，处理员工反馈，按最新分配输出工作量。" actions={<Space><Button icon={<ReloadOutlined />} onClick={() => void reload()}>刷新</Button><Button type="primary" icon={<DownloadOutlined />} loading={exporting} onClick={() => void previewExport()}>工作量输出</Button></Space>} />
    <Card className="surface-card" size="small"><Space wrap>
      <Typography.Text strong>作业日期</Typography.Text><DatePicker.RangePicker allowClear={false} value={range} onChange={(dates) => { if (dates?.[0] && dates[1]) setRange([dates[0], dates[1]]) }} />
      <Select aria-label="工作量班组" allowClear placeholder="全部管理班组" value={crewId} onChange={setCrewId} style={{ minWidth: 200 }} options={context?.crews.filter((crew) => crew.canManage).map((crew) => ({ value: crew.id, label: crew.name }))} />
    </Space></Card>
    <Row gutter={[16, 16]}>
      <Col xs={12} lg={6}><Card className="surface-card"><Statistic title="已完工单" value={result?.totals.ticketCount || 0} suffix="单" /></Card></Col>
      <Col xs={12} lg={6}><Card className="surface-card"><Statistic title="整单实际总量" value={result?.totals.orderQuantity || 0} precision={4} /><Typography.Text type="secondary">生产主单仅计一次</Typography.Text></Card></Col>
      <Col xs={12} lg={6}><Card className="surface-card"><Statistic title="人员计件工作量" value={result?.totals.personalQuantity || 0} precision={4} /><Typography.Text type="secondary">各岗位分别记录</Typography.Text></Card></Col>
      <Col xs={12} lg={6}><Card className="surface-card"><Statistic title="待处理反馈" value={openFeedback.length} suffix="条" /></Card></Col>
    </Row>
    <Card className="surface-card" loading={loading}>
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: 'tickets', label: '工单工作量', children: <Table<OperationsTicket> rowKey="id" dataSource={tickets} pagination={{ pageSize: 12 }} scroll={{ x: 980 }} columns={[
          { title: '工单', render: (_, ticket) => <Space direction="vertical" size={0}><Button type="link" style={{ padding: 0 }} onClick={() => void open(ticket.id)}>{ticket.ticketNo}</Button><span>{ticket.title}</span></Space> },
          { title: '类别', render: (_, ticket) => kindLabel[ticket.businessKind] }, { title: '作业日期', dataIndex: 'workDate' },
          { title: '班组 / 班次', render: (_, ticket) => `${ticket.crewName || '—'} / ${ticket.shiftName || '—'}` },
          { title: '整单实际总量', render: (_, ticket) => ticket.quantity == null ? '—' : quantityText(ticket.quantity) },
          { title: '作业项', render: (_, ticket) => ticket.workItems.map((item) => item.name).join('、') },
          { title: '员工确认', render: (_, ticket) => <Tag>{confirmation(ticket)}</Tag> },
          { title: '操作', render: (_, ticket) => <Button size="small" onClick={() => void open(ticket.id)}>{ticket.canManage ? '查看与分配' : '查看'}</Button> },
        ]} /> },
        { key: 'people', label: '人员分配明细', children: <Table rowKey="id" dataSource={personalRows} pagination={{ pageSize: 15 }} scroll={{ x: 1000 }} columns={[
          { title: '人员', dataIndex: 'personName' }, { title: '作业日期', render: (_, row) => row.ticket.workDate },
          { title: '工单号', render: (_, row) => <Button type="link" onClick={() => void open(row.ticket.id)}>{row.ticket.ticketNo}</Button> },
          { title: '岗位 / 作业项', render: (_, row) => row.item.name }, { title: '贡献比例', render: (_, row) => `${row.shareBasisPoints / 100}%` },
          { title: '最新分配量', render: (_, row) => `${quantityText(row.quantity)} ${row.item.unit}` },
          { title: '员工确认', render: (_, row) => row.confirmedAt ? <Tag color="green">已确认</Tag> : <Tag>待确认</Tag> },
          { title: '操作', render: (_, row) => row.ticket.canManage && <Button size="small" onClick={() => beginAdjustment(row.ticket, row.item)}>调整分配</Button> },
        ]} /> },
        { key: 'feedback', label: `员工反馈${openFeedback.length ? `（${openFeedback.length}）` : ''}`, children: <Table<OperationsFeedback> rowKey="id" dataSource={feedback} pagination={{ pageSize: 12 }} columns={[
          { title: '员工 / 工单', render: (_, record) => <Space direction="vertical" size={0}><b>{record.personName}</b><Button type="link" style={{ padding: 0 }} onClick={() => void open(record.ticketId)}>{record.ticketNo}</Button></Space> },
          { title: '反馈内容', dataIndex: 'message' }, { title: '反馈时间', dataIndex: 'createdAt', render: formatDateTime },
          { title: '处理结果', render: (_, record) => record.status === 'open' ? <Tag color="orange">待处理</Tag> : <Space direction="vertical" size={0}><Tag color="green">已处理</Tag><span>{record.response}</span></Space> },
          { title: '操作', render: (_, record) => record.status === 'open' && <Button size="small" onClick={() => { setResolving(record); setResponse('') }}>处理反馈</Button> },
        ]} /> },
      ]} />
    </Card>
    <Drawer width={850} title={selected ? `${selected.ticketNo} · 工作量分配` : '工作量分配'} open={Boolean(selected)} onClose={() => setSelected(null)}>
      {selected && <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <Descriptions bordered column={2} size="small"><Descriptions.Item label="工单">{selected.title}</Descriptions.Item><Descriptions.Item label="日期">{selected.workDate}</Descriptions.Item><Descriptions.Item label="班组">{selected.crewName}</Descriptions.Item><Descriptions.Item label="整单实际总量">{selected.quantity ?? '—'}</Descriptions.Item></Descriptions>
        <Alert type="info" showIcon message="人员分配调整保持整单总量不变；员工已确认的记录无需再次确认。" />
        {selected.workItems.map((item) => <Card key={item.id} size="small" title={item.name} extra={selected.canManage && <Button onClick={() => beginAdjustment(selected, item)}>调整贡献比例</Button>}>
          <Table rowKey="personId" size="small" pagination={false} dataSource={item.assignments} columns={[
            { title: '人员', dataIndex: 'personName' }, { title: '贡献比例', render: (_, assignment) => `${assignment.shareBasisPoints / 100}%` },
            { title: '最新分配量', render: (_, assignment) => `${quantityText(assignment.quantity)} ${item.unit}` },
            { title: '员工确认', render: (_, assignment) => assignment.confirmedAt ? <Space direction="vertical" size={0}><Tag color="green">已确认</Tag><small>{formatDateTime(assignment.confirmedAt)}</small></Space> : <Tag>待确认</Tag> },
          ]} />
        </Card>)}
        {!selected.workItems.length && <Empty description="暂无人员工作量" />}
      </Space>}
    </Drawer>
    <Modal title={editing ? `调整分配 · ${editing.item.name}` : '调整分配'} width={650} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => void saveAdjustment()} confirmLoading={saving} okText="保存分配" okButtonProps={{ disabled: !allocations.length || shareTotal !== 10000 }}>
      <Typography.Paragraph>整单实际总量：{editing?.ticket.quantity ?? '—'}。本项贡献比例合计须为 100%。</Typography.Paragraph>
      <Select aria-label="分配参与人员" mode="multiple" style={{ width: '100%', marginBottom: 16 }} value={allocations.map((assignment) => assignment.personId)} options={editingPeople.map((person) => ({ value: person.id, label: `${person.name} · ${person.employeeCode}` }))} onChange={(ids: string[]) => setAllocations(ids.map((personId) => ({ personId, shareBasisPoints: allocations.find((assignment) => assignment.personId === personId)?.shareBasisPoints || 0 })))} />
      <Button size="small" style={{ marginBottom: 12 }} disabled={!allocations.length} onClick={() => setAllocations((current) => current.map((assignment, index) => ({ ...assignment, shareBasisPoints: Math.floor(10000 / current.length) + (index < 10000 % current.length ? 1 : 0) })))}>按人数均分</Button>
      {allocations.map((assignment, index) => <Row key={assignment.personId} gutter={12} align="middle" style={{ marginBottom: 10 }}><Col span={14}>{context?.people.find((person) => person.id === assignment.personId)?.name || editing?.item.assignments.find((entry) => entry.personId === assignment.personId)?.personName || assignment.personId}</Col><Col span={10}><InputNumber aria-label={`贡献比例${index + 1}`} min={0} max={100} precision={2} addonAfter="%" value={assignment.shareBasisPoints / 100} onChange={(value) => setAllocations((current) => current.map((entry, i) => i === index ? { ...entry, shareBasisPoints: Math.round(Number(value || 0) * 100) } : entry))} /></Col></Row>)}
      <Tag color={shareTotal === 10000 ? 'green' : 'red'}>合计 {shareTotal / 100}%</Tag>
      <Form layout="vertical" style={{ marginTop: 16 }}><Form.Item label="调整原因" required><Input.TextArea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></Form.Item></Form>
    </Modal>
    <Modal title="处理工作量反馈" open={Boolean(resolving)} onCancel={() => setResolving(null)} onOk={() => void resolve()} confirmLoading={saving}>
      <Typography.Paragraph><b>{resolving?.personName} · {resolving?.ticketNo}</b></Typography.Paragraph><Typography.Paragraph>{resolving?.message}</Typography.Paragraph>
      <Button style={{ marginBottom: 16 }} onClick={() => { if (resolving) { void open(resolving.ticketId); setResolving(null) } }}>查看工单分配</Button><Input.TextArea aria-label="反馈处理结果" placeholder="填写处理结果；需改分配时先在工单详情调整" rows={3} value={response} onChange={(event) => setResponse(event.target.value)} />
    </Modal>
    <Modal title="工作量输出预览" width={1100} open={Boolean(exportData)} onCancel={() => setExportData(null)} footer={<Button type="primary" icon={<DownloadOutlined />} onClick={download}>下载工作量 CSV</Button>}>
      {exportData && <><Typography.Paragraph>{query.dateFrom} 至 {query.dateTo} · {exportData.totals.ticketCount} 单 · 整单总量 {quantityText(exportData.totals.orderQuantity)} · 人员计件工作量 {quantityText(exportData.totals.personalQuantity)}</Typography.Paragraph><Alert type="info" showIcon message="供薪酬系统核对的最新工作量；此处为模拟输出预览。" style={{ marginBottom: 16 }} />
        <Table rowKey={(row) => `${row.ticketId}:${row.workItemId}:${row.personId}`} size="small" pagination={{ pageSize: 12 }} dataSource={exportData.rows} scroll={{ x: 900 }} columns={[
          { title: '工单号', dataIndex: 'ticketNo' }, { title: '日期', dataIndex: 'workDate' }, { title: '岗位 / 作业项', dataIndex: 'workItemName' }, { title: '人员', dataIndex: 'personName' },
          { title: '分配量', render: (_, row) => `${quantityText(row.quantity)} ${row.unit}` }, { title: '贡献比例', render: (_, row) => `${row.shareBasisPoints / 100}%` }, { title: '员工确认', render: (_, row) => row.confirmedAt ? '已确认' : '待确认' },
        ]} /></>}
    </Modal>
  </div>
}
