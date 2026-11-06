import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, transaction } from './database'
import { addBusinessSnapshotColumns } from './migrations/020_business_snapshot_columns'
import { migrateLegacyFactorySchema } from './migrations/002a_factory_compatibility'

const migrationDir = fileURLToPath(new URL('./migrations', import.meta.url))
const codeMigrations: Record<string, (db: ReturnType<typeof openDatabase>) => void> = {
  '002a_factory_compatibility.ts': migrateLegacyFactorySchema,
  '020_business_snapshot_columns.ts': addBusinessSnapshotColumns,
}

export function migrate(): void {
  const db = openDatabase()
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((row) => String(row.name)),
  )
  const files = [...readdirSync(migrationDir).filter((name) => /^\d+.*\.sql$/.test(name)), ...Object.keys(codeMigrations)].sort()
  for (const file of files) {
    if (applied.has(file)) continue
    if (file === '002a_factory_compatibility.ts') {
      migrateLegacyFactorySchema(db)
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString())
      continue
    }
    transaction(() => {
      if (codeMigrations[file]) codeMigrations[file](db)
      else db.exec(readFileSync(join(migrationDir, file), 'utf8'))
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString())
    })
  }
}
