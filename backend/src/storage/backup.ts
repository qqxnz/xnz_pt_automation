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

export type BackupResult = {
  path: string
  sizeBytes: number
  fromVersion: number
}

function quoteSqlString(value: string): string {
  return value.replace(/'/g, "''")
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

export function listBackups(dataDir: string): Array<{ name: string; sizeBytes: number; mtime: string }> {
  if (!existsSync(dataDir)) return []
  return readdirSync(dataDir)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
    .map((name) => {
      const full = path.join(dataDir, name)
      const stat = statSync(full)
      return { name, sizeBytes: stat.size, mtime: stat.mtime.toISOString() }
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
}
