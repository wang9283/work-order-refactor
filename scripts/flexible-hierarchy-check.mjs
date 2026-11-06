import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
if (!process.env.DATABASE_PATH?.endsWith('flexible-codex-phase1-test.db')) throw Error('仅允许隔离验证库')
const base='http://127.0.0.1:3001/api', suffix=Date.now()
let count=0
async function call(path,token,method='GET',body,status=200){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const result=await r.json();assert.equal(r.status,status,`${path}: ${JSON.stringify(result)}`);count++;return result.data}
const login=async username=>(await call('/auth/login',null,'POST',{username,password:'Feed2026!'})).token
const group=await login('group.admin'), local=await login('qd.admin'), external=await login('hz.factory.admin')
const nodes=await call('/org/nodes',group)
const xj=nodes.find(n=>n.factory_id==='factory_xinjin');assert(xj)
await call('/org/nodes',null,'POST',{},401)
const body={parentId:xj.id,code:`ORG-${suffix}`,name:`测试自定义组织${suffix}`,payrollCompanyId:'co_heze',pricingSiteId:'base_direct'}
const child=await call('/org/nodes',group,'POST',body)
let next=(await call('/org/nodes',group)).find(n=>n.id===child.id)
assert.equal(next.payroll_company_id,'co_heze');assert.equal(next.pricing_site_id,'base_direct');assert(next.factory_id)
await call(`/org/nodes/${child.id}`,group,'PUT',{...body,name:`测试改名${suffix}`,revision:next.revision})
await call(`/org/nodes/${child.id}`,group,'PUT',{...body,revision:next.revision},409)
await call('/org/nodes',external,'POST',{...body,code:`DENY-${suffix}`},403)
const nested=await call('/org/nodes',local,'POST',{parentId:xj.id,code:`LOCAL-${suffix}`,name:`本地下级组织${suffix}`})
const nestedRead=(await call('/org/nodes',local)).find(n=>n.id===nested.id);assert(nestedRead.canManage)
const grand=await call('/org/nodes',local,'POST',{parentId:nested.id,code:`GRAND-${suffix}`,name:`任意深度组织${suffix}`})
await call(`/org/nodes/${xj.id}`,group,'PUT',{parentId:grand.id,code:xj.code,name:xj.name,payrollCompanyId:xj.payroll_company_id,pricingSiteId:xj.pricing_site_id,revision:xj.revision},400)
const tree=await call('/org/tree',group)
assert(tree.workAreas.some(a=>a.id==='line_xinjin_1' && a.parentId==='area_xinjin_prod'))
const areaBody={code:`LOC-${suffix}`,name:'旧产线下自定义位置',factoryId:'factory_xinjin',baseId:'base_direct',parentId:'line_xinjin_1',managerPersonId:null,status:'active'}
const area=await call('/org/work-areas',local,'POST',areaBody,201)
await call(`/org/work-areas/${area.id}`,local,'PUT',{...areaBody,parentId:area.id,revision:area.revision},400)
await call('/org/work-areas',external,'POST',{...areaBody,code:`BAD-${suffix}`},403)
const schema={mainFields:[{id:'output',key:'output',name:'产量',type:'number',required:true,strategy:'blocking',sort:0,isCore:false,editableByLocal:true}],subForms:[{id:'details',key:'details',name:'作业明细',sort:0,minRecords:1,maxRecords:10,fields:[{id:'weight',key:'weight',name:'明细数量',type:'number',required:true,strategy:'blocking',sort:0,isCore:false,editableByLocal:true}]}],conditionRules:[]}
const form=await call('/forms',group,'POST',{code:`FORM-${suffix}`,name:'在线无附件表单',ownerType:'group',ownerId:'group',schema},201)
await call('/forms',group,'POST',{code:`MEDIA-${suffix}`,name:'文件表单',ownerType:'group',ownerId:'group',schema:{...schema,mainFields:[{...schema.mainFields[0],type:'photo'}]}},400)
await call('/excel/imports/preview',group,'POST',{},400)
const v=form.versions[0];await call(`/forms/${form.id}/versions/${v.id}/publish`,group,'POST',{revision:v.revision})
const category=await call('/ticket-categories',group,'POST',{code:`CAT-${suffix}`,name:'自由工单类型',ownerType:'group',ownerId:'group'},201)
const type=await call('/ticket-types',group,'POST',{code:`TYPE-${suffix}`,name:'不依赖交接配置',categoryId:category.id,ownerType:'group',ownerId:'group',formTemplateId:form.id,formVersionId:v.id,workProfiles:[]},201)
const detail=await call(`/ticket-types/${type.typeId}`,group);const tv=detail.versions[0];await call(`/ticket-types/${type.typeId}/versions/${tv.id}/publish`,group,'POST',{revision:tv.revision})
await call('/prices',group,'POST',{ticketTypeId:type.typeId,siteId:'base_direct',unit:'吨',unitPriceMicros:2000000,effectiveFrom:'2026-01-01T00:00:00Z',effectiveTo:null},201)
let ticket=await call('/tickets',group,'POST',{ticketTypeId:type.typeId,siteId:'base_direct',factoryId:'factory_xinjin',workAreaId:'line_xinjin_1',crewId:'crew_xinjin_sauce',workDate:'2026-10-31',eventTime:'2026-10-31T00:00:00Z',quantity:3,assignments:[{personId:'person_yang',role:'lead'}]},201)
assert.equal(ticket.handoverShiftProfileId,null)
assert.equal(ticket.workAreaId,'line_xinjin_1')
ticket=await call(`/tickets/${ticket.id}/start`,group,'POST',{revision:ticket.revision})
await call(`/tickets/${ticket.id}/submit`,group,'POST',{revision:ticket.revision,values:{},subFormValues:{},quantity:3},400)
ticket=await call(`/tickets/${ticket.id}/submit`,group,'POST',{revision:ticket.revision,values:{output:3},subFormValues:{details:[{weight:3}]},assignmentQuantities:Object.fromEntries(ticket.assignments.map(a=>[a.id,3])),quantity:3})
await call('/payroll/confirm-company',group,'POST',{workMonth:'2026-10',personIds:['person_yang'],payrollCompanyId:'co_heze'})
ticket=await call(`/tickets/${ticket.id}/approve`,group,'POST',{revision:ticket.revision})
assert.equal(ticket.amountMicros,6000000)
const accruals=await call('/payroll/accruals?workMonth=2026-10',group);assert(accruals.some(a=>a.ticketId===ticket.id && a.workSiteId==='base_direct' && a.payrollCompanyId==='co_heze'))

const tickets=await call('/tickets?pageSize=200',group); const previous=tickets.find(t=>t.status==='closed'); console.log('基线工单',previous?.id)
const mediaTicket=await call('/tickets',group,'POST',{ticketTypeId:type.typeId,siteId:'base_direct',factoryId:'factory_xinjin',crewId:'crew_xinjin_sauce',workDate:'2026-10-31',eventTime:'2026-10-31T00:00:00Z',assignments:[{personId:'person_yang',role:'lead'}]},201)
const probeDb=new DatabaseSync(process.env.DATABASE_PATH)
const legacySchema={...schema,mainFields:[...schema.mainFields,{...schema.mainFields[0],id:'evidence',key:'evidence',name:'历史附件',type:'attachment'}]}
probeDb.prepare('UPDATE tickets SET form_snapshot_json=?,values_json=? WHERE id=?').run(JSON.stringify(legacySchema),JSON.stringify({evidence:'historical-ref'}),mediaTicket.id)
probeDb.close()
let media=await call(`/tickets/${mediaTicket.id}/start`,group,'POST',{revision:mediaTicket.revision})
await call(`/tickets/${media.id}/values`,group,'PUT',{revision:media.revision,values:{evidence:'new-file'},subFormValues:{}},400)
media=await call(`/tickets/${media.id}/submit`,group,'POST',{revision:media.revision,values:{output:3},subFormValues:{details:[{weight:3}]},quantity:3})
assert.equal(media.values.evidence,'historical-ref')
const upload=new FormData();upload.append('file',new Blob(['forbidden-file']),'blocked.xlsx');const denied=await fetch(base+'/excel/imports/preview',{method:'POST',headers:{Authorization:`Bearer ${group}`},body:upload});assert.equal(denied.status,400);count++
const db=new DatabaseSync(process.env.DATABASE_PATH);const old=new DatabaseSync('data/feed-before-flexible-hierarchy.db',{readOnly:true});
const snapshots='SELECT id,form_snapshot_json,site_snapshot_json,price_snapshot_json FROM tickets ORDER BY id';const before=old.prepare(snapshots).all(); const oldIds=new Set(before.map(t=>t.id)); assert.deepEqual(db.prepare(snapshots).all().filter(t=>oldIds.has(t.id)),before);old.close();db.close()
console.log(`组织任意层级、独立归属、修订冲突、权限、位置迁移、无文件表单、无交接类型、历史快照：${count} 项通过`)
