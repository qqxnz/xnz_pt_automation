import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { inspectDatabaseHealth, hasHealthIssues, summarizeHealth } from '../src/storage/health.js'

function openFreshDb(file: string): DatabaseSync {
  rmSync(file, { force: true })
  rmSync(file + '-wal', { force: true })
  rmSync(file + '-shm', { force: true })
  return new DatabaseSync(file)
}

test('inspectDatabaseHealth repairs all tables on a fresh db', () => {
  const tmp = path.join('/tmp', `xnz-h1-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmp, { recursive: true })
  const dbFile = path.join(tmp, 'test.db')
  const db = openFreshDb(dbFile)
  try {
    db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    const r = inspectDatabaseHealth(db)
    assert.ok(r.tablesChecked > 0)
    assert.ok(r.repairedTables > 0, 'first call should repair all missing tables')
  } finally {
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('inspectDatabaseHealth repairs missing column on second call', () => {
  const tmp = path.join('/tmp', `xnz-h2-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmp, { recursive: true })
  const dbFile = path.join(tmp, 'test.db')
  const db = openFreshDb(dbFile)
  try {
    db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    inspectDatabaseHealth(db)
    // 注意：sites.name 是 NOT NULL DEFAULT ''，SQLite 不允许直接 DROP
    // 我们用 sites.api_key（可空列）做测试
    db.exec(`ALTER TABLE sites DROP COLUMN api_key`)
    const r = inspectDatabaseHealth(db)
    assert.ok(hasHealthIssues(r))
    assert.ok(
      r.issues.some((i) => i.table === 'sites' && i.kind === 'MISSING_COLUMN' && i.detail.includes('api_key'))
    )
  } finally {
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('inspectDatabaseHealth removes orphan _new tables', () => {
  const tmp = path.join('/tmp', `xnz-h3-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmp, { recursive: true })
  const dbFile = path.join(tmp, 'test.db')
  const db = openFreshDb(dbFile)
  try {
    db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    db.exec(`CREATE TABLE leftover_new (id INTEGER)`)
    db.exec(`INSERT INTO leftover_new VALUES (1)`)
    const r = inspectDatabaseHealth(db)
    assert.equal(r.removedNewTables, 1)
    const stillThere = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='leftover_new'")
      .get() as { name?: string } | undefined
    assert.equal(stillThere, undefined)
  } finally {
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('summarizeHealth returns non-empty string', () => {
  const tmp = path.join('/tmp', `xnz-h4-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmp, { recursive: true })
  const dbFile = path.join(tmp, 'test.db')
  const db = openFreshDb(dbFile)
  try {
    db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    const r = inspectDatabaseHealth(db)
    const text = summarizeHealth(r)
    assert.ok(text.length > 0)
  } finally {
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('inspectDatabaseHealth detects missing singleton (admin user)', () => {
  const tmp = path.join('/tmp', `xnz-h5-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmp, { recursive: true })
  const dbFile = path.join(tmp, 'test.db')
  const db = openFreshDb(dbFile)
  try {
    db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    inspectDatabaseHealth(db)
    db.prepare(`DELETE FROM users WHERE id = 'admin'`).run()
    const r = inspectDatabaseHealth(db)
    assert.ok(
      r.issues.some((i) => i.table === 'users' && i.kind === 'MISSING_SINGLETON'),
      'expected MISSING_SINGLETON issue for users'
    )
  } finally {
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})
