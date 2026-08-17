// 演示数据：组织、分类、表单、工单类型、工单实例

let seed = 0
const uid = (prefix) => `${prefix}_${Date.now()}_${++seed}`

export function createDefaultConfig() {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return {
    shifts: [
      { id: 'shift_day', name: '白班', orgId: 'sub_qd', startTime: '08:00', endTime: '20:00', enabled: true, sort: 1 },
      { id: 'shift_night', name: '夜班', orgId: 'sub_qd', startTime: '20:00', endTime: '08:00', enabled: true, sort: 2 },
    ],
    schedules: [
      { id: 'sch_1', date: new Date().toISOString().slice(0, 10), orgId: 'sub_qd', personId: 'p1', shiftId: 'shift_day', status: '出勤' },
      { id: 'sch_2', date: new Date().toISOString().slice(0, 10), orgId: 'sub_qd', personId: 'p3', shiftId: 'shift_day', status: '请假' },
    ],
    logs: [
      { id: 'log_1', operator: '王琦淼', action: '创建工单类型', targetType: '工单类型', targetCode: 'PROD', orgId: 'group', operatedAt: now, summary: '创建生产任务类型' },
      { id: 'log_2', operator: '王琦淼', action: '发布表单', targetType: '表单', targetCode: 'form_production', orgId: 'group', operatedAt: now, summary: '发布生产任务表单 v1' },
    ],
    messages: [
      { id: 'msg_1', title: '工单生成通知', content: '您有一条新的生产任务工单待处理', type: '工单通知', read: false, orgId: 'sub_qd', createdAt: now },
      { id: 'msg_2', title: '系统通知', content: '车辆洗消工单已超时，请处理', type: '系统通知', read: false, orgId: 'sub_qd', createdAt: now },
    ],
    dictionaries: [
      { id: 'dict_wash_full', type: '洗消类型', code: 'WASH_FULL', name: '整车清洗', orgId: 'group', enabled: true, sort: 1 },
      { id: 'dict_wash_disinfect', type: '洗消类型', code: 'WASH_DISINFECT', name: '车厢消毒', orgId: 'group', enabled: true, sort: 2 },
      { id: 'dict_wash_dry', type: '洗消类型', code: 'WASH_DRY', name: '烘干确认', orgId: 'group', enabled: true, sort: 3 },
      { id: 'dict_line_livestock', type: '生产线', code: 'LINE_LIVESTOCK', name: '畜禽料生产线', orgId: 'group', enabled: true, sort: 1 },
      { id: 'dict_line_aqua', type: '生产线', code: 'LINE_AQUA', name: '水产料生产线', orgId: 'group', enabled: true, sort: 2 },
      { id: 'dict_unit_ton', type: '物料单位', code: 'UNIT_TON', name: '吨', orgId: 'group', enabled: true, sort: 1 },
      { id: 'dict_unit_bag', type: '物料单位', code: 'UNIT_BAG', name: '袋', orgId: 'group', enabled: true, sort: 2 },
      { id: 'dict_unit_car', type: '物料单位', code: 'UNIT_CAR', name: '车', orgId: 'group', enabled: true, sort: 3 },
    ],
    productionLines: [
      { id: 'pl_1', name: '畜禽料生产线', code: 'PL01', orgId: 'sub_qd', enabled: true, sort: 1 },
      { id: 'pl_2', name: '水产料生产线', code: 'PL02', orgId: 'sub_qd', enabled: true, sort: 2 },
    ],
    materials: [
      { id: 'mat_1', name: '豆粕', code: 'MAT001', unit: '吨', orgId: 'sub_qd', enabled: true },
      { id: 'mat_2', name: '玉米', code: 'MAT002', unit: '吨', orgId: 'sub_qd', enabled: true },
    ],
    priceStandards: [
      { id: 'price_1', ticketTypeId: 't_prod', price: 8.5, unit: '吨', effectiveDate: '2026-08-01', status: 'published' },
      { id: 'price_2', ticketTypeId: 't_wash', price: 15, unit: '车', effectiveDate: '2026-08-01', status: 'published' },
    ],
    pieceStandards: [
      { id: 'piece_1', ticketTypeId: 't_prod', method: '计件', price: 0.12, unit: '吨', effectiveDate: '2026-08-01', status: 'published' },
      { id: 'piece_2', ticketTypeId: 't_wash', method: '包干', price: 20, unit: '车', effectiveDate: '2026-08-01', status: 'published' },
    ],
    personnel: [
      { id: 'p1', name: '张建国', code: 'E20114', orgId: 'sub_qd', status: 'active', qualifications: ['q_prod', 'q_load'] },
      { id: 'p2', name: '李树军', code: 'E20115', orgId: 'sub_qd', status: 'active', qualifications: ['q_prod'] },
      { id: 'p3', name: '王海', code: 'E20116', orgId: 'sub_qd', status: 'active', qualifications: ['q_wash'] },
      { id: 'p4', name: '赵强', code: 'E20117', orgId: 'sub_qd', status: 'active', qualifications: ['q_warehouse'] },
      { id: 'p5', name: '孙明', code: 'E20118', orgId: 'sub_dz', status: 'active', qualifications: ['q_prod'] },
    ],
    orgs: [
      { id: 'group', name: '东方希望集团', code: 'JT', level: 'group', parentId: null },
      { id: 'region_east', name: '华东片区', code: 'HD', level: 'region', parentId: 'group' },
      { id: 'sub_qd', name: '青岛饲料厂', code: 'QD', level: 'subsidiary', parentId: 'region_east' },
      { id: 'sub_dz', name: '德州饲料厂', code: 'DZ', level: 'subsidiary', parentId: 'region_east' },
    ],
    categories: [
      { id: 'cat_prod', name: '生产', orgId: 'group', enabled: true, sort: 1 },
      { id: 'cat_load', name: '装卸', orgId: 'group', enabled: true, sort: 2 },
      { id: 'cat_wash', name: '洗消', orgId: 'group', enabled: true, sort: 3 },
      { id: 'cat_warehouse', name: '仓管', orgId: 'group', enabled: true, sort: 4 },
      { id: 'cat_boiler', name: '司炉', orgId: 'group', enabled: true, sort: 5 },
      { id: 'cat_other', name: '其它', orgId: 'group', enabled: true, sort: 6 },
      { id: 'cat_qd_extra', name: '青岛专项', orgId: 'sub_qd', enabled: true, sort: 7 },
    ],
    qualifications: [
      { id: 'q_prod', name: '生产操作' },
      { id: 'q_load', name: '装卸作业' },
      { id: 'q_wash', name: '洗消作业' },
      { id: 'q_warehouse', name: '仓储作业' },
      { id: 'q_boiler', name: '锅炉作业' },
    ],
    externalSystems: [
      { id: 'ext_group', name: '集团产量系统', orgId: 'group', scope: 'all', systemCode: 'GROUP_YIELD' },
      { id: 'ext_qd_lab', name: '青岛化验系统', orgId: 'sub_qd', scope: 'org', systemCode: 'QD_LAB' },
    ],
    forms: [
      {
        id: 'form_acceptance',
        name: '通用验收表单',
        ownerOrgId: 'group',
        visibility: 'group',
        orderRule: 'free',
        updatedAt: now,
        versions: [
          {
            versionNo: 1,
            status: 'published',
            publishedAt: now,
            mainFields: [
              { id: 'f1', key: 'workDesc', name: '工作内容', type: 'text', required: true, sort: 1, strategy: 'optional' },
              { id: 'f2', key: 'location', name: '作业地点', type: 'text', required: true, sort: 2, strategy: 'optional' },
            ],
            subForms: [
              {
                id: 'sf1', name: '到场签到', sort: 1, minRecords: 1, maxRecords: 1,
                fields: [{ id: 'f3', key: 'signTime', name: '签到时间', type: 'datetime', required: true, sort: 1, strategy: 'optional' }],
              },
            ],
            conditionRules: [],
          },
        ],
      },
      {
        id: 'form_production',
        name: '生产任务表单',
        ownerOrgId: 'group',
        visibility: 'group',
        orderRule: 'strict',
        updatedAt: now,
        versions: [
          {
            versionNo: 1,
            status: 'published',
            publishedAt: now,
            mainFields: [
              { id: 'f4', key: 'product', name: '产品名称', type: 'text', required: true, sort: 1, strategy: 'optional' },
              { id: 'f5', key: 'planQty', name: '计划产量', type: 'number', required: true, sort: 2, strategy: 'optional' },
              { id: 'f6', key: 'actualQty', name: '实际产量', type: 'number', required: false, sort: 3, strategy: 'backfill', sourceSystemId: 'ext_group' },
              { id: 'f7', key: 'labResult', name: '化验结果', type: 'text', required: false, sort: 4, strategy: 'blocking', sourceSystemId: 'ext_group' },
            ],
            subForms: [
              {
                id: 'sf2', name: '作业记录', sort: 1, minRecords: 1, maxRecords: 10,
                fields: [{ id: 'f8', key: 'recordNote', name: '记录说明', type: 'text', required: true, sort: 1, strategy: 'optional' }],
              },
            ],
            conditionRules: [],
          },
        ],
      },
      {
        id: 'form_wash',
        name: '车辆洗消检查表单',
        ownerOrgId: 'group',
        visibility: 'group',
        orderRule: 'strict',
        updatedAt: now,
        versions: [
          {
            versionNo: 1,
            status: 'published',
            publishedAt: now,
            mainFields: [
              { id: 'f9', key: 'plateNo', name: '车牌号', type: 'text', required: true, sort: 1, strategy: 'optional' },
              { id: 'f10', key: 'washType', name: '洗消类型', type: 'singleSelect', required: true, sort: 2, strategy: 'optional', options: [{ label: '整车清洗', value: 'full' }, { label: '车厢消毒', value: 'disinfect' }] },
            ],
            subForms: [
              {
                id: 'sf3', name: '洗消记录', sort: 1, minRecords: 1, maxRecords: 10,
                fields: [{ id: 'f11', key: 'photo', name: '现场照片', type: 'photo', required: true, sort: 1, strategy: 'optional' }],
              },
            ],
            conditionRules: [],
          },
        ],
      },
    ],
    ticketTypes: [
      {
        id: 't_prod',
        name: '生产任务',
        code: 'PROD',
        categoryId: 'cat_prod',
        ownerOrgId: 'group',
        typeOrigin: 'group_standard',
        status: 'published',
        formId: 'form_production',
        formVersion: 1,
        remark: '集团标准生产任务',
        generatedCount: 6,
        triggerRules: [
          { id: uid('tr'), type: 'manual', enabled: true, name: '手工创建' },
          { id: uid('tr'), type: 'api', enabled: true, name: 'NC同步触发' },
        ],
        timeWindow: { enabled: false, startTime: '08:00', endTime: '20:00', earlyStartMinutes: 0, lateEndMinutes: 0 },
        notify: { enabled: true, targets: ['executor'], channels: ['site', 'app'] },
        orgOverrides: {
          sub_qd: {
            triggerRules: [{ id: uid('tr'), type: 'manual', enabled: true, name: '青岛手工' }],
            timeWindow: { enabled: true, startTime: '08:00', endTime: '18:00', earlyStartMinutes: 30, lateEndMinutes: 30 },
            notify: { enabled: true, targets: ['executor'], channels: ['site', 'app'] },
            apiEnabled: false,
          },
        },
        updatedAt: now,
      },
      {
        id: 't_wash',
        name: '车辆洗消',
        code: 'VWASH',
        categoryId: 'cat_wash',
        ownerOrgId: 'group',
        typeOrigin: 'group_standard',
        status: 'published',
        formId: 'form_wash',
        formVersion: 1,
        remark: '',
        generatedCount: 4,
        triggerRules: [{ id: uid('tr'), type: 'manual', enabled: true, name: '手工创建' }],
        timeWindow: { enabled: true, startTime: '00:00', endTime: '23:59', earlyStartMinutes: 0, lateEndMinutes: 0 },
        notify: { enabled: false, targets: [], channels: [] },
        orgOverrides: {},
        updatedAt: now,
      },
      {
        id: 't_qd_other',
        name: '青岛专项任务',
        code: 'QD_SPECIAL',
        categoryId: 'cat_qd_extra',
        ownerOrgId: 'sub_qd',
        typeOrigin: 'subsidiary',
        status: 'published',
        formId: 'form_acceptance',
        formVersion: 1,
        remark: '子公司自有类型',
        generatedCount: 0,
        triggerRules: [{ id: uid('tr'), type: 'manual', enabled: true, name: '手工创建' }],
        timeWindow: { enabled: false, startTime: '08:00', endTime: '18:00', earlyStartMinutes: 0, lateEndMinutes: 0 },
        notify: { enabled: false, targets: [], channels: [] },
        orgOverrides: {},
        updatedAt: now,
      },
    ],
    tickets: [
      { id: 'tk_1', ticketNo: 'PROD-QD-20260814-0001', ticketTypeId: 't_prod', orgId: 'sub_qd', status: 'inProgress', formVersion: 1, createdAt: now, createdBy: '集团管理员', values: {}, assigneeId: 'p1' },
      { id: 'tk_2', ticketNo: 'VWASH-QD-20260814-0001', ticketTypeId: 't_wash', orgId: 'sub_qd', status: 'pending', formVersion: 1, createdAt: now, createdBy: '集团管理员', values: {}, assigneeId: null },
      { id: 'tk_3', ticketNo: 'PROD-QD-20260814-0002', ticketTypeId: 't_prod', orgId: 'sub_qd', status: 'waitingData', formVersion: 1, createdAt: now, createdBy: '集团管理员', values: {}, assigneeId: 'p2' },
    ],
  }
}
