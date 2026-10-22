import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, transaction } from './database'

const migrationDir = fileURLToPath(new URL('./migrations', import.meta.url))

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
  const files = readdirSync(migrationDir).filter((name) => /^\d+.*\.sql$/.test(name)).sort()
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(migrationDir, file), 'utf8')
    transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString())
    })
  }
}
