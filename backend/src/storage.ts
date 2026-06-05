import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { createPasswordHash } from './utils/password.js'

export type UserRecord = {
  id: string
  username: string
  passwordHash: string
  passwordChangedAt?: string
  lastLoginAt?: string
}

export type OperationLogRecord = {
  id: string
  type: 'OPERATION'
  action: string
  message: string
  actorId?: string
  actorName?: string
  ip?: string
  userAgent?: string
  status: 'SUCCESS' | 'FAILED'
  createdAt: string
}

export type TaskLogRecord = {
  id: string
  type: 'TASK'
  taskId?: string
  taskName: string
  runMode?: 'AUTO' | 'MANUAL_RUN'
  message: string
  status: 'SUCCESS' | 'FAILED' | 'RUNNING'
  startedAt?: string
  finishedAt?: string
  fetchedCount?: number
  matchedCount?: number
  skippedExistingCount?: number
  pushedCount?: number
  pushFailedCount?: number
  summary?: string
  errorMessage?: string
  fetchErrorMessage?: string
  pushErrorMessages?: string[]
  failureDetails?: string[]
  createdAt: string
}

export type TaskRecord = {
  id: string
  name: string
  siteId: string
  downloaderId: string
  autoRunEnabled: boolean
  autoRunStartedAt?: string
  nextRunAt?: string
  intervalMinutes: number
  freeOnly: boolean
  autoPush: boolean
  discountTypes: Array<'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'>
  seederCondition?: 'GT' | 'EQ' | 'LT'
  seederCount?: number
  sizeCondition?: 'GT' | 'EQ' | 'LT'
  sizeMb?: number
  expiringSoonMinutes?: number
  savePathOverride?: string
  categoryOverride?: string
  tagsOverride?: string[]
  running: boolean
  lastRunMode?: 'AUTO' | 'MANUAL_RUN'
  lastStartedAt?: string
  lastFinishedAt?: string
  lastStatus?: 'SUCCESS' | 'FAILED'
  lastSummary?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

const defaultTaskDiscountTypes: TaskRecord['discountTypes'] = ['FREE', 'TWO_X_FREE']

export type TorrentRecord = {
  id: string
  siteId: string
  siteName: string
  torrentId?: string
  title: string
  size: number
  discountType: 'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'
  isFreeNow: boolean
  currentState: 'NEW' | 'FREE_NOW' | 'EXPIRING_SOON' | 'EXPIRED' | 'PUSHED' | 'PUSH_FAILED' | 'DOWNLOADER_DELETED'
  freeEndAt?: string
  seeders?: number
  leechers?: number
  pushStatus: 'NEW' | 'PUSHED' | 'PUSH_FAILED' | 'DELETED'
  linkStatus: 'SAVED' | 'MISSING' | 'INVALID'
  detailUrl?: string
  downloaderId?: string
  downloaderName?: string
  downloaderType?: 'QBITTORRENT'
  downloaderState?: string
  torrentHash?: string
  downloadProgress?: number
  downloadState?: string
  ratio?: number
  uploadSpeed?: number
  downloadSpeed?: number
  uploaded?: number
  downloaded?: number
  downloadStatsSyncedAt?: string
  sourceTaskId?: string
  sourceTaskName?: string
  sourceRunMode: 'AUTO' | 'MANUAL_RUN'
  errorMessage?: string
  firstSeenAt: string
  lastSeenAt: string
  pushedAt?: string
  downloadUrlHash?: string
  downloadUrl?: string
}

export type ProxyRecord = {
  id: string
  name: string
  enabled: boolean
  type: 'HTTP' | 'HTTPS' | 'SOCKS5'
  host: string
  port: number
  username?: string
  password?: string
  lastTestStatus?: 'UNKNOWN' | 'ONLINE' | 'OFFLINE'
  lastTestedAt?: string
}

export type SiteRecord = {
  id: string
  domain: string
  enabled: boolean
  apiKey?: string
  cookie?: string
  userAgent?: string
  proxyId?: string
  connectivityStatus: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  currentCredential?: 'API_KEY' | 'COOKIE'
  userLevel?: string
  ratio?: number
  ratioInfinite?: boolean
  uploaded?: number
  downloaded?: number
  trafficSyncedAt?: string
  lastConnectedAt?: string
  lastConnectError?: string
  createdAt: string
  updatedAt: string
}

export type SiteTrafficSnapshotRecord = {
  id: string
  siteId: string
  siteName: string
  date: string
  uploaded?: number
  downloaded?: number
  ratio?: number
  ratioInfinite?: boolean
  syncedAt: string
}

export type SystemSettings = {
  sessionTtlHours: number
  operationLogRetentionDays: number
  taskLogRetentionDays: number
  torrentRetentionDays: number
  requestTimeoutMs: number
  proxyTestUrl: string
  maxConcurrentTasks: number
  defaultUserAgent: string
}

export type DownloaderRecord = {
  id: string
  name: string
  type: 'QBITTORRENT'
  enabled: boolean
  host: string
  username?: string
  password?: string
  savePath?: string
  status: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  statusMessage?: string
  lastTestedAt?: string
  lastSyncedAt?: string
  createdAt: string
  updatedAt: string
}

type AppState = {
  users: UserRecord[]
  operationLogs: OperationLogRecord[]
  taskLogs: TaskLogRecord[]
  sites: SiteRecord[]
  proxies: ProxyRecord[]
  downloaders: DownloaderRecord[]
  tasks: TaskRecord[]
  torrents: TorrentRecord[]
  siteTrafficSnapshots: SiteTrafficSnapshotRecord[]
  systemSettings: SystemSettings
  systemSettingsUpdatedAt?: string
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data')
const dbFile = path.join(dataDir, 'app.db')
const legacyStateFile = path.join(dataDir, 'app-state.json')

export const storagePaths = {
  root,
  dataDir,
  dbFile,
  legacyStateFile,
  logDir: path.join(dataDir, 'logs'),
  cacheDir: path.join(dataDir, 'cache')
}

export const defaultSystemSettings: SystemSettings = {
  sessionTtlHours: 168,
  operationLogRetentionDays: 180,
  taskLogRetentionDays: 60,
  torrentRetentionDays: 365,
  requestTimeoutMs: 15000,
  proxyTestUrl: 'https://www.gstatic.com/generate_204',
  maxConcurrentTasks: 2,
  defaultUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

async function initialState(): Promise<AppState> {
  return {
    users: [
      {
        id: 'admin',
        username: 'admin',
        passwordHash: await createPasswordHash(process.env.DEFAULT_ADMIN_PASSWORD ?? '123456')
      }
    ],
    operationLogs: [],
    taskLogs: [],
    sites: [],
    proxies: [],
    downloaders: [],
    tasks: [],
    torrents: [],
    siteTrafficSnapshots: [],
    systemSettings: defaultSystemSettings
  }
}

function normalizeState(state: Partial<AppState>): AppState {
  const systemSettings = {
    ...defaultSystemSettings,
    ...(state.systemSettings ?? {})
  }
  const tasks = (state.tasks ?? [])
    .filter((task) => typeof task.name === 'string')
    .map((task) => {
      const discountTypes = task.discountTypes ?? defaultTaskDiscountTypes
      const normalizedDiscountTypes: TaskRecord['discountTypes'] =
        task.freeOnly === false && !discountTypes.includes('NORMAL') ? [...discountTypes, 'NORMAL'] : discountTypes
      const sizeCondition = ['GT', 'EQ', 'LT'].includes(task.sizeCondition ?? '') ? task.sizeCondition : undefined
      return {
        ...task,
        discountTypes: normalizedDiscountTypes,
        sizeCondition,
        sizeMb: sizeCondition && Number.isFinite(task.sizeMb) && Number(task.sizeMb) >= 0 ? Number(task.sizeMb) : undefined
      }
    })

  return {
    users: state.users ?? [],
    operationLogs: state.operationLogs ?? [],
    taskLogs: state.taskLogs ?? [],
    sites: (state.sites ?? []).filter((site) => typeof site.domain === 'string'),
    proxies: state.proxies ?? [],
    downloaders: (state.downloaders ?? []).filter((downloader) => typeof downloader.name === 'string'),
    tasks,
    torrents: (state.torrents ?? []).filter((torrent) => typeof torrent.title === 'string'),
    siteTrafficSnapshots: (state.siteTrafficSnapshots ?? []).filter((snapshot) => typeof snapshot.siteId === 'string' && typeof snapshot.date === 'string'),
    systemSettings,
    systemSettingsUpdatedAt: state.systemSettingsUpdatedAt
  }
}

let database: DatabaseSync | undefined

function openDatabase() {
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(storagePaths.cacheDir, { recursive: true })

  if (database) return database

  database = new DatabaseSync(dbFile)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    PRAGMA user_version = 1;
  `)
  return database
}

function readDbState(db: DatabaseSync): Partial<AppState> | undefined {
  const row = db.prepare('SELECT state_json FROM app_state WHERE id = 1').get() as { state_json?: string } | undefined
  if (!row?.state_json) return undefined
  return JSON.parse(row.state_json) as Partial<AppState>
}

function setMeta(db: DatabaseSync, key: string, value: string) {
  db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

function writeDbState(db: DatabaseSync, state: AppState) {
  const updatedAt = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      'INSERT INTO app_state (id, state_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at'
    ).run(JSON.stringify(state), updatedAt)
    setMeta(db, 'last_migration_status', 'SUCCESS')
    setMeta(db, 'last_write_at', updatedAt)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

async function ensureState() {
  await mkdir(dataDir, { recursive: true })
  await mkdir(storagePaths.cacheDir, { recursive: true })
  const db = openDatabase()
  const existing = readDbState(db)
  if (existing) return normalizeState(existing)

  if (existsSync(legacyStateFile)) {
    const migrated = normalizeState(JSON.parse(readFileSync(legacyStateFile, 'utf8')) as Partial<AppState>)
    writeDbState(db, migrated)
    setMeta(db, 'migrated_from', legacyStateFile)
    return migrated
  }

  const state = await initialState()
  writeDbState(db, state)
  return state
}

export async function readState(): Promise<AppState> {
  return ensureState()
}

export async function writeState(state: AppState) {
  await mkdir(dataDir, { recursive: true })
  await mkdir(storagePaths.cacheDir, { recursive: true })
  writeDbState(openDatabase(), normalizeState(state))
}

export async function readStorageMigrationStatus() {
  const db = openDatabase()
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get('last_migration_status') as { value?: string } | undefined
  return row?.value ?? 'SUCCESS'
}

export async function readSystemSettings() {
  const state = await readState()
  return state.systemSettings
}

export async function appendOperationLog(payload: Omit<OperationLogRecord, 'id' | 'type' | 'createdAt'>) {
  const state = await readState()
  const log: OperationLogRecord = {
    id: randomUUID(),
    type: 'OPERATION',
    createdAt: new Date().toISOString(),
    ...payload
  }
  state.operationLogs = [log, ...state.operationLogs].slice(0, 1000)
  await writeState(state)
  return log
}

export async function appendTaskLog(payload: Omit<TaskLogRecord, 'id' | 'type' | 'createdAt'>) {
  const state = await readState()
  const log: TaskLogRecord = {
    id: randomUUID(),
    type: 'TASK',
    createdAt: new Date().toISOString(),
    ...payload
  }
  state.taskLogs = [log, ...state.taskLogs].slice(0, 1000)
  await writeState(state)
  return log
}

export async function clearLogsByType(type: 'operation' | 'task') {
  const state = await readState()
  const clearedCount = type === 'task' ? state.taskLogs.length : state.operationLogs.length
  if (type === 'task') {
    state.taskLogs = []
  } else {
    state.operationLogs = []
  }
  await writeState(state)
  return { clearedCount }
}
