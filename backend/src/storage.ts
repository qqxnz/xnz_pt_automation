import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
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

export type ScheduleLogRecord = {
  id: string
  type: 'SCHEDULE'
  jobName: string
  message: string
  status: 'SUCCESS' | 'FAILED' | 'RUNNING'
  scheduledAt?: string
  triggeredAt?: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  summary?: string
  errorMessage?: string
  details?: Record<string, unknown>
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
  onlyFreeDownload?: boolean
  autoPush: boolean
  discountTypes: Array<'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'>
  seederCondition?: 'GT' | 'EQ' | 'LT'
  seederCount?: number
  sizeCondition?: 'GT' | 'EQ' | 'LT'
  sizeMb?: number
  torrentCountCondition?: 'GT' | 'EQ' | 'LT'
  torrentCount?: number
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
  onlyFreeDownload?: boolean
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
  taskSavePath?: string
  downloaderSavePath?: string
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
  scheduleLogs: ScheduleLogRecord[]
  sites: SiteRecord[]
  proxies: ProxyRecord[]
  downloaders: DownloaderRecord[]
  tasks: TaskRecord[]
  torrents: TorrentRecord[]
  siteTrafficSnapshots: SiteTrafficSnapshotRecord[]
  systemSettings: SystemSettings
  systemSettingsUpdatedAt?: string
}

export type LogType = 'operation' | 'task' | 'schedule'

export type LogQuery = {
  type: LogType
  page: number
  pageSize: number
  keyword?: string
  status?: string
  taskId?: string
  runMode?: string
}

export type TorrentQuery = {
  keyword?: string
  siteId?: string
  downloaderId?: string
  taskId?: string
  pushStatus?: string
  status?: string
  freeStatus?: string
  sourceRunMode?: string
  page: number
  pageSize: number
}

export type TorrentStats = {
  total: number
  running: number
  notRunning: number
  auto: number
  manual: number
  pending: number
  failed: number
  expiringSoon: number
  totalUploaded: number
  totalDownloaded: number
  bySite: Array<{ siteId: string; siteName: string; uploaded: number; downloaded: number; torrentCount: number }>
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data')
const dbFile = path.join(dataDir, 'app.db')
const legacyStateFile = path.join(dataDir, 'app-state.json')
const schemaVersion = 3

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
    scheduleLogs: [],
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
      const torrentCountCondition = ['GT', 'EQ', 'LT'].includes(task.torrentCountCondition ?? '') ? task.torrentCountCondition : undefined
      return {
        ...task,
        onlyFreeDownload: Boolean(task.onlyFreeDownload),
        discountTypes: normalizedDiscountTypes,
        sizeCondition,
        sizeMb: sizeCondition && Number.isFinite(task.sizeMb) && Number(task.sizeMb) >= 0 ? Number(task.sizeMb) : undefined,
        torrentCountCondition,
        torrentCount: torrentCountCondition && Number.isInteger(task.torrentCount) && Number(task.torrentCount) >= 1
          ? Number(task.torrentCount)
          : undefined
      }
    })

  return {
    users: state.users ?? [],
    operationLogs: state.operationLogs ?? [],
    taskLogs: state.taskLogs ?? [],
    scheduleLogs: state.scheduleLogs ?? [],
    sites: (state.sites ?? []).filter((site) => typeof site.domain === 'string'),
    proxies: state.proxies ?? [],
    downloaders: (state.downloaders ?? []).filter((downloader) => typeof downloader.name === 'string'),
    tasks,
    torrents: (state.torrents ?? [])
      .filter((torrent) => typeof torrent.title === 'string')
      .map((torrent) => ({ ...torrent, onlyFreeDownload: Boolean(torrent.onlyFreeDownload) })),
    siteTrafficSnapshots: (state.siteTrafficSnapshots ?? []).filter((snapshot) => typeof snapshot.siteId === 'string' && typeof snapshot.date === 'string'),
    systemSettings,
    systemSettingsUpdatedAt: state.systemSettingsUpdatedAt
  }
}

let database: DatabaseSync | undefined
let storageReady: Promise<void> | undefined

function bool(value?: boolean) {
  return value ? 1 : 0
}

function fromBool(value: unknown) {
  return Number(value) === 1
}

function optional<T>(value: T | null | undefined) {
  return value ?? null
}

function json(value: unknown) {
  return JSON.stringify(value ?? null)
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function openDatabase() {
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(storagePaths.cacheDir, { recursive: true })

  if (database) return database

  database = new DatabaseSync(dbFile)
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  createBaseTables(database)
  return database
}

function createBaseTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

function createStructuredTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_changed_at TEXT,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      api_key TEXT,
      cookie TEXT,
      user_agent TEXT,
      proxy_id TEXT,
      connectivity_status TEXT NOT NULL,
      current_credential TEXT,
      user_level TEXT,
      ratio REAL,
      ratio_infinite INTEGER,
      uploaded REAL,
      downloaded REAL,
      traffic_synced_at TEXT,
      last_connected_at TEXT,
      last_connect_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proxies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      type TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      last_test_status TEXT,
      last_tested_at TEXT
    );
    CREATE TABLE IF NOT EXISTS downloaders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      host TEXT NOT NULL,
      username TEXT,
      password TEXT,
      save_path TEXT,
      status TEXT NOT NULL,
      status_message TEXT,
      last_tested_at TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      site_id TEXT NOT NULL,
      downloader_id TEXT NOT NULL,
      auto_run_enabled INTEGER NOT NULL,
      auto_run_started_at TEXT,
      next_run_at TEXT,
      interval_minutes INTEGER NOT NULL,
      free_only INTEGER NOT NULL,
      only_free_download INTEGER NOT NULL,
      auto_push INTEGER NOT NULL,
      discount_types_json TEXT NOT NULL,
      seeder_condition TEXT,
      seeder_count INTEGER,
      size_condition TEXT,
      size_mb REAL,
      torrent_count_condition TEXT,
      torrent_count INTEGER,
      expiring_soon_minutes INTEGER,
      save_path_override TEXT,
      category_override TEXT,
      tags_override_json TEXT,
      running INTEGER NOT NULL,
      last_run_mode TEXT,
      last_started_at TEXT,
      last_finished_at TEXT,
      last_status TEXT,
      last_summary TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS torrents (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      torrent_id TEXT,
      title TEXT NOT NULL,
      title_lc TEXT NOT NULL,
      size REAL NOT NULL,
      discount_type TEXT NOT NULL,
      is_free_now INTEGER NOT NULL,
      current_state TEXT NOT NULL,
      free_end_at TEXT,
      seeders INTEGER,
      leechers INTEGER,
      push_status TEXT NOT NULL,
      link_status TEXT NOT NULL,
      only_free_download INTEGER NOT NULL,
      detail_url TEXT,
      downloader_id TEXT,
      downloader_name TEXT,
      downloader_type TEXT,
      downloader_state TEXT,
      torrent_hash TEXT,
      download_progress REAL,
      download_state TEXT,
      ratio REAL,
      upload_speed REAL,
      download_speed REAL,
      uploaded REAL,
      downloaded REAL,
      task_save_path TEXT,
      downloader_save_path TEXT,
      download_stats_synced_at TEXT,
      source_task_id TEXT,
      source_task_name TEXT,
      source_run_mode TEXT NOT NULL,
      error_message TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      pushed_at TEXT,
      download_url_hash TEXT,
      download_url TEXT
    );
    CREATE TABLE IF NOT EXISTS operation_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      message TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      ip TEXT,
      user_agent TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      task_name TEXT NOT NULL,
      run_mode TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      fetched_count INTEGER,
      matched_count INTEGER,
      skipped_existing_count INTEGER,
      pushed_count INTEGER,
      push_failed_count INTEGER,
      summary TEXT,
      error_message TEXT,
      fetch_error_message TEXT,
      push_error_messages_json TEXT,
      failure_details_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedule_logs (
      id TEXT PRIMARY KEY,
      job_name TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduled_at TEXT,
      triggered_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      summary TEXT,
      error_message TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS site_traffic_snapshots (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      date TEXT NOT NULL,
      uploaded REAL,
      downloaded REAL,
      ratio REAL,
      ratio_infinite INTEGER,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      settings_json TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_torrents_first_seen ON torrents(first_seen_at DESC, id);
    CREATE INDEX IF NOT EXISTS idx_torrents_site ON torrents(site_id);
    CREATE INDEX IF NOT EXISTS idx_torrents_downloader ON torrents(downloader_id);
    CREATE INDEX IF NOT EXISTS idx_torrents_task ON torrents(source_task_id);
    CREATE INDEX IF NOT EXISTS idx_torrents_push_status ON torrents(push_status);
    CREATE INDEX IF NOT EXISTS idx_torrents_current_state ON torrents(current_state);
    CREATE INDEX IF NOT EXISTS idx_torrents_run_mode ON torrents(source_run_mode);
    CREATE INDEX IF NOT EXISTS idx_torrents_download_url_hash ON torrents(download_url_hash);
    CREATE INDEX IF NOT EXISTS idx_torrents_torrent_hash ON torrents(torrent_hash);
    CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_logs_created ON task_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_logs_task_created ON task_logs(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_schedule_logs_created ON schedule_logs(created_at DESC);
  `)
}

function userVersion(db: DatabaseSync) {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return Number(row.user_version ?? 0)
}

function setMeta(db: DatabaseSync, key: string, value: string) {
  db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

function readDbState(db: DatabaseSync): Partial<AppState> | undefined {
  const row = db.prepare('SELECT state_json FROM app_state WHERE id = 1').get() as { state_json?: string } | undefined
  if (!row?.state_json) return undefined
  return JSON.parse(row.state_json) as Partial<AppState>
}

function backupBeforeMigration(db: DatabaseSync) {
  if (!existsSync(dbFile)) return
  const alreadyBackedUp = db.prepare('SELECT value FROM app_meta WHERE key = ?').get('v2_backup_path') as { value?: string } | undefined
  if (alreadyBackedUp?.value) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${dbFile}.backup-before-v2-${stamp}`
  copyFileSync(dbFile, backupPath)
  setMeta(db, 'v2_backup_path', backupPath)
}

async function ensureStorage() {
  if (storageReady) return storageReady
  storageReady = (async () => {
    await mkdir(dataDir, { recursive: true })
    await mkdir(storagePaths.cacheDir, { recursive: true })
    const db = openDatabase()
    createStructuredTables(db)

    const currentVersion = userVersion(db)
    if (currentVersion >= schemaVersion && tableHasRows(db, 'users')) return

    if (currentVersion === 2 && tableHasRows(db, 'tasks')) {
      migrateV2ToV3(db)
      db.exec('COMMIT')
      return
    }

    const stateFromDb = readDbState(db)
    const stateFromFile = !stateFromDb && existsSync(legacyStateFile) ? JSON.parse(readFileSync(legacyStateFile, 'utf8')) as Partial<AppState> : undefined
    const source = stateFromDb ? 'app_state' : stateFromFile ? legacyStateFile : 'initial'
    const state = normalizeState(stateFromDb ?? stateFromFile ?? await initialState())

    backupBeforeMigration(db)
    db.exec('BEGIN IMMEDIATE')
    try {
      writeStructuredState(db, state)
      setMeta(db, 'schema_version', String(schemaVersion))
      setMeta(db, 'last_migration_status', 'SUCCESS')
      setMeta(db, 'migrated_at', new Date().toISOString())
      setMeta(db, 'migrated_from', source)
      db.exec(`PRAGMA user_version = ${schemaVersion}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      setMeta(db, 'last_migration_status', 'FAILED')
      throw error
    }
  })()
  return storageReady
}

function tableHasColumn(db: DatabaseSync, table: string, column: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((row) => row.name === column)
}

function migrateV2ToV3(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE')
  try {
    if (!tableHasColumn(db, 'tasks', 'torrent_count_condition')) {
      db.exec('ALTER TABLE tasks ADD COLUMN torrent_count_condition TEXT')
    }
    if (!tableHasColumn(db, 'tasks', 'torrent_count')) {
      db.exec('ALTER TABLE tasks ADD COLUMN torrent_count INTEGER')
    }
    setMeta(db, 'schema_version', String(schemaVersion))
    setMeta(db, 'last_migration_status', 'SUCCESS')
    setMeta(db, 'migrated_at', new Date().toISOString())
    setMeta(db, 'migrated_from', 'v2-additive')
    db.exec(`PRAGMA user_version = ${schemaVersion}`)
  } catch (error) {
    db.exec('ROLLBACK')
    setMeta(db, 'last_migration_status', 'FAILED')
    throw error
  }
}

function tableHasRows(db: DatabaseSync, table: string) {
  const row = db.prepare(`SELECT 1 AS ok FROM ${table} LIMIT 1`).get() as { ok?: number } | undefined
  return Boolean(row?.ok)
}

function clearStructuredTables(db: DatabaseSync, includeLogs = true) {
  db.exec(`
    DELETE FROM users;
    DELETE FROM sites;
    DELETE FROM proxies;
    DELETE FROM downloaders;
    DELETE FROM tasks;
    DELETE FROM torrents;
    DELETE FROM site_traffic_snapshots;
    DELETE FROM system_settings;
  `)
  if (includeLogs) {
    db.exec(`
      DELETE FROM operation_logs;
      DELETE FROM task_logs;
      DELETE FROM schedule_logs;
    `)
  }
}

function writeStructuredState(db: DatabaseSync, state: AppState, options: { includeLogs?: boolean } = {}) {
  const includeLogs = options.includeLogs ?? true
  clearStructuredTables(db, includeLogs)
  for (const item of state.users) upsertUser(db, item)
  for (const item of state.sites) upsertSite(db, item)
  for (const item of state.proxies) upsertProxy(db, item)
  for (const item of state.downloaders) upsertDownloader(db, item)
  for (const item of state.tasks) upsertTask(db, item)
  for (const item of state.torrents) upsertTorrent(db, item)
  if (includeLogs) {
    for (const item of state.operationLogs) upsertOperationLog(db, item)
    for (const item of state.taskLogs) upsertTaskLog(db, item)
    for (const item of state.scheduleLogs) upsertScheduleLog(db, item)
  }
  for (const item of state.siteTrafficSnapshots) upsertSnapshot(db, item)
  db.prepare('INSERT INTO system_settings (id, settings_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at').run(json(state.systemSettings), optional(state.systemSettingsUpdatedAt))
}

function upsertUser(db: DatabaseSync, item: UserRecord) {
  db.prepare('INSERT INTO users (id, username, password_hash, password_changed_at, last_login_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash, password_changed_at = excluded.password_changed_at, last_login_at = excluded.last_login_at')
    .run(item.id, item.username, item.passwordHash, optional(item.passwordChangedAt), optional(item.lastLoginAt))
}

function upsertSite(db: DatabaseSync, item: SiteRecord) {
  db.prepare(`INSERT INTO sites (id, domain, enabled, api_key, cookie, user_agent, proxy_id, connectivity_status, current_credential, user_level, ratio, ratio_infinite, uploaded, downloaded, traffic_synced_at, last_connected_at, last_connect_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET domain = excluded.domain, enabled = excluded.enabled, api_key = excluded.api_key, cookie = excluded.cookie, user_agent = excluded.user_agent, proxy_id = excluded.proxy_id, connectivity_status = excluded.connectivity_status, current_credential = excluded.current_credential, user_level = excluded.user_level, ratio = excluded.ratio, ratio_infinite = excluded.ratio_infinite, uploaded = excluded.uploaded, downloaded = excluded.downloaded, traffic_synced_at = excluded.traffic_synced_at, last_connected_at = excluded.last_connected_at, last_connect_error = excluded.last_connect_error, created_at = excluded.created_at, updated_at = excluded.updated_at`)
    .run(item.id, item.domain, bool(item.enabled), optional(item.apiKey), optional(item.cookie), optional(item.userAgent), optional(item.proxyId), item.connectivityStatus, optional(item.currentCredential), optional(item.userLevel), optional(item.ratio), item.ratioInfinite === undefined ? null : bool(item.ratioInfinite), optional(item.uploaded), optional(item.downloaded), optional(item.trafficSyncedAt), optional(item.lastConnectedAt), optional(item.lastConnectError), item.createdAt, item.updatedAt)
}

function upsertProxy(db: DatabaseSync, item: ProxyRecord) {
  db.prepare(`INSERT INTO proxies (id, name, enabled, type, host, port, username, password, last_test_status, last_tested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled, type = excluded.type, host = excluded.host, port = excluded.port, username = excluded.username, password = excluded.password, last_test_status = excluded.last_test_status, last_tested_at = excluded.last_tested_at`)
    .run(item.id, item.name, bool(item.enabled), item.type, item.host, item.port, optional(item.username), optional(item.password), optional(item.lastTestStatus), optional(item.lastTestedAt))
}

function upsertDownloader(db: DatabaseSync, item: DownloaderRecord) {
  db.prepare(`INSERT INTO downloaders (id, name, type, enabled, host, username, password, save_path, status, status_message, last_tested_at, last_synced_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, enabled = excluded.enabled, host = excluded.host, username = excluded.username, password = excluded.password, save_path = excluded.save_path, status = excluded.status, status_message = excluded.status_message, last_tested_at = excluded.last_tested_at, last_synced_at = excluded.last_synced_at, created_at = excluded.created_at, updated_at = excluded.updated_at`)
    .run(item.id, item.name, item.type, bool(item.enabled), item.host, optional(item.username), optional(item.password), optional(item.savePath), item.status, optional(item.statusMessage), optional(item.lastTestedAt), optional(item.lastSyncedAt), item.createdAt, item.updatedAt)
}

function upsertTask(db: DatabaseSync, item: TaskRecord) {
  db.prepare(`INSERT INTO tasks (id, name, site_id, downloader_id, auto_run_enabled, auto_run_started_at, next_run_at, interval_minutes, free_only, only_free_download, auto_push, discount_types_json, seeder_condition, seeder_count, size_condition, size_mb, torrent_count_condition, torrent_count, expiring_soon_minutes, save_path_override, category_override, tags_override_json, running, last_run_mode, last_started_at, last_finished_at, last_status, last_summary, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, site_id = excluded.site_id, downloader_id = excluded.downloader_id, auto_run_enabled = excluded.auto_run_enabled, auto_run_started_at = excluded.auto_run_started_at, next_run_at = excluded.next_run_at, interval_minutes = excluded.interval_minutes, free_only = excluded.free_only, only_free_download = excluded.only_free_download, auto_push = excluded.auto_push, discount_types_json = excluded.discount_types_json, seeder_condition = excluded.seeder_condition, seeder_count = excluded.seeder_count, size_condition = excluded.size_condition, size_mb = excluded.size_mb, torrent_count_condition = excluded.torrent_count_condition, torrent_count = excluded.torrent_count, expiring_soon_minutes = excluded.expiring_soon_minutes, save_path_override = excluded.save_path_override, category_override = excluded.category_override, tags_override_json = excluded.tags_override_json, running = excluded.running, last_run_mode = excluded.last_run_mode, last_started_at = excluded.last_started_at, last_finished_at = excluded.last_finished_at, last_status = excluded.last_status, last_summary = excluded.last_summary, last_error = excluded.last_error, created_at = excluded.created_at, updated_at = excluded.updated_at`)
    .run(item.id, item.name, item.siteId, item.downloaderId, bool(item.autoRunEnabled), optional(item.autoRunStartedAt), optional(item.nextRunAt), item.intervalMinutes, bool(item.freeOnly), bool(item.onlyFreeDownload), bool(item.autoPush), json(item.discountTypes), optional(item.seederCondition), optional(item.seederCount), optional(item.sizeCondition), optional(item.sizeMb), optional(item.torrentCountCondition), optional(item.torrentCount), optional(item.expiringSoonMinutes), optional(item.savePathOverride), optional(item.categoryOverride), item.tagsOverride ? json(item.tagsOverride) : null, bool(item.running), optional(item.lastRunMode), optional(item.lastStartedAt), optional(item.lastFinishedAt), optional(item.lastStatus), optional(item.lastSummary), optional(item.lastError), item.createdAt, item.updatedAt)
}

function upsertTorrent(db: DatabaseSync, item: TorrentRecord) {
  db.prepare(`INSERT INTO torrents (id, site_id, site_name, torrent_id, title, title_lc, size, discount_type, is_free_now, current_state, free_end_at, seeders, leechers, push_status, link_status, only_free_download, detail_url, downloader_id, downloader_name, downloader_type, downloader_state, torrent_hash, download_progress, download_state, ratio, upload_speed, download_speed, uploaded, downloaded, task_save_path, downloader_save_path, download_stats_synced_at, source_task_id, source_task_name, source_run_mode, error_message, first_seen_at, last_seen_at, pushed_at, download_url_hash, download_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET site_id = excluded.site_id, site_name = excluded.site_name, torrent_id = excluded.torrent_id, title = excluded.title, title_lc = excluded.title_lc, size = excluded.size, discount_type = excluded.discount_type, is_free_now = excluded.is_free_now, current_state = excluded.current_state, free_end_at = excluded.free_end_at, seeders = excluded.seeders, leechers = excluded.leechers, push_status = excluded.push_status, link_status = excluded.link_status, only_free_download = excluded.only_free_download, detail_url = excluded.detail_url, downloader_id = excluded.downloader_id, downloader_name = excluded.downloader_name, downloader_type = excluded.downloader_type, downloader_state = excluded.downloader_state, torrent_hash = excluded.torrent_hash, download_progress = excluded.download_progress, download_state = excluded.download_state, ratio = excluded.ratio, upload_speed = excluded.upload_speed, download_speed = excluded.download_speed, uploaded = excluded.uploaded, downloaded = excluded.downloaded, task_save_path = excluded.task_save_path, downloader_save_path = excluded.downloader_save_path, download_stats_synced_at = excluded.download_stats_synced_at, source_task_id = excluded.source_task_id, source_task_name = excluded.source_task_name, source_run_mode = excluded.source_run_mode, error_message = excluded.error_message, first_seen_at = excluded.first_seen_at, last_seen_at = excluded.last_seen_at, pushed_at = excluded.pushed_at, download_url_hash = excluded.download_url_hash, download_url = excluded.download_url`)
    .run(item.id, item.siteId, item.siteName, optional(item.torrentId), item.title, item.title.toLowerCase(), item.size, item.discountType, bool(item.isFreeNow), item.currentState, optional(item.freeEndAt), optional(item.seeders), optional(item.leechers), item.pushStatus, item.linkStatus, bool(item.onlyFreeDownload), optional(item.detailUrl), optional(item.downloaderId), optional(item.downloaderName), optional(item.downloaderType), optional(item.downloaderState), optional(item.torrentHash), optional(item.downloadProgress), optional(item.downloadState), optional(item.ratio), optional(item.uploadSpeed), optional(item.downloadSpeed), optional(item.uploaded), optional(item.downloaded), optional(item.taskSavePath), optional(item.downloaderSavePath), optional(item.downloadStatsSyncedAt), optional(item.sourceTaskId), optional(item.sourceTaskName), item.sourceRunMode, optional(item.errorMessage), item.firstSeenAt, item.lastSeenAt, optional(item.pushedAt), optional(item.downloadUrlHash), optional(item.downloadUrl))
}

function upsertOperationLog(db: DatabaseSync, item: OperationLogRecord) {
  db.prepare(`INSERT INTO operation_logs (id, action, message, actor_id, actor_name, ip, user_agent, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET action = excluded.action, message = excluded.message, actor_id = excluded.actor_id, actor_name = excluded.actor_name, ip = excluded.ip, user_agent = excluded.user_agent, status = excluded.status, created_at = excluded.created_at`)
    .run(item.id, item.action, item.message, optional(item.actorId), optional(item.actorName), optional(item.ip), optional(item.userAgent), item.status, item.createdAt)
}

function upsertTaskLog(db: DatabaseSync, item: TaskLogRecord) {
  db.prepare(`INSERT INTO task_logs (id, task_id, task_name, run_mode, message, status, started_at, finished_at, fetched_count, matched_count, skipped_existing_count, pushed_count, push_failed_count, summary, error_message, fetch_error_message, push_error_messages_json, failure_details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id, task_name = excluded.task_name, run_mode = excluded.run_mode, message = excluded.message, status = excluded.status, started_at = excluded.started_at, finished_at = excluded.finished_at, fetched_count = excluded.fetched_count, matched_count = excluded.matched_count, skipped_existing_count = excluded.skipped_existing_count, pushed_count = excluded.pushed_count, push_failed_count = excluded.push_failed_count, summary = excluded.summary, error_message = excluded.error_message, fetch_error_message = excluded.fetch_error_message, push_error_messages_json = excluded.push_error_messages_json, failure_details_json = excluded.failure_details_json, created_at = excluded.created_at`)
    .run(item.id, optional(item.taskId), item.taskName, optional(item.runMode), item.message, item.status, optional(item.startedAt), optional(item.finishedAt), optional(item.fetchedCount), optional(item.matchedCount), optional(item.skippedExistingCount), optional(item.pushedCount), optional(item.pushFailedCount), optional(item.summary), optional(item.errorMessage), optional(item.fetchErrorMessage), json(item.pushErrorMessages ?? []), json(item.failureDetails ?? []), item.createdAt)
}

function upsertScheduleLog(db: DatabaseSync, item: ScheduleLogRecord) {
  db.prepare(`INSERT INTO schedule_logs (id, job_name, message, status, scheduled_at, triggered_at, started_at, finished_at, duration_ms, summary, error_message, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET job_name = excluded.job_name, message = excluded.message, status = excluded.status, scheduled_at = excluded.scheduled_at, triggered_at = excluded.triggered_at, started_at = excluded.started_at, finished_at = excluded.finished_at, duration_ms = excluded.duration_ms, summary = excluded.summary, error_message = excluded.error_message, details_json = excluded.details_json, created_at = excluded.created_at`)
    .run(item.id, item.jobName, item.message, item.status, optional(item.scheduledAt), optional(item.triggeredAt), optional(item.startedAt), optional(item.finishedAt), optional(item.durationMs), optional(item.summary), optional(item.errorMessage), item.details ? json(item.details) : null, item.createdAt)
}

function upsertSnapshot(db: DatabaseSync, item: SiteTrafficSnapshotRecord) {
  db.prepare(`INSERT INTO site_traffic_snapshots (id, site_id, site_name, date, uploaded, downloaded, ratio, ratio_infinite, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET site_id = excluded.site_id, site_name = excluded.site_name, date = excluded.date, uploaded = excluded.uploaded, downloaded = excluded.downloaded, ratio = excluded.ratio, ratio_infinite = excluded.ratio_infinite, synced_at = excluded.synced_at`)
    .run(item.id, item.siteId, item.siteName, item.date, optional(item.uploaded), optional(item.downloaded), optional(item.ratio), item.ratioInfinite === undefined ? null : bool(item.ratioInfinite), item.syncedAt)
}

function usersFromDb(db: DatabaseSync): UserRecord[] {
  return (db.prepare('SELECT * FROM users ORDER BY username').all() as any[]).map((row) => ({
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    passwordChangedAt: row.password_changed_at ?? undefined,
    lastLoginAt: row.last_login_at ?? undefined
  }))
}

function sitesFromDb(db: DatabaseSync): SiteRecord[] {
  return (db.prepare('SELECT * FROM sites ORDER BY created_at DESC, id').all() as any[]).map((row) => ({
    id: row.id,
    domain: row.domain,
    enabled: fromBool(row.enabled),
    apiKey: row.api_key ?? undefined,
    cookie: row.cookie ?? undefined,
    userAgent: row.user_agent ?? undefined,
    proxyId: row.proxy_id ?? undefined,
    connectivityStatus: row.connectivity_status,
    currentCredential: row.current_credential ?? undefined,
    userLevel: row.user_level ?? undefined,
    ratio: row.ratio ?? undefined,
    ratioInfinite: row.ratio_infinite === null ? undefined : fromBool(row.ratio_infinite),
    uploaded: row.uploaded ?? undefined,
    downloaded: row.downloaded ?? undefined,
    trafficSyncedAt: row.traffic_synced_at ?? undefined,
    lastConnectedAt: row.last_connected_at ?? undefined,
    lastConnectError: row.last_connect_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

function proxiesFromDb(db: DatabaseSync): ProxyRecord[] {
  return (db.prepare('SELECT * FROM proxies ORDER BY name').all() as any[]).map((row) => ({
    id: row.id,
    name: row.name,
    enabled: fromBool(row.enabled),
    type: row.type,
    host: row.host,
    port: row.port,
    username: row.username ?? undefined,
    password: row.password ?? undefined,
    lastTestStatus: row.last_test_status ?? undefined,
    lastTestedAt: row.last_tested_at ?? undefined
  }))
}

function downloadersFromDb(db: DatabaseSync): DownloaderRecord[] {
  return (db.prepare('SELECT * FROM downloaders ORDER BY created_at DESC, id').all() as any[]).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: fromBool(row.enabled),
    host: row.host,
    username: row.username ?? undefined,
    password: row.password ?? undefined,
    savePath: row.save_path ?? undefined,
    status: row.status,
    statusMessage: row.status_message ?? undefined,
    lastTestedAt: row.last_tested_at ?? undefined,
    lastSyncedAt: row.last_synced_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

function tasksFromDb(db: DatabaseSync): TaskRecord[] {
  return (db.prepare('SELECT * FROM tasks ORDER BY created_at DESC, id').all() as any[]).map((row) => ({
    id: row.id,
    name: row.name,
    siteId: row.site_id,
    downloaderId: row.downloader_id,
    autoRunEnabled: fromBool(row.auto_run_enabled),
    autoRunStartedAt: row.auto_run_started_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    intervalMinutes: row.interval_minutes,
    freeOnly: fromBool(row.free_only),
    onlyFreeDownload: fromBool(row.only_free_download),
    autoPush: fromBool(row.auto_push),
    discountTypes: parseJson(row.discount_types_json, defaultTaskDiscountTypes),
    seederCondition: row.seeder_condition ?? undefined,
    seederCount: row.seeder_count ?? undefined,
    sizeCondition: row.size_condition ?? undefined,
    sizeMb: row.size_mb ?? undefined,
    torrentCountCondition: row.torrent_count_condition ?? undefined,
    torrentCount: row.torrent_count ?? undefined,
    expiringSoonMinutes: row.expiring_soon_minutes ?? undefined,
    savePathOverride: row.save_path_override ?? undefined,
    categoryOverride: row.category_override ?? undefined,
    tagsOverride: parseJson<string[] | undefined>(row.tags_override_json, undefined),
    running: fromBool(row.running),
    lastRunMode: row.last_run_mode ?? undefined,
    lastStartedAt: row.last_started_at ?? undefined,
    lastFinishedAt: row.last_finished_at ?? undefined,
    lastStatus: row.last_status ?? undefined,
    lastSummary: row.last_summary ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

function torrentFromRow(row: any): TorrentRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_name,
    torrentId: row.torrent_id ?? undefined,
    title: row.title,
    size: row.size,
    discountType: row.discount_type,
    isFreeNow: fromBool(row.is_free_now),
    currentState: row.current_state,
    freeEndAt: row.free_end_at ?? undefined,
    seeders: row.seeders ?? undefined,
    leechers: row.leechers ?? undefined,
    pushStatus: row.push_status,
    linkStatus: row.link_status,
    onlyFreeDownload: fromBool(row.only_free_download),
    detailUrl: row.detail_url ?? undefined,
    downloaderId: row.downloader_id ?? undefined,
    downloaderName: row.downloader_name ?? undefined,
    downloaderType: row.downloader_type ?? undefined,
    downloaderState: row.downloader_state ?? undefined,
    torrentHash: row.torrent_hash ?? undefined,
    downloadProgress: row.download_progress ?? undefined,
    downloadState: row.download_state ?? undefined,
    ratio: row.ratio ?? undefined,
    uploadSpeed: row.upload_speed ?? undefined,
    downloadSpeed: row.download_speed ?? undefined,
    uploaded: row.uploaded ?? undefined,
    downloaded: row.downloaded ?? undefined,
    taskSavePath: row.task_save_path ?? undefined,
    downloaderSavePath: row.downloader_save_path ?? undefined,
    downloadStatsSyncedAt: row.download_stats_synced_at ?? undefined,
    sourceTaskId: row.source_task_id ?? undefined,
    sourceTaskName: row.source_task_name ?? undefined,
    sourceRunMode: row.source_run_mode,
    errorMessage: row.error_message ?? undefined,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    pushedAt: row.pushed_at ?? undefined,
    downloadUrlHash: row.download_url_hash ?? undefined,
    downloadUrl: row.download_url ?? undefined
  }
}

function torrentsFromDb(db: DatabaseSync): TorrentRecord[] {
  return (db.prepare('SELECT * FROM torrents ORDER BY first_seen_at DESC, id DESC').all() as any[]).map(torrentFromRow)
}

function operationLogFromRow(row: any): OperationLogRecord {
  return {
    id: row.id,
    type: 'OPERATION',
    action: row.action,
    message: row.message,
    actorId: row.actor_id ?? undefined,
    actorName: row.actor_name ?? undefined,
    ip: row.ip ?? undefined,
    userAgent: row.user_agent ?? undefined,
    status: row.status,
    createdAt: row.created_at
  }
}

function taskLogFromRow(row: any): TaskLogRecord {
  return {
    id: row.id,
    type: 'TASK',
    taskId: row.task_id ?? undefined,
    taskName: row.task_name,
    runMode: row.run_mode ?? undefined,
    message: row.message,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    fetchedCount: row.fetched_count ?? undefined,
    matchedCount: row.matched_count ?? undefined,
    skippedExistingCount: row.skipped_existing_count ?? undefined,
    pushedCount: row.pushed_count ?? undefined,
    pushFailedCount: row.push_failed_count ?? undefined,
    summary: row.summary ?? undefined,
    errorMessage: row.error_message ?? undefined,
    fetchErrorMessage: row.fetch_error_message ?? undefined,
    pushErrorMessages: parseJson(row.push_error_messages_json, []),
    failureDetails: parseJson(row.failure_details_json, []),
    createdAt: row.created_at
  }
}

function scheduleLogFromRow(row: any): ScheduleLogRecord {
  return {
    id: row.id,
    type: 'SCHEDULE',
    jobName: row.job_name,
    message: row.message,
    status: row.status,
    scheduledAt: row.scheduled_at ?? undefined,
    triggeredAt: row.triggered_at ?? undefined,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    summary: row.summary ?? undefined,
    errorMessage: row.error_message ?? undefined,
    details: parseJson<Record<string, unknown> | undefined>(row.details_json, undefined),
    createdAt: row.created_at
  }
}

function snapshotsFromDb(db: DatabaseSync): SiteTrafficSnapshotRecord[] {
  return (db.prepare('SELECT * FROM site_traffic_snapshots ORDER BY date DESC, id').all() as any[]).map((row) => ({
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_name,
    date: row.date,
    uploaded: row.uploaded ?? undefined,
    downloaded: row.downloaded ?? undefined,
    ratio: row.ratio ?? undefined,
    ratioInfinite: row.ratio_infinite === null ? undefined : fromBool(row.ratio_infinite),
    syncedAt: row.synced_at
  }))
}

function systemSettingsFromDb(db: DatabaseSync) {
  const row = db.prepare('SELECT settings_json, updated_at FROM system_settings WHERE id = 1').get() as { settings_json?: string; updated_at?: string } | undefined
  return {
    settings: { ...defaultSystemSettings, ...parseJson(row?.settings_json, defaultSystemSettings) },
    updatedAt: row?.updated_at
  }
}

function readStructuredState(db: DatabaseSync): AppState {
  const systemSettings = systemSettingsFromDb(db)
  return normalizeState({
    users: usersFromDb(db),
    operationLogs: (db.prepare('SELECT * FROM operation_logs ORDER BY created_at DESC, id DESC').all() as any[]).map(operationLogFromRow),
    taskLogs: (db.prepare('SELECT * FROM task_logs ORDER BY created_at DESC, id DESC').all() as any[]).map(taskLogFromRow),
    scheduleLogs: (db.prepare('SELECT * FROM schedule_logs ORDER BY created_at DESC, id DESC').all() as any[]).map(scheduleLogFromRow),
    sites: sitesFromDb(db),
    proxies: proxiesFromDb(db),
    downloaders: downloadersFromDb(db),
    tasks: tasksFromDb(db),
    torrents: torrentsFromDb(db),
    siteTrafficSnapshots: snapshotsFromDb(db),
    systemSettings: systemSettings.settings,
    systemSettingsUpdatedAt: systemSettings.updatedAt
  })
}

function pruneLogTable(db: DatabaseSync, table: string) {
  db.prepare(`DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY created_at DESC, id DESC LIMIT 1000)`).run()
}

function logTable(type: LogType) {
  return type === 'task' ? 'task_logs' : type === 'schedule' ? 'schedule_logs' : 'operation_logs'
}

function logWhere(query: LogQuery) {
  const clauses: string[] = []
  const params: unknown[] = []
  const status = query.status ?? 'ALL'
  const keyword = query.keyword?.trim().toLowerCase()
  if (status !== 'ALL') {
    clauses.push('status = ?')
    params.push(status)
  }
  if (query.type === 'task') {
    if (query.taskId) {
      clauses.push('task_id = ?')
      params.push(query.taskId)
    }
    if (query.runMode && query.runMode !== 'ALL') {
      clauses.push('run_mode = ?')
      params.push(query.runMode)
    }
    if (keyword) {
      clauses.push("lower(task_name || ' ' || message || ' ' || coalesce(summary, '') || ' ' || coalesce(error_message, '') || ' ' || coalesce(fetch_error_message, '') || ' ' || coalesce(push_error_messages_json, '') || ' ' || coalesce(failure_details_json, '')) LIKE ?")
      params.push(`%${keyword}%`)
    }
  } else if (query.type === 'schedule') {
    if (keyword) {
      clauses.push("lower(job_name || ' ' || message || ' ' || coalesce(summary, '') || ' ' || coalesce(error_message, '') || ' ' || coalesce(details_json, '')) LIKE ?")
      params.push(`%${keyword}%`)
    }
  } else if (keyword) {
    clauses.push("lower(action || ' ' || message || ' ' || coalesce(actor_name, '')) LIKE ?")
    params.push(`%${keyword}%`)
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

function torrentWhere(query: Omit<TorrentQuery, 'page' | 'pageSize'>) {
  const clauses: string[] = []
  const params: unknown[] = []
  const keyword = query.keyword?.trim().toLowerCase()
  if (keyword) {
    clauses.push("lower(title || ' ' || site_name || ' ' || coalesce(source_task_name, '')) LIKE ?")
    params.push(`%${keyword}%`)
  }
  if (query.siteId) {
    clauses.push('site_id = ?')
    params.push(query.siteId)
  }
  if (query.downloaderId) {
    clauses.push('downloader_id = ?')
    params.push(query.downloaderId)
  }
  if (query.taskId) {
    clauses.push('source_task_id = ?')
    params.push(query.taskId)
  }
  if (query.pushStatus && query.pushStatus !== 'ALL') {
    clauses.push('push_status = ?')
    params.push(query.pushStatus)
  }
  const status = query.status ?? 'ALL'
  if (status === 'RUNNING') {
    clauses.push("push_status = 'PUSHED'")
  } else if (status === 'NOT_RUNNING') {
    clauses.push("push_status IN ('PUSH_FAILED', 'DELETED')")
  } else if (status !== 'ALL') {
    clauses.push('current_state = ?')
    params.push(status)
  }
  const freeStatus = query.freeStatus ?? 'ALL'
  if (freeStatus === 'FREE_NOW') {
    clauses.push('(is_free_now = 1 OR (free_end_at IS NOT NULL AND free_end_at > ?))')
    params.push(new Date().toISOString())
  } else if (freeStatus === 'EXPIRING_SOON') {
    clauses.push("current_state = 'EXPIRING_SOON'")
  } else if (freeStatus === 'EXPIRED') {
    clauses.push("(current_state = 'EXPIRED' OR (free_end_at IS NOT NULL AND free_end_at <= ?))")
    params.push(new Date().toISOString())
  } else if (freeStatus === 'NORMAL') {
    clauses.push("discount_type = 'NORMAL' AND NOT (is_free_now = 1 OR (free_end_at IS NOT NULL AND free_end_at > ?))")
    params.push(new Date().toISOString())
  } else if (freeStatus === 'FREE_NO_END') {
    clauses.push('is_free_now = 1 AND free_end_at IS NULL')
  }
  if (query.sourceRunMode && query.sourceRunMode !== 'ALL') {
    clauses.push('source_run_mode = ?')
    params.push(query.sourceRunMode)
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

async function readyDb() {
  await ensureStorage()
  return openDatabase()
}

export async function readState(): Promise<AppState> {
  return readStructuredState(await readyDb())
}

export async function writeState(state: AppState) {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    writeStructuredState(db, normalizeState(state), { includeLogs: false })
    setMeta(db, 'last_write_at', new Date().toISOString())
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function readStorageMigrationStatus() {
  const db = await readyDb()
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get('last_migration_status') as { value?: string } | undefined
  return row?.value ?? 'SUCCESS'
}

export async function readStorageSchemaVersion() {
  const db = await readyDb()
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get('schema_version') as { value?: string } | undefined
  return row?.value ?? String(userVersion(db))
}

export async function readSystemSettings() {
  const state = await readState()
  return state.systemSettings
}

export async function appendOperationLog(payload: Omit<OperationLogRecord, 'id' | 'type' | 'createdAt'>) {
  const db = await readyDb()
  const log: OperationLogRecord = {
    id: randomUUID(),
    type: 'OPERATION',
    createdAt: new Date().toISOString(),
    ...payload
  }
  upsertOperationLog(db, log)
  pruneLogTable(db, 'operation_logs')
  return log
}

export async function appendTaskLog(payload: Omit<TaskLogRecord, 'id' | 'type' | 'createdAt'>) {
  const db = await readyDb()
  const log: TaskLogRecord = {
    id: randomUUID(),
    type: 'TASK',
    createdAt: new Date().toISOString(),
    ...payload
  }
  upsertTaskLog(db, log)
  pruneLogTable(db, 'task_logs')
  return log
}

export async function appendScheduleLog(payload: Omit<ScheduleLogRecord, 'id' | 'type' | 'createdAt'>) {
  const db = await readyDb()
  const log: ScheduleLogRecord = {
    id: randomUUID(),
    type: 'SCHEDULE',
    createdAt: new Date().toISOString(),
    ...payload
  }
  upsertScheduleLog(db, log)
  pruneLogTable(db, 'schedule_logs')
  return log
}

export async function clearLogsByType(type: LogType) {
  const db = await readyDb()
  const table = logTable(type)
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }
  db.prepare(`DELETE FROM ${table}`).run()
  return { clearedCount: Number(row.total ?? 0) }
}

export async function queryLogs<T extends OperationLogRecord | TaskLogRecord | ScheduleLogRecord>(query: LogQuery) {
  const db = await readyDb()
  const table = logTable(query.type)
  const where = logWhere(query)
  const page = Math.max(Math.floor(query.page), 1)
  const pageSize = Math.min(Math.max(Math.floor(query.pageSize), 1), 100)
  const params = where.params as any[]
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM ${table} ${where.sql}`).get(...params) as { total: number }
  const rows = db.prepare(`SELECT * FROM ${table} ${where.sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as any[]
  const items =
    query.type === 'task'
      ? rows.map(taskLogFromRow)
      : query.type === 'schedule'
        ? rows.map(scheduleLogFromRow)
        : rows.map(operationLogFromRow)
  return { items: items as T[], total: Number(totalRow.total ?? 0), page, pageSize }
}

export async function queryAllLogs<T extends OperationLogRecord | TaskLogRecord | ScheduleLogRecord>(type: LogType) {
  const db = await readyDb()
  const rows = db.prepare(`SELECT * FROM ${logTable(type)} ORDER BY created_at DESC, id DESC`).all() as any[]
  const items =
    type === 'task'
      ? rows.map(taskLogFromRow)
      : type === 'schedule'
        ? rows.map(scheduleLogFromRow)
        : rows.map(operationLogFromRow)
  return items as T[]
}

export async function listTorrents(query: TorrentQuery) {
  const db = await readyDb()
  const where = torrentWhere(query)
  const page = Math.max(Math.floor(query.page), 1)
  const pageSize = Math.min(Math.max(Math.floor(query.pageSize), 1), 100)
  const params = where.params as any[]
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM torrents ${where.sql}`).get(...params) as { total: number }
  const rows = db.prepare(`SELECT * FROM torrents ${where.sql} ORDER BY first_seen_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as any[]
  return { items: rows.map(torrentFromRow), total: Number(totalRow.total ?? 0), page, pageSize }
}

export async function readTorrentStats(): Promise<TorrentStats> {
  const db = await readyDb()
  const now = new Date().toISOString()
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN push_status = 'PUSHED' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN push_status IN ('PUSH_FAILED', 'DELETED') THEN 1 ELSE 0 END) AS not_running,
      SUM(CASE WHEN source_run_mode = 'AUTO' THEN 1 ELSE 0 END) AS auto_count,
      SUM(CASE WHEN source_run_mode = 'MANUAL_RUN' THEN 1 ELSE 0 END) AS manual_count,
      SUM(CASE WHEN push_status = 'NEW' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN push_status = 'PUSH_FAILED' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN free_end_at IS NOT NULL AND free_end_at > ? AND current_state = 'EXPIRING_SOON' THEN 1 ELSE 0 END) AS expiring_soon,
      SUM(COALESCE(uploaded, 0)) AS total_uploaded,
      SUM(COALESCE(downloaded, 0)) AS total_downloaded
    FROM torrents
  `).get(now) as any
  const bySite = db.prepare(`
    SELECT site_id, site_name, SUM(COALESCE(uploaded, 0)) AS uploaded, SUM(COALESCE(downloaded, 0)) AS downloaded, COUNT(*) AS torrent_count
    FROM torrents
    GROUP BY site_id, site_name
    ORDER BY uploaded + downloaded DESC
  `).all() as any[]
  return {
    total: Number(row.total ?? 0),
    running: Number(row.running ?? 0),
    notRunning: Number(row.not_running ?? 0),
    auto: Number(row.auto_count ?? 0),
    manual: Number(row.manual_count ?? 0),
    pending: Number(row.pending ?? 0),
    failed: Number(row.failed ?? 0),
    expiringSoon: Number(row.expiring_soon ?? 0),
    totalUploaded: Number(row.total_uploaded ?? 0),
    totalDownloaded: Number(row.total_downloaded ?? 0),
    bySite: bySite.map((item) => ({
      siteId: item.site_id,
      siteName: item.site_name,
      uploaded: Number(item.uploaded ?? 0),
      downloaded: Number(item.downloaded ?? 0),
      torrentCount: Number(item.torrent_count ?? 0)
    }))
  }
}

export async function readTasks() {
  const db = await readyDb()
  return tasksFromDb(db)
}

function refreshTorrentFreeStateForStorage(torrent: TorrentRecord, expiringSoonMinutes = 120) {
  if (!torrent.freeEndAt || torrent.pushStatus === 'DELETED') return false
  const freeEndTime = new Date(torrent.freeEndAt).getTime()
  if (Number.isNaN(freeEndTime)) return false
  const previousState = torrent.currentState
  const previousFreeNow = torrent.isFreeNow
  const now = Date.now()
  if (freeEndTime <= now) {
    torrent.isFreeNow = false
    torrent.currentState = 'EXPIRED'
  } else {
    torrent.isFreeNow = true
    if (freeEndTime - now <= expiringSoonMinutes * 60_000) {
      torrent.currentState = 'EXPIRING_SOON'
    } else if (torrent.pushStatus === 'PUSHED') {
      torrent.currentState = 'PUSHED'
    } else if (torrent.pushStatus === 'PUSH_FAILED') {
      torrent.currentState = 'PUSH_FAILED'
    } else {
      torrent.currentState = 'FREE_NOW'
    }
  }
  return previousState !== torrent.currentState || previousFreeNow !== torrent.isFreeNow
}

export async function refreshStoredTorrentFreeStates() {
  const db = await readyDb()
  const tasks = tasksFromDb(db)
  const expiringByTask = new Map(tasks.map((task) => [task.id, task.expiringSoonMinutes ?? 120]))
  const candidates = (db.prepare("SELECT * FROM torrents WHERE free_end_at IS NOT NULL AND push_status != 'DELETED'").all() as any[]).map(torrentFromRow)
  const changed: TorrentRecord[] = []
  for (const torrent of candidates) {
    if (refreshTorrentFreeStateForStorage(torrent, expiringByTask.get(torrent.sourceTaskId ?? '') ?? 120)) changed.push(torrent)
  }
  if (changed.length) await updateTorrents(changed)
  return { checkedCount: candidates.length, updatedCount: changed.length }
}

export async function getTorrentById(id: string) {
  const db = await readyDb()
  const row = db.prepare('SELECT * FROM torrents WHERE id = ?').get(id) as any | undefined
  return row ? torrentFromRow(row) : undefined
}

export async function insertTorrents(records: TorrentRecord[]) {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const record of records) upsertTorrent(db, record)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function updateTorrent(record: TorrentRecord) {
  const db = await readyDb()
  upsertTorrent(db, record)
}

export async function updateTorrents(records: TorrentRecord[]) {
  await insertTorrents(records)
}

export async function deleteTorrents(ids: string[]) {
  const db = await readyDb()
  if (!ids.length) return { deletedCount: 0, missingIds: [] }
  const existing = db.prepare(`SELECT id FROM torrents WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: string }[]
  const existingIds = new Set(existing.map((item) => item.id))
  db.prepare(`DELETE FROM torrents WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
  return { deletedCount: existingIds.size, missingIds: ids.filter((id) => !existingIds.has(id)) }
}
