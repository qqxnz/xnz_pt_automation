/**
 * 处理 user_version < 2 的旧版存储
 *
 * 历史上 PT Automation 使用 app_state 单行表（state_json）或 data/app-state.json
 * 文件保存全部数据。本模块在 schemaVersion=2 之前检测并导入这些数据。
 */

import type { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { unlinkSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export type LegacyPayload = Record<string, unknown>

export function legacyStateFilePath(dataDir: string): string {
  return path.join(dataDir, 'app-state.json')
}

export async function readLegacyStateFile(dataDir: string): Promise<LegacyPayload | undefined> {
  const file = legacyStateFilePath(dataDir)
  if (!existsSync(file)) return undefined
  try {
    const raw = await readFile(file, 'utf8')
    return JSON.parse(raw) as LegacyPayload
  } catch {
    return undefined
  }
}

export function readLegacyStateTable(db: DatabaseSync): LegacyPayload | undefined {
  try {
    const row = db.prepare('SELECT state_json FROM app_state WHERE id = 1').get() as
      | { state_json?: string }
      | undefined
    if (!row?.state_json) return undefined
    return JSON.parse(row.state_json) as LegacyPayload
  } catch {
    return undefined
  }
}

export function ensureLegacyStateTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL
    );
  `)
}

export function dropLegacyStateTable(db: DatabaseSync): void {
  db.exec('DROP TABLE IF EXISTS app_state')
}

export function tryRemoveLegacyStateFile(dataDir: string): void {
  const file = legacyStateFilePath(dataDir)
  if (!existsSync(file)) return
  try {
    unlinkSync(file)
  } catch {
    // 忽略删除失败
  }
}

export async function ensureDataDirs(dataDir: string, cacheDir: string, logDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  await mkdir(logDir, { recursive: true })
}
