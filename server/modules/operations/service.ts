import type {
  OperationsContext, OperationsCrew, OperationsQuery, OperationsRoster, SaveRosterInput, RosterAssignment,
} from '../../../packages/contracts/src/operations'
import { hasGrant, type AuthContext } from '../../core/auth'
import { AppError } from '../../core/errors'
import { all, one, run, transaction, newId, nowIso, parseJson } from '../../db/database'
import { SqliteRosterContext, SqliteTicketContext } from '../execution/adapters'
import { writeAudit } from '../../core/audit'
import { requireScopedBase, scopedBaseId, withinScopedBase } from '../../core/base-scope'
import { listTicketCatalog } from '../templates/repository'

export interface CrewRow { id: string; name: string; base_id: string; factory_id: string; work_area_id: string | null }
interface RosterRow {
  id: string; work_date: string; shift_template_id: string; shift_name: string; crew_id: string; crew_name: string
  base_id: string
  revision: number; source: 'monthly' | 'daily'; note: string; assignments_json: string; updated_at: string
  attribution_date:string|null;shift_start_date:string|null;shift_name_snapshot:string;shift_start_time_snapshot:string;shift_end_time_snapshot:string;shift_cross_day_snapshot:number
}
export function today(): string { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) }
export function crew(id: string): CrewRow {
  const row=one<CrewRow>(`SELECT id,name,base_id,factory_id,work_area_id FROM crews WHERE id=? AND status='active'`,[id])
  if(!row || !row.factory_id) throw AppError.badRequest('班组不存在、已停用或未归属工厂')
  return row
}
export function crewFor(auth: AuthContext, id: string): CrewRow {
  const row = crew(id)
  requireScopedBase(auth, row.base_id)
  return row
}
export function isMember(auth: AuthContext, crewId: string, date=today()): boolean {
  return Boolean(auth.personId && one(`SELECT id FROM crew_memberships WHERE person_id=? AND crew_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)`,[auth.personId,crewId,date,date]))
}
export function canPlan(auth: AuthContext,c: CrewRow): boolean {
  return hasGrant(auth,'ticket.assign',{type:'factory',id:c.factory_id})
}
export function canManage(auth: AuthContext,c: CrewRow): boolean {
  if(canPlan(auth,c)) return true
  return Boolean(auth.personId && hasGrant(auth,'ticket.execute',{type:'factory',id:c.factory_id}) && one(`SELECT id FROM crew_memberships WHERE person_id=? AND crew_id=? AND role='leader' AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)`,[auth.personId,c.id,today(),today()]))
}
export function requireManage(auth: AuthContext,c: CrewRow): void { if(!canManage(auth,c)) throw AppError.forbidden('仅授权班组组长或管理人员可操作') }
function mappedCrew(auth: AuthContext,c: CrewRow): OperationsCrew {
  return {id:c.id,name:c.name,siteId:c.base_id,factoryId:c.factory_id,canManage:canManage(auth,c),canPlanMonth:canPlan(auth,c),qualificationId:one<{qualification_id:string|null}>('SELECT qualification_id FROM operations_crew_rules WHERE crew_id=?',[c.id])?.qualification_id||null}
}
export function context(auth: AuthContext): OperationsContext {
  const selectedBase = scopedBaseId(auth)
  const crews=all<CrewRow>(`SELECT id,name,base_id,factory_id,work_area_id FROM crews WHERE status='active' AND factory_id IS NOT NULL ORDER BY name`)
    .filter(c=>withinScopedBase(auth,c.base_id))
    .filter(c=>canManage(auth,c)||isMember(auth,c.id))
  const manageable=new Set(crews.filter(c=>canManage(auth,c)).map(c=>c.id))
  const people=all<{id:string;name:string;employee_code:string,home_base_id:string}>(`SELECT id,name,employee_code,home_base_id FROM people WHERE status='active' ORDER BY employee_code`)
    .filter(p=>selectedBase===null||p.home_base_id===selectedBase||Boolean(one(`SELECT id FROM secondments WHERE person_id=? AND to_base_id=? AND status IN ('planned','active') AND start_date<=? AND end_date>=?`,[p.id,selectedBase,today(),today()])))
    .map(p=>({...p,crewIds:all<{crew_id:string}>(`SELECT crew_id FROM crew_memberships WHERE person_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)`,[p.id,today(),today()]).map(x=>x.crew_id)}))
    .filter(p=>p.id===auth.personId||p.crewIds.some(id=>manageable.has(id)))
    .map(p=>({id:p.id,name:p.name,employeeCode:p.employee_code,crewIds:p.crewIds.filter(id=>crews.some(c=>c.id===id))}))
  const sites=new Set(crews.map(c=>c.base_id))
  const companyIds=new Set(crews.map(c=>one<{company_id:string}>('SELECT company_id FROM production_bases WHERE id=?',[c.base_id])?.company_id).filter((id):id is string=>Boolean(id)))
  const templates=all<{id:string;name:string;code:string;owner_type:string;owner_id:string}>(`SELECT id,name,code,owner_type,owner_id FROM ticket_types WHERE status='published' AND business_kind IS NULL ORDER BY name`)
    .filter(t=>t.owner_type==='group'||crews.some(c=>one<{company_id:string}>('SELECT company_id FROM production_bases WHERE id=?',[c.base_id])?.company_id===t.owner_id))
  return {
    today:today(),personId:auth.personId,crews:crews.map(c=>mappedCrew(auth,c)),people,
    shifts:all<{id:string;name:string;siteId:string;startTime:string;endTime:string;crossDay:number;revision:number;status:'active'|'inactive'}>(`SELECT id,name,base_id AS siteId,start_time AS startTime,end_time AS endTime,cross_day AS crossDay,revision,status FROM shift_templates WHERE status IN ('active','inactive') ORDER BY start_time`).filter(s=>withinScopedBase(auth,s.siteId)).filter(s=>sites.has(s.siteId)).map(s=>({...s,crossDay:Boolean(s.crossDay)})),
    posts:all(`SELECT id,name FROM business_catalog WHERE kind='production_post' AND status='active' ORDER BY name`),
    loadingTypes:all(`SELECT id,name FROM business_catalog WHERE kind='loading_type' AND status='active' ORDER BY name`),
    materials:all<{id:string;name:string;materialTypeId:string}>(`SELECT id,name,material_type_id AS materialTypeId FROM materials WHERE status='active' ORDER BY name`).map(m=>({...m,postIds:all<{post_catalog_id:string}>(`SELECT post_catalog_id FROM material_post_flags WHERE material_id=? ORDER BY post_catalog_id`,[m.id]).map(x=>x.post_catalog_id)})),
    ticketCatalog:listTicketCatalog(
      (type)=>type.ownerType==='group'||companyIds.has(type.ownerId),
      (category)=>category.ownerType==='group'||companyIds.has(category.ownerId),
    ),
    selfCreateTemplates:templates.map(t=>({id:t.id,name:t.name,code:t.code,formSchema:new SqliteTicketContext().resolveTicketTypeVersion(t.id).formSchema,sanitationKind:t.code==='VEHICLE_SANITATION'?'vehicle':t.code==='FACILITY_SANITATION'?'facility':null})),
  }
}
function rosterMap(row:RosterRow,auth:AuthContext,managed:boolean):OperationsRoster {
  const assignments=parseJson<RosterAssignment[]>(row.assignments_json,[])
    .filter(a=>managed||a.personId===auth.personId)
    .map(a=>({...a,personName:one<{name:string}>('SELECT name FROM people WHERE id=?',[a.personId])?.name||'',postName:a.postId?one<{name:string}>('SELECT name FROM business_catalog WHERE id=?',[a.postId])?.name||'':null,temporary:!one('SELECT id FROM crew_memberships WHERE person_id=? AND crew_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)',[a.personId,row.crew_id,row.work_date,row.work_date]),qualified:true,homeCrewName:one<{name:string}>(`SELECT c.name FROM crew_memberships cm JOIN crews c ON c.id=cm.crew_id WHERE cm.person_id=? AND cm.valid_from<=? AND (cm.valid_to IS NULL OR cm.valid_to>=?) ORDER BY cm.role='leader' DESC LIMIT 1`,[a.personId,row.work_date,row.work_date])?.name||'临时参与'}))
  return {id:row.id,workDate:row.work_date,shiftTemplateId:row.shift_template_id,shiftName:row.shift_name_snapshot||row.shift_name,crewId:row.crew_id,crewName:row.crew_name,revision:row.revision,source:row.source,note:row.note,assignments,updatedAt:row.updated_at,attributionDate:row.attribution_date||row.work_date,shiftStartDate:row.shift_start_date||row.work_date,shiftStartTime:row.shift_start_time_snapshot,shiftEndTime:row.shift_end_time_snapshot,crossDay:Boolean(row.shift_cross_day_snapshot)}
}
export function rosters(auth:AuthContext,query:OperationsQuery={}):OperationsRoster[] {
  const managed=query.scope==='managed'
  if(query.crewId) {
    const selectedCrew=crewFor(auth,query.crewId)
    if(managed)requireManage(auth,selectedCrew)
  }
  return all<RosterRow>(`SELECT r.*,s.name AS shift_name,c.name AS crew_name,c.base_id AS base_id FROM operations_rosters r JOIN shift_templates s ON s.id=r.shift_template_id JOIN crews c ON c.id=r.crew_id ORDER BY r.work_date,r.shift_template_id,r.crew_id`)
    .filter(r=>withinScopedBase(auth,r.base_id))
    .filter(r=>(!query.dateFrom||r.work_date>=query.dateFrom)&&(!query.dateTo||r.work_date<=query.dateTo)&&(!query.crewId||r.crew_id===query.crewId))
    .filter(r=>managed?canManage(auth,crew(r.crew_id)):parseJson<RosterAssignment[]>(r.assignments_json,[]).some(a=>a.personId===auth.personId))
    .map(r=>rosterMap(r,auth,managed))
}
export function saveRosters(auth:AuthContext,input:SaveRosterInput):OperationsRoster[] {
  return transaction(()=>{
    const result:OperationsRoster[]=[]
    const keys=new Set<string>()
    for(const record of input.records) {
      const c=crewFor(auth,record.crewId);requireManage(auth,c)
      if(input.mode==='monthly'&&!canPlan(auth,c))throw AppError.forbidden('月排班由生产管理人员安排')
      if(input.mode==='daily'&&record.workDate!==today())throw AppError.badRequest('日排班仅可调整北京时间当天安排')
      if(record.workDate<today())throw AppError.badRequest('历史日期排班只读')
      const key=`${record.workDate}/${record.shiftTemplateId}/${record.crewId}`
      if(keys.has(key))throw AppError.badRequest('同一批次排班不能重复');keys.add(key)
      if(!one(`SELECT id FROM shift_templates WHERE id=? AND base_id=? AND status='active'`,[record.shiftTemplateId,c.base_id]))throw AppError.badRequest('班次不属于班组基地')
      const shift=one<{name:string;start_time:string;end_time:string;cross_day:number}>('SELECT name,start_time,end_time,cross_day FROM shift_templates WHERE id=?',[record.shiftTemplateId])!
      const assignments: RosterAssignment[]=record.assignments.map(a=>({personId:a.personId,postId:a.postId}))
      if(new Set(assignments.map(a=>`${a.personId}/${a.postId||''}`)).size!==assignments.length)throw AppError.badRequest('同一人员岗位不能重复')
      for(const a of assignments) {
        const {validateRosterPerson}=requireDispatch()
        validateRosterPerson(a.personId,c,record.workDate)
        if(a.postId&&!one(`SELECT id FROM business_catalog WHERE id=? AND kind='production_post' AND status='active'`,[a.postId]))throw AppError.badRequest('岗位不存在或已停用')
      }
      const old=one<{id:string;revision:number}>(`SELECT id,revision FROM operations_rosters WHERE work_date=? AND shift_template_id=? AND crew_id=?`,[record.workDate,record.shiftTemplateId,c.id])
      if((old?.revision||0)!==record.revision)throw AppError.revisionConflict()
      const id=old?.id||newId('roster')
      const actualStartDate=shift.cross_day?new Date(Date.parse(`${record.workDate}T00:00:00Z`)-86400000).toISOString().slice(0,10):record.workDate
      if(old)run(`UPDATE operations_rosters SET assignments_json=?,source=?,note=?,attribution_date=?,shift_start_date=?,shift_name_snapshot=?,shift_start_time_snapshot=?,shift_end_time_snapshot=?,shift_cross_day_snapshot=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=?`,[JSON.stringify(assignments),input.mode==='daily'?'daily':'monthly',record.note||'',record.workDate,actualStartDate,shift.name,shift.start_time,shift.end_time,shift.cross_day,nowIso(),auth.accountId,id])
      else run(`INSERT INTO operations_rosters (id,work_date,shift_template_id,crew_id,assignments_json,source,note,attribution_date,shift_start_date,shift_name_snapshot,shift_start_time_snapshot,shift_end_time_snapshot,shift_cross_day_snapshot,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,record.workDate,record.shiftTemplateId,c.id,JSON.stringify(assignments),input.mode==='daily'?'daily':'monthly',record.note||'',record.workDate,actualStartDate,shift.name,shift.start_time,shift.end_time,shift.cross_day,nowIso(),auth.accountId])
      writeAudit({accountId:auth.accountId,ipAddress:auth.ipAddress,action:'operations.roster.save',entityType:'roster',entityId:id,scopeType:'factory',scopeId:c.factory_id,before:old,after:record})
      result.push(rosters(auth,{scope:'managed',crewId:c.id,dateFrom:record.workDate,dateTo:record.workDate}).find(r=>r.id===id)!)
    }
    return result
  })
}
// Local import indirection avoids a module initialization cycle; dispatch uses crew/auth helpers above.
import { validateRosterPerson } from './dispatch'
function requireDispatch(){return {validateRosterPerson}}
