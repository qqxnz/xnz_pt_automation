/**
 * 升级前自动备份
 *
 * 仅在 user_version < SCHEMA_VERSION 时触发；同版本启动不重复备份。
 * 使用 SQLite 原生 VACUUM INTO 保证一致性（含 WAL/SHM）。
 * 备份路径写到 app_meta.last_backup_path，system-info 暴露给前端。
 */

import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { setMeta } from './_meta.js'
import { timestampForFilename } from './migrations/_helpers.js'

const BACKUP_PREFIX = 'db-'
const BACKUP_SUFFIX = '.sqlite3'
const MAX_BACKUPS = 10
const BACKUP_FILENAME_RE = /^db-[A-Za-z0-9._-]+\.sqlite3$/

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
  if (!existsSync(dataDir)) return null

  const ts = timestampForFilename(new Date())
  const filename = `${BACKUP_PREFIX}${ts}-pre-v${fromVersion}${BACKUP_SUFFIX}`
  const backupPath = path.join(dataDir, filename)

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
  if (!existsSync(dataDir)) return []
  const files = readdirSync(dataDir)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
    .map((name) => ({
      name,
      full: path.join(dataDir, name),
      mtime: statSync(path.join(dataDir, name)).mtimeMs
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
  if (!existsSync(dataDir)) return []
  return readdirSync(dataDir)
    .filter((name) => BACKUP_FILENAME_RE.test(name) && !name.includes('..'))
    .map((name) => {
      const full = path.join(dataDir, name)
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
  if (!existsSync(dataDir)) {
    throw new Error('数据目录不存在')
  }
  const ts = timestampForFilename(new Date())
  const tag = options.fromVersion !== undefined ? `pre-v${options.fromVersion}` : `pre-restore`
  const filename = `${BACKUP_PREFIX}${ts}-${tag}${BACKUP_SUFFIX}`
  const backupPath = path.join(dataDir, filename)
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
  const full = path.join(dataDir, name)
  const resolved = path.resolve(full)
  const resolvedDir = path.resolve(dataDir)
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
  const full = path.join(dataDir, name)
  const resolved = path.resolve(full)
  const resolvedDir = path.resolve(dataDir)
  if (!resolved.startsWith(resolvedDir + path.sep)) {
    throw new Error('INVALID_BACKUP_NAME')
  }
  return resolved
}

export { MAX_BACKUPS, BACKUP_PREFIX, BACKUP_SUFFIX, BACKUP_FILENAME_RE }
