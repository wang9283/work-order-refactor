// Public API + isolated SQLite. Demonstration evidence only; no camera/upload claim.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
const root=resolve(import.meta.dirname,'..'),databasePath=resolve(root,'data/isolated',`sanitation-${Date.now()}`,'check.db');mkdirSync(resolve(databasePath,'..'),{recursive:true})
async function command(args,env){const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);await new Promise((done,fail)=>{child.on('error',fail);child.on('close',c=>c===0?done():fail(new Error(output)))})}
let port;for(let p=3430;p<3470;p++){const available=await new Promise(done=>{const s=createServer();s.on('error',()=>done(false));s.listen(p,'127.0.0.1',()=>s.close(()=>done(true)))});if(available){port=p;break}}assert(port)
const env={DATABASE_PATH:databasePath,PORT:String(port),LOG_LEVEL:'error'};await command(['--import','tsx','server/db/init.ts'],env);await command(['scripts/prepare-operations-demo.mjs'],env)
const server=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let logs='';server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x)
const base=`http://127.0.0.1:${port}/api`;let token
async function request(path,method='GET',body,expected=200){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(result)}`);return result.data}
async function login(username){token=(await request('/auth/login','POST',{username,password:'Feed2026!'})).token}
try{
  for(let i=0;i<300;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  await login('ops.manager');const context=await request('/operations/context'),today=context.today
  const existing=(await request(`/operations/rosters?scope=managed&crewId=crew_ops_wash&dateFrom=${today}&dateTo=${today}`)).find(x=>x.shiftTemplateId==='shift_ops_day')
  const roster=(await request('/operations/rosters','PUT',{mode:'monthly',records:[{workDate:today,crewId:'crew_ops_wash',shiftTemplateId:'shift_ops_day',revision:existing?.revision||0,assignments:[{personId:'person_ops_wash',postId:null}]}]}))[0]
  await login('ops.wash')
  let vehicle=await request('/operations/sanitation','POST',{kind:'vehicle',workDate:today,plateNumber:'京A88888',clientRequestId:'vehicle-flow'})
  assert.equal(vehicle.sanitation.plateNumber,'京A88888');assert(vehicle.sanitation.publishedAt);assert.equal(vehicle.sanitation.publishedByName,'洗消工何学刚')
  assert.equal(vehicle.crewName,'洗消班');assert.equal(vehicle.shiftName,'常日班')
  await login('ops.manager')
  const dayShift=context.shifts.find(x=>x.id==='shift_ops_day')
  await request(`/operations/shifts/${dayShift.id}`,'PUT',{name:'常日班改名',startTime:'08:00',endTime:'17:00',status:'active',revision:dayShift.revision})
  await login('ops.wash')
  const existingVehicle=await request(`/operations/tickets/${vehicle.id}`)
  assert.equal(existingVehicle.shiftName,'常日班','工单保留班次名称快照，不随配置改名')
  const assets=await request('/operations/demo-assets?kind=vehicle');assert(assets.length>=5);assert(assets.every(x=>x.url.startsWith('/demo-evidence/')))
  await request(`/operations/tickets/${vehicle.id}/evidence`,'POST',{revision:vehicle.revision,pointKey:'chlorine',assetId:'asset_vehicle_1'},409)
  await request(`/operations/tickets/${vehicle.id}/complete-sanitation`,'POST',{revision:vehicle.revision,dryingRequired:false},409)
  vehicle=await request(`/operations/tickets/${vehicle.id}/start-sanitation`,'POST',{revision:vehicle.revision})
  assert(vehicle.sanitation.startedAt);assert.equal(vehicle.sanitation.startedByName,'洗消工何学刚')
  await request(`/operations/tickets/${vehicle.id}/complete-sanitation`,'POST',{revision:vehicle.revision,dryingRequired:false},400)
  const points=[['chlorine',1],['before_head_left',2],['before_tail_right',3],['before_roof',4],['after_head_left',2],['after_tail_right',3],['after_roof',4]]
  for(const [point,index] of points){vehicle=await request(`/operations/tickets/${vehicle.id}/evidence`,'POST',{revision:vehicle.revision,pointKey:point,assetId:`asset_vehicle_${index}`});assert(vehicle.sanitation.evidence.some(x=>x.pointKey===point&&x.operatorName==='洗消工何学刚'))}
  await request(`/operations/tickets/${vehicle.id}/evidence`,'POST',{revision:vehicle.revision,pointKey:'chlorine',assetId:'asset_vehicle_1'},200)
  await request(`/operations/tickets/${vehicle.id}/evidence`,'POST',{revision:vehicle.revision,pointKey:'chlorine',assetId:'https://example.com/fake.jpg'},400)
  vehicle=await request(`/operations/tickets/${vehicle.id}`)
  await request(`/operations/tickets/${vehicle.id}/complete-sanitation`,'POST',{revision:vehicle.revision,dryingRequired:true,dryingStartedAt:`${today}T22:00:00+08:00`,dryingEndedAt:`${today}T21:00:00+08:00`},400)
  await request(`/operations/tickets/${vehicle.id}/complete-sanitation`,'POST',{revision:vehicle.revision,dryingRequired:true,dryingStartedAt:`${today}T22:00:00+08:00`,dryingEndedAt:`${today}T23:30:00+08:00`},400)
  vehicle=await request(`/operations/tickets/${vehicle.id}/evidence`,'POST',{revision:vehicle.revision,pointKey:'drying_entry',assetId:'asset_vehicle_5'})
  const nextDate=new Date(Date.parse(`${today}T00:00:00Z`)+86400000).toISOString().slice(0,10)
  vehicle=await request(`/operations/tickets/${vehicle.id}/complete-sanitation`,'POST',{revision:vehicle.revision,dryingRequired:true,dryingStartedAt:`${today}T22:00:00+08:00`,dryingEndedAt:`${nextDate}T01:30:00+08:00`})
  assert.equal(vehicle.sanitation.dryingMinutes,210);assert.equal(vehicle.completed,true);assert.equal(vehicle.quantity,1);assert.equal(vehicle.workItems[0].unit,'辆');assert(vehicle.sanitation.endedAt)
  await request(`/operations/tickets/${vehicle.id}/start-sanitation`,'POST',{revision:vehicle.revision},409)
  let facility=await request('/operations/sanitation','POST',{kind:'facility',workDate:today,clientRequestId:'facility-flow'})
  await request(`/operations/tickets/${facility.id}/start-sanitation`,'POST',{revision:facility.revision})
  facility=await request(`/operations/tickets/${facility.id}`)
  await request(`/operations/tickets/${facility.id}/areas/living/start`,'POST',{revision:facility.revision,areaKey:'living'},409)
  for(const [area,index] of [['production',1],['living',2],['office',3]]){
    facility=await request(`/operations/tickets/${facility.id}/areas/${area}/start`,'POST',{revision:facility.revision,areaKey:area})
    await request(`/operations/tickets/${facility.id}/areas/${area}/complete`,'POST',{revision:facility.revision,areaKey:area},400)
    for(let photo=0;photo<3;photo++)facility=await request(`/operations/tickets/${facility.id}/evidence`,'POST',{revision:facility.revision,pointKey:`area_${area}_${photo+1}`,assetId:`asset_facility_${index}`})
    facility=await request(`/operations/tickets/${facility.id}/areas/${area}/complete`,'POST',{revision:facility.revision,areaKey:area})
    const completedAt=facility.sanitation.areas.find(x=>x.key===area).completedAt;assert(completedAt)
    if(area==='production'){
      const supplement=await request(`/operations/tickets/${facility.id}/evidence`,'POST',{revision:facility.revision,pointKey:`area_${area}_4`,assetId:`asset_facility_${index}`})
      assert.equal(supplement.sanitation.areas.find(x=>x.key===area).completedAt,completedAt,'补充照片不改变首次完成时间')
      facility=await request(`/operations/tickets/${facility.id}`)
    }
  }
  assert.equal(facility.completed,false,'三区完成仍需员工手动确认整单结束')
  facility=await request(`/operations/tickets/${facility.id}/complete-sanitation`,'POST',{revision:facility.revision})
  assert.equal(facility.completed,true);assert.equal(facility.quantity,3);assert.equal(facility.workItems[0].unit,'区')
  await login('ops.other');await request(`/operations/tickets/${facility.id}`,'GET',undefined,403);await request(`/operations/tickets/${facility.id}/evidence`,'POST',{revision:facility.revision,pointKey:'area_production_5',assetId:'asset_facility_1'},403)
  await login('ops.wash');await request('/operations/confirmations','POST',{ticketIds:[vehicle.id,facility.id]})
  await login('ops.manager')
  const adjusted=await request(`/operations/tickets/${vehicle.id}/items/generic:${vehicle.id}/assignments`,'PUT',{revision:vehicle.revision,reason:'临时协作调整',assignments:[{personId:'person_ops_wash',shareBasisPoints:7000},{personId:'person_ops_a',shareBasisPoints:3000}]})
  assert.equal(adjusted.quantity,1);assert.equal(adjusted.workItems[0].assignments.find(x=>x.personId==='person_ops_wash').confirmedAt!==null,true)
  const exported=await request(`/operations/export?crewId=crew_ops_wash&dateFrom=${today}&dateTo=${today}`)
  assert.equal(exported.rows.find(x=>x.ticketId===vehicle.id&&x.personId==='person_ops_a').quantity,0.3)
  assert.equal(exported.rows.filter(x=>x.ticketId===facility.id).reduce((sum,x)=>sum+x.quantity,0),3)
  const trimmed=await request(`/operations/tickets/${vehicle.id}/items/generic:${vehicle.id}/assignments`,'PUT',{revision:adjusted.revision,reason:'移除临时协作人员',assignments:[{personId:'person_ops_wash',shareBasisPoints:10000}]})
  assert.deepEqual(trimmed.workItems[0].assignments.map(x=>x.personId),['person_ops_wash'],'调整人员后移除旧参与者')
  await login('ops.manager')
  const monthStart=`${today.slice(0,8)}01`
  const monthEnd=`${today.slice(0,8)}${new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),0)).getUTCDate()}`
  const washRosters=await request(`/operations/rosters?scope=managed&crewId=crew_ops_wash&dateFrom=${monthStart}&dateTo=${monthEnd}`)
  const unstaffedDate=Array.from({length:Number(monthEnd.slice(8))},(_,index)=>`${today.slice(0,8)}${String(index+1).padStart(2,'0')}`).find(day=>!washRosters.some(row=>row.workDate===day))
  assert(unstaffedDate,'整月示例应保留一个洗消班未安排日期')
  await login('ops.wash')
  const unassigned=await request('/operations/sanitation','POST',{kind:'facility',workDate:unstaffedDate,clientRequestId:'unstaffed'})
  assert.equal(unassigned.assignmentIssue,'当天未安排人员','无排班工单按业务标记进入待分配');assert.equal(unassigned.workItems[0].assignments.length,0,'无排班工单不静默指定执行人');assert(['pending_assignment','pending_start'].includes(unassigned.status),'待分配工单保持未完成状态')
  console.log('[PASS] 车辆点位与烘干、厂区顺序与首完时间、自主完单、越权/幂等/冲突、工作量闭环')
}catch(error){console.error(logs.slice(-10000));throw error}finally{server.kill();await new Promise(done=>{if(server.exitCode!==null)return done();server.once('close',done);setTimeout(done,3000)})}
console.log(`隔离数据库保留：${databasePath}`)
