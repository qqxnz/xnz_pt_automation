/**
 * app_meta 表读写（key/value 元数据）
 *
 * 用于保存 schema_version、last_migration_*、last_backup_* 等元信息。
 * 与原 storage.ts 的实现保持一致。
 */

import type { DatabaseSync } from 'node:sqlite'

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

export function getMeta(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
    | { value?: string }
    | undefined
  return row?.value
}

export function deleteMeta(db: DatabaseSync, key: string): void {
  db.prepare('DELETE FROM app_meta WHERE key = ?').run(key)
}
