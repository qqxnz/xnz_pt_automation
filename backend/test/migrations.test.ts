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
import { v23 } from '../src/storage/migrations/v23.js'
import { v24 } from '../src/storage/migrations/v24.js'

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

test('v23 keeps the latest daily snapshot and adds history schema', () => {
  const tmpDir = path.join('/tmp', `xnz-mig-v23-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
  const dbFile = path.join(tmpDir, 'test.db')
  const db = openFreshDb(dbFile)
  try {
    db.exec(`
      CREATE TABLE site_traffic_snapshots (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        site_name TEXT NOT NULL,
        date TEXT NOT NULL,
        uploaded REAL,
        downloaded REAL,
        ratio REAL,
        ratio_infinite INTEGER,
        synced_at TEXT NOT NULL
      );
      INSERT INTO site_traffic_snapshots VALUES
        ('older', 'site-a', 'A', '2026-07-01', 100, 20, 5, 0, '2026-07-01T01:00:00.000Z'),
        ('newer', 'site-a', 'A', '2026-07-01', 120, 22, 5.45, 0, '2026-07-01T02:00:00.000Z');
    `)

    v23.up(db, { dataDir: tmpDir })
    v23.up(db, { dataDir: tmpDir })

    const rows = db.prepare('SELECT id, uploaded, user_level FROM site_traffic_snapshots').all() as any[]
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, 'newer')
    assert.equal(rows[0].uploaded, 120)
    assert.equal(rows[0].user_level, null)
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'site_traffic_snapshots'").all() as Array<{ name: string }>
    assert.ok(indexes.some((item) => item.name === 'idx_site_traffic_snapshots_site_date_unique'))
    assert.ok(indexes.some((item) => item.name === 'idx_site_traffic_snapshots_site_date_desc'))
    assert.throws(() => {
      db.prepare(`INSERT INTO site_traffic_snapshots (id, site_id, site_name, date, synced_at) VALUES ('duplicate', 'site-a', 'A', '2026-07-01', '2026-07-01T03:00:00.000Z')`).run()
    })
  } finally {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('v24 creates notification configuration and log tables idempotently', () => {
  const tmpDir = path.join('/tmp', `xnz-mig-v24-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
  const dbFile = path.join(tmpDir, 'test.db')
  const db = openFreshDb(dbFile)
  try {
    v24.up(db, { dataDir: tmpDir })
    v24.up(db, { dataDir: tmpDir })
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'notification_%'").all() as Array<{ name: string }>
    assert.deepEqual(new Set(tables.map((item) => item.name)), new Set(['notification_configs', 'notification_logs']))
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notification_logs'").all() as Array<{ name: string }>
    assert.ok(indexes.some((item) => item.name === 'idx_notification_logs_created'))
    assert.ok(indexes.some((item) => item.name === 'idx_notification_logs_config_created'))
  } finally {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  }
})
