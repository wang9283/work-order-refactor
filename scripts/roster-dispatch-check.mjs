// TDD seam: public HTTP + isolated SQLite. Verifies default dispatch, substitutions and snapshots.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
const root=resolve(import.meta.dirname,'..')
const databasePath=resolve(root,'data/isolated',`dispatch-${Date.now()}`,'check.db')
mkdirSync(resolve(databasePath,'..'),{recursive:true})
async function command(args,env){const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);await new Promise((done,fail)=>{child.on('error',fail);child.on('close',code=>code===0?done():fail(new Error(output)))})}
let port
for(let p=3390;p<3430;p++){const available=await new Promise(done=>{const server=createServer();server.on('error',()=>done(false));server.listen(p,'127.0.0.1',()=>server.close(()=>done(true)))});if(available){port=p;break}}
assert(port)
const env={DATABASE_PATH:databasePath,PORT:String(port),LOG_LEVEL:'error'}
await command(['--import','tsx','server/db/init.ts'],env)
await command(['scripts/prepare-operations-demo.mjs'],env)
const server=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']})
let logs='';server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x)
const base=`http://127.0.0.1:${port}/api`;let token
async function request(path,method='GET',body,expected=200){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(result)}`);return result.data}
async function login(username){token=(await request('/auth/login','POST',{username,password:'Feed2026!'})).token}
try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  await login('ops.manager')
  const context=await request('/operations/context')
  const today=context.today
  const [year,monthNumber]=today.split('-').map(Number)
  const lastDay=new Date(Date.UTC(year,monthNumber,0)).getUTCDate()
  const expectedCrews=['crew_ops_main','crew_ops_other','crew_ops_loading','crew_ops_wash']
  assert.deepEqual(context.crews.map(x=>x.id).filter(id=>expectedCrews.includes(id)).sort(),[...expectedCrews].sort(),'四个示例作业组均可见')
  assert.equal(context.crews.find(x=>x.id==='crew_ops_main').name,'普通料生产班')
  assert.equal(context.crews.find(x=>x.id==='crew_ops_other').name,'预混料生产班')
  const monthRosters=await request(`/operations/rosters?scope=managed&dateFrom=${today.slice(0,8)}01&dateTo=${today.slice(0,8)}${lastDay}`)
  for(const crewId of expectedCrews)assert.equal(monthRosters.filter(x=>x.crewId===crewId).length,lastDay-2,`${crewId} 补齐整月默认安排，保留 06／15 日空白`)
  assert.equal(monthRosters.filter(x=>x.crewId==='crew_ops_main'&&x.shiftTemplateId==='shift_ops_night').length,lastDay-2,'普通料生产班整月排夜班')
  assert.equal(monthRosters.filter(x=>x.crewId==='crew_ops_other'&&x.shiftTemplateId==='shift_ops_night').length,lastDay-2,'预混料生产班整月排夜班')
  assert.equal(monthRosters.filter(x=>['crew_ops_loading','crew_ops_wash'].includes(x.crewId)&&x.shiftTemplateId==='shift_ops_day').length,(lastDay-2)*2,'装卸班与洗消班整月排常日班')
  assert(monthRosters.filter(x=>x.crossDay).every(x=>x.shiftStartDate<x.attributionDate),'跨天班次记录实际开工日')
  const day=context.shifts.find(x=>x.id==='shift_ops_day')
  assert.equal(day.name,'常日班','常日班使用独立示例班次')
  assert.equal(day.endTime,'17:00')
  assert.equal(day.crossDay,false,'常日班不跨天')
  const white=context.shifts.find(x=>x.id==='shift_ops_white')
  assert.equal(white.name,'白班')
  assert.equal(white.endTime,'20:00')
  const night=context.shifts.find(x=>x.id==='shift_ops_night')
  assert.equal(night.crossDay,true,'夜班跨天')
  const vehicleType=context.selfCreateTemplates.find(x=>x.code==='VEHICLE_SANITATION')
  assert(vehicleType,'车辆洗消类型对 App 可见')
  const defaultRule=(await request('/operations/assignment-rules')).find(x=>x.ticketTypeId===vehicleType.id)
  assert.equal(defaultRule.crewId,'crew_ops_wash')
  await request('/operations/assignment-rules','PUT',{siteId:'base_ops_demo',ticketTypeId:vehicleType.id,crewId:'crew_ops_wash',revision:defaultRule.revision})
  const candidates=await request(`/operations/roster-candidates?crewId=crew_ops_wash&workDate=${today}`)
  assert(candidates.find(x=>x.personId==='person_ops_wash')?.qualified,'本组洗消工有资格')
  assert(candidates.find(x=>x.personId==='person_ops_a')?.qualified,'有资格人员可跨组替班')
  assert.equal(candidates.find(x=>x.personId==='person_ops_other')?.qualified,false,'无资格人员不可替班')
  const seeded=await request(`/operations/rosters?scope=managed&dateFrom=${today}&dateTo=${today}`)
  const roster=(await request('/operations/rosters','PUT',{mode:'monthly',records:[{workDate:today,crewId:'crew_ops_wash',shiftTemplateId:'shift_ops_day',revision:seeded.find(x=>x.crewId==='crew_ops_wash'&&x.shiftTemplateId==='shift_ops_day')?.revision||0,assignments:[{personId:'person_ops_a',postId:null}]}]}))[0]
  assert.equal(roster.assignments[0].temporary,true)
  assert.equal(roster.assignments[0].homeCrewName,'普通料生产班')
  const nightRoster=(await request('/operations/rosters','PUT',{mode:'monthly',records:[{workDate:today,crewId:'crew_ops_main',shiftTemplateId:'shift_ops_night',revision:seeded.find(x=>x.crewId==='crew_ops_main'&&x.shiftTemplateId==='shift_ops_night')?.revision||0,assignments:[{personId:'person_ops_a',postId:'catalog_ops_post_a'}]}]}))[0]
  assert.equal(nightRoster.attributionDate,today)
  assert.equal(nightRoster.shiftStartDate,new Date(Date.parse(`${today}T00:00:00Z`)-86400000).toISOString().slice(0,10),'夜班按结束日归属')
  await request(`/operations/roster-candidates?crewId=crew_ops_wash&workDate=${today}`,'GET',undefined,200)
  await login('ops.worker')
  await request('/operations/rosters','PUT',{mode:'daily',records:[{workDate:today,crewId:'crew_ops_wash',shiftTemplateId:'shift_ops_day',revision:roster.revision,assignments:[{personId:'person_ops_other',postId:null}]}]},403)
  await login('ops.manager')
  await request('/operations/rosters','PUT',{mode:'daily',records:[{workDate:today,crewId:'crew_ops_wash',shiftTemplateId:'shift_ops_day',revision:roster.revision,assignments:[{personId:'person_ops_other',postId:null}]}]},400)
  await login('ops.manager')
  const shift=await request(`/operations/shifts/${night.id}`,'PUT',{name:'夜班改名',startTime:'19:00',endTime:'07:00',status:'active',revision:night.revision})
  assert.equal(shift.crossDay,true)
  assert.equal((await request(`/operations/rosters?scope=managed&dateFrom=${today}&dateTo=${today}&crewId=crew_ops_main`))[0].shiftName,'夜班','历史排班保留班次快照')
  await login('ops.wash')
  const input={kind:'vehicle',workDate:today,plateNumber:'京A88888',clientRequestId:'dispatch-vehicle-1'}
  const ticket=await request('/operations/sanitation','POST',input)
  assert.equal(ticket.workItems[0].assignments[0].personId,'person_ops_a','默认派单取替班人员，不取当前登录人')
  assert.equal(ticket.workItems[0].assignments[0].shareBasisPoints,10000)
  await login('ops.other')
  await request('/operations/sanitation','POST',{...input,clientRequestId:'dispatch-forbidden'},403)
  await login('ops.wash')
  assert.equal((await request('/operations/sanitation','POST',input)).id,ticket.id,'原创建人重试返回原工单')
  await login('ops.manager')
  const restoredRoster=(await request('/operations/rosters','PUT',{mode:'monthly',records:[{workDate:today,crewId:'crew_ops_wash',shiftTemplateId:'shift_ops_day',revision:roster.revision,assignments:[{personId:'person_ops_wash',postId:null}]}]}))[0]
  await login('ops.manager')
  assert.equal((await request(`/operations/tickets/${ticket.id}`)).workItems[0].assignments[0].personId,'person_ops_a','排班变更不改已有工单')
  await request('/operations/rosters','PUT',{mode:'monthly',records:[{workDate:today,crewId:'crew_ops_wash',shiftTemplateId:'shift_ops_day',revision:restoredRoster.revision,assignments:[{personId:'person_ops_wash',postId:null},{personId:'person_ops_a',postId:null}]}]})
  await login('ops.wash')
  const multi=await request('/operations/sanitation','POST',{...input,clientRequestId:'dispatch-vehicle-multi'})
  assert.deepEqual(multi.workItems[0].assignments.map(x=>[x.personId,x.shareBasisPoints]).sort(),[['person_ops_a',5000],['person_ops_wash',5000]],'多人初始均分')
  assert.equal(multi.workItems[0].assignments.reduce((sum,x)=>sum+x.shareBasisPoints,0),10000,'贡献比例守恒')
  const mine=await request(`/operations/sanitation-summary?scope=mine&dateFrom=${today}&dateTo=${today}`)
  assert(mine.some(x=>x.ticketId===multi.id&&x.kind==='vehicle'&&x.plateNumber==='京A88888'),'本人参与的洗消工单对创建人可见')
  assert.equal(mine.some(x=>x.ticketId===ticket.id),false,'仅创建但非参与人的洗消工单不进入本人摘要')
  await login('ops.worker')
  assert((await request(`/operations/sanitation-summary?scope=mine&dateFrom=${today}&dateTo=${today}`)).some(x=>x.ticketId===ticket.id),'实际参与人可读取自己的洗消工单摘要')
  await login('ops.other')
  const otherSummary=await request(`/operations/sanitation-summary?scope=mine&dateFrom=${today}&dateTo=${today}`)
  assert.equal(otherSummary.some(x=>x.ticketId===ticket.id||x.ticketId===multi.id),false,'非参与员工不能读取他人洗消摘要')
  await login('ops.manager')
  const managedSummary=await request(`/operations/sanitation-summary?scope=managed&dateFrom=${today}&dateTo=${today}`)
  assert(managedSummary.some(x=>x.ticketId===ticket.id)&&managedSummary.some(x=>x.ticketId===multi.id),'PC 月表按管理范围读取洗消工单摘要')
  await request('/operations/rosters','PUT',{mode:'monthly',records:[{workDate:today,crewId:'crew_ops_wash',shiftTemplateId:'shift_ops_night',revision:0,assignments:[]}]})
  console.log('[PASS] 默认作业组派单、单人/多人分配、资格替班、版本校验、跨天归属与历史快照')
}catch(error){console.error(logs.slice(-6000));throw error}finally{server.kill();await new Promise(done=>{if(server.exitCode!==null)return done();server.once('close',done);setTimeout(done,3000)})}
console.log(`隔离数据库保留：${databasePath}`)
