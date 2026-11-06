import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { relative, resolve, isAbsolute } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'

const root = resolve(import.meta.dirname, '..')
const sourcePath = resolve(root, process.argv[2] || 'data/flexible-codex-phase1-test.db')
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '')
const workDir = resolve(root, 'data/isolated', `legacy-upgrade-${runId}`)
const targetPath = resolve(workDir, 'legacy-before-upgrade.db')
const relativeDir = relative(root, workDir)
if (!relativeDir || relativeDir.startsWith('..') || isAbsolute(relativeDir)) throw new Error('隔离副本目录必须位于仓库内')

function snapshot(db) {
  return {
    tickets: db.prepare(`SELECT id, ticket_no, ticket_type_id, ticket_type_version_id, form_version_id,
      values_json, sub_form_values_json, ticket_type_snapshot_json, form_snapshot_json, site_snapshot_json,
      price_snapshot_json, quantity, amount_micros, work_date FROM tickets ORDER BY id`).all(),
    accruals: db.prepare(`SELECT id, ticket_id, person_id, work_site_id, price_rule_version_id, quantity,
      amount_micros, work_month, payroll_company_id, settlement_status, revision, adjustment_of_id,
      adjustment_reason FROM payroll_accruals ORDER BY id`).all(),
  }
}

mkdirSync(workDir, { recursive: true })
try {
  const source = new DatabaseSync(sourcePath, { readOnly: true })
  const before = snapshot(source)
  const sourceMigration = source.prepare('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').get().name
  await backup(source, targetPath)
  source.close()

  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "import { migrate } from './server/db/migrate.ts'; import { ensureBuiltinBusinessTypes } from './server/modules/business/system-types.ts'; import { closeDatabase } from './server/db/database.ts'; migrate(); ensureBuiltinBusinessTypes(); closeDatabase();"],
  { cwd: root, env: { ...process.env, DATABASE_PATH: targetPath }, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
  if (child.status !== 0) throw new Error(`迁移隔离副本失败\n${child.stdout}\n${child.stderr}`)

  const upgraded = new DatabaseSync(targetPath, { readOnly: true })
  const after = snapshot(upgraded)
  assert.deepEqual(after, before, '历史工单/核算 ID、快照、数量和金额必须保持原值')
  assert.equal(upgraded.prepare("SELECT count(*) AS c FROM tickets WHERE business_kind != 'generic'").get().c, 0)
  assert.equal(upgraded.prepare('SELECT count(*) AS c FROM ticket_business_work_items').get().c, 0)
  assert.equal(upgraded.prepare("SELECT count(*) AS c FROM ticket_types WHERE id IN ('type_builtin_production','type_builtin_loading') AND system_managed = 1").get().c, 2)
  assert.equal(upgraded.prepare(`SELECT count(*) AS c FROM role_capabilities rc JOIN roles r ON r.id = rc.role_id
    WHERE r.code = 'group_admin' AND rc.capability = 'business_catalog.manage'`).get().c, 1)
  const applied = upgraded.prepare('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').get().name
  assert.equal(applied, '025_demo_session_scope.sql')
  assert.equal(upgraded.prepare("SELECT count(*) AS c FROM business_catalog WHERE kind = 'material_type'").get().c, 9)
  assert.equal(upgraded.prepare('SELECT count(*) AS c FROM site_business_config_items').get().c, 0)
  upgraded.close()
  console.log(JSON.stringify({ status: 'passed', source: sourceMigration, tickets: before.tickets.length,
    accruals: before.accruals.length, migrated: applied, historicalDataUnchanged: true }))
} finally {
  rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
