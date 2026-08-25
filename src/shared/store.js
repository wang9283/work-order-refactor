// 共享数据存取层：PC 与 App 共用同一 localStorage key，保证两端数据一致
import { createDefaultConfig } from './demoData'
import { NOTIFY_EVENTS } from './constants'

const CONFIG_KEY = 'workOrderRefactor.config.v1'
const ORG_KEY = 'workOrderRefactor.currentOrg.v1'

export function loadConfig() {
  const raw = localStorage.getItem(CONFIG_KEY)
  if (raw) {
    try {
      const data = JSON.parse(raw)
      if (data && Array.isArray(data.orgs)) {
        if (!Array.isArray(data.shifts)) data.shifts = []
        if (!Array.isArray(data.schedules)) data.schedules = []
        if (!Array.isArray(data.dictionaries)) data.dictionaries = []
        if (!Array.isArray(data.productionLines)) data.productionLines = []
        if (!Array.isArray(data.materials)) data.materials = []
        if (!Array.isArray(data.personnel)) data.personnel = []
        if (!Array.isArray(data.logs)) data.logs = []
        if (!Array.isArray(data.messages)) data.messages = []
        if (!Array.isArray(data.priceStandards)) data.priceStandards = []
        if (!Array.isArray(data.pieceStandards)) data.pieceStandards = []
        if (!Array.isArray(data.notificationRules)) {
          data.notificationRules = []
          ;(data.ticketTypes || []).forEach((t) => {
            if (t.notify?.enabled) {
              data.notificationRules.push({
                id: 'nr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                name: `${t.name}-创建通知`,
                scope: t.typeOrigin === 'group_standard' ? 'group' : (t.ownerOrgId || 'group'),
                ticketTypeId: t.id,
                event: 'created',
                enabled: true,
                targets: Array.isArray(t.notify.targets) && t.notify.targets.length ? t.notify.targets : ['executor'],
                roles: [],
                personIds: [],
                channels: Array.isArray(t.notify.channels) && t.notify.channels.length ? t.notify.channels : ['site'],
                template: '您有一条新的「{typeName}」工单 {ticketNo} 待处理',
                createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
                updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
              })
            }
          })
        }
        // 兼容旧版本：删除“待数据”提醒；将“已超时”归一为“超期”，并补齐提醒天数
        data.notificationRules = (data.notificationRules || []).filter((r) => r.event !== 'waitingData')
        data.notificationRules.forEach((r) => {
          if (r.event === 'timeout') {
            r.event = 'overdue'
            r.reminderOperator = r.reminderOperator || 'gte'
            r.reminderDays = r.reminderDays || 3
          }
          if (r.event === 'overdue') {
            r.reminderOperator = r.reminderOperator || 'gte'
            r.reminderDays = r.reminderDays || 3
          }
          if (r.event === 'nearDeadline') {
            r.reminderOperator = r.reminderOperator || 'lte'
            r.reminderDays = r.reminderDays || 2
          }
        })
        saveConfig(data)
        return data
      }
    } catch (e) {
      // ignore broken data
    }
  }
  const config = createDefaultConfig()
  saveConfig(config)
  return config
}

export function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

export function resetConfig() {
  const config = createDefaultConfig()
  saveConfig(config)
  return config
}

export function loadCurrentOrg() {
  return localStorage.getItem(ORG_KEY) || 'group'
}

export function saveCurrentOrg(orgId) {
  localStorage.setItem(ORG_KEY, orgId)
}

export function getOrgOptions(config) {
  return config.orgs.filter((o) => o.level === 'group' || o.level === 'subsidiary')
}

export function getOrgName(config, orgId) {
  return config.orgs.find((o) => o.id === orgId)?.name || orgId
}

export function getCategories(config, orgId) {
  return config.categories.filter((c) => c.enabled && (c.orgId === 'group' || c.orgId === orgId))
}

export function getPublishedForms(config) {
  return config.forms.filter((f) => f.versions.some((v) => v.status === 'published'))
}

export function getVisibleForms(config, orgId) {
  return getPublishedForms(config).filter((f) => {
    if (f.visibility === 'group') return true
    return f.ownerOrgId === orgId
  })
}

export function getLatestPublishedVersion(form) {
  if (!form) return null
  const published = form.versions.filter((v) => v.status === 'published').sort((a, b) => b.versionNo - a.versionNo)
  return published[0] || null
}

export function getFormById(config, formId) {
  return config.forms.find((f) => f.id === formId)
}

export function getFormVersion(form, versionNo) {
  if (!form) return null
  return form.versions.find((v) => v.versionNo === versionNo) || getLatestPublishedVersion(form)
}

// 获取某组织视角下可见的工单类型：集团标准 + 本组织自有
export function getVisibleTicketTypes(config, orgId) {
  return config.ticketTypes.filter((t) => {
    if (t.status !== 'published') return false
    if (t.typeOrigin === 'group_standard') return true
    return t.ownerOrgId === orgId
  })
}

// 对集团标准类型应用子公司覆盖
export function resolveTicketType(ticketType, orgId) {
  if (ticketType.typeOrigin !== 'group_standard') return ticketType
  const override = ticketType.orgOverrides?.[orgId]
  if (!override) return ticketType
  return {
    ...ticketType,
    triggerRules: override.triggerRules || ticketType.triggerRules,
    timeWindow: override.timeWindow || ticketType.timeWindow,
    notify: override.notify || ticketType.notify,
    executorScope: override.executorScope || ticketType.executorScope || { defaultExecutors: [], otherExecutors: [] },
    apiEnabled: override.apiEnabled ?? true,
  }
}

export function getResolvedTicketType(config, ticketTypeId, orgId) {
  const ticketType = config.ticketTypes.find((t) => t.id === ticketTypeId)
  if (!ticketType) return null
  return resolveTicketType(ticketType, orgId)
}

export function getVisibleNotificationRules(config, orgId) {
  const rules = config.notificationRules || []
  if (orgId === 'group') return rules
  return rules.filter((r) => r.scope === 'group' || r.scope === orgId)
}

export function pushNotificationForEvent(config, { orgId, ticketTypeId, ticketNo, typeName, event }) {
  if (event === 'waitingData') return
  if (!config.messages) config.messages = []
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const eventLabel = NOTIFY_EVENTS.find((e) => e.value === event)?.label || event
  const rules = (config.notificationRules || []).filter((r) => (
    r.enabled &&
    r.ticketTypeId === ticketTypeId &&
    r.event === event &&
    (r.scope === 'group' || r.scope === orgId)
  ))
  rules.forEach((rule) => {
    const template = rule.template || '您有一条工单通知'
    const content = template
      .replace(/\{ticketNo\}/g, ticketNo || '')
      .replace(/\{typeName\}/g, typeName || '')
      .replace(/\{event\}/g, eventLabel)
    config.messages.push({
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      title: `【${typeName || '工单'}】${eventLabel}通知`,
      content,
      type: '工单通知',
      read: false,
      orgId,
      createdAt: now,
    })
  })
}

export function nextCode(config, prefix = 'T') {
  const codes = new Set(config.ticketTypes.map((t) => t.code))
  let n = 1
  while (codes.has(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

export function nextCategoryCode(config) {
  const codes = new Set(config.categories.map((c) => c.code))
  let n = 1
  while (codes.has(`CAT${n}`)) n += 1
  return `CAT${n}`
}

export function addTicket(config, ticketTypeId, orgId) {
  const type = config.ticketTypes.find((t) => t.id === ticketTypeId)
  if (!type) return null
  const org = config.orgs.find((o) => o.id === orgId)
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `${type.code}-${org?.code || orgId}-${date}`
  const seqStart = config.tickets
    .filter((t) => t.ticketNo && t.ticketNo.startsWith(prefix))
    .map((t) => Number(t.ticketNo.slice(-4)))
    .reduce((max, n) => Math.max(max, n), 0)
  const seq = String(seqStart + 1).padStart(4, '0')
  const ticket = {
    id: 'tk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    ticketNo: `${prefix}-${seq}`,
    ticketTypeId,
    orgId,
    status: 'inProgress',
    formVersion: type.formVersion || getLatestPublishedVersion(getFormById(config, type.formId))?.versionNo || 1,
    createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    createdBy: '当前用户',
    values: {},
    assigneeId: null,
  }
  config.tickets.push(ticket)
  type.generatedCount = (type.generatedCount || 0) + 1
  pushNotificationForEvent(config, {
    orgId,
    ticketTypeId,
    ticketNo: ticket.ticketNo,
    typeName: type.name,
    event: 'created',
  })
  saveConfig(config)
  return ticket
}
