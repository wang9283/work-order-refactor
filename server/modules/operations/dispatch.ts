import type { AssignmentRule, OperationsQuery, RosterCandidate, SanitationSummary } from '../../../packages/contracts/src/operations'
import { hasGrant, type AuthContext } from '../../core/auth'
import { AppError } from '../../core/errors'
import { all, one, run, transaction, nowIso, newId, parseJson } from '../../db/database'
import { SqliteRosterContext } from '../execution/adapters'
import { crewFor, requireManage, isMember, canManage, type CrewRow } from './service'
import { requireScopedBase, withinScopedBase, withinScopedFactory } from '../../core/base-scope'

interface RuleRow { site_id:string;ticket_type_id:string;ticket_type_name:string;crew_id:string;crew_name:string;revision:number }
export function assignmentRules(auth:AuthContext):AssignmentRule[] {
  return all<RuleRow>(`SELECT r.*,t.name AS ticket_type_name,c.name AS crew_name FROM operations_assignment_rules r JOIN ticket_types t ON t.id=r.ticket_type_id JOIN crews c ON c.id=r.crew_id ORDER BY t.name`)
    .filter(row=>withinScopedBase(auth,row.site_id))
    .filter(row=>hasGrant(auth,'ticket.assign',{type:'base',id:row.site_id}))
    .map(row=>({siteId:row.site_id,ticketTypeId:row.ticket_type_id,ticketTypeName:row.ticket_type_name,crewId:row.crew_id,crewName:row.crew_name,revision:row.revision}))
}
export function saveAssignmentRule(auth:AuthContext,input:{siteId:string;ticketTypeId:string;crewId:string;revision:number}):AssignmentRule {
  requireScopedBase(auth,input.siteId)
  const c=crewFor(auth,input.crewId)
  if(c.base_id!==input.siteId)throw AppError.badRequest('默认作业组必须属于所选基地')
  requireManage(auth,c)
  if(!one(`SELECT id FROM ticket_types WHERE id=? AND business_kind IS NULL AND status='published'`,[input.ticketTypeId]))throw AppError.badRequest('工单类型不存在或未发布')
  return transaction(()=>{
    const prior=one<{revision:number}>('SELECT revision FROM operations_assignment_rules WHERE site_id=? AND ticket_type_id=?',[input.siteId,input.ticketTypeId])
    if((prior?.revision||0)!==input.revision)throw AppError.revisionConflict()
    run(`INSERT INTO operations_assignment_rules (site_id,ticket_type_id,crew_id,updated_at,updated_by) VALUES (?,?,?,?,?)
      ON CONFLICT(site_id,ticket_type_id) DO UPDATE SET crew_id=excluded.crew_id,revision=revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,[input.siteId,input.ticketTypeId,input.crewId,nowIso(),auth.accountId])
    return assignmentRules(auth).find(r=>r.siteId===input.siteId&&r.ticketTypeId===input.ticketTypeId)!
  })
}
export function crewQualification(crewId:string):{id:string;name:string}|null {
  return one<{id:string;name:string}>(`SELECT q.id,q.name FROM operations_crew_rules r JOIN qualifications q ON q.id=r.qualification_id WHERE r.crew_id=? AND q.status='active'`,[crewId])||null
}
export function hasQualification(personId:string,crewId:string,date:string):boolean {
  const requirement=crewQualification(crewId)
  return !requirement||Boolean(one(`SELECT pq.id FROM person_qualifications pq WHERE pq.person_id=? AND pq.qualification_id=? AND pq.valid_from<=? AND (pq.valid_to IS NULL OR pq.valid_to>=?)`,[personId,requirement.id,date,date]))
}
export function rosterCandidates(auth:AuthContext,crewId:string,workDate:string):RosterCandidate[] {
  const c=crewFor(auth,crewId);requireManage(auth,c)
  const requirement=crewQualification(crewId)
  const eligible=new SqliteRosterContext().findEligibleCandidates({siteId:c.base_id,factoryId:c.factory_id,workAreaId:null,productionLineId:null,crewId:null,eventTime:`${workDate}T08:00:00+08:00`,workDate})
  return eligible.map(candidate=>({personId:candidate.person.id,personName:candidate.person.name,employeeCode:candidate.person.employeeCode,homeCrewName:candidate.crewName,temporary:!isMember({...auth,personId:candidate.person.id},crewId,workDate),qualified:hasQualification(candidate.person.id,crewId,workDate),qualificationName:requirement?.name||'无需专项资格'})).sort((a,b)=>Number(b.qualified)-Number(a.qualified)||a.employeeCode.localeCompare(b.employeeCode))
}
export function validateRosterPerson(personId:string,c:CrewRow,workDate:string):void {
  new SqliteRosterContext().validateAssignment({personId,siteId:c.base_id,factoryId:c.factory_id,crewId:null,workDate,eventTime:`${workDate}T08:00:00+08:00`})
  if(!hasQualification(personId,c.id,workDate))throw AppError.badRequest(`人员不具备该作业组所需资格：${crewQualification(c.id)?.name||'作业资格'}`)
}
export interface DefaultExecution { crew:CrewRow;shiftTemplateId:string|null;people:string[];issue:string|null;snapshot:Array<{personId:string;postId:string|null}> }
export function defaultExecution(auth:AuthContext,siteId:string,ticketTypeId:string,workDate:string):DefaultExecution {
  requireScopedBase(auth,siteId)
  const rule=one<{crew_id:string}>('SELECT crew_id FROM operations_assignment_rules WHERE site_id=? AND ticket_type_id=?',[siteId,ticketTypeId])
  if(!rule)throw AppError.badRequest('该工单类型尚未配置本基地默认作业组')
  const c=crewFor(auth,rule.crew_id)
  const roster=one<{shift_template_id:string;assignments_json:string}>(`SELECT shift_template_id,assignments_json FROM operations_rosters WHERE work_date=? AND crew_id=? ORDER BY shift_template_id LIMIT 1`,[workDate,c.id])
  const snapshot=parseJson<Array<{personId:string;postId:string|null}>>(roster?.assignments_json,[])
  const people=[...new Set(snapshot.map(row=>row.personId))]
  const qualified=people.filter(personId=>hasQualification(personId,c.id,workDate))
  const issue=!roster?'当天未安排人员':!snapshot.length?'当天安排没有人员':qualified.length!==people.length?'安排人员资格不符':null
  return {crew:c,shiftTemplateId:roster?.shift_template_id||null,people:issue?[]:qualified,issue,snapshot}
}
export function saveShift(auth:AuthContext,input:{id?:string;siteId?:string;code?:string;name:string;startTime:string;endTime:string;status:'active'|'inactive';revision:number}) {
  const existing=input.id?one<{id:string;base_id:string;revision:number}>('SELECT id,base_id,revision FROM shift_templates WHERE id=?',[input.id]):undefined
  if(input.id&&!existing)throw AppError.notFound('班次')
  const siteId=existing?.base_id||input.siteId
  if(siteId)requireScopedBase(auth,siteId)
  if(!siteId||!hasGrant(auth,'ticket.assign',{type:'base',id:siteId}))throw AppError.forbidden('仅基地管理人员可维护班次')
  if(existing&&existing.revision!==input.revision)throw AppError.revisionConflict()
  const id=existing?.id||newId('shift')
  const crossDay=input.endTime<=input.startTime?1:0
  run(`INSERT INTO shift_templates (id,code,name,base_id,start_time,end_time,cross_day,status,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,start_time=excluded.start_time,end_time=excluded.end_time,cross_day=excluded.cross_day,status=excluded.status,revision=revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,[id,input.code||`SHIFT-${id.slice(-6)}`,input.name,siteId,input.startTime,input.endTime,crossDay,input.status,nowIso(),nowIso(),auth.accountId,auth.accountId])
  return {id,name:input.name,siteId,startTime:input.startTime,endTime:input.endTime,crossDay:crossDay===1,status:input.status,revision:(existing?.revision||0)+1}
}
/** Read-only daily sanitation order summary for the PC planning month table. */
export function sanitationSummary(auth:AuthContext,query:OperationsQuery={}):SanitationSummary[] {
  const managed=query.scope==='managed'
  if(query.crewId)requireManage(auth,crewFor(auth,query.crewId))
  return all<{ticket_id:string;ticket_no:string;work_date:string;kind:'vehicle'|'facility';status:string;plate_number:string|null;assignment_issue:string|null;crew_id:string|null;factory_id:string;site_id:string}>(
    `SELECT t.id AS ticket_id,t.ticket_no,t.work_date,s.kind,t.status,s.plate_number,s.assignment_issue,t.crew_id,t.factory_id,t.site_id
     FROM operations_sanitation s JOIN tickets t ON t.id=s.ticket_id
     WHERE t.status<>'cancelled' ORDER BY t.work_date,t.ticket_no`)
    .filter(row=>withinScopedBase(auth,row.site_id))
    .filter(row=>withinScopedFactory(auth,row.factory_id))
    .filter(row=>(!query.dateFrom||row.work_date>=query.dateFrom)&&(!query.dateTo||row.work_date<=query.dateTo)&&(!query.crewId||row.crew_id===query.crewId))
    .filter(row=>{
      if(!managed)return one('SELECT id FROM ticket_assignments WHERE ticket_id=? AND person_id=?',[row.ticket_id,auth.personId])!==undefined
      return row.crew_id?canManage(auth,crewFor(auth,row.crew_id)):hasGrant(auth,'ticket.assign',{type:'factory',id:row.factory_id})
    })
    .map(row=>({ticketId:row.ticket_id,ticketNo:row.ticket_no,workDate:row.work_date,kind:row.kind,status:row.status,plateNumber:row.plate_number,assignmentIssue:row.assignment_issue}))
}
