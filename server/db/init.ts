import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { closeDatabase, openDatabase } from './database'
import { migrate } from './migrate'

const args = new Set(process.argv.slice(2))
if (args.has('--reset')) {
  const path = resolve(process.cwd(), process.env.DATABASE_PATH || './data/feed.db')
  for (const suffix of ['', '-shm', '-wal']) {
    if (existsSync(path + suffix)) unlinkSync(path + suffix)
  }
}

migrate()
const db = openDatabase()
const seedPath = fileURLToPath(new URL('./seed.sql', import.meta.url))
if (existsSync(seedPath)) db.exec(readFileSync(seedPath, 'utf8'))
const counts = db.prepare(`
  SELECT
    (SELECT count(*) FROM companies) AS companies,
    (SELECT count(*) FROM people) AS people,
    (SELECT count(*) FROM accounts) AS accounts
`).get()
console.log(JSON.stringify({ status: 'ready', counts }))
closeDatabase()
