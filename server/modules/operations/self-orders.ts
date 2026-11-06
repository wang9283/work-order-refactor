import type { SelfCreateInput, CompleteSelfInput, OperationsTicket } from '../../../packages/contracts/src/operations'
import type { FormVersionSchema } from '../../../packages/contracts/src'
import { hasGrant, type AuthContext } from '../../core/auth'
import { AppError } from '../../core/errors'
import { one, run, transaction, nowIso, newId, parseJson } from '../../db/database'
import { createTicket } from '../execution/repository'
import { validateFrozenForm } from '../execution/form-validator'
import { crewFor, isMember } from './service'
import { ticketRow, readTicket, mapTicket, completed, participates } from './workloads'

export function selfCreate(auth:AuthContext,input:SelfCreateInput):OperationsTicket {
  const c=crewFor(auth,input.crewId)
  if(!auth.personId||!isMember(auth,c.id,input.workDate)||!hasGrant(auth,'ticket.execute',{type:'factory',id:c.factory_id}))throw AppError.forbidden('员工只能为本人所在班组自建其他工单')
  if(!one(`SELECT id FROM ticket_types WHERE id=? AND business_kind IS NULL AND status='published'`,[input.ticketTypeId]))throw AppError.badRequest('员工自建仅支持已发布的其他工单类型')
  return transaction(()=>{
    const prior=one<{ticket_id:string}>(`SELECT ticket_id FROM operations_ticket_sources WHERE source_namespace=? AND source_key=?`,[`self:${auth.accountId}`,input.clientRequestId])
    if(prior)return readTicket(auth,prior.ticket_id)
    // The narrowly scoped adapter privilege stays inside this operation; all location and participants are inferred above.
    const created=createTicket({...auth,grants:[...auth.grants,{capability:'ticket.create',type:'factory',id:c.factory_id}]},{
      ticketTypeId:input.ticketTypeId,businessKind:'generic',siteId:c.base_id,factoryId:c.factory_id,workAreaId:null,productionLineId:null,crewId:c.id,
      shiftTemplateId:input.shiftTemplateId||null,workDate:input.workDate,eventTime:`${input.workDate}T08:00:00+08:00`,
      assignments:[{personId:auth.personId!,role:'member'}],quantity:input.quantity??null,
    })
    run(`UPDATE tickets SET values_json=?,sub_form_values_json=? WHERE id=?`,[JSON.stringify(input.values),JSON.stringify(input.subFormValues||{}),created.id])
    run(`UPDATE ticket_assignments SET share_basis_points=10000 WHERE ticket_id=?`,[created.id])
    run(`INSERT INTO operations_ticket_sources (ticket_id,source,source_namespace,source_key,created_at) VALUES (?,'self',?,?,?)`,[created.id,`self:${auth.accountId}`,input.clientRequestId,nowIso()])
    return mapTicket(auth,ticketRow(auth,created.id))
  })
}
export function completeSelf(auth:AuthContext,id:string,input:CompleteSelfInput):OperationsTicket {
  return transaction(()=>{
    const row=ticketRow(auth,id)
    if(one('SELECT ticket_id FROM operations_sanitation WHERE ticket_id=?',[id]))throw AppError.badRequest('洗消工单请按作业步骤完结')
    const source=one<{source:string}>('SELECT source FROM operations_ticket_sources WHERE ticket_id=?',[id])
    if(source?.source!=='self'||row.created_by!==auth.accountId||!participates(auth,id))throw AppError.forbidden('只能自主完结本人创建的其他工单')
    if(row.revision!==input.revision)throw AppError.revisionConflict()
    if(completed(row)||row.status==='cancelled')throw AppError.stateConflict('该工单已完结或取消')
    const schema=parseJson<FormVersionSchema>(row.form_snapshot_json,{mainFields:[],subForms:[],conditionRules:[]})
    const subForms=input.subFormValues??parseJson(row.sub_form_values_json,{})
    const validated=validateFrozenForm(schema,input.values,subForms)
    if(!validated.valid)throw AppError.badRequest('请完整填写工单内容',validated.issues)
    run(`UPDATE tickets SET status='completed',quantity=?,values_json=?,sub_form_values_json=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=?`,[input.quantity,JSON.stringify(input.values),JSON.stringify(subForms),nowIso(),auth.accountId,id,input.revision])
    run(`UPDATE ticket_assignments SET actual_quantity=?*COALESCE(share_basis_points,10000)/10000,updated_at=? WHERE ticket_id=?`,[input.quantity,nowIso(),id])
    run(`INSERT INTO ticket_events (id,ticket_id,event_type,from_status,to_status,account_id,note,payload_json,created_at) VALUES (?,?,'operations.self_complete',?,'completed',?,'员工自主完单，无经理逐单验收','{}',?)`,[newId('event'),id,row.status,auth.accountId,nowIso()])
    return mapTicket(auth,ticketRow(auth,id))
  })
}
