export const statusLabels: Record<string, string> = {
  active: '启用',
  inactive: '停用',
  archived: '已归档',
  draft: '草稿',
  published: '已发布',
  retired: '已停用',
  planned: '计划中',
  completed: '已完成',
  cancelled: '已取消',
  pending_assignment: '待指派',
  pending_start: '待开始',
  in_progress: '执行中',
  pending_data: '待数据',
  overdue: '已超期',
  closed: '已关闭',
  open: '未结算',
  closing: '结算中',
  locked: '已锁定',
  adjusted: '已调整',
  reopened: '已重开',
  failed: '失败',
  uploaded: '已上传',
  mapped: '已映射',
  draft_created: '已生成草稿',
}

export const crewRoleLabels: Record<string, string> = {
  leader: '班组长',
  operator: '操作员',
  support: '协作人员',
}

export function labelOf(value: string | null | undefined): string {
  return value ? statusLabels[value] || value : '—'
}
