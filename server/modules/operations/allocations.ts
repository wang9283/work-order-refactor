import type { OperationsFeedback, OperationsQuery, AdjustAssignmentsInput, OperationsTicket, WorkloadExport } from '../../../packages/contracts/src/operations'
import type { AuthContext } from '../../core/auth'
import { AppError } from '../../core/errors'
import { writeAudit } from '../../core/audit'
import { all, one, run, transaction, nowIso, newId } from '../../db/database'
import { SqliteRosterContext } from '../execution/adapters'
import { setBusinessWorkItemAssignments } from '../business/service'
import { crewFor, requireManage, context } from './service'
import { ticketRow, mapTicket, managesTicket, participates, completed, workloads } from './workloads'
import { hasQualification } from './dispatch'
import { withinScopedBase } from '../../core/base-scope'

export function adjustAssignments(auth:AuthContext,id:string,itemId:string,input:AdjustAssignmentsInput):OperationsTicket {
  return transaction(()=>{
    const row=ticketRow(auth,id)
    if(!managesTicket(auth,row))throw AppError.forbidden()
    if(row.revision!==input.revision)throw AppError.revisionConflict()
    if(row.status==='cancelled')throw AppError.stateConflict('已取消工单不能调整')
    if(!input.assignments.length||new Set(input.assignments.map(a=>a.personId)).size!==input.assignments.length)throw AppError.badRequest('请填写不重复的分配人员')
    if(input.assignments.reduce((sum,a)=>sum+a.shareBasisPoints,0)!==10000)throw AppError.badRequest('人员贡献比例必须合计100%')
    if(row.business_kind==='generic') {
      if(itemId!==`generic:${id}`)throw AppError.notFound('作业项')
    } else if(!one('SELECT id FROM ticket_business_work_items WHERE id=? AND ticket_id=?',[itemId,id]))throw AppError.notFound('作业项')
    const before=mapTicket(auth,row,true)
    const ids=new Map<string,string>()
    for(const a of input.assignments) {
      const prior=one<{id:string}>('SELECT id FROM ticket_assignments WHERE ticket_id=? AND person_id=?',[id,a.personId])
      if(prior){ids.set(a.personId,prior.id);continue}
      if(row.crew_id&&!hasQualification(a.personId,row.crew_id,row.work_date))throw AppError.badRequest('临时参与人员不具备该工单所需作业资格')
      const candidate=new SqliteRosterContext().validateAssignment({personId:a.personId,siteId:row.site_id,factoryId:row.factory_id,crewId:row.crew_id,workDate:row.work_date,eventTime:`${row.work_date}T08:00:00+08:00`})
      const assignmentId=newId('assign');ids.set(a.personId,assignmentId)
      run(`INSERT INTO ticket_assignments (id,ticket_id,person_id,role,assignment_source,created_at,updated_at,person_name_snapshot,person_snapshot_json) VALUES (?,?,?,'member',?,?,?,?,?)`,[assignmentId,id,a.personId,candidate.source,nowIso(),nowIso(),candidate.person.name,JSON.stringify(candidate.person)])
    }
    if(row.business_kind==='generic') {
      const retained=new Set(input.assignments.map(a=>a.personId))
      for(const previous of all<{person_id:string}>('SELECT person_id FROM ticket_assignments WHERE ticket_id=?',[id])) {
        if(!retained.has(previous.person_id))run('DELETE FROM ticket_assignments WHERE ticket_id=? AND person_id=?',[id,previous.person_id])
      }
      run(`UPDATE ticket_assignments SET share_basis_points=0,actual_quantity=0,updated_at=? WHERE ticket_id=?`,[nowIso(),id])
      for(const a of input.assignments)run(`UPDATE ticket_assignments SET share_basis_points=?,actual_quantity=?,updated_at=? WHERE ticket_id=? AND person_id=?`,[a.shareBasisPoints,(row.quantity||0)*a.shareBasisPoints/10000,nowIso(),id,a.personId])
    } else {
      setBusinessWorkItemAssignments(itemId,input.assignments.map(a=>({ticketAssignmentId:ids.get(a.personId)!,shareBasisPoints:a.shareBasisPoints})))
      run(`UPDATE ticket_business_work_items SET revision=revision+1 WHERE id=?`,[itemId])
      run(`DELETE FROM ticket_assignments WHERE ticket_id=? AND NOT EXISTS (
        SELECT 1 FROM ticket_business_work_item_assignments a WHERE a.ticket_assignment_id=ticket_assignments.id
      )`,[id])
    }
    run(`UPDATE tickets SET revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=?`,[nowIso(),auth.accountId,id,input.revision])
    run('UPDATE operations_sanitation SET assignment_issue=NULL WHERE ticket_id=?',[id])
    const after=mapTicket(auth,ticketRow(auth,id),true)
    writeAudit({accountId:auth.accountId,ipAddress:auth.ipAddress,action:'operations.assignments.adjust',entityType:'ticket',entityId:id,scopeType:'factory',scopeId:row.factory_id,before,after:{ticket:after,reason:input.reason}})
    return after
  })
}
export function confirm(auth:AuthContext,ticketIds:string[]):{confirmed:number} {
  if(!auth.personId)throw AppError.forbidden('工作量由员工本人确认')
  return transaction(()=>{
    for(const id of new Set(ticketIds)) {
      const row=ticketRow(auth,id)
      if(!participates(auth,id))throw AppError.forbidden('只能确认本人参与的工单')
      if(!completed(row))throw AppError.stateConflict('仅已完工工单可确认工作量')
      run(`INSERT OR IGNORE INTO operations_confirmations (ticket_id,person_id,confirmed_at,confirmed_by) VALUES (?,?,?,?)`,[id,auth.personId,nowIso(),auth.accountId])
    }
    return {confirmed:new Set(ticketIds).size}
  })
}
interface FeedbackRow { id:string;ticket_id:string;person_id:string;message:string;status:'open'|'resolved';response:string;created_at:string;resolved_at:string|null;revision:number;ticket_no:string;person_name:string;crew_id:string|null;work_date:string;site_id:string }
function feedbackRows():FeedbackRow[] {
  return all(`SELECT f.*,t.ticket_no,t.crew_id,t.work_date,t.site_id,p.name AS person_name FROM operations_feedback f JOIN tickets t ON t.id=f.ticket_id JOIN people p ON p.id=f.person_id ORDER BY f.created_at DESC,f.id`)
}
function mapFeedback(row:FeedbackRow):OperationsFeedback {
  return {id:row.id,ticketId:row.ticket_id,ticketNo:row.ticket_no,personId:row.person_id,personName:row.person_name,crewId:row.crew_id,message:row.message,status:row.status,response:row.response,createdAt:row.created_at,resolvedAt:row.resolved_at,revision:row.revision}
}
export function feedback(auth:AuthContext,query:OperationsQuery={}):OperationsFeedback[] {
  if(query.crewId)requireManage(auth,crewFor(auth,query.crewId))
  return feedbackRows().filter(f=>withinScopedBase(auth,f.site_id)).filter(f=>(!query.dateFrom||f.work_date>=query.dateFrom)&&(!query.dateTo||f.work_date<=query.dateTo)&&(!query.crewId||f.crew_id===query.crewId))
    .filter(f=>query.scope==='managed'?managesTicket(auth,ticketRow(auth,f.ticket_id)):f.person_id===auth.personId).map(mapFeedback)
}
export function createFeedback(auth:AuthContext,ticketId:string,message:string):OperationsFeedback {
  if(!auth.personId||!participates(auth,ticketId))throw AppError.forbidden('只能反馈本人参与的工单')
  if(!completed(ticketRow(auth,ticketId)))throw AppError.stateConflict('仅已完工工单可反馈工作量')
  const id=newId('feedback')
  run(`INSERT INTO operations_feedback (id,ticket_id,person_id,message,created_at) VALUES (?,?,?,?,?)`,[id,ticketId,auth.personId,message,nowIso()])
  return mapFeedback(feedbackRows().find(f=>f.id===id)!)
}
export function resolveFeedback(auth:AuthContext,id:string,revision:number,response:string):OperationsFeedback {
  return transaction(()=>{
    const old=feedbackRows().find(f=>f.id===id)
    if(!old)throw AppError.notFound('反馈')
    if(!managesTicket(auth,ticketRow(auth,old.ticket_id)))throw AppError.forbidden()
    if(old.revision!==revision)throw AppError.revisionConflict()
    run(`UPDATE operations_feedback SET status='resolved',response=?,revision=revision+1,resolved_at=?,resolved_by=? WHERE id=? AND revision=?`,[response,nowIso(),auth.accountId,id,revision])
    const result=mapFeedback(feedbackRows().find(f=>f.id===id)!)
    writeAudit({accountId:auth.accountId,action:'operations.feedback.resolve',entityType:'feedback',entityId:id,before:mapFeedback(old),after:result})
    return result
  })
}
export function exportWorkloads(auth:AuthContext,query:OperationsQuery):WorkloadExport {
  if(!context(auth).crews.some(c=>c.canManage))throw AppError.forbidden('仅授权管理人员可核对工作量输出')
  const result=workloads(auth,{...query,scope:'managed'})
  return {generatedAt:nowIso(),simulated:true,totals:result.totals,rows:result.tickets.filter(t=>t.completed).flatMap(t=>t.workItems.flatMap(i=>i.assignments.map(a=>({ticketId:t.id,ticketNo:t.ticketNo,workDate:t.workDate,businessKind:t.businessKind,crewId:t.crewId,workItemId:i.id,workItemName:i.name,personId:a.personId,personName:a.personName,quantity:a.quantity,unit:i.unit,shareBasisPoints:a.shareBasisPoints,confirmedAt:a.confirmedAt,ticketRevision:t.revision}))))}
}
