export interface ScheduleConfig {
  frequency: 'daily' | 'weekly'
  time: string
  weekdays?: number[]
  effectiveFrom: string
  effectiveTo?: string | null
}

/** Return a UTC instant for a Shanghai local date; null means the rule does not apply. */
export function scheduledInstant(config: ScheduleConfig, localDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.time)) {
    throw new Error('无效的触发日期或时间')
  }
  const local = new Date(`${localDate}T${config.time}:00+08:00`)
  if (!Number.isFinite(local.getTime()) || new Date(local.getTime() + 8 * 3600000).toISOString().slice(0, 10) !== localDate) {
    throw new Error('无效的触发日期')
  }
  if (localDate < config.effectiveFrom || (config.effectiveTo && localDate > config.effectiveTo)) return null
  const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay()
  if (config.frequency === 'weekly' && !config.weekdays?.includes(weekday)) return null
  return local.toISOString()
}
