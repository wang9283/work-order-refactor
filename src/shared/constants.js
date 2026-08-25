// 共享常量：状态、触发方式、字段类型、通知渠道等

export const ORG_LEVELS = ['group', 'region', 'subsidiary']

export const TICKET_TYPE_STATUS = {
  draft: { label: '草稿', color: 'default' },
  published: { label: '已发布', color: 'green' },
  disabled: { label: '已停用', color: 'orange' },
}

export const TICKET_STATUS = {
  unassigned: { label: '待分配', color: 'gold' },
  pending: { label: '待开始', color: 'orange' },
  inProgress: { label: '执行中', color: 'blue' },
  waitingData: { label: '待数据', color: 'purple' },
  timeout: { label: '已超时', color: 'red' },
  completed: { label: '已完成', color: 'green' },
  closed: { label: '已关闭', color: 'default' },
  cancelled: { label: '已取消', color: 'default' },
}

export const TRIGGER_TYPE = {
  manual: { label: '手动', color: 'blue' },
  once: { label: '单次定时', color: 'purple' },
  cron: { label: '周期定时', color: 'cyan' },
  api: { label: '开放API', color: 'geekblue' },
}

export const FIELD_TYPES = [
  { label: '文本', value: 'text' },
  { label: '数字', value: 'number' },
  { label: '单选', value: 'singleSelect' },
  { label: '多选', value: 'multiSelect' },
  { label: '附件', value: 'attachment' },
  { label: '拍照', value: 'photo' },
  { label: '点击确认', value: 'confirm' },
  { label: '签名', value: 'signature' },
  { label: '日期时间', value: 'datetime' },
]

export const FIELD_STRATEGY = {
  blocking: { label: '阻塞完成', color: 'red' },
  backfill: { label: '允许后补', color: 'blue' },
  optional: { label: '不阻塞', color: 'default' },
}

export const NOTIFY_TARGETS = [
  { label: '执行人', value: 'executor' },
  { label: '创建人/发起人', value: 'creator' },
  { label: '指定角色', value: 'role' },
  { label: '指定人员', value: 'person' },
]

export const NOTIFY_CHANNELS = [
  { label: '站内消息', value: 'site' },
  { label: 'App推送', value: 'app' },
  { label: '短信', value: 'sms' },
]

export const NOTIFY_EVENTS = [
  { label: '创建', value: 'created', color: 'blue' },
  { label: '变更', value: 'updated', color: 'cyan' },
  { label: '完成', value: 'completed', color: 'green' },
  { label: '超期', value: 'overdue', color: 'red' },
  { label: '临期', value: 'nearDeadline', color: 'orange' },
  { label: '已关闭', value: 'closed', color: 'default' },
  { label: '已取消', value: 'cancelled', color: 'default' },
]

export const NOTIFY_REMINDER_OPERATORS = [
  { label: '大于等于', value: 'gte' },
  { label: '小于等于', value: 'lte' },
]

export const NOTIFY_ROLES = [
  { label: '集团管理员', value: 'group_admin' },
  { label: '子公司配置管理员', value: 'subsidiary_config_admin' },
  { label: '子公司工单管理员', value: 'subsidiary_manager' },
  { label: '子公司负责人', value: 'subsidiary_owner' },
  { label: '班组长/主管', value: 'supervisor' },
]

export const TRIGGER_FREQ = [
  { label: '每日', value: 'daily' },
  { label: '每周', value: 'weekly' },
  { label: '每月', value: 'monthly' },
  { label: '自定义cron', value: 'cron' },
]

export const WINDOW_UNIT = '分钟'
