import { nowIso, one, run, transaction } from '../../db/database'

const emptySchema = JSON.stringify({ mainFields: [], subForms: [], conditionRules: [] })

export const ticketCatalogGroupIds = {
  production: 'cat_group_production',
  loading: 'cat_group_loading',
  sanitation: 'cat_group_sanitation',
  warehouse: 'cat_group_warehouse',
  boiler: 'cat_group_boiler',
  laboratory: 'cat_group_laboratory',
  other: 'cat_group_other',
} as const

/** Existing installations may apply migrations at server startup without re-running db:init/seed.sql. */
export function ensureBuiltinBusinessTypes(): void {
  const publisher = one<{ id: string }>(`SELECT id FROM accounts WHERE id = 'acct_group' AND status = 'active'`)
  if (!publisher) return
  const timestamp = nowIso()

  transaction(() => {
    for (const item of [
      { id: ticketCatalogGroupIds.production, code: 'GROUP-PRODUCTION', name: '生产' },
      { id: ticketCatalogGroupIds.loading, code: 'GROUP-LOADING', name: '装卸' },
      { id: ticketCatalogGroupIds.sanitation, code: 'GROUP-SANITATION', name: '洗消' },
      { id: ticketCatalogGroupIds.warehouse, code: 'GROUP-WAREHOUSE', name: '仓储' },
      { id: ticketCatalogGroupIds.boiler, code: 'GROUP-BOILER', name: '司炉' },
      { id: ticketCatalogGroupIds.laboratory, code: 'GROUP-LABORATORY', name: '化验' },
      { id: ticketCatalogGroupIds.other, code: 'GROUP-OTHER', name: '其他' },
    ]) {
      run(`INSERT OR IGNORE INTO ticket_categories
        (id, code, name, owner_type, owner_id, status, locked, revision, created_at, updated_at)
        VALUES (?, ?, ?, 'group', 'group', 'active', 1, 1, ?, ?)`,
      [item.id, item.code, item.name, timestamp, timestamp])
    }
    // Keep old demo rows out of the single "生产作业示例" bucket. Only
    // untouched demo categories are normalized; operator edits are preserved.
    run(`UPDATE ticket_types SET category_id = ?
      WHERE category_id = 'cat_demo' AND id IN ('type_demo', 'type_builtin_production')`,
    [ticketCatalogGroupIds.production])
    run(`UPDATE ticket_types SET category_id = ?
      WHERE category_id = 'cat_demo' AND id = 'type_builtin_loading'`,
    [ticketCatalogGroupIds.loading])
    run(`UPDATE ticket_types SET category_id = ?
      WHERE category_id = 'cat_demo' AND id IN ('type_ops_vehicle', 'type_ops_facility')`,
    [ticketCatalogGroupIds.sanitation])
    run(`UPDATE ticket_types SET category_id = ?
      WHERE category_id = 'cat_demo' AND id IN ('type_ops_demo', 'type_ops_multibase')`,
    [ticketCatalogGroupIds.other])
    run(`UPDATE ticket_categories SET status = 'inactive', updated_at = ?
      WHERE id = 'cat_demo' AND status = 'active'
        AND NOT EXISTS (SELECT 1 FROM ticket_types WHERE category_id = 'cat_demo')`,
    [timestamp])

    run(`INSERT OR IGNORE INTO role_capabilities (role_id, capability)
      SELECT id, 'business_catalog.manage' FROM roles WHERE code = 'group_admin'`)
    for (const item of [
      { kind: 'production', typeId: 'type_builtin_production', typeCode: 'SYSTEM-PRODUCTION', typeName: '生产工单', formId: 'form_builtin_production', formCode: 'SYSTEM-PRODUCTION', formName: '系统内置生产工单字段', versionId: 'formver_builtin_production', typeVersionId: 'typever_builtin_production' },
      { kind: 'loading', typeId: 'type_builtin_loading', typeCode: 'SYSTEM-LOADING', typeName: '装卸工单', formId: 'form_builtin_loading', formCode: 'SYSTEM-LOADING', formName: '系统内置装卸工单字段', versionId: 'formver_builtin_loading', typeVersionId: 'typever_builtin_loading' },
    ]) {
      run(`INSERT OR IGNORE INTO form_templates
        (id, code, name, owner_type, owner_id, source, locked, current_published_version_id, revision, created_at, updated_at, system_managed)
        VALUES (?, ?, ?, 'group', 'group', 'native', 1, ?, 1, ?, ?, 1)`,
      [item.formId, item.formCode, item.formName, item.versionId, timestamp, timestamp])
      run(`INSERT OR IGNORE INTO form_versions
        (id, template_id, version_no, status, schema_json, published_at, published_by, revision, created_at, updated_at)
        VALUES (?, ?, 1, 'published', ?, ?, ?, 1, ?, ?)`,
      [item.versionId, item.formId, emptySchema, timestamp, publisher.id, timestamp, timestamp])
      run(`INSERT OR IGNORE INTO ticket_types
        (id, code, name, category_id, owner_type, owner_id, origin, status, current_version_id, locked, revision, created_at, updated_at, system_managed, business_kind)
        VALUES (?, ?, ?, ?, 'group', 'group', 'group_standard', 'published', ?, 1, 1, ?, ?, 1, ?)`,
      [item.typeId, item.typeCode, item.typeName,
        item.kind === 'production' ? ticketCatalogGroupIds.production : ticketCatalogGroupIds.loading,
        item.typeVersionId, timestamp, timestamp, item.kind])
      run(`INSERT OR IGNORE INTO ticket_type_versions
        (id, ticket_type_id, version_no, status, form_version_id, published_at, published_by, revision, created_at, updated_at)
        VALUES (?, ?, 1, 'published', ?, ?, ?, 1, ?, ?)`,
      [item.typeVersionId, item.typeId, item.versionId, timestamp, publisher.id, timestamp, timestamp])
    }
  })
}
