import type {
  OperationsTicket, OperationsQuery, OperationsWorkItem, WorkloadResult, DemoSyncInput,
} from '../../../packages/contracts/src/operations'
import type { FormVersionSchema } from '../../../packages/contracts/src'
import { hasGrant, type AuthContext } from '../../core/auth'
import { AppError } from '../../core/errors'
import { all, one, run, transaction, nowIso, newId, parseJson } from '../../db/database'
import { createTicket } from '../execution/repository'
import { listBusinessWorkItems, setBusinessWorkItemAssignments } from '../business/service'
import { canManage, crew, crewFor, requireManage } from './service'
import { sanitationDetail } from './sanitation'
import { requireScopedBase, withinScopedBase } from '../../core/base-scope'

export interface TicketRow {
  id:string; ticket_no:string; ticket_type_id:string; business_kind:'generic'|'production'|'loading';
  work_date:string; crew_id:string|null; factory_id:string; site_id:string; shift_template_id:string|null;
  quantity:number|null; status:string; revision:number; created_by:string|null;
  ticket_type_snapshot_json:string; form_snapshot_json:string; values_json:string; sub_form_values_json:string; site_snapshot_json:string;
}
interface AssignmentRow { id:string;person_id:string;person_name:string;share_basis_points:number|null;actual_quantity:number|null }
export function ticketRow(auth:AuthContext,id:string):TicketRow {
  const row=one<TicketRow>('SELECT * FROM tickets WHERE id=?',[id])
  if(!row)throw AppError.notFound('工单')
  requireScopedBase(auth,row.site_id)
  return row
}
export function managesTicket(auth:AuthContext,row:TicketRow):boolean {
  if(!withinScopedBase(auth,row.site_id))return false
  return row.crew_id?canManage(auth,crew(row.crew_id)):hasGrant(auth,'ticket.assign',{type:'factory',id:row.factory_id})
}
export function participates(auth:AuthContext,id:string):boolean {
  return Boolean(auth.personId&&one('SELECT id FROM ticket_assignments WHERE ticket_id=? AND person_id=?',[id,auth.personId]))
}
export function completed(row:TicketRow):boolean { return ['completed','closed'].includes(row.status) }
export function assertVisible(auth:AuthContext,row:TicketRow):void {
  requireScopedBase(auth,row.site_id)
  const sanitationCreator=one<{published_by:string}>('SELECT published_by FROM operations_sanitation WHERE ticket_id=? AND published_by=?',[row.id,auth.accountId])
  if(!managesTicket(auth,row)&&!participates(auth,row.id)&&!sanitationCreator)throw AppError.forbidden()
}
export function equalShares(ids:string[]):Array<{personId:string;shareBasisPoints:number}> {
  const sorted=[...new Set(ids)].sort()
  return sorted.map((personId,i)=>({personId,shareBasisPoints:Math.floor(10000/sorted.length)+(i<10000%sorted.length?1:0)}))
}
function assignments(id:string):AssignmentRow[] {
  return all(`SELECT a.id,a.person_id,COALESCE(NULLIF(a.person_name_snapshot,''),p.name) AS person_name,a.share_basis_points,a.actual_quantity FROM ticket_assignments a JOIN people p ON p.id=a.person_id WHERE ticket_id=? ORDER BY a.person_id`,[id])
}
export function mapTicket(auth:AuthContext,row:TicketRow,full=managesTicket(auth,row)):OperationsTicket {
  const confirmation=(personId:string)=>one<{confirmed_at:string}>('SELECT confirmed_at FROM operations_confirmations WHERE ticket_id=? AND person_id=?',[row.id,personId])?.confirmed_at||null
  const source=one<{source:'self'|'demo_sync';source_key:string}>('SELECT source,source_key FROM operations_ticket_sources WHERE ticket_id=?',[row.id])
  const shares=assignments(row.id)
  let items:OperationsWorkItem[]
  if(row.business_kind==='generic') {
    const prices=one<{unit:string|null;unit_price_micros:number|null}>('SELECT unit,unit_price_micros FROM ticket_pricing WHERE ticket_id=?',[row.id])
    const sanitation=one<{kind:'vehicle'|'facility'}>('SELECT kind FROM operations_sanitation WHERE ticket_id=?',[row.id])
    items=[{id:`generic:${row.id}`,catalogId:null,name:sanitation?.kind==='vehicle'?'车辆洗消':sanitation?.kind==='facility'?'厂区洗消':'其他作业',unit:sanitation?.kind==='vehicle'?'辆':sanitation?.kind==='facility'?'区':prices?.unit||'项',unitPriceMicros:prices?.unit_price_micros??null,revision:row.revision,
      assignments:shares.map(a=>{
        const equal=equalShares(shares.map(s=>s.person_id)).find(s=>s.personId===a.person_id)!.shareBasisPoints
        const basis=a.share_basis_points??(a.actual_quantity!==null&&row.quantity?Math.round(a.actual_quantity/row.quantity*10000):equal)
        return {personId:a.person_id,personName:a.person_name,shareBasisPoints:basis,quantity:a.actual_quantity??(row.quantity||0)*basis/10000,confirmedAt:confirmation(a.person_id)}
      })}]
  } else items=listBusinessWorkItems(row.id,row.quantity).map(i=>({id:i.id,catalogId:i.catalogId,name:i.name,unit:i.unit,unitPriceMicros:i.unitPriceMicros,revision:row.revision,
    assignments:i.assignments.map(a=>({personId:a.personId,personName:a.personName,shareBasisPoints:a.shareBasisPoints,quantity:a.quantity||0,confirmedAt:confirmation(a.personId)}))}))
  if(!full)items=items.map(i=>({...i,assignments:i.assignments.filter(a=>a.personId===auth.personId)})).filter(i=>i.assignments.length)
  const snapshot=parseJson<{name?:string}>(row.ticket_type_snapshot_json,{})
  const siteSnapshot=parseJson<{crewName?:string;shiftName?:string}>(row.site_snapshot_json,{})
  const sanitationRow=one<{kind:'vehicle'|'facility';assignment_issue:string|null}>('SELECT kind,assignment_issue FROM operations_sanitation WHERE ticket_id=?',[row.id])
  const typeInfo=one<{type_name:string;category_name:string}>(`SELECT t.name AS type_name,c.name AS category_name
    FROM ticket_types t JOIN ticket_categories c ON c.id=t.category_id WHERE t.id=?`,[row.ticket_type_id])
  const ticketTypeName=snapshot.name||typeInfo?.type_name||'工单'
  return {id:row.id,ticketNo:row.ticket_no,title:ticketTypeName,businessKind:row.business_kind,
    ticketTypeId:row.ticket_type_id,ticketTypeName,ticketCategoryName:typeInfo?.category_name||'其他',
    workDate:row.work_date,crewId:row.crew_id,crewName:siteSnapshot.crewName||(row.crew_id?one<{name:string}>('SELECT name FROM crews WHERE id=?',[row.crew_id])?.name||'':'未指定班组'),
    shiftTemplateId:row.shift_template_id,shiftName:siteSnapshot.shiftName||(row.shift_template_id?one<{name:string}>('SELECT name FROM shift_templates WHERE id=?',[row.shift_template_id])?.name||'':'未指定班次'),
    status:row.status,completed:completed(row),quantity:row.quantity,revision:row.revision,source:source?.source||'legacy',sourceKey:source?.source_key||null,createdByMe:row.created_by===auth.accountId,
    canManage:managesTicket(auth,row),canComplete:!sanitationRow&&source?.source==='self'&&row.created_by===auth.accountId&&participates(auth,row.id)&&!completed(row)&&row.status!=='cancelled',
    values:parseJson(row.values_json,{}),subFormValues:parseJson(row.sub_form_values_json,{}),formSchema:parseJson<FormVersionSchema>(row.form_snapshot_json,{mainFields:[],subForms:[],conditionRules:[]}),workItems:items,
    assignmentIssue:sanitationRow?.assignment_issue||null,sanitation:sanitationDetail(row.id)}
}
export function readTicket(auth:AuthContext,id:string):OperationsTicket {
  const row=ticketRow(auth,id);assertVisible(auth,row);return mapTicket(auth,row)
}
export function workloads(auth:AuthContext,query:OperationsQuery={}):WorkloadResult {
  const full=query.scope==='managed'
  if(full&&query.crewId)requireManage(auth,crewFor(auth,query.crewId))
  const tickets=all<TicketRow>('SELECT * FROM tickets ORDER BY work_date DESC,created_at DESC')
    .filter(r=>withinScopedBase(auth,r.site_id))
    .filter(r=>(!query.dateFrom||r.work_date>=query.dateFrom)&&(!query.dateTo||r.work_date<=query.dateTo)&&(!query.crewId||r.crew_id===query.crewId)&&(!query.ticketTypeId||r.ticket_type_id===query.ticketTypeId)&&(!query.status||r.status===query.status))
    .filter(r=>!query.plateNumber||one<{ticket_id:string}>('SELECT ticket_id FROM operations_sanitation WHERE ticket_id=? AND plate_number LIKE ?',[r.id,`%${query.plateNumber}%`]))
    .filter(r=>full?managesTicket(auth,r):participates(auth,r.id))
    .map(r=>mapTicket(auth,r,full))
  const done=tickets.filter(t=>t.completed)
  return {tickets,totals:{ticketCount:done.length,orderQuantity:done.reduce((sum,t)=>sum+(t.quantity||0),0),
    personalQuantity:done.reduce((sum,t)=>sum+t.workItems.reduce((s,i)=>s+i.assignments.reduce((n,a)=>n+a.quantity,0),0),0),
    confirmedTicketCount:done.filter(t=>t.workItems.some(i=>i.assignments.length)&&t.workItems.every(i=>i.assignments.every(a=>a.confirmedAt))).length}}
}
export function demoSync(auth:AuthContext,input:DemoSyncInput):{ticket:OperationsTicket;duplicate:boolean} {
  const c=crewFor(auth,input.crewId);requireManage(auth,c)
  return transaction(()=>{
    const prior=one<{ticket_id:string}>(`SELECT ticket_id FROM operations_ticket_sources WHERE source_namespace='demo-upstream' AND source_key=?`,[input.sourceKey])
    if(prior) {
      const row=ticketRow(auth,prior.ticket_id)
      assertVisible(auth,row)
      return {ticket:mapTicket(auth,row),duplicate:true}
    }
    const roster=one<{assignments_json:string}>(`SELECT assignments_json FROM operations_rosters WHERE work_date=? AND shift_template_id=? AND crew_id=?`,[input.workDate,input.shiftTemplateId,c.id])
    const snapshot=parseJson<Array<{personId:string;postId:string|null}>>(roster?.assignments_json,[])
    if(input.businessKind==='production'&&!input.materialId)throw AppError.badRequest('生产同步须选择产品')
    if(input.businessKind==='loading'&&!input.loadingTypeId)throw AppError.badRequest('装卸同步须选择装卸类型')
    const created=createTicket({...auth,grants:[...auth.grants,{capability:'ticket.create',type:'factory',id:c.factory_id}]},{
      ticketTypeId:input.businessKind==='production'?'type_builtin_production':'type_builtin_loading',businessKind:input.businessKind,
      materialId:input.materialId,siteId:c.base_id,factoryId:c.factory_id,workAreaId:null,productionLineId:null,crewId:c.id,shiftTemplateId:input.shiftTemplateId,
      workDate:input.workDate,eventTime:`${input.workDate}T08:00:00+08:00`,quantity:input.quantity,
      // The product defines the full production post scope, including unstaffed posts.
      businessItems:input.businessKind==='loading'?[{kind:'loading_type',catalogId:input.loadingTypeId!}]:[],
      assignments:[...new Set(snapshot.map(a=>a.personId))].map(personId=>({personId,role:'member'})),
    })
    for(const item of created.businessWorkItems) {
      const matching=input.businessKind==='production'?snapshot.filter(a=>a.postId===item.catalogId):snapshot
      const shares=equalShares(matching.map(a=>a.personId))
      setBusinessWorkItemAssignments(item.id,shares.map(s=>({ticketAssignmentId:created.assignments.find(a=>a.personId===s.personId)!.id,shareBasisPoints:s.shareBasisPoints})))
    }
    run(`INSERT INTO operations_ticket_sources (ticket_id,source,source_namespace,source_key,roster_snapshot_json,created_at) VALUES (?,'demo_sync','demo-upstream',?,?,?)`,[created.id,input.sourceKey,JSON.stringify(snapshot),nowIso()])
    run(`UPDATE tickets SET status='completed',updated_at=?,updated_by=? WHERE id=?`,[nowIso(),auth.accountId,created.id])
    run(`INSERT INTO ticket_events (id,ticket_id,event_type,to_status,account_id,note,payload_json,created_at) VALUES (?,?,'operations.demo_sync','completed',?,'本地模拟业务系统同步完工',?,?)`,[newId('event'),created.id,auth.accountId,JSON.stringify({sourceKey:input.sourceKey,simulated:true}),nowIso()])
    return {ticket:mapTicket(auth,ticketRow(auth,created.id)),duplicate:false}
  })
}
