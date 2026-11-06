import type { TicketBusinessWorkItem } from '../../../packages/contracts/src'
import { AppError } from '../../core/errors'
import { all, newId, nowIso, one, run } from '../../db/database'
import type { BusinessPriceRow } from './routes'

export interface BusinessItemInput {
  catalogId: string
  kind: 'production_post' | 'loading_type'
}

export interface ProductionMaterialScope {
  materialId: string | null
  materialName: string | null
  materialTypeId: string | null
  items: BusinessItemInput[]
}

/** 产品（物料档案）决定参与工序：选定产品后料类取其分类，岗位未显式指定时按产品参与工序默认，显式指定时不得超出该范围。 */
export function resolveProductionMaterialScope(input: {
  siteId: string
  materialId: string | null
  materialTypeId: string | null
  items: BusinessItemInput[]
}): ProductionMaterialScope {
  if (!input.materialId) {
    return { materialId: null, materialName: null, materialTypeId: input.materialTypeId, items: input.items }
  }
  const material = one<{ id: string; name: string; material_type_id: string }>(
    'SELECT id, name, material_type_id FROM materials WHERE id = ? AND status = \'active\'', [input.materialId])
  if (!material) throw AppError.badRequest('产品不存在或已停用')
  if (input.materialTypeId && input.materialTypeId !== material.material_type_id) {
    throw AppError.badRequest('所选料类与产品物料类别不一致')
  }
  const flags = all<{ post_catalog_id: string }>(`SELECT f.post_catalog_id FROM material_post_flags f
    JOIN business_catalog c ON c.id = f.post_catalog_id
    WHERE f.material_id = ? AND c.kind = 'production_post' AND c.status = 'active' ORDER BY f.post_catalog_id`, [material.id])
    .map((row) => row.post_catalog_id)
  if (input.items.length) {
    const outside = input.items.filter((item) => item.kind !== 'production_post' || !flags.includes(item.catalogId))
    if (outside.length) throw AppError.badRequest('生产岗位超出产品参与工序范围')
    return { materialId: material.id, materialName: material.name, materialTypeId: material.material_type_id, items: input.items }
  }
  if (!flags.length) throw AppError.badRequest('产品未配置参与工序')
  return {
    materialId: material.id,
    materialName: material.name,
    materialTypeId: material.material_type_id,
    items: flags.map((catalogId) => ({ catalogId, kind: 'production_post' as const })),
  }
}

export function createBusinessWorkItems(input: {
  ticketId: string
  kind: 'production' | 'loading'
  siteId: string
  materialTypeId: string | null
  eventTime: string
  items: BusinessItemInput[]
}): void {
  if (!input.items.length) throw AppError.badRequest('至少选择一项生产岗位或装卸类型')
  if (new Set(input.items.map((item) => item.catalogId)).size !== input.items.length) {
    throw AppError.badRequest('作业明细不能重复')
  }
  const expectedCatalogKind = input.kind === 'production' ? 'production_post' : 'loading_type'
  if (input.items.some((item) => item.kind !== expectedCatalogKind)) throw AppError.badRequest('作业明细类型与工单业务类型不一致')
  if (input.kind === 'production') {
    if (!input.materialTypeId) throw AppError.badRequest('生产工单必须选择料类')
    const material = one<{ id: string }>(`SELECT c.id FROM business_catalog c JOIN site_business_config_items s
      ON s.catalog_id = c.id WHERE c.id = ? AND c.kind = 'material_type' AND c.status = 'active'
        AND s.site_id = ? AND s.enabled = 1`, [input.materialTypeId, input.siteId])
    if (!material) throw AppError.badRequest('料类须先在该基地启用')
  } else if (input.materialTypeId) throw AppError.badRequest('装卸工单不选择生产料类')

  for (const item of input.items) {
    const enabled = input.kind === 'production'
      ? one<{ id: string; name: string }>(`SELECT c.id, c.name FROM business_catalog c WHERE c.id = ? AND c.kind = ? AND c.status = 'active'`,
        [item.catalogId, expectedCatalogKind])
      : one<{ id: string; name: string }>(`SELECT c.id, c.name FROM business_catalog c JOIN site_business_config_items s
        ON s.catalog_id = c.id WHERE c.id = ? AND c.kind = ? AND c.status = 'active'
          AND s.site_id = ? AND s.enabled = 1`, [item.catalogId, expectedCatalogKind, input.siteId])
    if (!enabled) throw AppError.badRequest(input.kind === 'production' ? '工单包含已停用的工序/岗位' : '工单包含未在该基地启用的作业项')
    const price = one<BusinessPriceRow>(`SELECT * FROM business_price_rule_versions
      WHERE site_id = ? AND kind = ? AND catalog_id = ? AND ${input.kind === 'production' ? 'material_type_id = ?' : 'material_type_id IS NULL'}
        AND status = 'published' AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY effective_from DESC, version_no DESC LIMIT 1`,
    input.kind === 'production'
      ? [input.siteId, input.kind, item.catalogId, input.materialTypeId!, input.eventTime, input.eventTime]
      : [input.siteId, input.kind, item.catalogId, input.eventTime, input.eventTime])
    run(`INSERT INTO ticket_business_work_items
      (id, ticket_id, kind, catalog_id, catalog_name_snapshot, price_rule_version_id, price_status, unit, unit_price_micros, revision, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [newId('workitem'), input.ticketId, item.kind, item.catalogId, enabled.name, price?.id ?? null,
      price ? 'confirmed' : 'pending', price?.unit ?? '吨', price?.unit_price_micros ?? null, nowIso()])
  }
}

interface WorkItemRow {
  id: string; kind: 'production_post' | 'loading_type'; catalog_id: string; catalog_name_snapshot: string
  price_rule_version_id: string | null; price_status: 'pending' | 'confirmed'; unit: string; unit_price_micros: number | null
}

interface WorkItemAssignmentRow {
  assignment_id: string; person_id: string; person_name: string; share_basis_points: number
}

export function listBusinessWorkItems(ticketId: string, quantity: number | null): TicketBusinessWorkItem[] {
  const rows = all<WorkItemRow>(`SELECT w.id, w.kind, w.catalog_id, w.catalog_name_snapshot, w.price_rule_version_id, w.price_status, w.unit, w.unit_price_micros
    FROM ticket_business_work_items w
    WHERE w.ticket_id = ? ORDER BY w.catalog_name_snapshot, w.id`, [ticketId])
  return rows.map((row) => {
    const links = all<WorkItemAssignmentRow>(`SELECT a.id AS assignment_id, a.person_id,
      COALESCE(NULLIF(a.person_name_snapshot, ''), p.name) AS person_name, w.share_basis_points
      FROM ticket_business_work_item_assignments w JOIN ticket_assignments a ON a.id = w.ticket_assignment_id
      JOIN people p ON p.id = a.person_id WHERE w.work_item_id = ? ORDER BY a.person_id`, [row.id])
    const amountMicros = row.price_status === 'confirmed' && quantity !== null
      ? Math.round(quantity * row.unit_price_micros!) : null
    return {
      id: row.id, kind: row.kind, catalogId: row.catalog_id, name: row.catalog_name_snapshot,
      priceRuleVersionId: row.price_rule_version_id,
      priceStatus: row.price_status, unit: row.unit, unitPriceMicros: row.unit_price_micros,
      amountMicros,
      quantity,
      assignments: links.map((link) => {
        const assignedQuantity = quantity === null ? null : quantity * link.share_basis_points / 10000
        return {
          assignmentId: link.assignment_id, personId: link.person_id, personName: link.person_name,
          shareBasisPoints: link.share_basis_points, quantity: assignedQuantity,
          amountMicros: assignedQuantity === null || row.price_status !== 'confirmed'
            ? null : Math.round(assignedQuantity * row.unit_price_micros!),
        }
      }),
    }
  })
}

export function setBusinessWorkItemAssignments(
  workItemId: string,
  assignments: Array<{ ticketAssignmentId: string; shareBasisPoints: number }>,
): void {
  const item = one<{ ticket_id: string }>('SELECT ticket_id FROM ticket_business_work_items WHERE id = ?', [workItemId])
  if (!item) throw AppError.notFound('工单作业明细')
  if (new Set(assignments.map((assignment) => assignment.ticketAssignmentId)).size !== assignments.length) {
    throw AppError.badRequest('同一岗位人员不能重复')
  }
  if (assignments.some((assignment) => assignment.shareBasisPoints < 0 || assignment.shareBasisPoints > 10000)) {
    throw AppError.badRequest('人员贡献比例须在0%至100%之间')
  }
  if (assignments.length && assignments.reduce((sum, assignment) => sum + assignment.shareBasisPoints, 0) !== 10000) {
    throw AppError.badRequest('每个岗位的人员贡献比例必须合计100%')
  }
  for (const assignment of assignments) {
    if (!one<{ id: string }>('SELECT id FROM ticket_assignments WHERE id = ? AND ticket_id = ?', [assignment.ticketAssignmentId, item.ticket_id])) {
      throw AppError.badRequest('人员不属于当前工单')
    }
  }
  run('DELETE FROM ticket_business_work_item_assignments WHERE work_item_id = ?', [workItemId])
  for (const assignment of assignments) {
    run(`INSERT INTO ticket_business_work_item_assignments (id, work_item_id, ticket_assignment_id, share_basis_points, created_at)
      VALUES (?, ?, ?, ?, ?)`, [newId('workshare'), workItemId, assignment.ticketAssignmentId, assignment.shareBasisPoints, nowIso()])
  }
}

export function businessWorkItemShareTotals(ticketId: string): number[] {
  return all<{ total: number; count: number }>(`SELECT COALESCE(SUM(a.share_basis_points), 0) AS total, COUNT(a.id) AS count
    FROM ticket_business_work_items w LEFT JOIN ticket_business_work_item_assignments a ON a.work_item_id = w.id
    WHERE w.ticket_id = ? GROUP BY w.id`, [ticketId]).map((row) => row.count ? row.total : 0)
}

export function setBusinessWorkItemPriceSnapshot(input: {
  workItemId: string
  unit: string
  unitPriceMicros: number
  priceRuleVersionId: string | null
}): void {
  const changed = run(`UPDATE ticket_business_work_items SET price_status = 'confirmed', unit = ?, unit_price_micros = ?,
    price_rule_version_id = ?, revision = revision + 1 WHERE id = ?`,
  [input.unit, input.unitPriceMicros, input.priceRuleVersionId, input.workItemId])
  if (!changed.changes) throw AppError.notFound('工单作业明细')
}
