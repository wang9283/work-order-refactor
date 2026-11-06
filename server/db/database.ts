import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

let database: DatabaseSync | null = null
let transactionDepth = 0
let savepointSequence = 0

function configuredPath(): string {
  const raw = process.env.DATABASE_PATH || './data/feed.db'
  return resolve(process.cwd(), raw)
}

export function openDatabase(): DatabaseSync {
  if (database) return database
  const path = configuredPath()
  mkdirSync(dirname(path), { recursive: true })
  database = new DatabaseSync(path)
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA busy_timeout = 5000')
  return database
}

export function closeDatabase(): void {
  database?.close()
  database = null
}

export function one<T>(sql: string, params: SQLInputValue[] = []): T | undefined {
  return openDatabase().prepare(sql).get(...params) as T | undefined
}

export function all<T>(sql: string, params: SQLInputValue[] = []): T[] {
  return openDatabase().prepare(sql).all(...params) as T[]
}

export function run(sql: string, params: SQLInputValue[] = []): { changes: number; lastInsertRowid: number } {
  const result = openDatabase().prepare(sql).run(...params)
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  }
}

export function transaction<T>(fn: () => T): T {
  const db = openDatabase()
  const nested = transactionDepth > 0
  const savepoint = `nested_${++savepointSequence}`
  db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE')
  transactionDepth += 1
  try {
    const result = fn()
    db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT')
    return result
  } catch (error) {
    if (nested) {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      db.exec(`RELEASE SAVEPOINT ${savepoint}`)
    } else {
      db.exec('ROLLBACK')
    }
    throw error
  } finally {
    transactionDepth -= 1
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
