/**
 * 数据库迁移调度
 *
 * 迁移主流程（ensureStorage）会做：
 *   1) readSchemaVersion
 *   2) backupDatabaseIfNeeded
 *   3) runMigrations(db, from, SCHEMA_VERSION, ctx)  // 调本文件
 *   4) inspectDatabaseHealth
 *
 * 本文件对外只暴露 SCHEMA_VERSION + runMigrations；具体每个版本的逻辑在 ./vN.ts
 */

import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { v3 } from './v3.js'
import { v4 } from './v4.js'
import { v5 } from './v5.js'
import { v6 } from './v6.js'
import { v7 } from './v7.js'
import { v8 } from './v8.js'
import { v9 } from './v9.js'
import { v10 } from './v10.js'
import { v11 } from './v11.js'
import { v12 } from './v12.js'
import { v13 } from './v13.js'
import { v14 } from './v14.js'
import { v15 } from './v15.js'
import { v16 } from './v16.js'
import { v17 } from './v17.js'
import { v18 } from './v18.js'
import { v19 } from './v19.js'
import { v21 } from './v21.js'

export type MigrationContext = {
  dataDir: string
  onProgress?: (state: { step: number; total: number; version: number; description: string }) => void
}

export type Migration = {
  version: number
  description: string
  up: (db: DatabaseSync, ctx: MigrationContext) => void
}

/**
 * 当前镜像对应的最新 schema 版本
 * 新增 v{N} 时务必同步更新此常量 + 下方数组 + test fixture
 */
export const SCHEMA_VERSION = 21

export const MIGRATIONS: Migration[] = [
  v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v21
]

export type MigrationStepError = {
  type: 'MigrationStepError'
  version: number
  fromVersion: number
  cause: string
  stack?: string
}

export class SchemaTooNewError extends Error {
  readonly type = 'SchemaTooNewError'
  readonly dbVersion: number
  readonly imageVersion: number
  constructor(dbVersion: number, imageVersion: number) {
    super(
      `数据库版本 v${dbVersion} 高于当前镜像版本 v${imageVersion}；请使用 ≥ v${dbVersion} 的镜像`
    )
    this.dbVersion = dbVersion
    this.imageVersion = imageVersion
  }
}

export function readSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return Number(row.user_version ?? 0)
}

export function setSchemaVersion(db: DatabaseSync, version: number): void {
  db.exec(`PRAGMA user_version = ${version}`)
}

export type RunMigrationsResult = {
  fromVersion: number
  toVersion: number
  applied: number[]
  durationMs: number
}

export function runMigrations(
  db: DatabaseSync,
  fromVersion: number,
  ctx: MigrationContext,
  toVersion: number = SCHEMA_VERSION
): RunMigrationsResult {
  const startedAt = Date.now()
  if (fromVersion > toVersion) {
    throw new SchemaTooNewError(fromVersion, toVersion)
  }
  const applicable = MIGRATIONS.filter((m) => m.version > fromVersion && m.version <= toVersion)
  const applied: number[] = []
  try {
    db.exec('BEGIN IMMEDIATE')
    applicable.forEach((m, idx) => {
      ctx.onProgress?.({ step: idx + 1, total: applicable.length, version: m.version, description: m.description })
      try {
        m.up(db, ctx)
        applied.push(m.version)
      } catch (error) {
        const stepError: MigrationStepError = {
          type: 'MigrationStepError',
          version: m.version,
          fromVersion,
          cause: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }
        throw stepError
      }
    })
    setSchemaVersion(db, toVersion)
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // ignore
    }
    throw error
  }
  return {
    fromVersion,
    toVersion,
    applied,
    durationMs: Date.now() - startedAt
  }
}

export function isMigrationStepError(error: unknown): error is MigrationStepError {
  return Boolean(error && typeof error === 'object' && (error as { type?: string }).type === 'MigrationStepError')
}

export function isSchemaTooNewError(error: unknown): error is SchemaTooNewError {
  return Boolean(error && typeof error === 'object' && (error as { type?: string }).type === 'SchemaTooNewError')
}

export { path }
