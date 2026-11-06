// Public HTTP integration boundary with an isolated SQLite database. No data/feed.db changes.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'

const root=resolve(import.meta.dirname,'..')
const dir=resolve(root,'data/isolated',`operations-${Date.now()}`)
mkdirSync(dir,{recursive:true})
const databasePath=resolve(dir,'operations-check.db')
async function command(args,env) {
  const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']})
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x)
  await new Promise((done,fail)=>{child.on('error',fail);child.on('close',c=>c===0?done():fail(new Error(output)))})
}
let port
for(let p=3340;p<3390;p++) {
  const available=await new Promise(done=>{const s=createServer();s.on('error',()=>done(false));s.listen(p,'0.0.0.0',()=>s.close(()=>done(true)))})
  if(available){port=p;break}
}
assert(port,'测试端口可用')
const env={DATABASE_PATH:databasePath,PORT:String(port),LOG_LEVEL:'error'}
await command(['--import','tsx','server/db/init.ts'],env)
await command(['scripts/prepare-operations-demo.mjs'],env)
const fixtureTime='2026-11-06T00:00:00.000Z'
const seeded=new DatabaseSync(databasePath)
seeded.exec('PRAGMA foreign_keys=ON')
seeded.prepare(`INSERT OR IGNORE INTO ticket_categories
  (id,code,name,owner_type,owner_id,status,locked,revision,created_at,updated_at)
  VALUES ('cat_group_laboratory','GROUP-LABORATORY','化验','group','group','active',1,1,?,?)`).run(fixtureTime,fixtureTime)
seeded.prepare(`INSERT OR IGNORE INTO ticket_types
  (id,code,name,category_id,owner_type,owner_id,origin,status,current_version_id,locked,revision,
   created_at,updated_at,system_managed,business_kind)
  VALUES ('type_ops_empty','OPS-EMPTY','暂无工单化验类型','cat_group_laboratory','group','group',
    'group_standard','published','typever_ops_empty',0,1,?,?,0,NULL)`).run(fixtureTime,fixtureTime)
seeded.prepare(`INSERT OR IGNORE INTO ticket_type_versions
  (id,ticket_type_id,version_no,status,form_version_id,published_at,published_by,revision,created_at,updated_at)
  VALUES ('typever_ops_empty','type_ops_empty',1,'published','formver_ops_demo',?,'acct_group',1,?,?)`)
  .run(fixtureTime,fixtureTime,fixtureTime)
seeded.close()
const server=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']})
let logs='';server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x)
const base=`http://127.0.0.1:${port}/api`
let token
async function request(path,method='GET',body,expected=200) {
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
  const result=await response.json()
  assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(result)}`)
  return result.data
}
async function login(username){token=(await request('/auth/login','POST',{username,password:'Feed2026!'})).token}
try {
  for(let i=0;i<300;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  await login('ops.manager')
  const context=await request('/operations/context')
  const today=context.today
  assert.equal(context.crews.find(c=>c.id==='crew_ops_main').canPlanMonth,true)
  const record={workDate:today,crewId:'crew_ops_main',shiftTemplateId:'shift_ops_day',revision:0,assignments:[
    {personId:'person_ops_a',postId:'catalog_ops_post_a'},{personId:'person_ops_b',postId:'catalog_ops_post_a'},
    {personId:'person_ops_leader',postId:'catalog_ops_post_b'},
  ]}
  let roster=(await request('/operations/rosters','PUT',{mode:'monthly',records:[record]}))[0]
  const seededNight=(await request(`/operations/rosters?scope=managed&dateFrom=${today}&dateTo=${today}&crewId=crew_ops_main`)).find(x=>x.shiftTemplateId==='shift_ops_night')
  await request('/operations/rosters','PUT',{mode:'monthly',records:[{...record,shiftTemplateId:'shift_ops_night',revision:seededNight?.revision||0,assignments:[{personId:'person_ops_leader',postId:'catalog_ops_post_b'}]}]})
  const yesterday=new Date(Date.parse(`${today}T00:00:00Z`)-86400000).toISOString().slice(0,10)
  await request('/operations/rosters','PUT',{mode:'monthly',records:[{...record,workDate:yesterday,revision:0}]},400)
  await login('ops.worker')
  await request('/operations/rosters','PUT',{mode:'monthly',records:[record]},403)
  await request('/operations/rosters','PUT',{mode:'daily',records:[record]},403)
  await request('/operations/export?crewId=crew_ops_main', 'GET',undefined,403)
  await login('ops.worker')
  const mine=await request(`/operations/rosters?dateFrom=${today}&dateTo=${today}`)
  assert.equal(mine[0].id,roster.id,'月排班与本人日程共读')
  assert.deepEqual(mine[0].assignments.map(x=>x.personId),['person_ops_a'],'员工只读本人安排')
  console.log('[PASS] 月排班与本人日程持久化共读')
  await login('ops.leader')
  roster=(await request('/operations/rosters','PUT',{mode:'daily',records:[{...record,revision:roster.revision,note:'当天换岗',assignments:[...record.assignments,{personId:'person_ops_a',postId:'catalog_ops_post_b'}]}]}))[0]
  await login('ops.manager')
  assert.equal((await request(`/operations/rosters?scope=managed&dateFrom=${today}`)).find(x=>x.id===roster.id).note,'当天换岗')
  const syncInput={sourceKey:'mes-order-1',businessKind:'production',workDate:today,crewId:'crew_ops_main',shiftTemplateId:'shift_ops_day',quantity:12,materialId:'material_ops_demo'}
  const production=(await request('/operations/demo-sync','POST',syncInput)).ticket
  const unassigned=(await request('/operations/demo-sync','POST',{...syncInput,sourceKey:'mes-order-unassigned',shiftTemplateId:'shift_ops_night'})).ticket
  await request('/tickets','POST',{
    ticketTypeId:'type_builtin_production',businessKind:'production',materialId:'material_ops_demo',
    materialTypeId:'catalog_ops_material',businessItems:[{kind:'production_post',catalogId:'catalog_ops_post_a'}],
    siteId:'base_ops_demo',factoryId:'factory_ops_demo',workDate:today,eventTime:`${today}T08:00:00+08:00`,
  },400)
  await request('/tickets','POST',{
    ticketTypeId:'type_ops_vehicle',businessKind:'generic',siteId:'base_ops_demo',factoryId:'factory_ops_demo',
    workDate:today,eventTime:`${today}T08:00:00+08:00`,
  },400)
  await request(`/tickets/${production.id}/start`,'POST',{revision:production.revision},400)
  await request(`/tickets/${production.id}/submit`,'POST',{revision:production.revision,values:{}},400)
  await request(`/tickets/${production.id}/approve`,'POST',{revision:production.revision},400)
  await request(`/tickets/${production.id}/cancel`,'POST',{revision:production.revision},400)
  assert.equal(unassigned.workItems.find(i=>i.catalogId==='catalog_ops_post_a').assignments.length,0,'缺岗位排班保留待分配，不虚构人员')
  assert.equal(production.completed,true)
  assert.equal(production.workItems.length,2)
  assert.equal(production.workItems.find(i=>i.catalogId==='catalog_ops_post_a').assignments.find(a=>a.personId==='person_ops_a').quantity,6)
  const duplicate=await request('/operations/demo-sync','POST',syncInput)
  assert.equal(duplicate.duplicate,true)
  assert.equal(duplicate.ticket.id,production.id,'重复同步返回原工单')
  assert.equal((await request(`/operations/workloads?scope=managed&dateFrom=${today}&dateTo=${today}`)).tickets.find(t=>t.id===production.id)?.quantity,12)
  await login('ops.leader')
  await request('/operations/rosters','PUT',{mode:'daily',records:[{...record,revision:roster.revision,assignments:[{personId:'person_ops_a',postId:null}]}]})
  assert.equal((await request(`/operations/tickets/${production.id}`)).workItems.find(i=>i.catalogId==='catalog_ops_post_a').assignments.length,2,'排班变更不回写已有人员快照')
  console.log('[PASS] 当天调整、同步按岗位快照、来源幂等与整单量去重')
  await login('ops.worker')
  await request(`/operations/tickets/${production.id}/items/${production.workItems[0].id}/assignments`,'PUT',{revision:production.revision,reason:'越权调量',assignments:[{personId:'person_ops_a',shareBasisPoints:10000}]},403)
  await login('ops.other')
  await request(`/operations/tickets/${production.id}`,'GET',undefined,403)
  await request('/operations/confirmations','POST',{ticketIds:[production.id]},403)
  await request('/operations/feedback','POST',{ticketId:production.id,message:'越权反馈'},403)
  await request('/operations/self-create','POST',{ticketTypeId:'type_ops_demo',crewId:'crew_ops_main',shiftTemplateId:'shift_ops_day',workDate:today,values:{work_note:'跨组自建'},clientRequestId:'forbidden-cross-crew'},403)
  await login('ops.leader')
  await request('/operations/rosters','PUT',{mode:'daily',records:[{...record,crewId:'crew_ops_other'}]},403)
  await request('/operations/rosters','PUT',{mode:'daily',records:[{...record,revision:0}]},409)
  console.log('[PASS] 员工越权、跨组操作、排班版本冲突、缺岗待分配与重复同步边界')
  await login('ops.worker')
  await request('/operations/confirmations','POST',{ticketIds:[production.id]})
  const confirmed=(await request(`/operations/tickets/${production.id}`)).workItems[0].assignments[0].confirmedAt
  assert(confirmed)
  const feedback=await request('/operations/feedback','POST',{ticketId:production.id,message:'投料实际贡献需调整为七成'})
  await login('ops.leader')
  assert.equal((await request('/operations/feedback?scope=managed'))[0].id,feedback.id)
  await request(`/operations/tickets/${production.id}/items/${production.workItems.find(i=>i.catalogId==='catalog_ops_post_a').id}/assignments`,'PUT',{
    revision:production.revision+1,reason:'旧版本',assignments:[{personId:'person_ops_a',shareBasisPoints:7000},{personId:'person_ops_b',shareBasisPoints:3000}],
  },409)
  await request(`/operations/tickets/${production.id}/items/${production.workItems.find(i=>i.catalogId==='catalog_ops_post_a').id}/assignments`,'PUT',{
    revision:production.revision,reason:'比例错误',assignments:[{personId:'person_ops_a',shareBasisPoints:7000}],
  },400)
  const updated=await request(`/operations/tickets/${production.id}/items/${production.workItems.find(i=>i.catalogId==='catalog_ops_post_a').id}/assignments`,'PUT',{
    revision:production.revision,reason:'按实际贡献调整',assignments:[{personId:'person_ops_a',shareBasisPoints:7000},{personId:'person_ops_b',shareBasisPoints:3000}],
  })
  assert.equal(updated.quantity,12)
  assert.equal(updated.workItems.find(i=>i.catalogId==='catalog_ops_post_a').assignments.find(a=>a.personId==='person_ops_a').quantity,8.4)
  await request(`/operations/feedback/${feedback.id}`,'PUT',{revision:feedback.revision+1,response:'旧版本'},409)
  await request(`/operations/feedback/${feedback.id}`,'PUT',{revision:feedback.revision,response:'已按实际贡献调整为70%'})
  await login('ops.worker')
  const latest=await request(`/operations/tickets/${production.id}`)
  assert.equal(latest.workItems.find(i=>i.catalogId==='catalog_ops_post_a').assignments[0].confirmedAt,confirmed,'调整分配不重置确认')
  assert.equal((await request('/operations/feedback'))[0].status,'resolved')
  console.log('[PASS] 员工确认、逐单反馈、组长处理、确认后调整守恒且无需再次确认')
  const selfInput={ticketTypeId:'type_ops_demo',crewId:'crew_ops_main',shiftTemplateId:'shift_ops_day',workDate:today,values:{work_note:'员工自主登记清理现场'},clientRequestId:'self-request-1'}
  const self=await request('/operations/self-create','POST',selfInput)
  assert.equal(self.workItems[0].assignments[0].shareBasisPoints,10000)
  assert.equal((await request('/operations/self-create','POST',selfInput)).id,self.id,'自建请求重试防重')
  await request(`/operations/tickets/${self.id}/complete`,'POST',{revision:self.revision,quantity:3,values:{}},400)
  const selfDone=await request(`/operations/tickets/${self.id}/complete`,'POST',{revision:self.revision,quantity:3,values:selfInput.values})
  assert.equal(selfDone.completed,true,'员工自主完单无需经理审核')
  assert.equal(selfDone.canComplete,false)
  await request(`/operations/tickets/${self.id}/complete`,'POST',{revision:self.revision,quantity:3,values:selfInput.values},409)
  await login('ops.leader')
  const loading=(await request('/operations/demo-sync','POST',{sourceKey:'scale-order-1',businessKind:'loading',workDate:today,crewId:'crew_ops_main',shiftTemplateId:'shift_ops_day',quantity:5,loadingTypeId:'catalog_ops_loading'})).ticket
  assert.equal(loading.workItems[0].assignments[0].shareBasisPoints,10000)
  await login('ops.worker')
  assert.equal((await request('/operations/confirmations','POST',{ticketIds:[self.id,loading.id]})).confirmed,2)
  await login('ops.manager')
  const exported=await request(`/operations/export?crewId=crew_ops_main&dateFrom=${today}&dateTo=${today}`)
  assert.equal(exported.simulated,true)
  assert.equal(exported.totals.orderQuantity,32,'生产主单12、缺岗单12、装卸5、自建3')
  assert.equal(exported.rows.filter(r=>r.ticketId===production.id&&r.personId==='person_ops_a'&&r.workItemName==='投料')[0].quantity,8.4,'输出采用最新分配')
  assert.equal(exported.rows.filter(r=>r.ticketId===production.id).length,4,'两岗位分别输出个人计件量')
  const unassignedMissingItem=unassigned.workItems.find(item=>item.catalogId==='catalog_ops_post_a')
  assert.equal(exported.rows.filter(r=>r.ticketId===unassigned.id&&r.workItemId===unassignedMissingItem.id).length,0,'缺岗作业项没有人员工作量，不虚构输出')
  console.log('[PASS] 员工其他工单自主完单、多选确认、装卸单人100%、最新工作量模拟输出')
  const catalog=await request('/ticket-catalog')
  const group=(code)=>catalog.groups.find(item=>item.code===code)
  assert(group('GROUP-PRODUCTION')?.types.some(type=>type.id==='type_builtin_production'&&type.systemManaged&&type.businessKind==='production'))
  assert(group('GROUP-LOADING')?.types.some(type=>type.id==='type_builtin_loading'&&type.systemManaged&&type.businessKind==='loading'))
  assert(group('GROUP-SANITATION')?.types.some(type=>type.id==='type_ops_vehicle')&&group('GROUP-SANITATION')?.types.some(type=>type.id==='type_ops_facility'))
  assert.equal(group('GROUP-LABORATORY')?.types.find(type=>type.id==='type_ops_empty')?.name,'暂无工单化验类型')
  assert.equal(catalog.types.filter(type=>type.id==='type_ops_empty').length,1,'无工单的新类型仍进入完整目录')
  assert(!catalog.groups.some(item=>item.id==='cat_demo'),'旧演示分组不再出现在目录')
  assert.equal(context.ticketCatalog.types.filter(type=>type.id==='type_ops_empty').length,1,'App 与 PC 共用同一类型目录')
  assert.equal((await request('/tickets?ticketTypeId=type_ops_empty')).length,0,'新类型暂无工单仍可正常查询')
  const vehicle=await request('/operations/sanitation','POST',{kind:'vehicle',workDate:today,plateNumber:'京A88888',clientRequestId:'catalog-vehicle'})
  const facility=await request('/operations/sanitation','POST',{kind:'facility',workDate:today,clientRequestId:'catalog-facility'})
  const sanitation=await request('/tickets?ticketCategoryId=cat_group_sanitation')
  assert.deepEqual(new Set(sanitation.map(ticket=>ticket.ticketTypeId)),new Set(['type_ops_vehicle','type_ops_facility']),'洗消分组同时覆盖车辆和厂区类型')
  const vehicles=await request('/tickets?ticketTypeId=type_ops_vehicle')
  assert.deepEqual(vehicles.map(ticket=>ticket.id),[vehicle.id],'车辆洗消类型精确筛选')
  assert.deepEqual((await request(`/tickets?plateNumber=${encodeURIComponent('8888')}`)).map(ticket=>ticket.id),[vehicle.id],'车牌号只命中车辆洗消')
  assert((await request(`/tickets?ticketCategoryId=cat_group_production&ticketTypeId=type_builtin_production`)).every(ticket=>ticket.businessKind==='production'))
  assert((await request(`/tickets?ticketTypeId=type_builtin_loading`)).every(ticket=>ticket.businessKind==='loading'))
  assert((await request('/tickets?productionPostId=catalog_ops_post_a')).every(ticket=>ticket.businessKind==='production'),'生产工序筛选不串入其他类型')
  assert.deepEqual((await request('/tickets?loadingTypeId=catalog_ops_loading')).map(ticket=>ticket.id),[loading.id],'装卸方式精确筛选')
  assert.deepEqual((await request('/tickets?q=mes-order-1')).map(ticket=>ticket.id),[production.id],'来源单号关键词筛选')
  console.log('[PASS] 类型目录、洗消分组、空类型与生产/装卸/车牌组合筛选')
} catch(error){console.error(logs.slice(-4000));throw error}
finally {server.kill();await new Promise(done=>{if(server.exitCode!==null)return done();server.once('close',done);setTimeout(done,3000)})}
console.log(`隔离数据库保留：${databasePath}`)
