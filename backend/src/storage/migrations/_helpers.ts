import type { DatabaseSync } from 'node:sqlite'

/**
 * SQLite 表结构迁移工具
 *
 * 约定：
 *   - 所有 helper 自动检测列/表/索引是否已存在，幂等可重入
 *   - 不抛错，仅跳过；迁移主流程通过 MigrationStepError 抛出真正的失败
 */

export function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { ok?: number } | undefined
  return Boolean(row?.ok)
}

export function indexExists(db: DatabaseSync, index: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='index' AND name=?")
    .get(index) as { ok?: number } | undefined
  return Boolean(row?.ok)
}

export function tableHasColumn(db: DatabaseSync, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((row) => row.name === column)
}

export function tableHasRows(db: DatabaseSync, table: string): boolean {
  if (!tableExists(db, table)) return false
  const row = db.prepare(`SELECT 1 AS ok FROM ${table} LIMIT 1`).get() as { ok?: number } | undefined
  return Boolean(row?.ok)
}

export function addColumnIfMissing(db: DatabaseSync, table: string, column: string, definition: string): boolean {
  if (tableHasColumn(db, table, column)) return false
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  return true
}

export function dropColumnIfExists(db: DatabaseSync, table: string, column: string): boolean {
  if (!tableHasColumn(db, table, column)) return false
  db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
  return true
}

export function createTableIfMissing(db: DatabaseSync, ddl: string): boolean {
  const match = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/i.exec(ddl)
  if (!match) throw new Error('createTableIfMissing: cannot parse table name from DDL')
  const table = match[1]
  if (tableExists(db, table)) return false
  db.exec(ddl)
  return true
}

export function createIndexIfMissing(db: DatabaseSync, ddl: string): boolean {
  const match = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF NOT EXISTS\s+(\w+)/i.exec(ddl)
  if (!match) throw new Error('createIndexIfMissing: cannot parse index name from DDL')
  const index = match[1]
  if (indexExists(db, index)) return false
  db.exec(ddl)
  return true
}

/** 把主表改名为 _legacy_v{prev}；已存在则补 .bak 后缀避免冲突 */
export function renameToLegacy(db: DatabaseSync, table: string, previousVersion: number): string {
  const legacyName = `${table}_legacy_v${previousVersion}`
  if (!tableExists(db, table)) return legacyName
  let target = legacyName
  let i = 1
  while (tableExists(db, target)) {
    target = `${legacyName}_${i++}`
  }
  db.exec(`ALTER TABLE ${table} RENAME TO ${target}`)
  return target
}

/** 把临时表升级为正式主表 */
export function promoteTable(db: DatabaseSync, tempTable: string, targetTable: string): void {
  if (!tableExists(db, tempTable)) {
    throw new Error(`promoteTable: source table ${tempTable} does not exist`)
  }
  if (tableExists(db, targetTable)) {
    throw new Error(`promoteTable: target table ${targetTable} already exists`)
  }
  db.exec(`ALTER TABLE ${tempTable} RENAME TO ${targetTable}`)
}

export function localDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function timestampForFilename(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}` +
    `-${pad(value.getHours())}${pad(value.getMinutes())}${pad(value.getSeconds())}`
  )
}
