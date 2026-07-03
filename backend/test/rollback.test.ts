import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { runMigrations, SCHEMA_VERSION, isMigrationStepError, MigrationStepError } from '../src/storage/migrations/index.js'
import { backupDatabaseIfNeeded } from '../src/storage/backup.js'
import { getMeta, setMeta } from '../src/storage/_meta.js'

function openFreshDb(file: string): DatabaseSync {
  rmSync(file, { force: true })
  rmSync(file + '-wal', { force: true })
  rmSync(file + '-shm', { force: true })
  return new DatabaseSync(file)
}

test('failed migration throws MigrationStepError and leaves user_version unchanged', async () => {
  const dataDir = path.join('/tmp', `xnz-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  const dbFile = path.join(dataDir, 'app.db')
  const db = openFreshDb(dbFile)
  try {
    db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const { inspectDatabaseHealth } = await import('../src/storage/health.js')
    inspectDatabaseHealth(db)

    // 删掉 tasks 表让 v3 的 addColumnIfMissing 必然失败
    db.exec('DROP TABLE tasks')
    db.exec('PRAGMA user_version = 2')

    let caught: unknown = null
    try {
      runMigrations(db, 2, { dataDir })
    } catch (err) {
      caught = err
    }
    assert.ok(caught, 'expected migration to fail when tasks table is missing')
    assert.ok(isMigrationStepError(caught), 'expected MigrationStepError type')
    const finalVer = db.prepare('PRAGMA user_version').get() as { user_version: number }
    assert.equal(finalVer.user_version, 2, 'user_version should remain 2 after failed migration (rollback)')
  } finally {
    db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('backupDatabaseIfNeeded creates a backup that can be used to recover', () => {
  const dataDir = path.join('/tmp', `xnz-bk-rec-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  const dbFile = path.join(dataDir, 'app.db')
  const db = openFreshDb(dbFile)
  try {
    db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)')
    db.prepare('INSERT INTO t VALUES (?)').run('original')
    const result = backupDatabaseIfNeeded(db, dataDir, 10, 21)
    assert.ok(result)
    assert.ok(existsSync(result!.path))
    // 在备份后插入新数据
    db.prepare('INSERT INTO t VALUES (?)').run('after-backup')
    // 验证备份文件是只读的旧数据
    const recoverDb = new DatabaseSync(result!.path)
    try {
      const rows = recoverDb.prepare('SELECT id FROM t ORDER BY id').all() as Array<{ id: string }>
      assert.deepEqual(rows.map((r) => r.id), ['original'])
    } finally {
      recoverDb.close()
    }
  } finally {
    db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
