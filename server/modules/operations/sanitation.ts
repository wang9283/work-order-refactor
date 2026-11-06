import type { AuthContext } from '../../core/auth'
import { hasGrant } from '../../core/auth'
import { AppError } from '../../core/errors'
import { all, one, run, transaction, nowIso, newId } from '../../db/database'
import { createTicket } from '../execution/repository'
import { defaultExecution } from './dispatch'
import { ticketRow, mapTicket, equalShares, participates, assertVisible, completed } from './workloads'
import { isMember } from './service'
import { hasQualification } from './dispatch'
import type { CreateSanitationInput, OperationsTicket, SanitationDetail, SanitationArea, SanitationEvidence, CompleteSanitationInput } from '../../../packages/contracts/src/operations'
import { writeAudit } from '../../core/audit'
import { scopedBaseId } from '../../core/base-scope'

export function sanitationTypeId(kind:'vehicle'|'facility'):string {
  return kind==='vehicle'?'type_ops_vehicle':'type_ops_facility'
}
export function createSanitation(auth:AuthContext,input:CreateSanitationInput):OperationsTicket {
  const typeId=sanitationTypeId(input.kind)
  const person=auth.personId?one<{home_base_id:string}>('SELECT home_base_id FROM people WHERE id=? AND status=\'active\'',[auth.personId]):undefined
  const selectedBase=scopedBaseId(auth)
  const ruleRows=all<{site_id:string;crew_id:string}>(`SELECT r.site_id,r.crew_id FROM operations_assignment_rules r JOIN crews c ON c.id=r.crew_id WHERE r.ticket_type_id=? AND c.status='active' ORDER BY r.site_id`,[typeId])
  const managedRule=auth.personId?undefined:ruleRows.find(row=>selectedBase===null||row.site_id===selectedBase)
  const siteId=selectedBase||person?.home_base_id||managedRule?.site_id
  if(!siteId)throw AppError.forbidden('当前账号未关联员工，且没有可管理的洗消类型')
  const execution=defaultExecution(auth,siteId,typeId,input.workDate)
  const manager=hasGrant(auth,'ticket.assign',{type:'base',id:siteId})
  const executor=Boolean(auth.personId&&hasGrant(auth,'ticket.execute',{type:'factory',id:execution.crew.factory_id})&&hasQualification(auth.personId,execution.crew.id,input.workDate)&&(execution.people.includes(auth.personId)||isMember(auth,execution.crew.id,input.workDate)||!execution.people.length))
  if(!manager&&!executor)throw AppError.forbidden('仅当天安排的执行人、具备资格的作业组成员或基地管理人员可创建洗消工单')
  if(input.kind==='vehicle'&&!input.plateNumber?.trim())throw AppError.badRequest('请填写车牌号')
  return transaction(()=>{
    const prior=one<{ticket_id:string}>('SELECT ticket_id FROM operations_ticket_sources WHERE source_namespace=? AND source_key=?',[`sanitation:${auth.accountId}`,input.clientRequestId])
    if(prior){const existing=ticketRow(auth,prior.ticket_id);assertVisible(auth,existing);return mapTicket(auth,existing,true)}
    const created=createTicket({...auth,grants:[...auth.grants,{capability:'ticket.create',type:'factory',id:execution.crew.factory_id}]},{
      ticketTypeId:typeId,businessKind:'generic',siteId:execution.crew.base_id,factoryId:execution.crew.factory_id,
      workAreaId:null,productionLineId:null,crewId:execution.crew.id,shiftTemplateId:execution.shiftTemplateId,
      workDate:input.workDate,eventTime:`${input.workDate}T08:00:00+08:00`,
      assignments:execution.people.map(personId=>({personId,role:'member'})),quantity:null,
    })
    for(const share of equalShares(execution.people))run('UPDATE ticket_assignments SET share_basis_points=? WHERE ticket_id=? AND person_id=?',[share.shareBasisPoints,created.id,share.personId])
    run(`INSERT INTO operations_ticket_sources (ticket_id,source,source_namespace,source_key,roster_snapshot_json,created_at) VALUES (?,'self',?,?,?,?)`,[created.id,`sanitation:${auth.accountId}`,input.clientRequestId,JSON.stringify(execution.snapshot),nowIso()])
    run(`INSERT INTO operations_sanitation (ticket_id,kind,plate_number,published_at,published_by,assignment_issue) VALUES (?,?,?,?,?,?)`,[created.id,input.kind,input.plateNumber?.trim()||null,nowIso(),auth.accountId,execution.issue])
    return mapTicket(auth,ticketRow(auth,created.id),true)
  })
}

export const vehiclePoints:Record<string,string>={chlorine:'消毒液测氯试纸',before_head_left:'洗消前 · 车头左侧',before_tail_right:'洗消前 · 车尾右侧',before_roof:'洗消前 · 车顶',after_head_left:'洗消后 · 车头左侧',after_tail_right:'洗消后 · 车尾右侧',after_roof:'洗消后 · 车顶',drying_entry:'入烘照片'}
const areaNames={production:'生产区',living:'生活区',office:'办公区'} as const
type AreaKey=keyof typeof areaNames
function accountName(id:string|null):string{return id?one<{name:string}>('SELECT COALESCE(p.name,a.display_name) AS name FROM accounts a LEFT JOIN people p ON p.id=a.person_id WHERE a.id=?',[id])?.name||'':''}
export function sanitationDetail(ticketId:string):SanitationDetail|null {
  const row=one<{kind:'vehicle'|'facility';plate_number:string|null;published_at:string;published_by:string;started_at:string|null;started_by:string|null;ended_at:string|null;ended_by:string|null;drying_required:number|null;drying_started_at:string|null;drying_ended_at:string|null}>('SELECT * FROM operations_sanitation WHERE ticket_id=?',[ticketId])
  if(!row)return null
  const evidence=all<{id:string;point_key:string;asset_id:string;url:string;created_at:string;created_by:string}>(`SELECT e.*,a.url FROM operations_sanitation_evidence e JOIN operations_demo_assets a ON a.id=e.asset_id WHERE e.ticket_id=? ORDER BY e.created_at,e.id`,[ticketId]).map((item):SanitationEvidence=>({id:item.id,pointKey:item.point_key,pointName:vehiclePoints[item.point_key]||(item.point_key.startsWith('area_')?`${areaNames[item.point_key.split('_')[1] as AreaKey]||'区域'} · 演示凭证`:item.point_key),assetId:item.asset_id,url:item.url,createdAt:item.created_at,operatorName:accountName(item.created_by)}))
  const areas=all<{area_key:AreaKey;started_at:string|null;started_by:string|null;completed_at:string|null;completed_by:string|null}>('SELECT * FROM operations_sanitation_areas WHERE ticket_id=?',[ticketId])
  const mappedAreas=(Object.keys(areaNames) as AreaKey[]).map((key):SanitationArea=>{const area=areas.find(x=>x.area_key===key);return {key,name:areaNames[key],startedAt:area?.started_at||null,startedByName:accountName(area?.started_by||null),completedAt:area?.completed_at||null,completedByName:accountName(area?.completed_by||null)}})
  const minutes=row.drying_started_at&&row.drying_ended_at?Math.round((Date.parse(row.drying_ended_at)-Date.parse(row.drying_started_at))/60000):null
  return {kind:row.kind,plateNumber:row.plate_number,publishedAt:row.published_at,publishedByName:accountName(row.published_by),startedAt:row.started_at,startedByName:accountName(row.started_by),endedAt:row.ended_at,endedByName:accountName(row.ended_by),dryingRequired:row.drying_required===null?null:Boolean(row.drying_required),dryingStartedAt:row.drying_started_at,dryingEndedAt:row.drying_ended_at,dryingMinutes:minutes,evidence,areas:row.kind==='facility'?mappedAreas:[]}
}
function editable(auth:AuthContext,id:string,revision:number) {
  const row=ticketRow(auth,id);assertVisible(auth,row)
  if(!participates(auth,id))throw AppError.forbidden('仅工单实际参与人可执行洗消操作')
  const detail=one<{kind:'vehicle'|'facility';started_at:string|null;ended_at:string|null}>('SELECT kind,started_at,ended_at FROM operations_sanitation WHERE ticket_id=?',[id])
  if(!detail)throw AppError.notFound('洗消工单')
  if(row.revision!==revision)throw AppError.revisionConflict()
  return {row,detail}
}
function bump(auth:AuthContext,id:string,action:string):OperationsTicket {
  run('UPDATE tickets SET revision=revision+1,updated_at=?,updated_by=? WHERE id=?',[nowIso(),auth.accountId,id])
  writeAudit({accountId:auth.accountId,ipAddress:auth.ipAddress,action,entityType:'ticket',entityId:id})
  return mapTicket(auth,ticketRow(auth,id))
}
export function demoAssets(kind:'vehicle'|'facility') {return all('SELECT id,kind,name,url FROM operations_demo_assets WHERE kind=? AND status=\'active\' ORDER BY id',[kind])}
export function startSanitation(auth:AuthContext,id:string,revision:number):OperationsTicket {
  return transaction(()=>{const {row,detail}=editable(auth,id,revision);if(completed(row)||detail.ended_at)throw AppError.stateConflict('工单已完结');if(detail.started_at)throw AppError.stateConflict('工单已开始');run('UPDATE operations_sanitation SET started_at=?,started_by=? WHERE ticket_id=?',[nowIso(),auth.accountId,id]);run(`UPDATE tickets SET status='in_progress' WHERE id=?`,[id]);return bump(auth,id,'operations.sanitation.start')})
}
export function addEvidence(auth:AuthContext,id:string,input:{revision:number;pointKey:string;assetId:string}):OperationsTicket {
  return transaction(()=>{
    const {row,detail}=editable(auth,id,input.revision)
    const prior=one<{id:string}>('SELECT id FROM operations_sanitation_evidence WHERE ticket_id=? AND point_key=? AND asset_id=?',[id,input.pointKey,input.assetId])
    if(prior)return mapTicket(auth,row)
    if(completed(row)||detail.ended_at)throw AppError.stateConflict('已完成工单只能查看，不能补充凭证')
    if(!detail.started_at)throw AppError.stateConflict('请先开始工单')
    const asset=one<{id:string;kind:string}>(`SELECT id,kind FROM operations_demo_assets WHERE id=? AND kind=? AND status='active'`,[input.assetId,detail.kind])
    if(!asset)throw AppError.badRequest('请选择服务端登记的对应演示资源，不支持任意图片地址')
    if(detail.kind==='vehicle'){
      if(!vehiclePoints[input.pointKey])throw AppError.badRequest('车辆洗消点位不正确')
      if(one('SELECT id FROM operations_sanitation_evidence WHERE ticket_id=? AND point_key=?',[id,input.pointKey]))throw AppError.conflict('该车辆点位已有照片，每个点位只需一张')
    }else{
      const match=/^area_(production|living|office)_(\d+)$/.exec(input.pointKey)
      if(!match||Number(match[2])<1||Number(match[2])>20)throw AppError.badRequest('厂区洗消凭证点位不正确')
      const area=one<{started_at:string|null}>('SELECT started_at FROM operations_sanitation_areas WHERE ticket_id=? AND area_key=?',[id,match[1]])
      if(!area?.started_at)throw AppError.stateConflict('请先开始对应区域')
    }
    run('INSERT INTO operations_sanitation_evidence (id,ticket_id,point_key,asset_id,created_at,created_by) VALUES (?,?,?,?,?,?)',[newId('evidence'),id,input.pointKey,input.assetId,nowIso(),auth.accountId])
    return bump(auth,id,'operations.sanitation.evidence.add')
  })
}
export function startArea(auth:AuthContext,id:string,key:AreaKey,revision:number):OperationsTicket {
  return transaction(()=>{
    const {row,detail}=editable(auth,id,revision);if(detail.kind!=='facility')throw AppError.badRequest('仅厂区洗消使用区域作业')
    if(completed(row)||detail.ended_at)throw AppError.stateConflict('工单已完结')
    if(!detail.started_at)throw AppError.stateConflict('请先开始工单')
    const keys=Object.keys(areaNames) as AreaKey[],index=keys.indexOf(key)
    if(index<0)throw AppError.badRequest('区域不正确')
    if(index>0){const prior=one<{completed_at:string|null}>('SELECT completed_at FROM operations_sanitation_areas WHERE ticket_id=? AND area_key=?',[id,keys[index-1]]);if(!prior?.completed_at)throw AppError.stateConflict(`请先完成${areaNames[keys[index-1]]}`)}
    if(one('SELECT id FROM operations_sanitation_areas WHERE ticket_id=? AND area_key=?',[id,key]))throw AppError.stateConflict('该区域已开始')
    run('INSERT INTO operations_sanitation_areas (id,ticket_id,area_key,started_at,started_by) VALUES (?,?,?,?,?)',[newId('area'),id,key,nowIso(),auth.accountId])
    return bump(auth,id,'operations.sanitation.area.start')
  })
}
export function completeArea(auth:AuthContext,id:string,key:AreaKey,revision:number):OperationsTicket {
  return transaction(()=>{
    const {row,detail}=editable(auth,id,revision);if(detail.kind!=='facility')throw AppError.badRequest('仅厂区洗消使用区域作业')
    if(completed(row)||detail.ended_at)throw AppError.stateConflict('工单已完结')
    if(!Object.hasOwn(areaNames,key))throw AppError.badRequest('区域不正确')
    const area=one<{started_at:string|null;completed_at:string|null}>('SELECT started_at,completed_at FROM operations_sanitation_areas WHERE ticket_id=? AND area_key=?',[id,key])
    if(!area?.started_at)throw AppError.stateConflict('请先开始对应区域')
    if(area.completed_at)throw AppError.stateConflict('该区域已完成；首次完成时间保持不变')
    const count=one<{count:number}>(`SELECT COUNT(*) AS count FROM operations_sanitation_evidence WHERE ticket_id=? AND point_key LIKE ?`,[id,`area_${key}_%`])?.count||0
    if(count<3)throw AppError.badRequest(`${areaNames[key]}至少需要3张演示照片`)
    run('UPDATE operations_sanitation_areas SET completed_at=?,completed_by=?,revision=revision+1 WHERE ticket_id=? AND area_key=?',[nowIso(),auth.accountId,id,key])
    return bump(auth,id,'operations.sanitation.area.complete')
  })
}
function validTime(value:string|undefined):boolean{return Boolean(value&&Number.isFinite(Date.parse(value)))}
export function completeSanitation(auth:AuthContext,id:string,input:CompleteSanitationInput):OperationsTicket {
  return transaction(()=>{
    const {row,detail}=editable(auth,id,input.revision);if(completed(row)||detail.ended_at)throw AppError.stateConflict('工单已完结')
    if(!detail.started_at)throw AppError.stateConflict('请先开始工单')
    let quantity:number
    if(detail.kind==='vehicle'){
      if(typeof input.dryingRequired!=='boolean')throw AppError.badRequest('请选择是否烘干')
      const missing=Object.keys(vehiclePoints).filter(key=>key!=='drying_entry'&&!one('SELECT id FROM operations_sanitation_evidence WHERE ticket_id=? AND point_key=?',[id,key]))
      if(missing.length)throw AppError.badRequest(`请补齐7个固定点位：${missing.map(key=>vehiclePoints[key]).join('、')}`)
      if(input.dryingRequired){
        if(!one(`SELECT id FROM operations_sanitation_evidence WHERE ticket_id=? AND point_key='drying_entry'`,[id]))throw AppError.badRequest('选择烘干时必须添加入烘照片')
        if(!validTime(input.dryingStartedAt)||!validTime(input.dryingEndedAt)||Date.parse(input.dryingEndedAt!)<=Date.parse(input.dryingStartedAt!))throw AppError.badRequest('烘干起止时间必填，结束须晚于开始；支持跨天')
      }
      run('UPDATE operations_sanitation SET drying_required=?,drying_started_at=?,drying_ended_at=? WHERE ticket_id=?',[input.dryingRequired?1:0,input.dryingRequired?input.dryingStartedAt||null:null,input.dryingRequired?input.dryingEndedAt||null:null,id]);quantity=1
    }else{
      for(const key of Object.keys(areaNames))if(!one('SELECT completed_at FROM operations_sanitation_areas WHERE ticket_id=? AND area_key=? AND completed_at IS NOT NULL',[id,key]))throw AppError.badRequest('请按顺序完成生产区、生活区和办公区')
      quantity=3
    }
    run('UPDATE operations_sanitation SET ended_at=?,ended_by=? WHERE ticket_id=?',[nowIso(),auth.accountId,id])
    run(`UPDATE tickets SET status='completed',quantity=? WHERE id=?`,[quantity,id])
    run('UPDATE ticket_assignments SET actual_quantity=?*COALESCE(share_basis_points,10000)/10000,updated_at=? WHERE ticket_id=?',[quantity,nowIso(),id])
    run(`INSERT INTO ticket_events (id,ticket_id,event_type,from_status,to_status,account_id,note,payload_json,created_at) VALUES (?,?,'operations.sanitation_complete',?,'completed',?,'员工自主完单，无经理逐单验收','{}',?)`,[newId('event'),id,row.status,auth.accountId,nowIso()])
    return bump(auth,id,'operations.sanitation.complete')
  })
}
