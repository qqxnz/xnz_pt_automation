/**
 * 升级前自动备份
 *
 * 仅在 user_version < SCHEMA_VERSION 时触发；同版本启动不重复备份。
 * 使用 SQLite 原生 VACUUM INTO 保证一致性（含 WAL/SHM）。
 * 备份路径写到 app_meta.last_backup_path，system-info 暴露给前端。
 *
 * 两类备份分开存放：
 *   - 迁移备份（backupDatabaseIfNeeded）→ data/cache/
 *   - 手动备份（createManualBackup 等）→ data/backup/
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { copyFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setMeta } from './_meta.js'
import { timestampForFilename } from './migrations/_helpers.js'

const BACKUP_PREFIX = 'db-'
const BACKUP_SUFFIX = '.sqlite3'
const MAX_BACKUPS = 10
const BACKUP_FILENAME_RE = /^db-[A-Za-z0-9._-]+\.sqlite3$/

function ensureDir(dir: string): string {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getMigrationBackupDir(dataDir: string): string {
  return ensureDir(path.join(dataDir, 'cache'))
}

function getManualBackupDir(dataDir: string): string {
  return ensureDir(path.join(dataDir, 'backup'))
}

export type BackupResult = {
  path: string
  sizeBytes: number
  fromVersion: number
}

export type BackupItem = {
  name: string
  sizeBytes: number
  mtime: string
}

function quoteSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

export function nameLooksSafe(name: unknown): name is string {
  return typeof name === 'string' && BACKUP_FILENAME_RE.test(name) && !name.includes('..')
}

export function backupDatabaseIfNeeded(
  db: DatabaseSync,
  dataDir: string,
  fromVersion: number,
  schemaVersion: number
): BackupResult | null {
  if (fromVersion >= schemaVersion) return null
  const backupDir = getMigrationBackupDir(dataDir)

  const ts = timestampForFilename(new Date())
  const filename = `${BACKUP_PREFIX}${ts}-pre-v${fromVersion}${BACKUP_SUFFIX}`
  const backupPath = path.join(backupDir, filename)

  try {
    db.exec(`VACUUM INTO '${quoteSqlString(backupPath)}'`)
  } catch (error) {
    throw new Error(
      `backupDatabaseIfNeeded：VACUUM INTO 备份失败：${error instanceof Error ? error.message : String(error)}`
    )
  }

  const sizeBytes = statSync(backupPath).size
  setMeta(db, 'last_backup_path', backupPath)
  setMeta(db, 'last_backup_at', new Date().toISOString())

  pruneOldBackups(dataDir, MAX_BACKUPS)

  return { path: backupPath, sizeBytes, fromVersion }
}

export function pruneOldBackups(dataDir: string, keep: number = MAX_BACKUPS): string[] {
  const backupDir = getMigrationBackupDir(dataDir)
  const files = readdirSync(backupDir)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
    .map((name) => ({
      name,
      full: path.join(backupDir, name),
      mtime: statSync(path.join(backupDir, name)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime)
  const removed: string[] = []
  for (const f of files.slice(keep)) {
    try {
      unlinkSync(f.full)
      removed.push(f.name)
    } catch {
      // 忽略单文件删除失败
    }
  }
  return removed
}

export function listBackups(dataDir: string): BackupItem[] {
  const backupDir = getManualBackupDir(dataDir)
  return readdirSync(backupDir)
    .filter((name) => BACKUP_FILENAME_RE.test(name) && !name.includes('..'))
    .map((name) => {
      const full = path.join(backupDir, name)
      const stat = statSync(full)
      return { name, sizeBytes: stat.size, mtime: stat.mtime.toISOString() }
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
}

export function createManualBackup(
  db: DatabaseSync,
  dataDir: string,
  options: { fromVersion?: number } = {}
): BackupResult {
  const backupDir = getManualBackupDir(dataDir)
  const ts = timestampForFilename(new Date())
  const tag = options.fromVersion !== undefined ? `pre-v${options.fromVersion}` : `pre-restore`
  const filename = `${BACKUP_PREFIX}${ts}-${tag}${BACKUP_SUFFIX}`
  const backupPath = path.join(backupDir, filename)
  try {
    db.exec(`VACUUM INTO '${quoteSqlString(backupPath)}'`)
  } catch (error) {
    throw new Error(
      `createManualBackup：VACUUM INTO 备份失败：${error instanceof Error ? error.message : String(error)}`
    )
  }
  const sizeBytes = statSync(backupPath).size
  setMeta(db, 'last_backup_path', backupPath)
  setMeta(db, 'last_backup_at', new Date().toISOString())
  return { path: backupPath, sizeBytes, fromVersion: options.fromVersion ?? -1 }
}

export function deleteBackup(dataDir: string, name: string): void {
  if (!nameLooksSafe(name)) {
    throw new Error('BACKUP_NOT_FOUND')
  }
  const backupDir = getManualBackupDir(dataDir)
  const full = path.join(backupDir, name)
  const resolved = path.resolve(full)
  const resolvedDir = path.resolve(backupDir)
  if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) {
    throw new Error('BACKUP_NOT_FOUND')
  }
  if (!existsSync(full)) {
    throw new Error('BACKUP_NOT_FOUND')
  }
  try {
    unlinkSync(full)
  } catch {
    throw new Error('BACKUP_NOT_FOUND')
  }
}

export function resolveBackupPath(dataDir: string, name: string): string {
  const backupDir = getManualBackupDir(dataDir)
  const full = path.join(backupDir, name)
  const resolved = path.resolve(full)
  const resolvedDir = path.resolve(backupDir)
  if (!resolved.startsWith(resolvedDir + path.sep)) {
    throw new Error('INVALID_BACKUP_NAME')
  }
  return resolved
}

function sqliteIntegrityCheck(file: string): string {
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(file, { readOnly: true })
    const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
    return row?.integrity_check ?? ''
  } finally {
    db?.close()
  }
}

export function assertValidSqliteBackup(file: string): void {
  if (!existsSync(file)) {
    throw new Error('备份文件不存在')
  }
  let result: string
  try {
    result = sqliteIntegrityCheck(file)
  } catch (error) {
    throw new Error(`备份文件无法打开或不是有效 SQLite：${error instanceof Error ? error.message : String(error)}`)
  }
  if (result !== 'ok') {
    throw new Error(`备份完整性检查失败：${result || 'unknown'}`)
  }
}

async function unlinkIfExists(file: string): Promise<void> {
  try {
    await unlink(file)
  } catch {
    // 文件不存在或已被清理时忽略
  }
}

async function removeSqliteSidecars(dbFile: string): Promise<void> {
  await Promise.all([
    unlinkIfExists(`${dbFile}-wal`),
    unlinkIfExists(`${dbFile}-shm`)
  ])
}

export async function replaceDatabaseWithBackup(options: {
  currentDb?: DatabaseSync
  backupPath: string
  dbFile: string
  onClosed?: () => void
}): Promise<void> {
  const { currentDb, backupPath, dbFile, onClosed } = options
  assertValidSqliteBackup(backupPath)

  const tmpFile = path.join(
    path.dirname(dbFile),
    `.restore-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  )
  let renamed = false

  try {
    await copyFile(backupPath, tmpFile)
    assertValidSqliteBackup(tmpFile)

    try {
      currentDb?.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      // checkpoint 失败不阻止恢复；关闭连接后会清理 sidecar
    }
    try {
      currentDb?.close()
    } finally {
      onClosed?.()
    }

    await removeSqliteSidecars(dbFile)
    await rename(tmpFile, dbFile)
    renamed = true
    await removeSqliteSidecars(dbFile)
  } finally {
    if (!renamed) {
      await unlinkIfExists(tmpFile)
    }
  }
}

export { MAX_BACKUPS, BACKUP_PREFIX, BACKUP_SUFFIX, BACKUP_FILENAME_RE }
