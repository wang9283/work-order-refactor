import { createHash, randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'

const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api'
const password = 'Feed2026!'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, options = {}, token) {
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers })
  const body = response.status === 204 ? null : await response.json()
  return { status: response.status, body }
}

async function login(username) {
  const result = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  assert(result.status === 200, `${username} 登录失败: ${JSON.stringify(result.body)}`)
  return result.body.data
}

async function expectStatus(promise, status, label) {
  const result = await promise
  assert(result.status === status, `${label}: 期望 ${status}，实际 ${result.status} ${JSON.stringify(result.body)}`)
  return result.body?.data
}

const group = await login('group.admin')
const xinjinManager = await login('qd.manager')
const xinjinAdmin = await login('qd.admin')
const productionAdmin = await login('dz.admin')
const executor = await login('executor.demo')
const hezeFactoryAdmin = await login('hz.factory.admin')

await expectStatus(request('/audit-logs', {}, xinjinAdmin.token), 403, '基地管理员不能读取总部审计日志')
await expectStatus(request('/audit-logs?pageSize=200', {}, group.token), 200, '总部管理员读取审计日志')

const workbook = new ExcelJS.Workbook()
const worksheet = workbook.addWorksheet('交接班记录')
worksheet.addRow(['班次', '产量', '质量结论', '交接事项'])
worksheet.addRow(['type:text', 'type:number', 'type:single_select', 'type:textarea'])
worksheet.addRow(['白班', 12, '合格', '设备已点检'])
const excelBuffer = await workbook.xlsx.writeBuffer()
const excelForm = new FormData()
excelForm.append(
  'file',
  new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }),
  'handover-smoke.xlsx',
)
// 业务约束：现场人员不依赖文件上传与交接班表，Excel 导入通道保持关闭，表单走在线结构化编辑。
const blocked = await request('/excel/imports/preview', {
  method: 'POST',
  body: excelForm,
  headers: { 'X-Owner-Type': 'group', 'X-Owner-Id': 'group' },
}, group.token)
assert(blocked.status === 400 && blocked.body?.error?.message === '当前不允许上传文件', `Excel 上传通道应关闭：${JSON.stringify(blocked.body)}`)
const nativeForm = await expectStatus(request('/forms', {
  method: 'POST',
  body: JSON.stringify({
    code: `SMOKE_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
    name: '冒烟在线表单',
    ownerType: 'group',
    ownerId: 'group',
    source: 'native',
    schema: {
      mainFields: [{ id: 'field_note', key: 'note', name: '情况说明', type: 'textarea', required: true, strategy: 'blocking', sort: 1, isCore: false, editableByLocal: true }],
      subForms: [],
      conditionRules: [],
    },
  }),
}, group.token), 201, '在线创建表单模板')
assert(nativeForm.versions[0].status === 'draft', '在线表单应生成草稿版本')

const tree = await expectStatus(request('/org/tree', {}, group.token), 200, '读取组织树')
assert(tree.factories.length === 4, '组织树应包含四个饲料厂')
assert(tree.managementGroups.some((group) => group.id === 'mg_direct') && tree.managementGroups.some((group) => group.id === 'mg_production'), '演示数据应有两个管理分组')
assert(tree.bases.every((base) => base.siteConfirmed && !['直属各厂', '生产基地'].includes(base.name)), '计价基地应是确认后的实际作业基地')
assert(tree.factories.filter((item) => item.baseId === 'base_direct').length === 1, '直属各厂下应有新津饲料厂')
assert(tree.crews.filter((item) => item.factoryId === 'factory_xinjin').length === 2, '新津饲料厂下应有酱料、预混两个生产班')
assert(tree.handoverShiftProfiles.length >= 3, '组织树应包含交接班配置')
assert(tree.shiftTemplates.length === 4, '直属各厂和生产基地各应有两类班次')

const factoryTree = await expectStatus(request('/org/tree', {}, hezeFactoryAdmin.token), 200, '菏泽工厂管理员读取组织树')
assert(factoryTree.factories.length === 1 && factoryTree.factories[0].id === 'factory_heze', '工厂授权只能看到菏泽饲料厂')
assert(factoryTree.crews.length === 1 && factoryTree.crews[0].id === 'crew_heze_a', '工厂授权只能看到菏泽生产班')
assert(factoryTree.bases.length === 1 && factoryTree.bases[0].id === 'base_production', '工厂授权只显示所属基地')
assert(factoryTree.shiftTemplates.length === 2, '工厂授权只显示所属基地的班次模板')
const factoryPeople = await expectStatus(request('/org/people', {}, hezeFactoryAdmin.token), 200, '工厂管理员读取人员')
assert(factoryPeople.length === 1 && factoryPeople[0].id === 'person_sun', '工厂授权只能看到本厂人员')
const factoryList = await expectStatus(request('/org/factories', {}, hezeFactoryAdmin.token), 200, '工厂管理员读取饲料厂')
assert(factoryList.length === 1 && factoryList[0].id === 'factory_heze', '工厂管理员不能看到兄弟工厂')
await expectStatus(request('/org/factories/factory_jia', {
  method: 'PUT',
  body: JSON.stringify({ name: '佳市饲料厂越权改名', revision: 1 }),
}, hezeFactoryAdmin.token), 403, '工厂管理员不能修改兄弟工厂')
const factoryOwnUpdate = await expectStatus(request('/org/factories/factory_heze', {
  method: 'PUT',
  body: JSON.stringify({ name: '菏泽饲料厂', revision: factoryList[0].revision }),
}, hezeFactoryAdmin.token), 200, '工厂管理员可以维护本厂')
assert(factoryOwnUpdate.revision === factoryList[0].revision + 1, '本厂维护应递增版本')
assert(factoryOwnUpdate.managementGroupId === factoryList[0].managementGroupId, '修改工厂名称不能清除管理分组')
await expectStatus(request('/forms', {
  method: 'POST',
  body: JSON.stringify({
    code: `HZ_FACTORY_DENIED_${randomUUID().slice(0, 8)}`,
    name: '工厂管理员越权创建公司表单',
    ownerType: 'company',
    ownerId: 'co_heze',
    source: 'native',
    schema: { mainFields: [], subForms: [], conditionRules: [] },
  }),
}, hezeFactoryAdmin.token), 403, '工厂授权不能管理整家公司表单')

const schema = {
  mainFields: [
    {
      id: 'field_output', key: 'output', name: '完成数量', type: 'number',
      required: true, strategy: 'blocking', sort: 1, isCore: true, editableByLocal: false,
      validation: { min: 1 },
    },
    {
      id: 'field_quality', key: 'quality', name: '质量结论', type: 'single_select',
      required: true, strategy: 'blocking', sort: 2, isCore: true, editableByLocal: false,
      options: [{ label: '合格', value: 'pass' }, { label: '异常', value: 'fail' }],
    },
    {
      id: 'field_note', key: 'note', name: '异常说明', type: 'textarea',
      required: false, strategy: 'optional', sort: 3, isCore: false, editableByLocal: true,
    },
  ],
  subForms: [],
  conditionRules: [{
    id: 'rule_fail_note', fieldKey: 'quality', operator: 'eq', value: 'fail',
    action: 'require', targetKeys: ['note'],
  }],
}

const suffix = randomUUID().slice(0, 8)
const groupForm = await expectStatus(request('/forms', {
  method: 'POST',
  body: JSON.stringify({
    code: `GROUP_SMOKE_${suffix}`,
    name: `集团标准烟测 ${suffix}`,
    ownerType: 'group',
    ownerId: 'group',
    source: 'native',
    locked: true,
    schema,
  }),
}, group.token), 201, '创建集团表单')

const groupVersion = groupForm.versions[0]
await expectStatus(request(`/forms/${groupForm.id}/versions/${groupVersion.id}/publish`, {
  method: 'POST',
  body: JSON.stringify({ revision: groupVersion.revision }),
}, group.token), 200, '发布集团表单')

await expectStatus(request('/forms', {
  method: 'POST',
  body: JSON.stringify({
    code: `PROD_DENIED_${suffix}`,
    name: '跨公司表单',
    ownerType: 'company',
    ownerId: 'co_xinjin',
    source: 'native',
    schema,
  }),
}, productionAdmin.token), 403, '生产基地账号不能创建新津公司表单')

const xinjinLocalForm = await expectStatus(request('/forms', {
  method: 'POST',
  body: JSON.stringify({
    code: `XJ_LOCAL_${suffix}`,
    name: `新津本地表单 ${suffix}`,
    ownerType: 'company',
    ownerId: 'co_xinjin',
    source: 'native',
    schema,
  }),
}, xinjinAdmin.token), 201, '新津基地管理员创建本地表单')
const xinjinVersion = xinjinLocalForm.versions[0]
await expectStatus(request(`/forms/${xinjinLocalForm.id}/versions/${xinjinVersion.id}/publish`, {
  method: 'POST',
  body: JSON.stringify({ revision: xinjinVersion.revision }),
}, xinjinAdmin.token), 200, '发布新津本地表单')

await expectStatus(request(`/forms/${xinjinLocalForm.id}/versions`, {
  method: 'POST',
  body: JSON.stringify({ fromVersionId: xinjinVersion.id }),
}, productionAdmin.token), 403, '生产基地账号不能修改新津表单')

const productionSeesXinjinForm = await expectStatus(request('/forms', {
  method: 'GET',
}, productionAdmin.token), 200, '生产基地读取表单列表')
assert(!productionSeesXinjinForm.some((form) => form.id === xinjinLocalForm.id), '生产基地列表不能出现新津本地表单')

const productionCategory = await expectStatus(request('/ticket-categories', {
  method: 'POST',
  body: JSON.stringify({
    code: `PROD_CROSS_CAT_${suffix}`,
    name: `生产基地分类 ${suffix}`,
    ownerType: 'company',
    ownerId: 'co_heze',
  }),
}, productionAdmin.token), 201, '创建生产基地分类')

await expectStatus(request('/ticket-types', {
  method: 'POST',
  body: JSON.stringify({
    code: `PROD_CROSS_FORM_${suffix}`,
    name: '跨公司类型',
    categoryId: productionCategory.id,
    ownerType: 'company',
    ownerId: 'co_heze',
    formTemplateId: xinjinLocalForm.id,
    formVersionId: xinjinVersion.id,
    workProfiles: [],
  }),
}, productionAdmin.token), 404, '生产基地不能引用新津本地表单')

const productionTestForm = await expectStatus(request('/forms', {
  method: 'POST',
  body: JSON.stringify({
    code: `PROD_FACTORY_FORM_${suffix}`,
    name: '生产基地工厂测试表单',
    ownerType: 'company',
    ownerId: 'co_heze',
    source: 'native',
    schema,
  }),
}, productionAdmin.token), 201, '创建生产基地工厂测试表单')
const productionTestFormVersion = productionTestForm.versions[0]
await expectStatus(
  request(`/forms/${productionTestForm.id}/versions/${productionTestFormVersion.id}/publish`, {
    method: 'POST',
    body: JSON.stringify({ revision: productionTestFormVersion.revision }),
  }, productionAdmin.token),
  200,
  '发布生产基地工厂测试表单',
)
const productionTestCategory = await expectStatus(request('/ticket-categories', {
  method: 'POST',
  body: JSON.stringify({
    code: `PROD_FACTORY_CAT_${suffix}`,
    name: `生产基地工厂分类 ${suffix}`,
    ownerType: 'company',
    ownerId: 'co_heze',
  }),
}, productionAdmin.token), 201, '创建生产基地工厂测试分类')

await expectStatus(request('/ticket-types', {
  method: 'POST',
  body: JSON.stringify({
    code: `PROD_WRONG_FACTORY_${suffix}`,
    name: '跨基地饲料厂引用',
    categoryId: productionTestCategory.id,
    ownerType: 'company',
    ownerId: 'co_heze',
    formTemplateId: productionTestForm.id,
    formVersionId: productionTestFormVersion.id,
    workProfiles: [{
      siteId: 'base_production',
      factoryId: 'factory_xinjin',
      workAreaId: null,
      productionLineId: null,
      crewId: null,
      shiftTemplateId: 'shift_production_day',
      generationMode: 'manual',
      handoverGrouping: 'shift',
      handoverRequired: true,
      timeWindowStart: '07:30',
      timeWindowEnd: '20:30',
      earlyStartMinutes: 30,
      lateEndMinutes: 30,
      assignmentMode: 'roster_first',
    }],
  }),
}, productionAdmin.token), 400, '拒绝不属于生产基地的饲料厂')

const siblingFactory = await expectStatus(request('/org/factories', {
  method: 'POST', body: JSON.stringify({ code: `SM-SIB-${suffix}`, name: `菏泽兄弟厂${suffix}`, companyId: 'co_heze', baseId: 'base_production', factoryType: 'other', address: '', sortOrder: 90, status: 'active' }),
}, group.token), 201, '创建同基地兄弟工厂')
const siblingArea = await expectStatus(request('/org/work-areas', {
  method: 'POST', body: JSON.stringify({ code: `SM-AREA-${suffix}`, name: `兄弟厂工区${suffix}`, baseId: 'base_production', factoryId: siblingFactory.id, parentId: null, managerPersonId: null, status: 'active' }),
}, group.token), 201, '创建兄弟工厂工区')
await expectStatus(request('/ticket-types', {
  method: 'POST', body: JSON.stringify({
    code: `CROSS_AREA_${suffix}`, name: `跨厂工区验证${suffix}`, categoryId: productionTestCategory.id,
    ownerType: 'company', ownerId: 'co_heze', formTemplateId: productionTestForm.id, formVersionId: productionTestFormVersion.id,
    workProfiles: [{ siteId: 'base_production', factoryId: 'factory_heze', workAreaId: siblingArea.id,
      productionLineId: null, crewId: null, shiftTemplateId: null, generationMode: 'manual', handoverGrouping: 'shift',
      handoverRequired: true, timeWindowStart: '07:30', timeWindowEnd: '20:30', earlyStartMinutes: 30, lateEndMinutes: 30, assignmentMode: 'roster_first' }],
  }),
}, productionAdmin.token), 400, '工单配置拒绝同基地兄弟工厂工区')

const groupType = await expectStatus(request('/ticket-types', {
  method: 'POST',
  body: JSON.stringify({
    code: `GROUP_WORK_${suffix}`,
    name: `饲料总部标准工单 ${suffix}`,
    categoryId: (await expectStatus(request('/ticket-categories', {
      method: 'POST',
      body: JSON.stringify({
        code: `GROUP_CAT_${suffix}`,
        name: `饲料总部标准分类 ${suffix}`,
        ownerType: 'group',
        ownerId: 'group',
        locked: true,
      }),
    }, group.token), 201, '创建集团分类')).id,
    ownerType: 'group',
    ownerId: 'group',
    formTemplateId: groupForm.id,
    formVersionId: groupVersion.id,
    locked: true,
    workProfiles: [{
      siteId: 'base_direct',
      factoryId: 'factory_xinjin',
      workAreaId: null,
      productionLineId: null,
      crewId: 'crew_xinjin_sauce',
      shiftTemplateId: 'shift_direct_day',
      generationMode: 'manual',
      handoverGrouping: 'shift',
      handoverRequired: true,
      timeWindowStart: '07:30',
      timeWindowEnd: '20:30',
      earlyStartMinutes: 30,
      lateEndMinutes: 30,
      assignmentMode: 'roster_first',
    }],
  }),
}, group.token), 201, '创建饲料总部标准工单类型')

const groupTypeDetail = await expectStatus(
  request(`/ticket-types/${groupType.typeId}`, {}, xinjinManager.token),
  200,
  '新津读取饲料总部标准工单类型',
)
assert(groupTypeDetail.standardLocked === true, '饲料总部标准应对基地只读')

await expectStatus(request('/ticket-types', {
  method: 'POST',
  body: JSON.stringify({
    code: `XJ_STANDARD_ASSETS_${suffix}`,
    name: `新津引用总部资产 ${suffix}`,
    categoryId: groupTypeDetail.categoryId,
    ownerType: 'company',
    ownerId: 'co_xinjin',
    formTemplateId: groupForm.id,
    formVersionId: groupVersion.id,
    workProfiles: [{
      siteId: 'base_direct',
      factoryId: 'factory_xinjin',
      workAreaId: null,
      productionLineId: null,
      crewId: 'crew_xinjin_sauce',
      shiftTemplateId: 'shift_direct_day',
      generationMode: 'manual',
      handoverGrouping: 'shift',
      handoverRequired: true,
      timeWindowStart: '07:30',
      timeWindowEnd: '20:30',
      earlyStartMinutes: 30,
      lateEndMinutes: 30,
      assignmentMode: 'roster_first',
    }],
  }),
}, xinjinAdmin.token), 201, '新津本地类型可引用总部分类与表单')
await expectStatus(request(`/ticket-types/${groupType.typeId}/versions`, {
  method: 'POST',
  body: JSON.stringify({
    formVersionId: groupVersion.id,
    workProfiles: [],
  }),
}, xinjinManager.token), 403, '新津不能修改饲料总部标准')

const localType = await expectStatus(request('/ticket-types', {
  method: 'POST',
  body: JSON.stringify({
    code: `XJ_LOCAL_WORK_${suffix}`,
    name: `新津本地工单 ${suffix}`,
    categoryId: (await expectStatus(request('/ticket-categories', {
      method: 'POST',
      body: JSON.stringify({
        code: `XJ_CAT_${suffix}`,
        name: `新津本地分类 ${suffix}`,
        ownerType: 'company',
        ownerId: 'co_xinjin',
      }),
    }, xinjinAdmin.token), 201, '创建新津本地分类')).id,
    ownerType: 'company',
    ownerId: 'co_xinjin',
    formTemplateId: xinjinLocalForm.id,
    formVersionId: xinjinVersion.id,
    workProfiles: [{
      siteId: 'base_direct',
      factoryId: 'factory_xinjin',
      workAreaId: null,
      productionLineId: null,
      crewId: 'crew_xinjin_sauce',
      shiftTemplateId: 'shift_direct_day',
      generationMode: 'manual',
      handoverGrouping: 'shift',
      handoverRequired: true,
      timeWindowStart: '07:30',
      timeWindowEnd: '20:30',
      earlyStartMinutes: 30,
      lateEndMinutes: 30,
      assignmentMode: 'roster_first',
    }],
  }),
}, xinjinAdmin.token), 201, '创建新津本地工单类型')

const localTypeDetail = await expectStatus(
  request(`/ticket-types/${localType.typeId}`, {}, xinjinManager.token),
  200,
  '读取新津本地工单类型',
)
const localTypeVersion = localTypeDetail.versions[0]
await expectStatus(request(`/ticket-types/${localType.typeId}/versions/${localTypeVersion.id}/publish`, {
  method: 'POST',
  body: JSON.stringify({ revision: localTypeVersion.revision }),
}, xinjinAdmin.token), 200, '发布新津本地工单类型')

await expectStatus(request('/tickets', {
  method: 'POST',
  body: JSON.stringify({
    ticketTypeId: localType.typeId,
    siteId: 'base_production',
    factoryId: 'factory_heze',
    crewId: 'crew_heze_a',
    shiftTemplateId: 'shift_production_day',
    eventTime: new Date('2026-10-22T08:00:00+08:00').toISOString(),
    workDate: '2026-10-22',
    assignments: [],
    quantity: 1,
  }),
}, group.token), 403, '新津本地工单类型不能用于生产基地')

await expectStatus(request('/prices', {
  method: 'POST',
  body: JSON.stringify({
    ticketTypeId: localType.typeId,
    siteId: 'base_production',
    unit: '件',
    unitPriceMicros: 2_500_000,
    effectiveFrom: new Date('2026-10-01T00:00:00+08:00').toISOString(),
    effectiveTo: null,
  }),
}, group.token), 403, '新津本地工单类型不能发布生产基地计价')

const effectiveFrom = new Date('2026-10-01T00:00:00+08:00').toISOString()
await expectStatus(request('/prices', {
  method: 'POST', body: JSON.stringify({ ticketTypeId: localType.typeId, siteId: 'mg_direct', unit: '件', unitPriceMicros: 1, effectiveFrom, effectiveTo: null }),
}, group.token), 403, '管理分组不能用于计价')
const xinjinBase = tree.bases.find((base) => base.id === 'base_direct')
const unconfirmedBase = await expectStatus(request('/org/bases/base_direct', {
  method: 'PUT', body: JSON.stringify({ revision: xinjinBase.revision, siteConfirmed: false }),
}, group.token), 200, '模拟待确认旧基地')
await expectStatus(request('/prices', {
  method: 'POST', body: JSON.stringify({ ticketTypeId: localType.typeId, siteId: 'base_direct', unit: '件', unitPriceMicros: 1, effectiveFrom, effectiveTo: null }),
}, group.token), 400, '未确认基地不能新增计价')
await expectStatus(request('/tickets', {
  method: 'POST', body: JSON.stringify({ ticketTypeId: localType.typeId, siteId: 'base_direct', factoryId: 'factory_xinjin', eventTime: effectiveFrom, workDate: '2026-10-01', assignments: [] }),
}, group.token), 400, '未确认基地不能新建工单')
await expectStatus(request('/org/bases/base_direct', {
  method: 'PUT', body: JSON.stringify({ revision: unconfirmedBase.revision, siteConfirmed: true }),
}, group.token), 200, '恢复实际基地确认状态')
const price = await expectStatus(request('/prices', {
  method: 'POST',
  body: JSON.stringify({
    ticketTypeId: localType.typeId,
    siteId: 'base_direct',
    unit: '件',
    unitPriceMicros: 2_500_000,
    effectiveFrom,
    effectiveTo: null,
  }),
}, group.token), 201, '总部发布新津计价')
assert(price.unitPriceMicros === 2_500_000, '价格应保存为整数微元')
await expectStatus(request('/prices', {
  method: 'POST',
  body: JSON.stringify({
    ticketTypeId: localType.typeId,
    siteId: 'base_direct',
    unit: '件',
    unitPriceMicros: 3_000_000,
    effectiveFrom: new Date('2026-10-15T00:00:00+08:00').toISOString(),
    effectiveTo: null,
  }),
}, group.token), 409, '重叠计价应被拒绝')

const candidatePath = `/tickets/candidates?siteId=base_direct&factoryId=factory_xinjin&crewId=crew_xinjin_sauce&workDate=2026-10-22&eventTime=${encodeURIComponent(new Date('2026-10-22T08:00:00+08:00').toISOString())}`
const candidates = await expectStatus(request(candidatePath, {}, xinjinManager.token), 200, '读取执行候选')
assert(candidates.some((item) => item.person.id === 'person_sun' && item.source === 'secondment'), '借调人员应作为候选出现')
assert(candidates.some((item) => item.person.id === 'person_yang' && item.source === 'roster'), '本基地班组人员应作为候选出现')

const noPersonTicket = await expectStatus(request('/tickets', {
  method: 'POST',
  body: JSON.stringify({
    ticketTypeId: localType.typeId,
    siteId: 'base_direct',
    factoryId: 'factory_xinjin',
    crewId: 'crew_xinjin_sauce',
    shiftTemplateId: 'shift_direct_day',
    handoverShiftProfileId: 'handover_xinjin_sauce_day',
    eventTime: new Date('2026-10-22T08:00:00+08:00').toISOString(),
    workDate: '2026-10-22',
    assignments: [],
    quantity: 3,
    clientRequestId: `smoke-reassign-${suffix}`,
  }),
}, xinjinManager.token), 201, '创建待指派工单')
assert(noPersonTicket.status === 'pending_assignment', '未选人员工单应进入待指派')
assert(noPersonTicket.factoryId === 'factory_xinjin', '交接配置应带出饲料厂')
assert(noPersonTicket.crewId === 'crew_xinjin_sauce', '交接配置应带出首个生产班')
assert(noPersonTicket.shiftTemplateId === 'shift_direct_day', '交接配置应带出班次')
await expectStatus(request(`/tickets/${noPersonTicket.id}`, {}, executor.token), 403, '执行人不能读取未指派给自己的工单')
await expectStatus(request(`/tickets/${noPersonTicket.id}/start`, {
  method: 'POST',
  body: JSON.stringify({ revision: noPersonTicket.revision, note: '越权开始' }),
}, executor.token), 403, '执行人不能开始未指派给自己的工单')
const reassigned = await expectStatus(request(`/tickets/${noPersonTicket.id}/assignments`, {
  method: 'PUT',
  body: JSON.stringify({
    assignments: [
      { personId: 'person_yang', role: 'lead' },
      { personId: 'person_sun', role: 'member' },
    ],
    revision: noPersonTicket.revision,
  }),
}, xinjinManager.token), 200, '重新指派工单人员')
assert(reassigned.status === 'pending_start', '指派人员后应进入待开始')
assert(reassigned.assignments.length === 2, '重新指派应保存两名人员')
await expectStatus(request(`/tickets/${noPersonTicket.id}/assignments`, {
  method: 'PUT',
  body: JSON.stringify({
    assignments: [
      { personId: 'person_yang', role: 'lead' },
      { personId: 'person_yang', role: 'member' },
    ],
    revision: reassigned.revision,
  }),
}, xinjinManager.token), 400, '拒绝重复执行人员')

const ticket = await expectStatus(request('/tickets', {
  method: 'POST',
  body: JSON.stringify({
    ticketTypeId: localType.typeId,
    siteId: 'base_direct',
    factoryId: 'factory_xinjin',
    crewId: 'crew_xinjin_sauce',
    shiftTemplateId: 'shift_direct_day',
    handoverShiftProfileId: 'handover_xinjin_sauce_day',
    eventTime: new Date('2026-10-22T08:00:00+08:00').toISOString(),
    workDate: '2026-10-22',
    assignments: [
      { personId: 'person_yang', role: 'lead' },
      { personId: 'person_sun', role: 'member' },
    ],
    quantity: 10,
    clientRequestId: `smoke-${suffix}`,
  }),
}, xinjinManager.token), 201, '创建含借调人员工单')
assert(ticket.status === 'pending_start', '有人员工单应进入待开始')
assert(ticket.formSchema.mainFields.length === 3, '工单应返回冻结表单')
assert(ticket.ticketTypeSnapshot.name.includes(suffix), '工单应返回类型快照')

const visibleToExecutor = await expectStatus(request('/tickets', {}, executor.token), 200, '执行人读取本人工单')
assert(visibleToExecutor.some((item) => item.id === ticket.id), '执行人应看到本人已分配工单')
const listedTicket = visibleToExecutor.find((item) => item.id === ticket.id)
assert(listedTicket.ticketTypeSnapshot.name.includes(suffix), 'App 工单列表应带类型名称快照')

const started = await expectStatus(request(`/tickets/${ticket.id}/start`, {
  method: 'POST',
  body: JSON.stringify({ revision: ticket.revision, note: '烟测开始' }),
}, executor.token), 200, '执行人开始工单')

const executorDetail = await expectStatus(
  request(`/tickets/${ticket.id}`, {}, executor.token),
  200,
  '执行人读取工单详情',
)
const executorAssignment = executorDetail.assignments.find(
  (assignment) => assignment.personId === 'person_yang',
)
assert(executorAssignment, '执行人详情应包含本人分摊记录')
const memberAssignment = executorDetail.assignments.find(
  (assignment) => assignment.personId === 'person_sun',
)
assert(memberAssignment, '借调人员应同工单分摊产量')

const invalidSubmit = await request(`/tickets/${ticket.id}/submit`, {
  method: 'POST',
  body: JSON.stringify({
    values: { output: 10, quality: 'fail', note: '' },
    subFormValues: {},
    revision: started.revision,
    quantity: 10,
  }),
}, executor.token)
assert(invalidSubmit.status === 400, `条件必填应阻止提交: ${invalidSubmit.status}`)

// 两人分摊 10 件：个人产量之和必须等于核定总产量，否则提交即拒绝。
const submitted = await expectStatus(request(`/tickets/${ticket.id}/submit`, {
  method: 'POST',
  body: JSON.stringify({
    values: { output: 10, quality: 'pass', note: '' },
    subFormValues: {},
    assignmentQuantities: { [executorAssignment.id]: 6, [memberAssignment.id]: 4 },
    revision: started.revision,
    quantity: 10,
  }),
}, executor.token), 200, '执行人提交工单')
assert(submitted.status === 'completed', '提交后应进入待审核')

const payrollCandidates = await expectStatus(
  request('/payroll/confirm-candidates?workMonth=2026-10', {}, xinjinManager.token),
  200,
  '提交后读取工资主体确认候选',
)
assert(payrollCandidates.some((item) => item.personId === 'person_yang'), '候选应包含本工单人员')
assert(payrollCandidates.some((item) => item.personId === 'person_sun'), '候选应包含借调人员')
assert(
  payrollCandidates.filter((item) => ['person_yang', 'person_sun'].includes(item.personId))
    .every((item) => item.ticketIds.includes(ticket.id)),
  '审核前应能确认工单人员',
)

await expectStatus(request('/payroll/confirm-company', {
  method: 'POST',
  body: JSON.stringify({
    workMonth: '2026-10',
    personIds: ['person_yang', 'person_sun'],
    payrollCompanyId: 'co_xinjin',
  }),
}, xinjinManager.token), 200, '确认月底发放公司')

const closedTicket = await expectStatus(request(`/tickets/${ticket.id}/approve`, {
  method: 'POST',
  body: JSON.stringify({ revision: submitted.revision, note: '烟测审核' }),
}, xinjinManager.token), 200, '审核工单')
assert(closedTicket.status === 'closed', '审核后应关闭')
assert(closedTicket.quantity === 10, '多人工单总产量应为人员分摊之和')
assert(closedTicket.amountMicros === 25_000_000, '多人工单总金额应按核定总产量计算')
await expectStatus(request(`/tickets/${noPersonTicket.id}/cancel`, {
  method: 'POST',
  body: JSON.stringify({ revision: reassigned.revision, note: '清理烟测待指派工单' }),
}, xinjinManager.token), 200, '取消待开始烟测工单')

const accruals = await expectStatus(
  request('/payroll/accruals?workMonth=2026-10', {}, group.token),
  200,
  '读取计件记录',
)
const ticketAccruals = accruals.filter((item) => item.ticketId === ticket.id)
assert(ticketAccruals.length === 2, '两名人员应各生成一条计件')
assert(ticketAccruals.every((item) => item.workSiteId === 'base_direct'), '实际作业基地应为直属各厂')
assert(ticketAccruals.every((item) => item.payrollCompanyId === 'co_xinjin'), '发放公司应按月底确认')
assert(ticketAccruals.some((item) => item.personId === 'person_yang' && item.quantity === 6 && item.amountMicros === 15_000_000), '牵头人应计 6 件')
assert(ticketAccruals.some((item) => item.personId === 'person_sun' && item.quantity === 4 && item.amountMicros === 10_000_000), '借调人员应计 4 件')

// 分摊不一致要在执行端提交时就拦住，而不是等到大管理员审核。
const uneven = await expectStatus(request('/tickets', {
  method: 'POST',
  body: JSON.stringify({
    ticketTypeId: localType.typeId,
    siteId: 'base_direct',
    factoryId: 'factory_xinjin',
    crewId: 'crew_xinjin_sauce',
    eventTime: new Date('2026-10-23T08:00:00+08:00').toISOString(),
    workDate: '2026-10-23',
    assignments: [{ personId: 'person_yang', role: 'lead' }, { personId: 'person_sun', role: 'member' }],
    quantity: 10,
    clientRequestId: `smoke-uneven-${suffix}`,
  }),
}, xinjinManager.token), 201, '创建分摊校验工单')
const unevenStarted = await expectStatus(request(`/tickets/${uneven.id}/start`, {
  method: 'POST',
  body: JSON.stringify({ revision: uneven.revision, note: '烟测开始' }),
}, executor.token), 200, '开始分摊校验工单')
const unevenDetail = await expectStatus(request(`/tickets/${uneven.id}`, {}, executor.token), 200, '读取分摊校验工单')
const unevenQuantities = Object.fromEntries(unevenDetail.assignments.map((assignment, index) => [assignment.id, index === 0 ? 9 : 4]))
const unevenSubmit = await request(`/tickets/${uneven.id}/submit`, {
  method: 'POST',
  body: JSON.stringify({
    values: { output: 10, quality: 'pass', note: '' },
    subFormValues: {},
    assignmentQuantities: unevenQuantities,
    revision: unevenStarted.revision,
    quantity: 10,
  }),
}, executor.token)
assert(unevenSubmit.status === 409 && String(unevenSubmit.body?.error?.message || '').includes('个人产量之和'),
  `提交应拦住分摊不一致：${unevenSubmit.status} ${JSON.stringify(unevenSubmit.body)}`)
const unevenAfter = await expectStatus(request(`/tickets/${uneven.id}`, {}, executor.token), 200, '读取被拒后的分摊校验工单')
assert(unevenAfter.status === 'in_progress', '提交被拒后工单应仍可继续修改')
await expectStatus(request(`/tickets/${uneven.id}/cancel`, {
  method: 'POST',
  body: JSON.stringify({ revision: unevenAfter.revision, note: '清理分摊校验工单' }),
}, xinjinManager.token), 200, '取消分摊校验工单')

const confirmedCandidates = await expectStatus(
  request('/payroll/confirm-candidates?workMonth=2026-10', {}, xinjinManager.token),
  200,
  '确认后读取工资主体候选',
)
assert(
  confirmedCandidates.filter((item) => ['person_yang', 'person_sun'].includes(item.personId))
    .every((item) => item.payrollCompanyId === 'co_xinjin'),
  '确认结果应反馈到工单人员候选',
)

const ownAccruals = await expectStatus(
  request('/payroll/accruals?workMonth=2026-10', {}, executor.token),
  200,
  '执行人读取本人计件',
)
assert(ownAccruals.length === 1, '执行人应只看到本人一条计件')
assert(ownAccruals[0].personId === 'person_yang', '执行人不能看到其他人员的计件')
assert(ownAccruals[0].ticketId === ticket.id, '执行人应看到本人工单对应的计件')

const summary = await expectStatus(
  request('/payroll/summary?workMonth=2026-10', {}, group.token),
  200,
  '读取月结汇总',
)
assert(summary.companies.length === 1 && summary.companies[0].payrollCompanyId === 'co_xinjin', '月结应归集到新津公司')

const audit = await expectStatus(
  request('/audit-logs?pageSize=200', {}, group.token),
  200,
  '读取审计日志',
)
assert(Array.isArray(audit), '审计接口应返回分页数组')
for (const action of [
  'form.create',
  'form.publish',
  'ticket_type.create',
  'ticket_type.publish',
  'ticket.create',
  'ticket.assign',
  'ticket.start',
  'ticket.submit',
  'ticket.approve',
  'payroll.company.confirm',
]) {
  assert(audit.some((entry) => entry.action === action), `审计日志缺少 ${action}`)
}

const closedPayroll = await expectStatus(request('/payroll/close', {
  method: 'POST',
  body: JSON.stringify({
    workMonth: '2026-10',
    revision: summary.period.revision,
    replaceAccruals: [{
      accrualId: ticketAccruals[0].id,
      quantity: 9,
      reason: '烟测调整一件',
    }],
    additionalAccruals: [],
  }),
}, group.token), 200, '总部关账并调整')
assert(closedPayroll.status === 'closed', '关账后状态应为 closed')

const adjusted = await expectStatus(
  request('/payroll/accruals?workMonth=2026-10', {}, group.token),
  200,
  '读取调整后的计件',
)
const adjustedItems = adjusted.filter((item) => item.ticketId === ticket.id)
assert(adjustedItems.length === 2, '调整应替换原记录，不新增重复记录')
assert(adjustedItems.some((item) => item.quantity === 9 && item.amountMicros === 22_500_000), '调整金额应重算')

const closedAudit = await expectStatus(
  request('/audit-logs?pageSize=200', {}, group.token),
  200,
  '读取关账后的审计日志',
)
assert(closedAudit.some((entry) => entry.action === 'payroll.close'), '审计日志缺少 payroll.close')
assert(closedAudit.filter((entry) => entry.ipAddress).length > 0, '审计日志应记录来源 IP')

const reopenedPayroll = await expectStatus(request('/payroll/reopen', {
  method: 'POST',
  body: JSON.stringify({
    workMonth: '2026-10',
    revision: closedPayroll.revision,
  }),
}, group.token), 200, '总部重开月结')
assert(reopenedPayroll.status === 'reopened', '重开后状态应为 reopened')
assert(reopenedPayroll.revision === closedPayroll.revision + 1, '重开后期间版本应递增')

const reopenedAccruals = await expectStatus(
  request('/payroll/accruals?workMonth=2026-10', {}, group.token),
  200,
  '读取重开后的计件',
)
assert(
  reopenedAccruals.filter((item) => item.ticketId === ticket.id)
    .every((item) => ['open', 'adjusted'].includes(item.settlementStatus)),
  '重开后锁定计件应恢复为可调整',
)

const reclosedPayroll = await expectStatus(request('/payroll/close', {
  method: 'POST',
  body: JSON.stringify({
    workMonth: '2026-10',
    revision: reopenedPayroll.revision,
    replaceAccruals: [],
    additionalAccruals: [],
  }),
}, group.token), 200, '重开后再次关账')
assert(reclosedPayroll.status === 'closed', '再次关账后状态应为 closed')

await expectStatus(request('/payroll/close', {
  method: 'POST',
  body: JSON.stringify({ workMonth: '2026-10', revision: summary.period.revision + 1, replaceAccruals: [], additionalAccruals: [] }),
}, xinjinManager.token), 403, '基地管理员不能总部关账')

await expectStatus(request(`/tickets/${ticket.id}/cancel`, {
  method: 'POST',
  body: JSON.stringify({ revision: closedTicket.revision, note: '非法取消已关闭工单' }),
}, xinjinManager.token), 409, '已关闭工单不能取消')

const digest = createHash('sha256')
  .update(JSON.stringify({ groupForm: groupForm.id, localType: localType.typeId, ticket: ticket.id }))
  .digest('hex')
  .slice(0, 12)

console.log(JSON.stringify({
  status: 'passed',
  evidence: {
    digest,
    groupFormId: groupForm.id,
    xinjinLocalFormId: xinjinLocalForm.id,
    groupTypeId: groupType.typeId,
    localTypeId: localType.typeId,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    payrollMonth: '2026-10',
    accrualCount: adjustedItems.length,
  },
}, null, 2))
