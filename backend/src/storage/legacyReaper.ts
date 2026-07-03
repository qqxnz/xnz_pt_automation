/**
 * 旧表（*_legacy_v*）自动清理
 *
 * 升级时把旧表保留为 _legacy_v{prev}，30 天后由本模块在启动时清理。
 * 保留日期采用表创建时刻（在迁移主流程中通过 markLegacyRetainedAt 写入 app_meta）。
 * 若没有保留日期，则用 migrated_at 兜底；都没有则不清理（防止误删）。
 */

import { getMeta, setMeta } from './_meta.js'
import type { DatabaseSync } from 'node:sqlite'

const RETAIN_DAYS = 30
const META_KEY = 'legacy_reaper_last_run'
const LEGACY_RE = /^(.+)_legacy_v(\d+)(?:_\d+)?$/

export type LegacyTableInfo = {
  tableName: string
  originalTable: string
  previousVersion: number
  retainedAt: string
  expiresAt: string
  rowCount: number
}

function listLegacyTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_legacy_v%'")
    .all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function parseLegacyName(name: string): { originalTable: string; version: number } | null {
  const match = LEGACY_RE.exec(name)
  if (!match) return null
  return { originalTable: match[1], version: Number(match[2]) }
}

function rowCount(db: DatabaseSync, table: string): number {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
    return row.n
  } catch {
    return 0
  }
}

function retainedAtFor(db: DatabaseSync, table: string): string | undefined {
  return getMeta(db, `legacy_retain_${table}`) ?? getMeta(db, 'migrated_at')
}

export function listLegacyTableInfo(db: DatabaseSync): LegacyTableInfo[] {
  return listLegacyTables(db).map((tableName) => {
    const meta = parseLegacyName(tableName)
    const retainedAt = retainedAtFor(db, tableName) ?? new Date(0).toISOString()
    const expires = new Date(retainedAt)
    expires.setDate(expires.getDate() + RETAIN_DAYS)
    return {
      tableName,
      originalTable: meta?.originalTable ?? tableName,
      previousVersion: meta?.version ?? 0,
      retainedAt,
      expiresAt: expires.toISOString(),
      rowCount: rowCount(db, tableName)
    }
  })
}

export function markLegacyRetainedAt(db: DatabaseSync, table: string, iso: string): void {
  setMeta(db, `legacy_retain_${table}`, iso)
}

export function reapLegacyTables(db: DatabaseSync, now: Date = new Date()): string[] {
  const removed: string[] = []
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - RETAIN_DAYS)

  for (const tableName of listLegacyTables(db)) {
    const retainedAt = retainedAtFor(db, tableName)
    if (!retainedAt) continue
    if (new Date(retainedAt) > cutoff) continue
    try {
      db.exec(`DROP TABLE IF EXISTS ${tableName}`)
      removed.push(tableName)
      deleteMetaSafe(db, `legacy_retain_${tableName}`)
    } catch {
      // 忽略单表删除失败
    }
  }
  setMeta(db, META_KEY, now.toISOString())
  return removed
}

function deleteMetaSafe(db: DatabaseSync, key: string): void {
  try {
    db.prepare('DELETE FROM app_meta WHERE key = ?').run(key)
  } catch {
    // ignore
  }
}

export function shouldReapToday(db: DatabaseSync, now: Date = new Date()): boolean {
  const last = getMeta(db, META_KEY)
  if (!last) return true
  try {
    return formatDay(new Date(last)) !== formatDay(now)
  } catch {
    return true
  }
}

function formatDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export { RETAIN_DAYS }
