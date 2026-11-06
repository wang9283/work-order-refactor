import type { DatabaseSync } from 'node:sqlite'

const factoriesDdl = `
CREATE TABLE IF NOT EXISTS factories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  company_id TEXT NOT NULL REFERENCES companies(id),
  base_id TEXT NOT NULL REFERENCES production_bases(id),
  factory_type TEXT NOT NULL DEFAULT 'feed_mill'
    CHECK (factory_type IN ('direct_mill', 'feed_mill', 'other')),
  manager_person_id TEXT REFERENCES people(id),
  address TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
)
`

function columnInfo(db: DatabaseSync, table: string): Array<{ name: string; notnull: number }> {
  return db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>
}

function tableSql(db: DatabaseSync, table: string): string {
  return String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '')
}

function rebuildCrews(db: DatabaseSync, factoryColumn: boolean): void {
  const columns = ['id', 'code', 'name', 'base_id', 'work_area_id']
  if (factoryColumn) columns.push('factory_id')
  columns.push('leader_person_id', 'status', 'revision', 'created_at', 'created_by', 'updated_at', 'updated_by')
  const factoryDefinition = factoryColumn ? ', factory_id TEXT REFERENCES factories(id)' : ''
  const indexes = db.prepare(`SELECT sql FROM sqlite_master
    WHERE type='index' AND tbl_name='crews' AND sql IS NOT NULL`).all() as Array<{ sql: string }>
  db.exec(`CREATE TABLE crews__compat (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    base_id TEXT NOT NULL REFERENCES production_bases(id),
    work_area_id TEXT REFERENCES work_areas(id)${factoryDefinition},
    leader_person_id TEXT REFERENCES people(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by TEXT,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  )`)
  db.prepare(`INSERT INTO crews__compat (${columns.join(',')})
    SELECT ${columns.join(',')} FROM crews`).run()
  db.exec('ALTER TABLE crews RENAME TO crews__compat_old')
  db.exec('ALTER TABLE crews__compat RENAME TO crews')
  db.exec('DROP TABLE crews__compat_old')
  for (const index of indexes) db.exec(index.sql)
}

function rebuildRoleAssignments(db: DatabaseSync): void {
  const indexes = db.prepare(`SELECT sql FROM sqlite_master
    WHERE type='index' AND tbl_name='role_assignments' AND sql IS NOT NULL`).all() as Array<{ sql: string }>
  db.exec(`CREATE TABLE role_assignments__compat (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    role_id TEXT NOT NULL REFERENCES roles(id),
    scope_type TEXT NOT NULL CHECK (scope_type IN ('group', 'company', 'base', 'factory', 'work_area')),
    scope_id TEXT NOT NULL,
    valid_from TEXT,
    valid_to TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT
  )`)
  db.exec(`INSERT INTO role_assignments__compat
    (id, account_id, role_id, scope_type, scope_id, valid_from, valid_to, created_at, created_by)
    SELECT id, account_id, role_id, scope_type, scope_id, valid_from, valid_to, created_at, created_by
    FROM role_assignments`)
  db.exec('ALTER TABLE role_assignments RENAME TO role_assignments__compat_old')
  db.exec('ALTER TABLE role_assignments__compat RENAME TO role_assignments')
  db.exec('DROP TABLE role_assignments__compat_old')
  for (const index of indexes) db.exec(index.sql)
}

/**
 * Brings databases created before the factory-aware schema up to the shape
 * needed by later migrations without editing an already-applied 001 file.
 */
export function migrateLegacyFactorySchema(db: DatabaseSync): void {
  const previousForeignKeys = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys || 0)
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('PRAGMA legacy_alter_table = ON')
  try {
    db.exec(factoriesDdl)
    const crews = columnInfo(db, 'crews')
    const workArea = crews.find((column) => column.name === 'work_area_id')
    if (workArea?.notnull) rebuildCrews(db, crews.some((column) => column.name === 'factory_id'))
    if (!tableSql(db, 'role_assignments').includes("'factory'")) rebuildRoleAssignments(db)
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF')
    db.exec(`PRAGMA foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`)
  }
}
