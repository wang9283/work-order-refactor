import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { hasGrant, requireAuth, type AuthContext } from '../../core/auth'
import { AppError } from '../../core/errors'
import { parseInput, success } from '../../core/http'
import { all, one, run, transaction, nowIso, newId } from '../../db/database'
import { writeAudit } from '../../core/audit'

type Node = { id: string; parent_id: string | null; code: string; name: string; factory_id: string | null; payroll_company_id: string | null; pricing_site_id: string | null; status: string; revision: number }
const schema = z.object({ parentId: z.string().nullable().default(null), code: z.string().trim().min(2).max(40), name: z.string().trim().min(1).max(100), payrollCompanyId: z.string().nullable().default(null), pricingSiteId: z.string().nullable().default(null), status: z.enum(['active','inactive','archived']).default('active'), revision: z.number().int().positive().optional() })
function allowed(auth: AuthContext, node?: Node): boolean {
  if (auth.grants.some(g => g.capability === 'org.manage' && g.type === 'group')) return true
  return !!node?.factory_id && hasGrant(auth,'org.manage',{ type: 'factory', id: node.factory_id })
}
export async function hierarchyRoutes(app: FastifyInstance) {
  app.get('/org/nodes', async request => {
    const auth = requireAuth(request)
    const nodes = all<Node>('SELECT * FROM org_nodes')
    const visible = new Set(nodes.filter(n => allowed(auth,n) || (n.factory_id && hasGrant(auth,'org.view',{type:'factory',id:n.factory_id}))).map(n => n.id))
    for (const id of [...visible]) { let n = nodes.find(n => n.id === id); while(n?.parent_id) { visible.add(n.parent_id); n = nodes.find(p => p.id === n!.parent_id) } }
    return success(request,nodes.filter(n => visible.has(n.id)).map(n => ({...n, canManage: allowed(auth,n)})))
  })
  async function save(request: FastifyRequest, editing: boolean) {
    const auth = requireAuth(request)
    const input = parseInput(schema,request.body)
    const before = editing ? one<Node>('SELECT * FROM org_nodes WHERE id=?',[(request.params as {id:string}).id]) : undefined
    if(editing && !before) throw AppError.notFound('组织')
    const parent = input.parentId ? one<Node>('SELECT * FROM org_nodes WHERE id=?',[input.parentId]) : undefined
    if(input.parentId && (!parent || parent.status !== 'active')) throw AppError.badRequest('上级组织不存在或未启用')
    if(!allowed(auth,editing ? before : parent)) throw AppError.forbidden()
    if(editing && before!.revision !== input.revision) throw AppError.revisionConflict()
    if(editing && input.parentId !== before!.parent_id && (!allowed(auth,parent) || !allowed(auth))) throw AppError.forbidden('调整上级需要总部组织管理权限')
    let cursor = parent
    while(cursor) { if(cursor.id === before?.id) throw AppError.badRequest('不能将自身或下级设为上级'); cursor = cursor.parent_id ? one<Node>('SELECT * FROM org_nodes WHERE id=?',[cursor.parent_id]) : undefined }
    const siteId = input.pricingSiteId || parent?.pricing_site_id || null
    const payrollId = input.payrollCompanyId || parent?.payroll_company_id || null
    if(siteId && !one('SELECT id FROM production_bases WHERE id=? AND status=? AND site_confirmed=1',[siteId,'active'])) throw AppError.badRequest('计价归属必须是已确认且启用的作业地点')
    if(payrollId && !one('SELECT id FROM companies WHERE id=? AND status=? AND payroll_enabled=1',[payrollId,'active'])) throw AppError.badRequest('发薪主体未启用')
    if(!allowed(auth) && (siteId !== parent?.pricing_site_id && siteId !== before?.pricing_site_id || payrollId !== parent?.payroll_company_id && payrollId !== before?.payroll_company_id)) throw AppError.forbidden('归属调整需要总部权限')
    if(before?.factory_id && input.status !== 'active' && (
      one('SELECT id FROM crews WHERE factory_id=? AND status=? LIMIT 1',[before.factory_id,'active'])
      || one('SELECT id FROM people WHERE factory_id=? AND status=? LIMIT 1',[before.factory_id,'active'])
      || one("SELECT id FROM tickets WHERE factory_id=? AND status NOT IN ('closed','cancelled') LIMIT 1",[before.factory_id])
    )) throw AppError.referenceConflict('组织仍有启用人员、班组或未结束工单，请先处理关联数据')
    const id = before?.id || newId('org'); const ts = nowIso()
    transaction(() => {
      let factoryId = before?.factory_id || null
      const nameTaken = one('SELECT id FROM factories WHERE name=? AND id<>?',[input.name,factoryId || ''])
      const factoryName = nameTaken ? `${input.name} · ${input.code}` : input.name
      if(siteId && !factoryId) {
        factoryId = newId('factory')
        const company = one<{company_id:string}>('SELECT company_id FROM production_bases WHERE id=?',[siteId])!
        run(`INSERT INTO factories(id,code,name,company_id,base_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`,[factoryId,input.code,factoryName,company.company_id,siteId,input.status,ts,ts])
      }
      if(before?.factory_id && siteId !== before.pricing_site_id) throw AppError.badRequest('已有作业记录的组织请新建下级指定新的计价归属')
      if(factoryId) run('UPDATE factories SET code=?,name=?,status=?,revision=revision+1,updated_at=? WHERE id=?',[input.code,factoryName,input.status,ts,factoryId])
      if(before) run('UPDATE org_nodes SET parent_id=?,code=?,name=?,payroll_company_id=?,pricing_site_id=?,factory_id=?,status=?,revision=revision+1,updated_at=? WHERE id=?',[input.parentId,input.code,input.name,payrollId,siteId,factoryId,input.status,ts,id])
      else run('INSERT INTO org_nodes(id,parent_id,code,name,payroll_company_id,pricing_site_id,factory_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,input.parentId,input.code,input.name,payrollId,siteId,factoryId,input.status,ts,ts])
      if(input.status !== 'active' && one('SELECT id FROM org_nodes WHERE parent_id=? AND status=?',[id,'active'])) throw AppError.badRequest('请先停用或调整下级组织')
      writeAudit({accountId:auth.accountId,action:before?'org.node.update':'org.node.create',entityType:'org_node',entityId:id,scopeType:'group',scopeId:'group',before,after:input,ipAddress:auth.ipAddress})
    })
    return success(request,{id})
  }
  app.post('/org/nodes', request => save(request,false))
  app.put('/org/nodes/:id', request => save(request,true))
}
