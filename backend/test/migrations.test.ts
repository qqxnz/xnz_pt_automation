import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { runMigrations, readSchemaVersion, SCHEMA_VERSION, SchemaTooNewError, isMigrationStepError } from '../src/storage/migrations/index.js'
import {
  addColumnIfMissing,
  createTableIfMissing,
  createIndexIfMissing,
  dropColumnIfExists
} from '../src/storage/migrations/_helpers.js'

function openFreshDb(file: string): DatabaseSync {
  rmSync(file, { force: true })
  rmSync(file + '-wal', { force: true })
  rmSync(file + '-shm', { force: true })
  return new DatabaseSync(file)
}

test('addColumnIfMissing is idempotent', () => {
  const tmpDir = path.join('/tmp', `xnz-mig-h-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
  const dbFile = path.join(tmpDir, 'test.db')
  const db = openFreshDb(dbFile)
  try {
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY)`)
    assert.equal(addColumnIfMissing(db, 't', 'col', 'INTEGER'), true)
    assert.equal(addColumnIfMissing(db, 't', 'col', 'INTEGER'), false)
  } finally {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('dropColumnIfExists is idempotent', () => {
  const tmpDir = path.join('/tmp', `xnz-mig-d-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
  const dbFile = path.join(tmpDir, 'test.db')
  const db = openFreshDb(dbFile)
  try {
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, a TEXT)`)
    assert.equal(dropColumnIfExists(db, 't', 'a'), true)
    assert.equal(dropColumnIfExists(db, 't', 'a'), false)
  } finally {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('createTableIfMissing is idempotent', () => {
  const tmpDir = path.join('/tmp', `xnz-mig-t-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
  const dbFile = path.join(tmpDir, 'test.db')
  const db = openFreshDb(dbFile)
  try {
    const ddl = `CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER)`
    assert.equal(createTableIfMissing(db, ddl), true)
    assert.equal(createTableIfMissing(db, ddl), false)
  } finally {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('createIndexIfMissing is idempotent', () => {
  const tmpDir = path.join('/tmp', `xnz-mig-i-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
  const dbFile = path.join(tmpDir, 'test.db')
  const db = openFreshDb(dbFile)
  try {
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER)`)
    const ddl = `CREATE INDEX IF NOT EXISTS idx_t_v ON t(v)`
    assert.equal(createIndexIfMissing(db, ddl), true)
    assert.equal(createIndexIfMissing(db, ddl), false)
  } finally {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('runMigrations from 0 upgrades to SCHEMA_VERSION', async () => {
  const dbFile = `/tmp/xnz-mig-fresh-${Date.now()}.db`
  rmSync(dbFile, { force: true })
  const db = new DatabaseSync(dbFile)
  try {
    // 模拟生产环境：先用 health.ts 跑一次建立所有结构化表
    const { inspectDatabaseHealth } = await import('../src/storage/health.js')
    db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    inspectDatabaseHealth(db)
    // 重置 user_version 到 0（health 不会主动设置）
    db.exec('PRAGMA user_version = 0')
    const result = runMigrations(db, 0, { dataDir: '/tmp' })
    assert.equal(result.fromVersion, 0)
    assert.equal(result.toVersion, SCHEMA_VERSION)
    assert.ok(result.applied.length > 0)
    assert.equal(readSchemaVersion(db), SCHEMA_VERSION)
  } finally {
    db.close()
    rmSync(dbFile, { force: true })
    rmSync(dbFile + '-wal', { force: true })
    rmSync(dbFile + '-shm', { force: true })
  }
})

test('runMigrations from SCHEMA_VERSION applies zero migrations (idempotent)', async () => {
  const dbFile = `/tmp/xnz-mig-idem-${Date.now()}.db`
  rmSync(dbFile, { force: true })
  const db = new DatabaseSync(dbFile)
  try {
    const { inspectDatabaseHealth } = await import('../src/storage/health.js')
    db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    inspectDatabaseHealth(db)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    const result = runMigrations(db, SCHEMA_VERSION, { dataDir: '/tmp' })
    assert.deepEqual(result.applied, [])
  } finally {
    db.close()
    rmSync(dbFile, { force: true })
    rmSync(dbFile + '-wal', { force: true })
    rmSync(dbFile + '-shm', { force: true })
  }
})

test('runMigrations throws SchemaTooNewError when dbVersion > imageVersion', async () => {
  const dbFile = `/tmp/xnz-mig-down-${Date.now()}.db`
  rmSync(dbFile, { force: true })
  const db = new DatabaseSync(dbFile)
  try {
    const { inspectDatabaseHealth } = await import('../src/storage/health.js')
    db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    inspectDatabaseHealth(db)
    assert.throws(
      () => runMigrations(db, SCHEMA_VERSION + 5, { dataDir: '/tmp' }),
      SchemaTooNewError
    )
  } finally {
    db.close()
    rmSync(dbFile, { force: true })
    rmSync(dbFile + '-wal', { force: true })
    rmSync(dbFile + '-shm', { force: true })
  }
})

test('runMigrations from v15 applies v16..v21', async () => {
  const dbFile = `/tmp/xnz-mig-v15-${Date.now()}.db`
  rmSync(dbFile, { force: true })
  const db = new DatabaseSync(dbFile)
  try {
    const { inspectDatabaseHealth } = await import('../src/storage/health.js')
    db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    inspectDatabaseHealth(db)
    db.exec('PRAGMA user_version = 15')
    const result = runMigrations(db, 15, { dataDir: '/tmp' })
    for (const v of [16, 17, 18, 19, 21]) {
      assert.ok(result.applied.includes(v), `expected v${v} to be applied`)
    }
    assert.equal(readSchemaVersion(db), SCHEMA_VERSION)
  } finally {
    db.close()
    rmSync(dbFile, { force: true })
    rmSync(dbFile + '-wal', { force: true })
    rmSync(dbFile + '-shm', { force: true })
  }
})

test('isMigrationStepError detects correctly', () => {
  assert.equal(isMigrationStepError(new Error('plain')), false)
  assert.equal(
    isMigrationStepError({ type: 'MigrationStepError', version: 3, fromVersion: 2, cause: 'x' }),
    true
  )
})
