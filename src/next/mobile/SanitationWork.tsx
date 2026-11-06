import { useEffect, useState } from 'react'
import { Button, Card, Radio, Selector, Toast } from 'antd-mobile'
import type { OperationsTicket } from '@contracts/operations'
import { operationsApi } from '@next/shared/operations-api'
import { errorMessage } from '@next/shared/api'
import { Empty } from './components'
import { useSnapshotUnsavedChanges } from '@next/shared/unsaved-changes'

const points = [
  ['chlorine', '消毒液测氯试纸', '检测'], ['before_head_left', '车头左侧', '洗消前'], ['before_tail_right', '车尾右侧', '洗消前'], ['before_roof', '车顶', '洗消前'],
  ['after_head_left', '车头左侧', '洗消后'], ['after_tail_right', '车尾右侧', '洗消后'], ['after_roof', '车顶', '洗消后'],
] as const
const areas = [{ key: 'production', name: '生产区' }, { key: 'living', name: '生活区' }, { key: 'office', name: '办公区' }] as const
type Asset = { id: string; name: string; url: string }
const time = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未记录'
const localTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

export function SanitationWork({ initial, onSaved }: { initial: OperationsTicket; onSaved: (ticket: OperationsTicket) => void }) {
  const [ticket, setTicket] = useState(initial)
  const [assets, setAssets] = useState<Asset[]>([])
  const [busy, setBusy] = useState(false)
  const [drying, setDrying] = useState<boolean | null>(initial.sanitation?.dryingRequired ?? null)
  const [dryingStart, setDryingStart] = useState(initial.sanitation?.dryingStartedAt ? localTime(new Date(initial.sanitation.dryingStartedAt)) : localTime(new Date()))
  const [dryingEnd, setDryingEnd] = useState(initial.sanitation?.dryingEndedAt ? localTime(new Date(initial.sanitation.dryingEndedAt)) : localTime(new Date(Date.now() + 3600000)))
  const detail = ticket.sanitation
  const canOperate = Boolean(detail) && ticket.workItems.some(item => item.assignments.length > 0) && !ticket.completed
  useSnapshotUnsavedChanges({ drying, dryingStart, dryingEnd }, canOperate, '洗消作业')
  useEffect(() => { if (detail) void operationsApi.demoAssets(detail.kind).then(setAssets).catch(reason => Toast.show(errorMessage(reason))) }, [detail?.kind])
  useEffect(() => { setTicket(initial) }, [initial])
  if (!detail) return null
  async function run(action: Promise<OperationsTicket>, success = '已保存') {
    setBusy(true)
    try { const updated = await action; setTicket(updated); onSaved(updated); Toast.show({ icon: 'success', content: success }) }
    catch (reason) { Toast.show({ icon: 'fail', content: errorMessage(reason) }) }
    finally { setBusy(false) }
  }
  async function addPhoto(pointKey: string, index: number) {
    const area = pointKey.startsWith('area_') ? pointKey.split('_')[1] : null
    const asset = assets.find(item => item.id === (area ? `asset_facility_${areas.findIndex(row => row.key === area) + 1}` : `asset_vehicle_${index}`))
    if (!asset) { Toast.show('演示资源尚未准备，请刷新后重试'); return }
    await run(operationsApi.addSanitationEvidence(ticket.id, { revision: ticket.revision, pointKey, assetId: asset.id }), '演示照片已保存')
  }
  const completeVehicle = async () => {
    if (drying === null) { Toast.show('请选择是否烘干'); return }
    await run(operationsApi.completeSanitation(ticket.id, { revision: ticket.revision, dryingRequired: drying, ...(drying ? { dryingStartedAt: new Date(dryingStart).toISOString(), dryingEndedAt: new Date(dryingEnd).toISOString() } : {}) }), '车辆洗消已完单，计 1 辆')
  }
  const hasEvidence = (key: string) => detail.evidence.some(item => item.pointKey === key)
  const areaPhotos = (key: string) => detail.evidence.filter(item => item.pointKey.startsWith(`area_${key}_`))
  return <>
    <Card><div className="mobile-row"><span className="mobile-card-number">{ticket.ticketNo}</span><b>{detail.kind === 'vehicle' ? '车辆洗消' : '厂区洗消'}</b></div>
      {detail.plateNumber && <div className="mobile-detail-field"><span>车牌号</span><b>{detail.plateNumber}</b></div>}
      <div className="mobile-detail-field"><span>任务发布</span><b>{time(detail.publishedAt)}<small className="mobile-block-note">{detail.publishedByName}</small></b></div>
      <div className="mobile-detail-field"><span>任务开始</span><b>{time(detail.startedAt)}<small className="mobile-block-note">{detail.startedByName}</small></b></div>
      <div className="mobile-detail-field"><span>任务结束</span><b>{time(detail.endedAt)}<small className="mobile-block-note">{detail.endedByName}</small></b></div>
      {ticket.assignmentIssue && <p className="mobile-warning">{ticket.assignmentIssue}，请联系负责人分配后由实际参与人操作。</p>}
    </Card>
    {detail.kind === 'vehicle' ? <>
      {['检测', '洗消前', '洗消后'].map(group => <Card key={group}><h3>{group}</h3>{points.filter(point => point[2] === group).map(([key, name]) => {
        const evidence = detail.evidence.find(item => item.pointKey === key)
        return <div className="mobile-evidence-point" key={key}><div className="mobile-row"><b>{name}</b><span>{evidence ? '已记录' : '待添加'}</span></div>
          {evidence && <EvidencePhoto evidence={evidence} />}
          {!evidence && canOperate && detail.startedAt && <Button block fill="outline" size="small" disabled={busy} onClick={() => void addPhoto(key, key === 'chlorine' ? 1 : key.includes('head') ? 2 : key.includes('tail') ? 3 : 4)}>添加演示照片</Button>}
        </div>
      })}</Card>)}
      {detail.startedAt && <Card><h3>烘干信息</h3><Radio.Group value={drying === null ? '' : String(drying)} onChange={value => setDrying(value === 'true')} disabled={ticket.completed}><div className="mobile-radio-row"><Radio value="true">需要烘干</Radio><Radio value="false">不烘干</Radio></div></Radio.Group>
        {drying && <><label className="mobile-edit-field"><span>入烘开始时间</span><input aria-label="入烘开始时间" type="datetime-local" value={dryingStart} disabled={ticket.completed} onChange={event => setDryingStart(event.target.value)} /></label><label className="mobile-edit-field"><span>烘干结束时间</span><input aria-label="烘干结束时间" type="datetime-local" value={dryingEnd} disabled={ticket.completed} onChange={event => setDryingEnd(event.target.value)} /></label>
          {!hasEvidence('drying_entry') && canOperate && <Button block fill="outline" disabled={busy} onClick={() => void addPhoto('drying_entry', 5)}>添加入烘演示照片</Button>}
          {detail.evidence.filter(item => item.pointKey === 'drying_entry').map(item => <EvidencePhoto key={item.id} evidence={item} />)}
          {detail.dryingMinutes != null && <p className="mobile-hint">烘干用时 {detail.dryingMinutes} 分钟</p>}</>}
      </Card>}
    </> : areas.map((area, index) => {
      const current = detail.areas.find(item => item.key === area.key)
      const photos = areaPhotos(area.key)
      const priorDone = index === 0 || Boolean(detail.areas.find(item => item.key === areas[index - 1].key)?.completedAt)
      return <Card key={area.key}><div className="mobile-row"><h3>{index + 1}. {area.name}</h3><b>{current?.completedAt ? '区域已完成' : current?.startedAt ? '作业中' : '待开始'}</b></div>
        <p className="mobile-hint">开始：{time(current?.startedAt || null)} {current?.startedByName}<br />完成：{time(current?.completedAt || null)} {current?.completedByName}</p>
        {photos.map(photo => <EvidencePhoto key={photo.id} evidence={photo} />)}
        {canOperate && detail.startedAt && current?.startedAt && <Button block fill="outline" size="small" disabled={busy} onClick={() => void addPhoto(`area_${area.key}_${photos.length + 1}`, index + 1)}>添加演示照片（{photos.length}/至少3张）</Button>}
        {canOperate && detail.startedAt && !current?.startedAt && priorDone && <Button block color="primary" disabled={busy} onClick={() => void run(operationsApi.startSanitationArea(ticket.id, { revision: ticket.revision, areaKey: area.key }), `已开始${area.name}`)}>开始{area.name}</Button>}
        {canOperate && current?.startedAt && !current.completedAt && <Button block color="primary" disabled={busy || photos.length < 3} onClick={() => void run(operationsApi.completeSanitationArea(ticket.id, { revision: ticket.revision, areaKey: area.key }), `${area.name}已完成，可补充照片`)}>完成{area.name}</Button>}
      </Card>
    })}
    <Card><h3>执行人</h3>{ticket.workItems.flatMap(item => item.assignments).map(row => <div className="mobile-detail-field" key={row.personId}><span>{row.personName}</span><b>贡献占比 {row.shareBasisPoints / 100}%</b></div>)}{!ticket.workItems.some(item => item.assignments.length) && <Empty>待分配实际执行人</Empty>}<p className="mobile-hint">此处为预置演示照片，仅验证保存与作业流程，尚未接入相机或本地上传。</p></Card>
    {canOperate && !detail.startedAt && <Button block color="primary" size="large" loading={busy} onClick={() => void run(operationsApi.startSanitation(ticket.id, ticket.revision), '任务已开始')}>开始{detail.kind === 'vehicle' ? '车辆洗消' : '厂区洗消'}</Button>}
    {canOperate && detail.startedAt && detail.kind === 'vehicle' && <Button block color="primary" size="large" loading={busy} onClick={() => void completeVehicle()}>结束车辆洗消</Button>}
    {canOperate && detail.kind === 'facility' && detail.areas.every(area => area.completedAt) && <Button block color="primary" size="large" loading={busy} onClick={() => void run(operationsApi.completeSanitation(ticket.id, { revision: ticket.revision }), '厂区洗消已完单，计 3 区')}>确认结束厂区洗消</Button>}
  </>
}

function EvidencePhoto({ evidence }: { evidence: NonNullable<OperationsTicket['sanitation']>['evidence'][number] }) {
  return <figure className="mobile-evidence"><img src={evidence.url} alt={`${evidence.pointName}演示照片`} /><figcaption><span>{evidence.pointName} · {evidence.operatorName}</span><small>{time(evidence.createdAt)}</small></figcaption></figure>
}
