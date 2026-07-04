import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdirSync, rmSync, existsSync, readdirSync, writeFileSync, utimesSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  backupDatabaseIfNeeded,
  createManualBackup,
  deleteBackup,
  listBackups,
  nameLooksSafe,
  pruneOldBackups,
  replaceDatabaseWithBackup,
  resolveBackupPath
} from '../src/storage/backup.js'
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
  const cacheDir = path.join(dataDir, 'cache')
  mkdirSync(cacheDir, { recursive: true })
  try {
    for (let i = 0; i < 12; i++) {
      const f = path.join(cacheDir, `db-old-${i}.sqlite3`)
      writeFileSync(f, 'x')
      const future = new Date(Date.now() + i * 1000)
      utimesSync(f, future, future)
    }
    const removed = pruneOldBackups(dataDir, 10)
    assert.equal(removed.length, 2)
    const remaining = readdirSync(cacheDir).filter((n) => n.endsWith('.sqlite3'))
    assert.equal(remaining.length, 10)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('listBackups returns newest-first', () => {
  const dataDir = path.join('/tmp', `xnz-bk-list-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  const backupDir = path.join(dataDir, 'backup')
  mkdirSync(backupDir, { recursive: true })
  try {
    for (let i = 0; i < 3; i++) {
      const f = path.join(backupDir, `db-test-${i}.sqlite3`)
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

test('nameLooksSafe accepts valid filenames and rejects traversal', () => {
  assert.equal(nameLooksSafe('db-20260101-1234-pre-v21.sqlite3'), true)
  assert.equal(nameLooksSafe('db-test.sqlite3'), true)
  assert.equal(nameLooksSafe('../etc/passwd'), false)
  assert.equal(nameLooksSafe('../../db-evil.sqlite3'), false)
  assert.equal(nameLooksSafe('db-with-/-slash.sqlite3'), false)
  assert.equal(nameLooksSafe('notadb.sqlite3'), false)
  assert.equal(nameLooksSafe(undefined), false)
})

test('resolveBackupPath rejects names that escape dataDir', () => {
  const dataDir = path.join('/tmp', `xnz-bk-resolve-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  const backupDir = path.join(dataDir, 'backup')
  mkdirSync(backupDir, { recursive: true })
  try {
    const safe = resolveBackupPath(dataDir, 'db-ok.sqlite3')
    assert.equal(safe, path.join(backupDir, 'db-ok.sqlite3'))
    assert.throws(() => resolveBackupPath(dataDir, '../escape.sqlite3'))
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('createManualBackup writes a backup file', () => {
  const dataDir = path.join('/tmp', `xnz-bk-manual-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  const dbFile = path.join(dataDir, 'app.db')
  const db = openFreshDb(dbFile)
  try {
    createTableIfMissing(db, `CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER)`)
    db.prepare('INSERT INTO t VALUES (?, ?)').run('a', 1)
    const result = createManualBackup(db, dataDir)
    assert.ok(existsSync(result.path))
    assert.equal(getMeta(db, 'last_backup_path'), result.path)
  } finally {
    db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('deleteBackup removes file and rejects missing', () => {
  const dataDir = path.join('/tmp', `xnz-bk-del-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  const backupDir = path.join(dataDir, 'backup')
  mkdirSync(backupDir, { recursive: true })
  try {
    const f = path.join(backupDir, 'db-to-delete.sqlite3')
    writeFileSync(f, 'x')
    assert.ok(existsSync(f))
    deleteBackup(dataDir, 'db-to-delete.sqlite3')
    assert.equal(existsSync(f), false)
    assert.throws(() => deleteBackup(dataDir, 'db-to-delete.sqlite3'), /BACKUP_NOT_FOUND/)
    assert.throws(() => deleteBackup(dataDir, '../escape.sqlite3'), /BACKUP_NOT_FOUND/)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('listBackups ignores non-matching filenames', () => {
  const dataDir = path.join('/tmp', `xnz-bk-filter-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  const backupDir = path.join(dataDir, 'backup')
  mkdirSync(backupDir, { recursive: true })
  try {
    writeFileSync(path.join(backupDir, 'db-good-1.sqlite3'), 'x')
    writeFileSync(path.join(backupDir, 'db-good-2.sqlite3'), 'x')
    writeFileSync(path.join(backupDir, 'something-else.txt'), 'x')
    writeFileSync(path.join(backupDir, 'db-bad.exe'), 'x')
    const list = listBackups(dataDir)
    assert.equal(list.length, 2)
    for (const item of list) {
      assert.ok(item.name.startsWith('db-'))
      assert.ok(item.name.endsWith('.sqlite3'))
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('replaceDatabaseWithBackup restores a valid sqlite backup and removes WAL sidecars', async () => {
  const dataDir = path.join('/tmp', `xnz-bk-restore-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  const dbFile = path.join(dataDir, 'app.db')
  const backupFile = path.join(dataDir, 'backup.sqlite3')
  const db = openFreshDb(dbFile)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    createTableIfMissing(db, `CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT NOT NULL)`)
    db.prepare('INSERT INTO t VALUES (?, ?)').run('a', 'current')
    const safetyBackup = createManualBackup(db, dataDir)
    assert.ok(existsSync(safetyBackup.path))

    const backup = openFreshDb(backupFile)
    backup.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT NOT NULL)`)
    backup.prepare('INSERT INTO t VALUES (?, ?)').run('a', 'restored')
    backup.close()

    writeFileSync(dbFile + '-wal', 'stale wal')
    writeFileSync(dbFile + '-shm', 'stale shm')

    await replaceDatabaseWithBackup({ currentDb: db, backupPath: backupFile, dbFile })

    assert.equal(existsSync(dbFile + '-wal'), false)
    assert.equal(existsSync(dbFile + '-shm'), false)

    const restored = new DatabaseSync(dbFile)
    try {
      const integrity = restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
      assert.equal(integrity.integrity_check, 'ok')
      const row = restored.prepare('SELECT v FROM t WHERE id = ?').get('a') as { v: string }
      assert.equal(row.v, 'restored')
    } finally {
      restored.close()
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('replaceDatabaseWithBackup rejects malformed backups without overwriting current database', async () => {
  const dataDir = path.join('/tmp', `xnz-bk-bad-restore-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dataDir, { recursive: true })
  const dbFile = path.join(dataDir, 'app.db')
  const badBackupFile = path.join(dataDir, 'bad.sqlite3')
  const db = openFreshDb(dbFile)
  try {
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT NOT NULL)`)
    db.prepare('INSERT INTO t VALUES (?, ?)').run('a', 'current')
    writeFileSync(badBackupFile, 'not a sqlite database')

    await assert.rejects(
      () => replaceDatabaseWithBackup({ currentDb: db, backupPath: badBackupFile, dbFile }),
      /备份文件无法打开|备份完整性检查失败/
    )

    const row = db.prepare('SELECT v FROM t WHERE id = ?').get('a') as { v: string }
    assert.equal(row.v, 'current')
  } finally {
    db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
