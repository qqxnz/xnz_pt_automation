/**
 * 应用全局启动状态机
 *
 * 状态流转：
 *   STARTING          → 容器刚启动，storage 尚未初始化
 *   VERSION_CHECK     → 正在读 user_version 与 SCHEMA_VERSION
 *   MIGRATING         → 正在跑迁移，HEALTHCHECK_ONLY 模式
 *   READY             → 启动完成，Scheduler 运行中
 *   MIGRATION_FAILED  → 迁移失败，待重启或人工介入
 *   DOWNGRADE_REJECTED→ 数据库版本高于当前镜像版本
 */

export type AppStatus =
  | 'STARTING'
  | 'VERSION_CHECK'
  | 'MIGRATING'
  | 'READY'
  | 'MIGRATION_FAILED'
  | 'DOWNGRADE_REJECTED'

export type MigrationProgress = {
  from: number
  to: number
  currentStep: number
  totalSteps: number
  currentTable?: string
  startedAt: string
  lastError?: string
  lastBackupPath?: string
  legacyTables: string[]
}

export type AppStateSnapshot = {
  status: AppStatus
  schemaVersion: number
  dbVersion: number
  startedAt: string
  migration?: MigrationProgress
  health?: {
    tablesChecked: number
    repairedColumns: number
    repairedTables: number
    issues: Array<{ table: string; kind: string; detail: string }>
  }
}

type Listener = (state: AppStateSnapshot) => void

let current: AppStateSnapshot = {
  status: 'STARTING',
  schemaVersion: 0,
  dbVersion: 0,
  startedAt: new Date().toISOString(),
  migration: undefined,
  health: undefined
}

const listeners = new Set<Listener>()

export function getAppState(): AppStateSnapshot {
  return current
}

export function setStatus(status: AppStatus, patch: Partial<AppStateSnapshot> = {}): void {
  current = { ...current, status, ...patch }
  for (const fn of listeners) fn(current)
}

export function setSchemaVersion(version: number): void {
  current = { ...current, schemaVersion: version }
  for (const fn of listeners) fn(current)
}

export function setDbVersion(version: number): void {
  current = { ...current, dbVersion: version }
  for (const fn of listeners) fn(current)
}

export function updateMigration(patch: Partial<MigrationProgress>): void {
  current = {
    ...current,
    migration: { ...(current.migration ?? defaultMigration()), ...patch } as MigrationProgress
  }
  for (const fn of listeners) fn(current)
}

export function updateHealth(patch: NonNullable<AppStateSnapshot['health']>): void {
  current = { ...current, health: patch }
  for (const fn of listeners) fn(current)
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function resetForTest(): void {
  current = {
    status: 'STARTING',
    schemaVersion: 0,
    dbVersion: 0,
    startedAt: new Date().toISOString(),
    migration: undefined,
    health: undefined
  }
  listeners.clear()
}

function defaultMigration(): MigrationProgress {
  return {
    from: 0,
    to: 0,
    currentStep: 0,
    totalSteps: 0,
    currentTable: undefined,
    startedAt: new Date().toISOString(),
    lastError: undefined,
    lastBackupPath: undefined,
    legacyTables: []
  }
}

/** 计算升级百分比（0-100） */
export function migrationPercent(state: AppStateSnapshot): number {
  if (!state.migration || state.migration.totalSteps === 0) return 0
  return Math.min(100, Math.round((state.migration.currentStep / state.migration.totalSteps) * 100))
}
