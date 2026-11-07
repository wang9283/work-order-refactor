// Add independent demo fixtures to an explicitly selected database. Never resets a database.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const path = process.env.DATABASE_PATH && resolve(process.env.DATABASE_PATH)
if (!path || path.toLowerCase() === resolve('data/feed.db').toLowerCase()) throw new Error('请指定独立演示 DATABASE_PATH，不能使用 data/feed.db')
const db = new DatabaseSync(path)
db.exec('PRAGMA foreign_keys=ON')
const timestamp = new Date().toISOString()
function clone(table, sourceId, overrides) {
  if (db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(overrides.id)) return
  const source = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(sourceId)
  if (!source) throw new Error(`请先运行 db:init，缺少 ${table}/${sourceId}`)
  const row = { ...source, ...overrides }
  const columns = Object.keys(row)
  db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row))
}
db.exec('BEGIN IMMEDIATE')
try {
  clone('companies','co_xinjin',{id:'co_ops_demo',code:'OPS-DEMO',name:'工作量演示公司',short_name:'工作量演示'})
  clone('production_bases','base_direct',{id:'base_ops_demo',code:'OPS-DEMO',name:'工作量演示基地',company_id:'co_ops_demo',site_confirmed:1})
  clone('production_bases','base_ops_demo',{id:'base_ops_demo_b',code:'OPS-DEMO-B',name:'工作量演示基地 B',company_id:'co_ops_demo',site_confirmed:1})
  clone('factories','factory_xinjin',{id:'factory_ops_demo',code:'OPS-DEMO',name:'工作量演示工厂',company_id:'co_ops_demo',base_id:'base_ops_demo',manager_person_id:null})
  clone('factories','factory_ops_demo',{id:'factory_ops_demo_b',code:'OPS-DEMO-B',name:'工作量演示工厂 B',company_id:'co_ops_demo',base_id:'base_ops_demo_b',manager_person_id:null})
  // Org Management is the single source for the top-bar organization picker.
  db.prepare(`INSERT OR IGNORE INTO org_nodes
    (id,parent_id,code,name,factory_id,payroll_company_id,pricing_site_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    'org_ops_company', null, 'ORG-OPS-DEMO', '工作量演示公司', null, 'co_ops_demo', null, 'active', timestamp, timestamp)
  db.prepare(`INSERT OR IGNORE INTO org_nodes
    (id,parent_id,code,name,factory_id,payroll_company_id,pricing_site_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    'org_ops_demo', 'org_ops_company', 'ORG-OPS-DEMO-A', '工作量演示工厂', 'factory_ops_demo', 'co_ops_demo', 'base_ops_demo', 'active', timestamp, timestamp)
  db.prepare(`INSERT OR IGNORE INTO org_nodes
    (id,parent_id,code,name,factory_id,payroll_company_id,pricing_site_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    'org_ops_demo_b', 'org_ops_company', 'ORG-OPS-DEMO-B', '工作量演示工厂 B', 'factory_ops_demo_b', 'co_ops_demo', 'base_ops_demo_b', 'active', timestamp, timestamp)
  // Migration 011 derived org nodes from factories, but on freshly seeded databases the
  // factories table is still empty when migrations run. Backfill one work org per active
  // factory so Org Management stays the single source for every seeded base.
  for (const group of db.prepare('SELECT * FROM management_groups').all()) {
    db.prepare(`INSERT OR IGNORE INTO org_nodes
      (id,parent_id,code,name,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      group.id, null, `ORG-${group.code}`, group.name, group.status, timestamp, timestamp)
  }
  const coveredFactories = new Set(
    db.prepare('SELECT factory_id FROM org_nodes WHERE factory_id IS NOT NULL').all().map((row) => row.factory_id),
  )
  for (const factory of db.prepare("SELECT * FROM factories WHERE status = 'active'").all()) {
    if (coveredFactories.has(factory.id)) continue
    const parent = factory.management_group_id
      ? db.prepare('SELECT id FROM org_nodes WHERE id = ?').get(factory.management_group_id)
      : undefined
    db.prepare(`INSERT OR IGNORE INTO org_nodes
      (id,parent_id,code,name,factory_id,payroll_company_id,pricing_site_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      `org_seed_${factory.id}`, parent?.id ?? null, factory.code, factory.name, factory.id,
      factory.company_id, factory.base_id, factory.status, timestamp, timestamp)
  }
  clone('work_areas','area_xinjin_prod',{id:'area_ops_a',code:'OPS-AREA-A',name:'A 基地生产区',base_id:'base_ops_demo',factory_id:'factory_ops_demo',parent_id:null,manager_person_id:null})
  clone('work_areas','area_xinjin_prod',{id:'area_ops_b',code:'OPS-AREA-B',name:'B 基地生产区',base_id:'base_ops_demo_b',factory_id:'factory_ops_demo_b',parent_id:null,manager_person_id:null})
  clone('production_lines','line_xinjin_1',{id:'line_ops_a',code:'OPS-LINE-A',name:'A 基地一号线',base_id:'base_ops_demo',work_area_id:'area_ops_a'})
  clone('production_lines','line_xinjin_1',{id:'line_ops_b',code:'OPS-LINE-B',name:'B 基地一号线',base_id:'base_ops_demo_b',work_area_id:'area_ops_b'})
  for (const [suffix,name] of [['leader','演示组长'],['a','演示员工甲'],['b','演示员工乙'],['other','外组员工'],['wash','洗消工何学刚'],['loan','跨基地借调员工']]) {
    clone('people','person_yang',{id:`person_ops_${suffix}`,employee_code:`OPS-${suffix}`,name,home_company_id:'co_ops_demo',home_base_id:'base_ops_demo',factory_id:'factory_ops_demo'})
  }
  for (const [suffix,name] of [['main','普通料生产班'],['other','预混料生产班'],['loading','装卸班'],['wash','洗消班']]) {
    clone('crews','crew_xinjin_sauce',{id:`crew_ops_${suffix}`,code:`OPS-${suffix}`,name,base_id:'base_ops_demo',factory_id:'factory_ops_demo',work_area_id:null,leader_person_id:suffix==='main'?'person_ops_leader':null})
  }
  clone('crews','crew_ops_main',{id:'crew_ops_b',code:'OPS-B-MAIN',name:'B 基地生产班',base_id:'base_ops_demo_b',factory_id:'factory_ops_demo_b',work_area_id:null,leader_person_id:null})
  // Older independent demo databases used generic crew names. Correct only those
  // unchanged fixture names; a user-entered rename is preserved.
  db.prepare(`UPDATE crews SET name='普通料生产班',updated_at=? WHERE id='crew_ops_main' AND name='演示生产一组'`).run(timestamp)
  db.prepare(`UPDATE crews SET name='预混料生产班',updated_at=? WHERE id='crew_ops_other' AND name='演示生产二组'`).run(timestamp)
  if(!db.prepare(`SELECT id FROM crew_memberships WHERE person_id='person_ops_b' AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)`).get(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()))) clone('crew_memberships','cm_yang_sauce',{id:'cm_ops_loading',crew_id:'crew_ops_loading',person_id:'person_ops_b',role:'operator',valid_from:'2020-01-01',valid_to:null})
  clone('crew_memberships','cm_yang_sauce',{id:'cm_ops_wash',crew_id:'crew_ops_wash',person_id:'person_ops_wash',role:'operator',valid_from:'2020-01-01',valid_to:null})
  clone('crew_memberships','cm_yang_sauce',{id:'cm_ops_other',crew_id:'crew_ops_other',person_id:'person_ops_other',role:'operator',valid_from:'2020-01-01',valid_to:null})
  for (const suffix of ['leader','a']) clone('crew_memberships','cm_yang_sauce',{
    id:`cm_ops_${suffix}`,crew_id:'crew_ops_main',person_id:`person_ops_${suffix}`,
    role:suffix==='leader'?'leader':'operator',valid_from:'2020-01-01',valid_to:null,
  })
  for (const [suffix,username,person,role] of [
    ['manager','ops.manager',null,'role_base_manager'],['leader','ops.leader','person_ops_leader','role_executor'],
    ['a','ops.worker','person_ops_a','role_executor'],['b','ops.worker2','person_ops_b','role_executor'],['other','ops.other','person_ops_other','role_executor'],
    ['wash','ops.wash','person_ops_wash','role_executor'],
  ]) {
    clone('accounts','acct_executor',{id:`acct_ops_${suffix}`,username,display_name:username,person_id:person})
    clone('role_assignments','ra_executor',{id:`ra_ops_${suffix}`,account_id:`acct_ops_${suffix}`,role_id:role,scope_type:'base',scope_id:'base_ops_demo',valid_from:null,valid_to:null})
  }
  clone('role_assignments','ra_ops_manager',{id:'ra_ops_manager_b',account_id:'acct_ops_manager',role_id:'role_base_manager',scope_type:'base',scope_id:'base_ops_demo_b',valid_from:null,valid_to:null})
  for (const [suffix,name,start,end,cross] of [['day','常日班','08:00','17:00',0],['night','夜班','20:00','08:00',1],['white','白班','08:00','20:00',0]]) clone('shift_templates',suffix==='white'?'shift_direct_day':`shift_direct_${suffix}`,{id:`shift_ops_${suffix}`,base_id:'base_ops_demo',name,code:`OPS-${suffix}`,start_time:start,end_time:end,cross_day:cross})
  clone('shift_templates','shift_ops_day',{id:'shift_ops_b_day',base_id:'base_ops_demo_b',name:'B 基地常日班',code:'OPS-B-DAY',start_time:'08:00',end_time:'17:00',cross_day:0})
  db.prepare(`INSERT OR IGNORE INTO secondments
    (id,person_id,from_company_id,from_base_id,to_company_id,to_base_id,to_factory_id,
     start_date,end_date,purpose,status,approved_by,revision,created_at,updated_at)
    VALUES ('secondment_ops_loan','person_ops_loan','co_ops_demo','base_ops_demo',
      'co_ops_demo','base_ops_demo_b','factory_ops_demo_b','2020-01-01','2099-12-31',
      '生产基地切换隔离验收','active','acct_ops_manager',1,?,?)`).run(timestamp,timestamp)
  // Older demo runs reused this fixture id for 白班 08:00–20:00. Correct
  // only that unchanged legacy signature so user edits remain intact.
  db.prepare(`UPDATE shift_templates SET name='常日班',start_time='08:00',end_time='17:00',cross_day=0,updated_at=? WHERE id='shift_ops_day' AND name='白班' AND code='OPS-day' AND start_time='08:00' AND end_time='20:00'`).run(timestamp)
  db.prepare(`INSERT OR IGNORE INTO qualifications (id,code,name,description,status,revision,created_at,updated_at) VALUES ('qualification_ops_wash','OPS-WASH','洗消作业资格','允许承接车辆和厂区洗消','active',1,?,?)`).run(timestamp,timestamp)
  for(const suffix of ['a','wash'])db.prepare(`INSERT OR IGNORE INTO person_qualifications (id,person_id,qualification_id,valid_from,valid_to,certificate_no,revision,created_at,updated_at) VALUES (?,?,'qualification_ops_wash','2020-01-01',NULL,'',1,?,?)`).run(`pq_ops_${suffix}`,`person_ops_${suffix}`,timestamp,timestamp)
  db.prepare(`INSERT OR IGNORE INTO operations_crew_rules (crew_id,qualification_id,updated_at,updated_by) VALUES ('crew_ops_wash','qualification_ops_wash',?,'acct_ops_manager')`).run(timestamp)
  for (const [suffix,kind,name] of [['material','material_type','演示畜禽料'],['post_a','production_post','投料'],['post_b','production_post','打包'],['loading','loading_type','成品装车']]) {
    db.prepare(`INSERT OR IGNORE INTO business_catalog (id,kind,code,name,created_at,updated_at) VALUES (?,?,?,?,?,?)`).run(`catalog_ops_${suffix}`,kind,`OPS-${suffix}`,name,timestamp,timestamp)
  }
  for (const suffix of ['material','loading']) db.prepare(`INSERT OR IGNORE INTO site_business_config_items (site_id,catalog_id,enabled,updated_at) VALUES ('base_ops_demo',?,1,?)`).run(`catalog_ops_${suffix}`,timestamp)
  db.prepare(`INSERT OR IGNORE INTO site_business_config_items (site_id,catalog_id,enabled,updated_at) VALUES ('base_ops_demo_b','catalog_ops_loading',1,?)`).run(timestamp)
  db.prepare(`INSERT OR IGNORE INTO materials (id,code,name,material_type_id,created_at,updated_at) VALUES ('material_ops_demo','OPS-DEMO','演示颗粒料','catalog_ops_material',?,?)`).run(timestamp,timestamp)
  db.prepare(`INSERT OR IGNORE INTO materials (id,code,name,material_type_id,created_at,updated_at) VALUES ('material_ops_missing_post','OPS-MISSING-POST','缺岗待分配演示料','catalog_ops_material',?,?)`).run(timestamp,timestamp)
  for (const suffix of ['post_a','post_b']) db.prepare(`INSERT OR IGNORE INTO material_post_flags VALUES ('material_ops_demo',?)`).run(`catalog_ops_${suffix}`)
  db.prepare(`INSERT OR IGNORE INTO material_post_flags VALUES ('material_ops_missing_post','catalog_ops_post_a')`).run()
  for (const [suffix,kind,price] of [['post_a','production',2000000],['post_b','production',3000000],['loading','loading',1500000]]) {
    db.prepare(`INSERT OR IGNORE INTO business_price_rule_versions (id,site_id,kind,catalog_id,material_type_id,version_no,unit,unit_price_micros,effective_from,created_at) VALUES (?,'base_ops_demo',?,?,?,1,'吨',?,'2020-01-01T00:00:00Z',?)`).run(`price_ops_${suffix}`,kind,`catalog_ops_${suffix}`,kind==='production'?'catalog_ops_material':null,price,timestamp)
  }
  clone('business_price_rule_versions','price_ops_loading',{id:'price_ops_loading_b',site_id:'base_ops_demo_b'})
  clone('form_templates','form_demo',{id:'form_ops_demo',code:'OPS-OTHER',name:'临时现场作业表单',current_published_version_id:'formver_ops_demo'})
  clone('form_versions','formver_demo',{id:'formver_ops_demo',template_id:'form_ops_demo',schema_json:JSON.stringify({mainFields:[{id:'ops_note',key:'work_note',name:'作业说明',type:'text',required:true,strategy:'blocking',description:'',defaultValue:''}],subForms:[],conditionRules:[]})})
  clone('ticket_types','type_demo',{id:'type_ops_demo',code:'OPS-OTHER',name:'其他现场作业',current_version_id:'typever_ops_demo',business_kind:null})
  clone('ticket_type_versions','typever_demo',{id:'typever_ops_demo',ticket_type_id:'type_ops_demo',form_version_id:'formver_ops_demo'})
  clone('ticket_types','type_demo',{
    id:'type_ops_multibase',code:'OPS-MULTIBASE',name:'跨基地作业配置',
    owner_type:'company',owner_id:'co_ops_demo',origin:'local',
    current_version_id:null,status:'draft',locked:0,business_kind:null,
  })
  clone('ticket_type_versions','typever_demo',{
    id:'typever_ops_multibase',ticket_type_id:'type_ops_multibase',version_no:1,
    status:'draft',published_at:null,published_by:null,
  })
  for(const [suffix,siteId,factoryId,shiftId,crewId] of [
    ['a','base_ops_demo','factory_ops_demo','shift_ops_day','crew_ops_main'],
    ['b','base_ops_demo_b','factory_ops_demo_b','shift_ops_b_day','crew_ops_b'],
  ]){
    clone('work_profiles','wp_demo_hz',{
      id:`wp_ops_multibase_${suffix}`,ticket_type_version_id:'typever_ops_multibase',
      name:`${suffix.toUpperCase()} 基地配置`,site_id:siteId,factory_id:factoryId,
      work_area_id:null,production_line_id:null,crew_id:crewId,shift_template_id:shiftId,
    })
  }
  clone('handover_shift_profiles','handover_heze_day',{
    id:'handover_ops_a',name:'A 基地交接配置',factory_id:'factory_ops_demo',
    shift_template_id:'shift_ops_day',revision:1,status:'active',
  })
  clone('handover_shift_profiles','handover_heze_day',{
    id:'handover_ops_b',name:'B 基地交接配置',factory_id:'factory_ops_demo_b',
    shift_template_id:'shift_ops_b_day',revision:1,status:'active',
  })
  for(const [profileId,crewId] of [['handover_ops_a','crew_ops_main'],['handover_ops_b','crew_ops_b']]){
    db.prepare('INSERT OR IGNORE INTO handover_shift_profile_crews (profile_id,crew_id) VALUES (?,?)').run(profileId,crewId)
  }
  for(const [suffix,code,name] of [['vehicle','VEHICLE_SANITATION','车辆洗消'],['facility','FACILITY_SANITATION','厂区洗消']]){
    clone('form_templates','form_demo',{id:`form_ops_${suffix}`,code,name:`${name}记录`,current_published_version_id:`formver_ops_${suffix}`})
    clone('form_versions','formver_demo',{id:`formver_ops_${suffix}`,template_id:`form_ops_${suffix}`,schema_json:JSON.stringify({mainFields:[],subForms:[],conditionRules:[]})})
    clone('ticket_types','type_demo',{id:`type_ops_${suffix}`,code,name,current_version_id:`typever_ops_${suffix}`,business_kind:null})
    clone('ticket_type_versions','typever_demo',{id:`typever_ops_${suffix}`,ticket_type_id:`type_ops_${suffix}`,form_version_id:`formver_ops_${suffix}`})
    db.prepare(`INSERT OR IGNORE INTO operations_assignment_rules (site_id,ticket_type_id,crew_id,updated_at,updated_by) VALUES ('base_ops_demo',?,'crew_ops_wash',?,'acct_ops_manager')`).run(`type_ops_${suffix}`,timestamp)
  }
  for(const [kind,index,name] of [['vehicle',1,'测氯试纸示例'],['vehicle',2,'车头洗消示例'],['vehicle',3,'车尾洗消示例'],['vehicle',4,'车顶洗消示例'],['vehicle',5,'入烘记录示例'],['facility',1,'生产区洗消示例'],['facility',2,'生活区洗消示例'],['facility',3,'办公区洗消示例']]){
    db.prepare(`INSERT OR IGNORE INTO operations_demo_assets (id,kind,name,url) VALUES (?,?,?,?)`).run(`asset_${kind}_${index}`,kind,name,`/demo-evidence/${kind}-${index}.svg`)
  }
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
  // Seed one full natural month of default arrangements. Days 06 and 15 stay
  // empty on purpose: 06 demonstrates an unassigned sanitation order, 15 shows
  // that an empty cell means "not scheduled" rather than "rest".
  const [year,monthNumber]=today.split('-').map(Number)
  const lastDay=new Date(Date.UTC(year,monthNumber,0)).getUTCDate()
  const shiftRows=new Map(db.prepare(`SELECT * FROM shift_templates WHERE id IN ('shift_ops_day','shift_ops_night','shift_ops_white')`).all().map(row=>[row.id,row]))
  const defaultRosters=[
    ['regular','crew_ops_main','shift_ops_night',[{personId:'person_ops_a',postId:'catalog_ops_post_a'},{personId:'person_ops_b',postId:'catalog_ops_post_a'},{personId:'person_ops_leader',postId:'catalog_ops_post_b'}]],
    ['premix','crew_ops_other','shift_ops_night',[{personId:'person_ops_other',postId:'catalog_ops_post_a'}]],
    ['loading','crew_ops_loading','shift_ops_day',[{personId:'person_ops_b',postId:null}]],
    ['wash','crew_ops_wash','shift_ops_day',[{personId:'person_ops_wash',postId:null}]],
  ]
  for(let day=1;day<=lastDay;day++){
    if(day===6||day===15)continue
    const workDate=`${today.slice(0,8)}${String(day).padStart(2,'0')}`
    for(const [suffix,crew,shiftId,assignments] of defaultRosters){
      const id=day===Number(today.slice(8))?`roster_ops_${suffix}`:`roster_ops_${suffix}_${String(day).padStart(2,'0')}`
      if(db.prepare('SELECT id FROM operations_rosters WHERE id=?').get(id))continue
      if(db.prepare('SELECT id FROM operations_rosters WHERE work_date=? AND shift_template_id=? AND crew_id=?').get(workDate,shiftId,crew))continue
      const shiftRow=shiftRows.get(shiftId)
      const startDate=shiftRow.cross_day?new Date(Date.parse(`${workDate}T00:00:00Z`)-86400000).toISOString().slice(0,10):workDate
      db.prepare(`INSERT OR IGNORE INTO operations_rosters (id,work_date,shift_template_id,crew_id,assignments_json,source,note,updated_at,updated_by,attribution_date,shift_start_date,shift_name_snapshot,shift_start_time_snapshot,shift_end_time_snapshot,shift_cross_day_snapshot) VALUES (?,?,?,?,?,'monthly','示例默认安排',?,'acct_ops_manager',?,?,?,?,?,?)`).run(id,workDate,shiftId,crew,JSON.stringify(assignments),timestamp,workDate,startDate,shiftRow.name,shiftRow.start_time,shiftRow.end_time,shiftRow.cross_day)
    }
  }
  db.prepare(`UPDATE operations_rosters SET shift_name_snapshot='常日班',shift_start_time_snapshot='08:00',shift_end_time_snapshot='17:00',shift_cross_day_snapshot=0,updated_at=? WHERE crew_id IN ('crew_ops_loading','crew_ops_wash') AND note='示例默认安排' AND shift_template_id='shift_ops_day' AND shift_name_snapshot='白班'`).run(timestamp)
  db.exec('COMMIT')
} catch (error) { db.exec('ROLLBACK'); throw error }
db.close()
console.log(JSON.stringify({ databasePath:path,accounts:['ops.manager','ops.leader','ops.worker','ops.worker2','ops.other','ops.wash'],crewId:'crew_ops_main',shiftId:'shift_ops_day',materialId:'material_ops_demo',loadingTypeId:'catalog_ops_loading',crossBaseTypeId:'type_ops_multibase' }))
