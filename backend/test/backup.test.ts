import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdirSync, rmSync, existsSync, readdirSync, writeFileSync, utimesSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { backupDatabaseIfNeeded, listBackups, pruneOldBackups } from '../src/storage/backup.js'
import { setMeta, getMeta } from '../src/storage/_meta.js'
import { createTableIfMissing } from '../src/storage/migrations/_helpers.js'

function openFreshDb(file: string): DatabaseSync {
  rmSync(file, { force: true })
  rmSync(file + '-wal', { force: true })
  rmSync(file + '-shm', { force: true })
  return new DatabaseSync(file)
}

test('backup creates a backup file when upgrading', () => {
  const dataDir = path.join('/tmp', `xnz-bk-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  const dbFile = path.join(dataDir, 'app.db')
  const db = openFreshDb(dbFile)
  try {
    createTableIfMissing(db, `CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER)`)
    db.prepare('INSERT INTO t VALUES (?, ?)').run('a', 1)
    const result = backupDatabaseIfNeeded(db, dataDir, 15, 21)
    assert.ok(result)
    assert.equal(result!.fromVersion, 15)
    assert.ok(existsSync(result!.path))
    assert.equal(getMeta(db, 'last_backup_path'), result!.path)
    assert.ok(getMeta(db, 'last_backup_at'))
  } finally {
    db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('backup is skipped when fromVersion >= schemaVersion', () => {
  const dataDir = path.join('/tmp', `xnz-bk-skip-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  const dbFile = path.join(dataDir, 'app.db')
  const db = openFreshDb(dbFile)
  try {
    createTableIfMissing(db, `CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    const result = backupDatabaseIfNeeded(db, dataDir, 21, 21)
    assert.equal(result, null)
  } finally {
    db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('pruneOldBackups keeps only 10 most recent', () => {
  const dataDir = path.join('/tmp', `xnz-bk-prune-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  try {
    for (let i = 0; i < 12; i++) {
      const f = path.join(dataDir, `db-old-${i}.sqlite3`)
      writeFileSync(f, 'x')
      const future = new Date(Date.now() + i * 1000)
      utimesSync(f, future, future)
    }
    const removed = pruneOldBackups(dataDir, 10)
    assert.equal(removed.length, 2)
    const remaining = readdirSync(dataDir).filter((n) => n.endsWith('.sqlite3'))
    assert.equal(remaining.length, 10)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('listBackups returns newest-first', () => {
  const dataDir = path.join('/tmp', `xnz-bk-list-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  try {
    for (let i = 0; i < 3; i++) {
      const f = path.join(dataDir, `db-test-${i}.sqlite3`)
      writeFileSync(f, 'x')
      const future = new Date(Date.now() + i * 1000)
      utimesSync(f, future, future)
    }
    const list = listBackups(dataDir)
    assert.equal(list.length, 3)
    assert.ok(new Date(list[0].mtime).getTime() > new Date(list[2].mtime).getTime())
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
