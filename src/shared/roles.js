// 角色视角：菜单可见性 + 关键操作能力（演示用轻量权限），PC 与 App 双端共用
// 角色定义来自《迭代方案》§七：集团管理员 / 子公司配置管理员 / 子公司工单管理员 / 子公司负责人 / 执行人

export const ROLE_LABELS = {
  group_admin: '集团管理员',
  subsidiary_config_admin: '子公司配置管理员',
  subsidiary_manager: '子公司工单管理员',
  subsidiary_owner: '子公司负责人',
  executor: '执行人',
}

export const GROUP_ROLES = ['group_admin']
export const SUBSIDIARY_ROLES = ['subsidiary_config_admin', 'subsidiary_manager', 'subsidiary_owner', 'executor']

export function availableRoles(orgId) {
  return orgId === 'group' ? GROUP_ROLES : SUBSIDIARY_ROLES
}

export function defaultRole(orgId) {
  return orgId === 'group' ? 'group_admin' : 'subsidiary_config_admin'
}

// 组织切换后校验角色：不在该组织可选范围内则回退默认角色
export function normalizeRole(orgId, role) {
  const list = availableRoles(orgId)
  return role && list.includes(role) ? role : defaultRole(orgId)
}

// 菜单/页面访问白名单：'*' = 所有角色；未登记的键默认放行（避免误伤新页面）
const MENU_ACCESS = {
  home: '*',

  // 工单类型配置 = 配置类角色
  'types-group': ['group_admin', 'subsidiary_config_admin'],
  types: ['group_admin', 'subsidiary_config_admin'],
  categories: ['group_admin', 'subsidiary_config_admin'],
  forms: ['group_admin', 'subsidiary_config_admin'],

  // 排班与执行 = 工单管理员
  'execution-group': ['group_admin', 'subsidiary_manager'],
  tickets: ['group_admin', 'subsidiary_manager'],
  schedules: ['group_admin', 'subsidiary_manager'],

  // 薪酬与报表：报表给管理角色看，薪酬核算只给负责人
  'salary-group': ['group_admin', 'subsidiary_manager', 'subsidiary_owner'],
  reports: ['group_admin', 'subsidiary_manager', 'subsidiary_owner'],
  'salary-sub': ['group_admin', 'subsidiary_owner'],
  contribution: ['group_admin', 'subsidiary_owner'],
  'income-check': ['group_admin', 'subsidiary_owner'],
  'price-standards': ['group_admin', 'subsidiary_owner'],

  // 集成与审计：消息人人可见（在组内），配置类归配置管理员，日志含工单管理员
  'integration-group': ['group_admin', 'subsidiary_config_admin', 'subsidiary_manager', 'subsidiary_owner'],
  'notification-config': ['group_admin', 'subsidiary_config_admin'],
  'operation-logs': ['group_admin', 'subsidiary_config_admin', 'subsidiary_manager'],
  messages: '*',
  'integration-sub': ['group_admin', 'subsidiary_config_admin'],
  'external-systems': ['group_admin', 'subsidiary_config_admin'],

  // 基础主数据 = 配置管理员 + 工单管理员（排班要引用人员/班次）
  'basic-data-group': ['group_admin', 'subsidiary_config_admin', 'subsidiary_manager'],
  orgs: ['group_admin', 'subsidiary_config_admin', 'subsidiary_manager'],
  personnel: ['group_admin', 'subsidiary_config_admin', 'subsidiary_manager'],
  shifts: ['group_admin', 'subsidiary_config_admin', 'subsidiary_manager'],
  dicts: ['group_admin', 'subsidiary_config_admin', 'subsidiary_manager'],
  'lines-materials': ['group_admin', 'subsidiary_config_admin', 'subsidiary_manager'],

  // 预留功能：执行人 PC 端只留首页
  'reserved-group': ['group_admin', 'subsidiary_config_admin', 'subsidiary_manager', 'subsidiary_owner'],
}

export function canAccess(key, role) {
  const a = MENU_ACCESS[key]
  if (!a) return true
  return a === '*' || a.includes(role)
}

// 递归过滤 antd Menu items：子项全被滤掉的分组随之隐藏
export function filterMenu(items, role) {
  return items
    .map((it) => (Array.isArray(it.children) ? { ...it, children: filterMenu(it.children, role) } : it))
    .filter((it) => (Array.isArray(it.children) ? it.children.length > 0 : canAccess(it.key, role)))
    .filter((it) => (Array.isArray(it.children) ? canAccess(it.key, role) : true))
}

// 操作级能力：入口藏起来之外，关键动作再拦一道
const CAPS = {
  createTask: ['executor'],                              // App 快速新建 / 新建任务
  submitTask: ['executor'],                              // App 提交完工 / 超时完成 / 添加子表记录
  manageTickets: ['group_admin', 'subsidiary_manager'],  // PC 超时完成 / 强制完结 / 复核 / 模拟回写
  editContribution: ['subsidiary_owner'],                // 贡献比例调节
}

export function can(role, cap) {
  const a = CAPS[cap]
  return !a || a.includes(role)
}