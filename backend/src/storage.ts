import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
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

export type SigninLogRecord = {
  id: string
  type: 'SIGNIN'
  siteId: string
  siteName: string
  runMode: 'AUTO' | 'MANUAL'
  triggerSource: 'scheduler' | 'manual-button'
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  message: string
  errorMessage?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  createdAt: string
}

export type TorrentLogEvent =
  | 'INSERTED'
  | 'PUSHED'
  | 'PUSH_FAILED'
  | 'AUTO_DELETE_TASK'
  | 'MANUAL_DELETE_TASK'
  | 'DELETE_RECORD'
  | 'UPDATE_SETTINGS'

export type TorrentLogRecord = {
  id: string
  type: 'TORRENT'
  torrentId?: string
  siteId?: string
  siteName?: string
  torrentTitle: string
  event: TorrentLogEvent
  status: 'SUCCESS' | 'FAILED'
  message: string
  reason?: string
  source?: 'AUTO' | 'MANUAL' | 'SCHEDULER' | 'TASK'
  actorId?: string
  actorName?: string
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
  deleteOnFreeExpire?: boolean
  lowUploadKbps?: number
  lowUploadMinutes?: number
  autoPush: boolean
  discountTypes: Array<'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'>
  seederCondition?: 'GT' | 'EQ' | 'LT'
  seederCount?: number
  sizeMinGb?: number
  sizeMaxGb?: number
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
  deleteOnFreeExpire?: boolean
  lowUploadKbps?: number
  lowUploadMinutes?: number
  lowUploadSince?: string
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
  hasIpv6Peers?: boolean
  ipv6PeerCount?: number
  totalPeerCount?: number
  peerSyncRid?: number
  peerSyncedAt?: string
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
  name: string
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
  signinEnabled: boolean
  signinTime: string
  lastSigninAt?: string
  lastSigninStatus?: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  lastSigninMessage?: string
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
  hasIpv6Peers?: boolean
  ipv6TorrentCount?: number
  ipv6SyncedAt?: string
  createdAt: string
  updatedAt: string
}

type AppStateMigrationPayload = {
  users?: UserRecord[]
  operationLogs?: OperationLogRecord[]
  taskLogs?: TaskLogRecord[]
  scheduleLogs?: ScheduleLogRecord[]
  sites?: SiteRecord[]
  proxies?: ProxyRecord[]
  downloaders?: DownloaderRecord[]
  tasks?: TaskRecord[]
  torrents?: TorrentRecord[]
  siteTrafficSnapshots?: SiteTrafficSnapshotRecord[]
  systemSettings?: SystemSettings
  systemSettingsUpdatedAt?: string
}

export type LogType = 'operation' | 'task' | 'schedule' | 'signin' | 'torrent'

export type LogQuery = {
  type: LogType
  page: number
  pageSize: number
  keyword?: string
  status?: string
  taskId?: string
  runMode?: string
  siteId?: string
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
}

export type TorrentTrafficSample = {
  torrentId: string
  siteId: string
  siteName: string
  uploaded: number
  downloaded: number
}

export type SiteStatisticsQuery = {
  startDate: string
  endDate: string
  siteId?: string
  page: number
  pageSize: number
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data')
const dbFile = path.join(dataDir, 'app.db')
const legacyStateFile = path.join(dataDir, 'app-state.json')
const schemaVersion = 11

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

async function initialAdminUser(): Promise<UserRecord> {
  return {
    id: 'admin',
    username: 'admin',
    passwordHash: await createPasswordHash(process.env.DEFAULT_ADMIN_PASSWORD ?? '123456')
  }
}

function normalizeMigratedState(state: Partial<AppStateMigrationPayload>): AppStateMigrationPayload {
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
      const sizeMinGbRaw = Number(task.sizeMinGb)
      const sizeMaxGbRaw = Number(task.sizeMaxGb)
      const sizeMinGb = Number.isFinite(sizeMinGbRaw) && Number.isInteger(sizeMinGbRaw) && sizeMinGbRaw >= 0 ? sizeMinGbRaw : 0
      const sizeMaxGb = Number.isFinite(sizeMaxGbRaw) && Number.isInteger(sizeMaxGbRaw) && sizeMaxGbRaw >= 0 ? sizeMaxGbRaw : 0
      const torrentCountCondition = ['GT', 'EQ', 'LT'].includes(task.torrentCountCondition ?? '') ? task.torrentCountCondition : undefined
      return {
        ...task,
        onlyFreeDownload: Boolean(task.onlyFreeDownload),
        deleteOnFreeExpire: Boolean(task.deleteOnFreeExpire),
        lowUploadKbps: Number.isFinite(Number(task.lowUploadKbps)) && Number(task.lowUploadKbps) > 0 ? Number(task.lowUploadKbps) : undefined,
        lowUploadMinutes: Number.isFinite(Number(task.lowUploadMinutes)) && Number(task.lowUploadMinutes) >= 1 ? Number(task.lowUploadMinutes) : undefined,
        discountTypes: normalizedDiscountTypes,
        sizeCondition: undefined,
        sizeMb: undefined,
        sizeMinGb,
        sizeMaxGb,
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
    sites: (state.sites ?? [])
      .filter((site) => typeof site.domain === 'string')
      .map((site) => ({ ...site, name: site.name?.trim() || site.domain })),
    proxies: state.proxies ?? [],
    downloaders: (state.downloaders ?? []).filter((downloader) => typeof downloader.name === 'string'),
    tasks,
    torrents: (state.torrents ?? [])
      .filter((torrent) => typeof torrent.title === 'string')
      .map((torrent) => ({
        ...torrent,
        onlyFreeDownload: Boolean(torrent.onlyFreeDownload),
        deleteOnFreeExpire: Boolean(torrent.deleteOnFreeExpire),
        lowUploadKbps: Number.isFinite(Number(torrent.lowUploadKbps)) && Number(torrent.lowUploadKbps) > 0 ? Number(torrent.lowUploadKbps) : undefined,
        lowUploadMinutes: Number.isFinite(Number(torrent.lowUploadMinutes)) && Number(torrent.lowUploadMinutes) >= 1 ? Number(torrent.lowUploadMinutes) : undefined
      })),
    siteTrafficSnapshots: (state.siteTrafficSnapshots ?? []).filter((snapshot) => typeof snapshot.siteId === 'string' && typeof snapshot.date === 'string'),
    systemSettings,
    systemSettingsUpdatedAt: state.systemSettingsUpdatedAt
  }
}

let database: DatabaseSync | undefined
let storageReady: Promise<void> | undefined

async function readJsonFile(filePath: string): Promise<Partial<AppStateMigrationPayload> | undefined> {
  try {
    const fs = await import('node:fs/promises')
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as Partial<AppStateMigrationPayload>
  } catch {
    return undefined
  }
}

function tryRemoveLegacyStateFile() {
  try {
    if (existsSync(legacyStateFile)) unlinkSync(legacyStateFile)
  } catch {
    // 忽略删除失败，避免影响正常启动
  }
}

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
      name TEXT NOT NULL,
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
      signin_enabled INTEGER NOT NULL DEFAULT 0,
      signin_time TEXT NOT NULL DEFAULT '09:00',
      last_signin_at TEXT,
      last_signin_status TEXT,
      last_signin_message TEXT,
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
      has_ipv6_peers INTEGER,
      ipv6_torrent_count INTEGER,
      ipv6_synced_at TEXT,
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
      delete_on_free_expire INTEGER NOT NULL DEFAULT 0,
      low_upload_kbps INTEGER,
      low_upload_minutes INTEGER,
      auto_push INTEGER NOT NULL,
      discount_types_json TEXT NOT NULL,
      seeder_condition TEXT,
      seeder_count INTEGER,
      size_min_gb REAL,
      size_max_gb REAL,
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
      delete_on_free_expire INTEGER NOT NULL DEFAULT 0,
      low_upload_kbps INTEGER,
      low_upload_minutes INTEGER,
      low_upload_since TEXT,
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
      download_url TEXT,
      has_ipv6_peers INTEGER,
      ipv6_peer_count INTEGER,
      total_peer_count INTEGER,
      peer_sync_rid INTEGER,
      peer_synced_at TEXT
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
    CREATE TABLE IF NOT EXISTS site_signin_logs (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      run_mode TEXT NOT NULL,
      trigger_source TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      error_message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS torrent_logs (
      id TEXT PRIMARY KEY,
      torrent_id TEXT,
      site_id TEXT,
      site_name TEXT,
      torrent_title TEXT NOT NULL,
      event TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      reason TEXT,
      source TEXT,
      actor_id TEXT,
      actor_name TEXT,
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
    CREATE TABLE IF NOT EXISTS site_torrent_traffic_daily (
      date TEXT NOT NULL,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      uploaded REAL NOT NULL DEFAULT 0,
      downloaded REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (date, site_id)
    );
    CREATE TABLE IF NOT EXISTS torrent_traffic_cursors (
      torrent_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      uploaded REAL NOT NULL DEFAULT 0,
      downloaded REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_site_torrent_traffic_daily_site_date ON site_torrent_traffic_daily(site_id, date);
    CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_logs_created ON task_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_logs_task_created ON task_logs(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_schedule_logs_created ON schedule_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_site_signin_logs_created ON site_signin_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_site_signin_logs_site ON site_signin_logs(site_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_torrent_logs_created ON torrent_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_torrent_logs_torrent ON torrent_logs(torrent_id, created_at DESC);
  `)
}

function userVersion(db: DatabaseSync) {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return Number(row.user_version ?? 0)
}

function setMeta(db: DatabaseSync, key: string, value: string) {
  db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

function readDbLegacyState(db: DatabaseSync): Partial<AppStateMigrationPayload> | undefined {
  const row = db.prepare('SELECT state_json FROM app_state WHERE id = 1').get() as { state_json?: string } | undefined
  if (!row?.state_json) return undefined
  try {
    return JSON.parse(row.state_json) as Partial<AppStateMigrationPayload>
  } catch {
    return undefined
  }
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

    if (currentVersion >= 2) {
      migrateStructuredDatabase(db, currentVersion)
      return
    }

    const stateFromDb = readDbLegacyState(db)
    const stateFromFile = !stateFromDb && existsSync(legacyStateFile) ? await readJsonFile(legacyStateFile) : undefined
    const source = stateFromDb ? 'app_state' : stateFromFile ? legacyStateFile : 'initial'
    const state = normalizeMigratedState(stateFromDb ?? stateFromFile ?? {})

    db.exec('BEGIN IMMEDIATE')
    try {
      if (state.users?.length) {
        for (const item of state.users) upsertUser(db, item)
      } else {
        upsertUser(db, await initialAdminUser())
      }
      for (const item of state.sites ?? []) upsertSite(db, item)
      for (const item of state.proxies ?? []) upsertProxy(db, item)
      for (const item of state.downloaders ?? []) upsertDownloader(db, item)
      for (const item of state.tasks ?? []) upsertTask(db, item)
      for (const item of state.torrents ?? []) upsertTorrent(db, item)
      for (const item of state.operationLogs ?? []) upsertOperationLog(db, item)
      for (const item of state.taskLogs ?? []) upsertTaskLog(db, item)
      for (const item of state.scheduleLogs ?? []) upsertScheduleLog(db, item)
      for (const item of state.siteTrafficSnapshots ?? []) upsertSnapshot(db, item)
      db.prepare('INSERT INTO system_settings (id, settings_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at')
        .run(json(state.systemSettings ?? defaultSystemSettings), optional(state.systemSettingsUpdatedAt))
      seedTorrentTrafficStatistics(db, new Date().toISOString())
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

function localDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function seedTorrentTrafficStatistics(db: DatabaseSync, migratedAt: string) {
  const alreadySeeded = db.prepare('SELECT value FROM app_meta WHERE key = ?').get('torrent_traffic_seeded_at') as { value?: string } | undefined
  if (alreadySeeded?.value) return

  const date = localDateKey(new Date(migratedAt))
  db.prepare(`
    INSERT INTO site_torrent_traffic_daily (date, site_id, site_name, uploaded, downloaded, updated_at)
    SELECT ?, site_id, site_name, SUM(COALESCE(uploaded, 0)), SUM(COALESCE(downloaded, 0)), ?
    FROM torrents
    WHERE COALESCE(uploaded, 0) > 0 OR COALESCE(downloaded, 0) > 0
    GROUP BY site_id, site_name
    ON CONFLICT(date, site_id) DO UPDATE SET
      uploaded = site_torrent_traffic_daily.uploaded + excluded.uploaded,
      downloaded = site_torrent_traffic_daily.downloaded + excluded.downloaded,
      site_name = excluded.site_name,
      updated_at = excluded.updated_at
  `).run(date, migratedAt)
  db.prepare(`
    INSERT INTO torrent_traffic_cursors (torrent_id, site_id, site_name, uploaded, downloaded, updated_at)
    SELECT id, site_id, site_name, COALESCE(uploaded, 0), COALESCE(downloaded, 0), ? FROM torrents
    WHERE 1
    ON CONFLICT(torrent_id) DO NOTHING
  `).run(migratedAt)
  setMeta(db, 'torrent_traffic_seeded_at', migratedAt)
}

function migrateStructuredDatabase(db: DatabaseSync, currentVersion: number) {
  const migratedAt = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    if (currentVersion < 3) {
      if (!tableHasColumn(db, 'tasks', 'torrent_count_condition')) db.exec('ALTER TABLE tasks ADD COLUMN torrent_count_condition TEXT')
      if (!tableHasColumn(db, 'tasks', 'torrent_count')) db.exec('ALTER TABLE tasks ADD COLUMN torrent_count INTEGER')
    }
    if (currentVersion < 4) {
      if (!tableHasColumn(db, 'torrents', 'has_ipv6_peers')) db.exec('ALTER TABLE torrents ADD COLUMN has_ipv6_peers INTEGER')
      if (!tableHasColumn(db, 'torrents', 'ipv6_peer_count')) db.exec('ALTER TABLE torrents ADD COLUMN ipv6_peer_count INTEGER')
      if (!tableHasColumn(db, 'torrents', 'total_peer_count')) db.exec('ALTER TABLE torrents ADD COLUMN total_peer_count INTEGER')
      if (!tableHasColumn(db, 'torrents', 'peer_sync_rid')) db.exec('ALTER TABLE torrents ADD COLUMN peer_sync_rid INTEGER')
      if (!tableHasColumn(db, 'torrents', 'peer_synced_at')) db.exec('ALTER TABLE torrents ADD COLUMN peer_synced_at TEXT')
      if (!tableHasColumn(db, 'downloaders', 'has_ipv6_peers')) db.exec('ALTER TABLE downloaders ADD COLUMN has_ipv6_peers INTEGER')
      if (!tableHasColumn(db, 'downloaders', 'ipv6_torrent_count')) db.exec('ALTER TABLE downloaders ADD COLUMN ipv6_torrent_count INTEGER')
      if (!tableHasColumn(db, 'downloaders', 'ipv6_synced_at')) db.exec('ALTER TABLE downloaders ADD COLUMN ipv6_synced_at TEXT')
    }
    if (currentVersion < 5) {
      if (!tableHasColumn(db, 'tasks', 'size_min_gb')) db.exec('ALTER TABLE tasks ADD COLUMN size_min_gb REAL')
      if (!tableHasColumn(db, 'tasks', 'size_max_gb')) db.exec('ALTER TABLE tasks ADD COLUMN size_max_gb REAL')
    }
    if (currentVersion < 6) seedTorrentTrafficStatistics(db, migratedAt)
    if (currentVersion < 7) {
      // v7 移除对旧版 JSON 存储的依赖：删掉 app_state 单行表与磁盘上的 app-state.json 文件
      dropLegacyStateTable(db)
      tryRemoveLegacyStateFile()
    }
    if (currentVersion < 8) {
      // v8 站点签到：扩展 sites 表并新建 site_signin_logs
      if (!tableHasColumn(db, 'sites', 'signin_enabled')) db.exec('ALTER TABLE sites ADD COLUMN signin_enabled INTEGER NOT NULL DEFAULT 0')
      if (!tableHasColumn(db, 'sites', 'signin_time')) db.exec("ALTER TABLE sites ADD COLUMN signin_time TEXT NOT NULL DEFAULT '09:00'")
      if (!tableHasColumn(db, 'sites', 'last_signin_at')) db.exec('ALTER TABLE sites ADD COLUMN last_signin_at TEXT')
      if (!tableHasColumn(db, 'sites', 'last_signin_status')) db.exec('ALTER TABLE sites ADD COLUMN last_signin_status TEXT')
      if (!tableHasColumn(db, 'sites', 'last_signin_message')) db.exec('ALTER TABLE sites ADD COLUMN last_signin_message TEXT')
      db.exec(`
        CREATE TABLE IF NOT EXISTS site_signin_logs (
          id TEXT PRIMARY KEY,
          site_id TEXT NOT NULL,
          site_name TEXT NOT NULL,
          run_mode TEXT NOT NULL,
          trigger_source TEXT NOT NULL,
          status TEXT NOT NULL,
          message TEXT NOT NULL,
          error_message TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          duration_ms INTEGER,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_site_signin_logs_created ON site_signin_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_site_signin_logs_site ON site_signin_logs(site_id, created_at DESC);
      `)
    }
    if (currentVersion < 9) {
      // v9 自我修复：之前 v8 在某些情况下只创建了 site_signin_logs 表，但 sites 的签到列未添加
      if (!tableHasColumn(db, 'sites', 'signin_enabled')) db.exec('ALTER TABLE sites ADD COLUMN signin_enabled INTEGER NOT NULL DEFAULT 0')
      if (!tableHasColumn(db, 'sites', 'signin_time')) db.exec("ALTER TABLE sites ADD COLUMN signin_time TEXT NOT NULL DEFAULT '09:00'")
      if (!tableHasColumn(db, 'sites', 'last_signin_at')) db.exec('ALTER TABLE sites ADD COLUMN last_signin_at TEXT')
      if (!tableHasColumn(db, 'sites', 'last_signin_status')) db.exec('ALTER TABLE sites ADD COLUMN last_signin_status TEXT')
      if (!tableHasColumn(db, 'sites', 'last_signin_message')) db.exec('ALTER TABLE sites ADD COLUMN last_signin_message TEXT')
    }
    if (currentVersion < 10) {
      if (!tableHasColumn(db, 'sites', 'name')) db.exec("ALTER TABLE sites ADD COLUMN name TEXT NOT NULL DEFAULT ''")
      db.exec(`
        UPDATE sites
        SET name = CASE lower(domain)
          WHEN 'm-team.cc' THEN '馒头'
          WHEN 'pt.m-team.cc' THEN '馒头'
          WHEN 'api.m-team.cc' THEN '馒头'
          WHEN 'hhanclub.net' THEN '憨憨'
          WHEN 'www.hhanclub.net' THEN '憨憨'
          WHEN 'hdhome.org' THEN '家园'
          WHEN 'www.hdhome.org' THEN '家园'
          WHEN 'hdkyl.in' THEN '麒麟'
          WHEN 'www.hdkyl.in' THEN '麒麟'
          WHEN 'totheglory.im' THEN '听听歌'
          WHEN 'www.totheglory.im' THEN '听听歌'
          WHEN 'pt.keepfrds.com' THEN '朋友'
          WHEN 'keepfrds.com' THEN '朋友'
          WHEN 'ptchdbits.co' THEN '彩虹岛'
          WHEN 'www.ptchdbits.co' THEN '彩虹岛'
          WHEN 'pterclub.net' THEN '猫站'
          WHEN 'pterclub.com' THEN '猫站'
          WHEN 'www.pterclub.com' THEN '猫站'
          WHEN 'ourbits.club' THEN '我堡'
          WHEN 'www.ourbits.club' THEN '我堡'
          WHEN 'pthome.net' THEN '铂金家'
          WHEN 'www.pthome.net' THEN '铂金家'
          WHEN 'ubits.club' THEN '优堡'
          WHEN 'www.ubits.club' THEN '优堡'
          WHEN 'pttime.org' THEN '时间'
          WHEN 'www.pttime.org' THEN '时间'
          ELSE domain
        END
        WHERE trim(name) = ''
      `)
    }
    if (currentVersion < 11) {
      // v11 下载器删除条件组：tasks/torrents 增加新列；新增 torrent_logs 表
      if (!tableHasColumn(db, 'tasks', 'delete_on_free_expire')) db.exec('ALTER TABLE tasks ADD COLUMN delete_on_free_expire INTEGER NOT NULL DEFAULT 0')
      if (!tableHasColumn(db, 'tasks', 'low_upload_kbps')) db.exec('ALTER TABLE tasks ADD COLUMN low_upload_kbps INTEGER')
      if (!tableHasColumn(db, 'tasks', 'low_upload_minutes')) db.exec('ALTER TABLE tasks ADD COLUMN low_upload_minutes INTEGER')
      if (!tableHasColumn(db, 'torrents', 'delete_on_free_expire')) db.exec('ALTER TABLE torrents ADD COLUMN delete_on_free_expire INTEGER NOT NULL DEFAULT 0')
      if (!tableHasColumn(db, 'torrents', 'low_upload_kbps')) db.exec('ALTER TABLE torrents ADD COLUMN low_upload_kbps INTEGER')
      if (!tableHasColumn(db, 'torrents', 'low_upload_minutes')) db.exec('ALTER TABLE torrents ADD COLUMN low_upload_minutes INTEGER')
      if (!tableHasColumn(db, 'torrents', 'low_upload_since')) db.exec('ALTER TABLE torrents ADD COLUMN low_upload_since TEXT')
      db.exec(`
        CREATE TABLE IF NOT EXISTS torrent_logs (
          id TEXT PRIMARY KEY,
          torrent_id TEXT,
          site_id TEXT,
          site_name TEXT,
          torrent_title TEXT NOT NULL,
          event TEXT NOT NULL,
          status TEXT NOT NULL,
          message TEXT NOT NULL,
          reason TEXT,
          source TEXT,
          actor_id TEXT,
          actor_name TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_torrent_logs_created ON torrent_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_torrent_logs_torrent ON torrent_logs(torrent_id, created_at DESC);
      `)
    }
    setMeta(db, 'schema_version', String(schemaVersion))
    setMeta(db, 'last_migration_status', 'SUCCESS')
    setMeta(db, 'migrated_at', migratedAt)
    setMeta(db, 'migrated_from', `v${currentVersion}-additive`)
    db.exec(`PRAGMA user_version = ${schemaVersion}`)
    db.exec('COMMIT')
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

function dropLegacyStateTable(db: DatabaseSync) {
  db.exec('DROP TABLE IF EXISTS app_state')
}

function upsertUser(db: DatabaseSync, item: UserRecord) {
  db.prepare('INSERT INTO users (id, username, password_hash, password_changed_at, last_login_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash, password_changed_at = excluded.password_changed_at, last_login_at = excluded.last_login_at')
    .run(item.id, item.username, item.passwordHash, optional(item.passwordChangedAt), optional(item.lastLoginAt))
}

function upsertSite(db: DatabaseSync, item: SiteRecord) {
  db.prepare(`INSERT INTO sites (id, name, domain, enabled, api_key, cookie, user_agent, proxy_id, connectivity_status, current_credential, user_level, ratio, ratio_infinite, uploaded, downloaded, traffic_synced_at, last_connected_at, last_connect_error, signin_enabled, signin_time, last_signin_at, last_signin_status, last_signin_message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, domain = excluded.domain, enabled = excluded.enabled, api_key = excluded.api_key, cookie = excluded.cookie, user_agent = excluded.user_agent, proxy_id = excluded.proxy_id, connectivity_status = excluded.connectivity_status, current_credential = excluded.current_credential, user_level = excluded.user_level, ratio = excluded.ratio, ratio_infinite = excluded.ratio_infinite, uploaded = excluded.uploaded, downloaded = excluded.downloaded, traffic_synced_at = excluded.traffic_synced_at, last_connected_at = excluded.last_connected_at, last_connect_error = excluded.last_connect_error, signin_enabled = excluded.signin_enabled, signin_time = excluded.signin_time, last_signin_at = excluded.last_signin_at, last_signin_status = excluded.last_signin_status, last_signin_message = excluded.last_signin_message, created_at = excluded.created_at, updated_at = excluded.updated_at`)
    .run(item.id, item.name, item.domain, bool(item.enabled), optional(item.apiKey), optional(item.cookie), optional(item.userAgent), optional(item.proxyId), item.connectivityStatus, optional(item.currentCredential), optional(item.userLevel), optional(item.ratio), item.ratioInfinite === undefined ? null : bool(item.ratioInfinite), optional(item.uploaded), optional(item.downloaded), optional(item.trafficSyncedAt), optional(item.lastConnectedAt), optional(item.lastConnectError), bool(item.signinEnabled), item.signinTime, optional(item.lastSigninAt), optional(item.lastSigninStatus), optional(item.lastSigninMessage), item.createdAt, item.updatedAt)
}

function upsertProxy(db: DatabaseSync, item: ProxyRecord) {
  db.prepare(`INSERT INTO proxies (id, name, enabled, type, host, port, username, password, last_test_status, last_tested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled, type = excluded.type, host = excluded.host, port = excluded.port, username = excluded.username, password = excluded.password, last_test_status = excluded.last_test_status, last_tested_at = excluded.last_tested_at`)
    .run(item.id, item.name, bool(item.enabled), item.type, item.host, item.port, optional(item.username), optional(item.password), optional(item.lastTestStatus), optional(item.lastTestedAt))
}

function upsertDownloader(db: DatabaseSync, item: DownloaderRecord) {
  db.prepare(`INSERT INTO downloaders (id, name, type, enabled, host, username, password, save_path, status, status_message, last_tested_at, last_synced_at, has_ipv6_peers, ipv6_torrent_count, ipv6_synced_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, enabled = excluded.enabled, host = excluded.host, username = excluded.username, password = excluded.password, save_path = excluded.save_path, status = excluded.status, status_message = excluded.status_message, last_tested_at = excluded.last_tested_at, last_synced_at = excluded.last_synced_at, has_ipv6_peers = excluded.has_ipv6_peers, ipv6_torrent_count = excluded.ipv6_torrent_count, ipv6_synced_at = excluded.ipv6_synced_at, created_at = excluded.created_at, updated_at = excluded.updated_at`)
    .run(item.id, item.name, item.type, bool(item.enabled), item.host, optional(item.username), optional(item.password), optional(item.savePath), item.status, optional(item.statusMessage), optional(item.lastTestedAt), optional(item.lastSyncedAt), item.hasIpv6Peers === undefined ? null : bool(item.hasIpv6Peers), optional(item.ipv6TorrentCount), optional(item.ipv6SyncedAt), item.createdAt, item.updatedAt)
}

function upsertTask(db: DatabaseSync, item: TaskRecord) {
  db.prepare(`INSERT INTO tasks (id, name, site_id, downloader_id, auto_run_enabled, auto_run_started_at, next_run_at, interval_minutes, free_only, only_free_download, delete_on_free_expire, low_upload_kbps, low_upload_minutes, auto_push, discount_types_json, seeder_condition, seeder_count, size_min_gb, size_max_gb, torrent_count_condition, torrent_count, expiring_soon_minutes, save_path_override, category_override, tags_override_json, running, last_run_mode, last_started_at, last_finished_at, last_status, last_summary, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, site_id = excluded.site_id, downloader_id = excluded.downloader_id, auto_run_enabled = excluded.auto_run_enabled, auto_run_started_at = excluded.auto_run_started_at, next_run_at = excluded.next_run_at, interval_minutes = excluded.interval_minutes, free_only = excluded.free_only, only_free_download = excluded.only_free_download, delete_on_free_expire = excluded.delete_on_free_expire, low_upload_kbps = excluded.low_upload_kbps, low_upload_minutes = excluded.low_upload_minutes, auto_push = excluded.auto_push, discount_types_json = excluded.discount_types_json, seeder_condition = excluded.seeder_condition, seeder_count = excluded.seeder_count, size_min_gb = excluded.size_min_gb, size_max_gb = excluded.size_max_gb, torrent_count_condition = excluded.torrent_count_condition, torrent_count = excluded.torrent_count, expiring_soon_minutes = excluded.expiring_soon_minutes, save_path_override = excluded.save_path_override, category_override = excluded.category_override, tags_override_json = excluded.tags_override_json, running = excluded.running, last_run_mode = excluded.last_run_mode, last_started_at = excluded.last_started_at, last_finished_at = excluded.last_finished_at, last_status = excluded.last_status, last_summary = excluded.last_summary, last_error = excluded.last_error, created_at = excluded.created_at, updated_at = excluded.updated_at`)
    .run(item.id, item.name, item.siteId, item.downloaderId, bool(item.autoRunEnabled), optional(item.autoRunStartedAt), optional(item.nextRunAt), item.intervalMinutes, bool(item.freeOnly), bool(item.onlyFreeDownload), bool(item.deleteOnFreeExpire), optional(item.lowUploadKbps), optional(item.lowUploadMinutes), bool(item.autoPush), json(item.discountTypes), optional(item.seederCondition), optional(item.seederCount), item.sizeMinGb ?? 0, item.sizeMaxGb ?? 0, optional(item.torrentCountCondition), optional(item.torrentCount), optional(item.expiringSoonMinutes), optional(item.savePathOverride), optional(item.categoryOverride), item.tagsOverride ? json(item.tagsOverride) : null, bool(item.running), optional(item.lastRunMode), optional(item.lastStartedAt), optional(item.lastFinishedAt), optional(item.lastStatus), optional(item.lastSummary), optional(item.lastError), item.createdAt, item.updatedAt)
}

function upsertTorrent(db: DatabaseSync, item: TorrentRecord) {
  db.prepare(`INSERT INTO torrents (id, site_id, site_name, torrent_id, title, title_lc, size, discount_type, is_free_now, current_state, free_end_at, seeders, leechers, push_status, link_status, only_free_download, delete_on_free_expire, low_upload_kbps, low_upload_minutes, low_upload_since, detail_url, downloader_id, downloader_name, downloader_type, downloader_state, torrent_hash, download_progress, download_state, ratio, upload_speed, download_speed, uploaded, downloaded, task_save_path, downloader_save_path, download_stats_synced_at, source_task_id, source_task_name, source_run_mode, error_message, first_seen_at, last_seen_at, pushed_at, download_url_hash, download_url, has_ipv6_peers, ipv6_peer_count, total_peer_count, peer_sync_rid, peer_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET site_id = excluded.site_id, site_name = excluded.site_name, torrent_id = excluded.torrent_id, title = excluded.title, title_lc = excluded.title_lc, size = excluded.size, discount_type = excluded.discount_type, is_free_now = excluded.is_free_now, current_state = excluded.current_state, free_end_at = excluded.free_end_at, seeders = excluded.seeders, leechers = excluded.leechers, push_status = excluded.push_status, link_status = excluded.link_status, only_free_download = excluded.only_free_download, delete_on_free_expire = excluded.delete_on_free_expire, low_upload_kbps = excluded.low_upload_kbps, low_upload_minutes = excluded.low_upload_minutes, low_upload_since = excluded.low_upload_since, detail_url = excluded.detail_url, downloader_id = excluded.downloader_id, downloader_name = excluded.downloader_name, downloader_type = excluded.downloader_type, downloader_state = excluded.downloader_state, torrent_hash = excluded.torrent_hash, download_progress = excluded.download_progress, download_state = excluded.download_state, ratio = excluded.ratio, upload_speed = excluded.upload_speed, download_speed = excluded.download_speed, uploaded = excluded.uploaded, downloaded = excluded.downloaded, task_save_path = excluded.task_save_path, downloader_save_path = excluded.downloader_save_path, download_stats_synced_at = excluded.download_stats_synced_at, source_task_id = excluded.source_task_id, source_task_name = excluded.source_task_name, source_run_mode = excluded.source_run_mode, error_message = excluded.error_message, first_seen_at = excluded.first_seen_at, last_seen_at = excluded.last_seen_at, pushed_at = excluded.pushed_at, download_url_hash = excluded.download_url_hash, download_url = excluded.download_url, has_ipv6_peers = excluded.has_ipv6_peers, ipv6_peer_count = excluded.ipv6_peer_count, total_peer_count = excluded.total_peer_count, peer_sync_rid = excluded.peer_sync_rid, peer_synced_at = excluded.peer_synced_at`)
    .run(item.id, item.siteId, item.siteName, optional(item.torrentId), item.title, item.title.toLowerCase(), item.size, item.discountType, bool(item.isFreeNow), item.currentState, optional(item.freeEndAt), optional(item.seeders), optional(item.leechers), item.pushStatus, item.linkStatus, bool(item.onlyFreeDownload), bool(item.deleteOnFreeExpire), optional(item.lowUploadKbps), optional(item.lowUploadMinutes), optional(item.lowUploadSince), optional(item.detailUrl), optional(item.downloaderId), optional(item.downloaderName), optional(item.downloaderType), optional(item.downloaderState), optional(item.torrentHash), optional(item.downloadProgress), optional(item.downloadState), optional(item.ratio), optional(item.uploadSpeed), optional(item.downloadSpeed), optional(item.uploaded), optional(item.downloaded), optional(item.taskSavePath), optional(item.downloaderSavePath), optional(item.downloadStatsSyncedAt), optional(item.sourceTaskId), optional(item.sourceTaskName), item.sourceRunMode, optional(item.errorMessage), item.firstSeenAt, item.lastSeenAt, optional(item.pushedAt), optional(item.downloadUrlHash), optional(item.downloadUrl), item.hasIpv6Peers === undefined ? null : bool(item.hasIpv6Peers), optional(item.ipv6PeerCount), optional(item.totalPeerCount), optional(item.peerSyncRid), optional(item.peerSyncedAt))
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

function upsertSigninLog(db: DatabaseSync, item: SigninLogRecord) {
  db.prepare(`INSERT INTO site_signin_logs (id, site_id, site_name, run_mode, trigger_source, status, message, error_message, started_at, finished_at, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET site_id = excluded.site_id, site_name = excluded.site_name, run_mode = excluded.run_mode, trigger_source = excluded.trigger_source, status = excluded.status, message = excluded.message, error_message = excluded.error_message, started_at = excluded.started_at, finished_at = excluded.finished_at, duration_ms = excluded.duration_ms, created_at = excluded.created_at`)
    .run(item.id, item.siteId, item.siteName, item.runMode, item.triggerSource, item.status, item.message, optional(item.errorMessage), item.startedAt, optional(item.finishedAt), optional(item.durationMs), item.createdAt)
}

function upsertTorrentLog(db: DatabaseSync, item: TorrentLogRecord) {
  db.prepare(`INSERT INTO torrent_logs (id, torrent_id, site_id, site_name, torrent_title, event, status, message, reason, source, actor_id, actor_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET torrent_id = excluded.torrent_id, site_id = excluded.site_id, site_name = excluded.site_name, torrent_title = excluded.torrent_title, event = excluded.event, status = excluded.status, message = excluded.message, reason = excluded.reason, source = excluded.source, actor_id = excluded.actor_id, actor_name = excluded.actor_name, created_at = excluded.created_at`)
    .run(item.id, optional(item.torrentId), optional(item.siteId), optional(item.siteName), item.torrentTitle, item.event, item.status, item.message, optional(item.reason), optional(item.source), optional(item.actorId), optional(item.actorName), item.createdAt)
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
    name: row.name || row.domain,
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
    signinEnabled: row.signin_enabled === undefined ? false : fromBool(row.signin_enabled),
    signinTime: row.signin_time ?? '09:00',
    lastSigninAt: row.last_signin_at ?? undefined,
    lastSigninStatus: row.last_signin_status ?? undefined,
    lastSigninMessage: row.last_signin_message ?? undefined,
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
    hasIpv6Peers: row.has_ipv6_peers === null || row.has_ipv6_peers === undefined ? undefined : fromBool(row.has_ipv6_peers),
    ipv6TorrentCount: row.ipv6_torrent_count ?? undefined,
    ipv6SyncedAt: row.ipv6_synced_at ?? undefined,
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
    deleteOnFreeExpire: fromBool(row.delete_on_free_expire),
    lowUploadKbps: row.low_upload_kbps ?? undefined,
    lowUploadMinutes: row.low_upload_minutes ?? undefined,
    autoPush: fromBool(row.auto_push),
    discountTypes: parseJson(row.discount_types_json, defaultTaskDiscountTypes),
    seederCondition: row.seeder_condition ?? undefined,
    seederCount: row.seeder_count ?? undefined,
    sizeMinGb: row.size_min_gb ?? 0,
    sizeMaxGb: row.size_max_gb ?? 0,
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
    deleteOnFreeExpire: fromBool(row.delete_on_free_expire),
    lowUploadKbps: row.low_upload_kbps ?? undefined,
    lowUploadMinutes: row.low_upload_minutes ?? undefined,
    lowUploadSince: row.low_upload_since ?? undefined,
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
    downloadUrl: row.download_url ?? undefined,
    hasIpv6Peers: row.has_ipv6_peers === null || row.has_ipv6_peers === undefined ? undefined : fromBool(row.has_ipv6_peers),
    ipv6PeerCount: row.ipv6_peer_count ?? undefined,
    totalPeerCount: row.total_peer_count ?? undefined,
    peerSyncRid: row.peer_sync_rid ?? undefined,
    peerSyncedAt: row.peer_synced_at ?? undefined
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

function signinLogFromRow(row: any): SigninLogRecord {
  return {
    id: row.id,
    type: 'SIGNIN',
    siteId: row.site_id,
    siteName: row.site_name,
    runMode: row.run_mode,
    triggerSource: row.trigger_source,
    status: row.status,
    message: row.message,
    errorMessage: row.error_message ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    createdAt: row.created_at
  }
}

function torrentLogFromRow(row: any): TorrentLogRecord {
  return {
    id: row.id,
    type: 'TORRENT',
    torrentId: row.torrent_id ?? undefined,
    siteId: row.site_id ?? undefined,
    siteName: row.site_name ?? undefined,
    torrentTitle: row.torrent_title,
    event: row.event,
    status: row.status,
    message: row.message,
    reason: row.reason ?? undefined,
    source: row.source ?? undefined,
    actorId: row.actor_id ?? undefined,
    actorName: row.actor_name ?? undefined,
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

function pruneLogTable(db: DatabaseSync, table: string) {
  db.prepare(`DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY created_at DESC, id DESC LIMIT 1000)`).run()
}

function logTable(type: LogType) {
  return type === 'task'
    ? 'task_logs'
    : type === 'schedule'
      ? 'schedule_logs'
      : type === 'signin'
        ? 'site_signin_logs'
        : type === 'torrent'
          ? 'torrent_logs'
          : 'operation_logs'
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
  } else if (query.type === 'signin') {
    if (query.siteId) {
      clauses.push('site_id = ?')
      params.push(query.siteId)
    }
    if (query.runMode && query.runMode !== 'ALL') {
      clauses.push('run_mode = ?')
      params.push(query.runMode)
    }
    if (keyword) {
      clauses.push("lower(site_name || ' ' || message || ' ' || coalesce(error_message, '')) LIKE ?")
      params.push(`%${keyword}%`)
    }
  } else if (query.type === 'torrent') {
    if (keyword) {
      clauses.push("lower(torrent_title || ' ' || coalesce(site_name, '') || ' ' || message || ' ' || coalesce(reason, '') || ' ' || coalesce(event, '') || ' ' || coalesce(actor_name, '')) LIKE ?")
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

export async function readSystemSettings(): Promise<SystemSettings> {
  const db = await readyDb()
  return systemSettingsFromDb(db).settings
}

export async function readSystemSettingsMeta(): Promise<{ settings: SystemSettings; updatedAt?: string }> {
  const db = await readyDb()
  return systemSettingsFromDb(db)
}

export async function writeSystemSettings(settings: SystemSettings, updatedAt: string): Promise<void> {
  const db = await readyDb()
  db.prepare('INSERT INTO system_settings (id, settings_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at')
    .run(json(settings), updatedAt)
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

export async function appendSigninLog(payload: Omit<SigninLogRecord, 'id' | 'type' | 'createdAt'>) {
  const db = await readyDb()
  const log: SigninLogRecord = {
    id: randomUUID(),
    type: 'SIGNIN',
    createdAt: new Date().toISOString(),
    ...payload
  }
  upsertSigninLog(db, log)
  pruneLogTable(db, 'site_signin_logs')
  return log
}

export async function appendTorrentLog(payload: Omit<TorrentLogRecord, 'id' | 'type' | 'createdAt'>) {
  const db = await readyDb()
  const log: TorrentLogRecord = {
    id: randomUUID(),
    type: 'TORRENT',
    createdAt: new Date().toISOString(),
    ...payload
  }
  upsertTorrentLog(db, log)
  pruneLogTable(db, 'torrent_logs')
  return log
}

export async function listLatestSigninLogBySiteAndDate(siteId: string, dateKey: string): Promise<SigninLogRecord | undefined> {
  const db = await readyDb()
  const row = db.prepare(
    'SELECT * FROM site_signin_logs WHERE site_id = ? AND substr(created_at, 1, 10) = ? ORDER BY created_at DESC, id DESC LIMIT 1'
  ).get(siteId, dateKey) as any
  return row ? signinLogFromRow(row) : undefined
}

export async function clearLogsByType(type: LogType) {
  const db = await readyDb()
  const table = logTable(type)
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }
  db.prepare(`DELETE FROM ${table}`).run()
  return { clearedCount: Number(row.total ?? 0) }
}

export async function queryLogs<T extends OperationLogRecord | TaskLogRecord | ScheduleLogRecord | SigninLogRecord | TorrentLogRecord>(query: LogQuery) {
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
        : query.type === 'signin'
          ? rows.map(signinLogFromRow)
          : query.type === 'torrent'
            ? rows.map(torrentLogFromRow)
            : rows.map(operationLogFromRow)
  return { items: items as T[], total: Number(totalRow.total ?? 0), page, pageSize }
}

export async function queryAllLogs<T extends OperationLogRecord | TaskLogRecord | ScheduleLogRecord | SigninLogRecord | TorrentLogRecord>(type: LogType) {
  const db = await readyDb()
  const rows = db.prepare(`SELECT * FROM ${logTable(type)} ORDER BY created_at DESC, id DESC`).all() as any[]
  const items =
    type === 'task'
      ? rows.map(taskLogFromRow)
      : type === 'schedule'
        ? rows.map(scheduleLogFromRow)
        : type === 'signin'
          ? rows.map(signinLogFromRow)
          : type === 'torrent'
            ? rows.map(torrentLogFromRow)
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

export async function listAllTorrents(query: Omit<TorrentQuery, 'page' | 'pageSize'> = {}) {
  const db = await readyDb()
  const where = torrentWhere(query)
  const rows = db.prepare(`SELECT * FROM torrents ${where.sql} ORDER BY first_seen_at DESC, id DESC`).all(...(where.params as any[])) as any[]
  return rows.map(torrentFromRow)
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
    totalDownloaded: Number(row.total_downloaded ?? 0)
  }
}

export async function recordTorrentTraffic(samples: TorrentTrafficSample[], syncedAt: string) {
  if (!samples.length) return { uploadedDelta: 0, downloadedDelta: 0, updatedCount: 0 }
  const db = await readyDb()
  const date = localDateKey(new Date(syncedAt))
  let uploadedDelta = 0
  let downloadedDelta = 0
  let updatedCount = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    const readCursor = db.prepare('SELECT uploaded, downloaded FROM torrent_traffic_cursors WHERE torrent_id = ?')
    const upsertCursor = db.prepare(`
      INSERT INTO torrent_traffic_cursors (torrent_id, site_id, site_name, uploaded, downloaded, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(torrent_id) DO UPDATE SET site_id = excluded.site_id, site_name = excluded.site_name,
        uploaded = excluded.uploaded, downloaded = excluded.downloaded, updated_at = excluded.updated_at
    `)
    const addDaily = db.prepare(`
      INSERT INTO site_torrent_traffic_daily (date, site_id, site_name, uploaded, downloaded, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, site_id) DO UPDATE SET site_name = excluded.site_name,
        uploaded = site_torrent_traffic_daily.uploaded + excluded.uploaded,
        downloaded = site_torrent_traffic_daily.downloaded + excluded.downloaded,
        updated_at = excluded.updated_at
    `)

    for (const sample of samples) {
      const currentUploaded = Number.isFinite(sample.uploaded) ? Math.max(sample.uploaded, 0) : 0
      const currentDownloaded = Number.isFinite(sample.downloaded) ? Math.max(sample.downloaded, 0) : 0
      const cursor = readCursor.get(sample.torrentId) as { uploaded: number; downloaded: number } | undefined
      const uploadIncrement = cursor && currentUploaded >= cursor.uploaded ? currentUploaded - cursor.uploaded : cursor ? 0 : currentUploaded
      const downloadIncrement = cursor && currentDownloaded >= cursor.downloaded ? currentDownloaded - cursor.downloaded : cursor ? 0 : currentDownloaded
      upsertCursor.run(sample.torrentId, sample.siteId, sample.siteName, currentUploaded, currentDownloaded, syncedAt)
      if (uploadIncrement > 0 || downloadIncrement > 0) {
        addDaily.run(date, sample.siteId, sample.siteName, uploadIncrement, downloadIncrement, syncedAt)
        uploadedDelta += uploadIncrement
        downloadedDelta += downloadIncrement
        updatedCount += 1
      }
    }
    db.exec('COMMIT')
    return { uploadedDelta, downloadedDelta, updatedCount }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function readSiteStatistics(query: SiteStatisticsQuery) {
  const db = await readyDb()
  const siteClause = query.siteId ? 'AND daily.site_id = ?' : ''
  const params: Array<string | number> = [query.startDate, query.endDate]
  if (query.siteId) params.push(query.siteId)
  const countRow = db.prepare(`
    SELECT COUNT(DISTINCT daily.site_id) AS total
    FROM site_torrent_traffic_daily daily
    WHERE daily.date BETWEEN ? AND ? ${siteClause}
  `).get(...params) as { total: number }
  const total = Number(countRow.total ?? 0)
  const page = Math.max(Math.floor(query.page), 1)
  const pageSize = Math.min(Math.max(Math.floor(query.pageSize), 1), 100)
  const rows = db.prepare(`
    SELECT daily.site_id, MAX(daily.site_name) AS site_name,
      SUM(daily.uploaded) AS uploaded, SUM(daily.downloaded) AS downloaded,
      CASE WHEN sites.id IS NULL THEN 1 ELSE 0 END AS site_deleted
    FROM site_torrent_traffic_daily daily
    LEFT JOIN sites ON sites.id = daily.site_id
    WHERE daily.date BETWEEN ? AND ? ${siteClause}
    GROUP BY daily.site_id, sites.id
    ORDER BY SUM(daily.uploaded) + SUM(daily.downloaded) DESC, site_name
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize) as any[]
  const totals = db.prepare(`
    SELECT COALESCE(SUM(daily.uploaded), 0) AS uploaded, COALESCE(SUM(daily.downloaded), 0) AS downloaded
    FROM site_torrent_traffic_daily daily
    WHERE daily.date BETWEEN ? AND ? ${siteClause}
  `).get(...params) as any
  const allTimeClause = query.siteId ? 'WHERE daily.site_id = ?' : ''
  const allTimeParams: Array<string | number> = []
  if (query.siteId) allTimeParams.push(query.siteId)
  const allTimeRow = db.prepare(`
    SELECT
      COALESCE(SUM(daily.uploaded), 0) AS uploaded,
      COALESCE(SUM(daily.downloaded), 0) AS downloaded,
      COUNT(DISTINCT daily.site_id) AS siteCount
    FROM site_torrent_traffic_daily daily
    ${allTimeClause}
  `).get(...allTimeParams) as any
  const siteIds = rows.map((row) => String(row.site_id))
  const siteOptions = (db.prepare(`
    SELECT daily.site_id, MAX(daily.site_name) AS site_name, CASE WHEN sites.id IS NULL THEN 1 ELSE 0 END AS site_deleted
    FROM site_torrent_traffic_daily daily
    LEFT JOIN sites ON sites.id = daily.site_id
    GROUP BY daily.site_id, sites.id
    ORDER BY site_name
  `).all() as any[]).map((row) => ({
    siteId: String(row.site_id),
    siteName: String(row.site_name),
    siteDeleted: Boolean(row.site_deleted)
  }))
  const dailyRows = siteIds.length
    ? db.prepare(`
        SELECT date, site_id, site_name, uploaded, downloaded
        FROM site_torrent_traffic_daily
        WHERE date BETWEEN ? AND ? AND site_id IN (${siteIds.map(() => '?').join(',')})
        ORDER BY date DESC, site_name
      `).all(query.startDate, query.endDate, ...siteIds) as any[]
    : []

  return {
    startDate: query.startDate,
    endDate: query.endDate,
    totalUploaded: Number(totals.uploaded ?? 0),
    totalDownloaded: Number(totals.downloaded ?? 0),
    siteCount: total,
    allTimeUploaded: Number(allTimeRow.uploaded ?? 0),
    allTimeDownloaded: Number(allTimeRow.downloaded ?? 0),
    allTimeSiteCount: Number(allTimeRow.siteCount ?? 0),
    total,
    page,
    pageSize,
    siteOptions,
    items: rows.map((row) => ({
      siteId: String(row.site_id),
      siteName: String(row.site_name),
      siteDeleted: Boolean(row.site_deleted),
      uploaded: Number(row.uploaded ?? 0),
      downloaded: Number(row.downloaded ?? 0),
      daily: dailyRows
        .filter((daily) => daily.site_id === row.site_id)
        .map((daily) => ({
          date: String(daily.date),
          uploaded: Number(daily.uploaded ?? 0),
          downloaded: Number(daily.downloaded ?? 0)
        }))
    }))
  }
}

export async function listTasksFromDb(): Promise<TaskRecord[]> {
  const db = await readyDb()
  return tasksFromDb(db)
}

export async function getTaskFromDb(id: string): Promise<TaskRecord | undefined> {
  const db = await readyDb()
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any
  return row ? taskFromRow(row) : undefined
}

export async function insertTaskToDb(task: TaskRecord): Promise<void> {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    upsertTask(db, task)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function deleteTaskFromDb(id: string): Promise<boolean> {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    db.exec('COMMIT')
    return result.changes > 0
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function updateTaskFieldsInDb(
  id: string,
  fields: Partial<
    Pick<
      TaskRecord,
      | 'name'
      | 'siteId'
      | 'downloaderId'
      | 'autoRunEnabled'
      | 'autoRunStartedAt'
      | 'nextRunAt'
      | 'intervalMinutes'
      | 'freeOnly'
      | 'onlyFreeDownload'
      | 'deleteOnFreeExpire'
      | 'lowUploadKbps'
      | 'lowUploadMinutes'
      | 'autoPush'
      | 'discountTypes'
      | 'seederCondition'
      | 'seederCount'
      | 'sizeMinGb'
      | 'sizeMaxGb'
      | 'torrentCountCondition'
      | 'torrentCount'
      | 'expiringSoonMinutes'
      | 'savePathOverride'
      | 'categoryOverride'
      | 'tagsOverride'
      | 'running'
      | 'lastRunMode'
      | 'lastStartedAt'
      | 'lastFinishedAt'
      | 'lastStatus'
      | 'lastSummary'
      | 'lastError'
      | 'updatedAt'
    >
  >
): Promise<void> {
  const db = await readyDb()
  const assignments: string[] = []
  const values: unknown[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    const column = taskFieldToColumn[key as keyof typeof fields]
    if (!column) continue
    assignments.push(`${column} = ?`)
    values.push(taskFieldToDbValue(key as keyof typeof fields, value))
  }
  if (!assignments.length) return
  values.push(id)
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?`).run(...(values as any[]))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const taskFieldToColumn: Record<string, string> = {
  name: 'name',
  siteId: 'site_id',
  downloaderId: 'downloader_id',
  autoRunEnabled: 'auto_run_enabled',
  autoRunStartedAt: 'auto_run_started_at',
  nextRunAt: 'next_run_at',
  intervalMinutes: 'interval_minutes',
  freeOnly: 'free_only',
  onlyFreeDownload: 'only_free_download',
  deleteOnFreeExpire: 'delete_on_free_expire',
  lowUploadKbps: 'low_upload_kbps',
  lowUploadMinutes: 'low_upload_minutes',
  autoPush: 'auto_push',
  discountTypes: 'discount_types_json',
  seederCondition: 'seeder_condition',
  seederCount: 'seeder_count',
  sizeMinGb: 'size_min_gb',
  sizeMaxGb: 'size_max_gb',
  torrentCountCondition: 'torrent_count_condition',
  torrentCount: 'torrent_count',
  expiringSoonMinutes: 'expiring_soon_minutes',
  savePathOverride: 'save_path_override',
  categoryOverride: 'category_override',
  tagsOverride: 'tags_override_json',
  running: 'running',
  lastRunMode: 'last_run_mode',
  lastStartedAt: 'last_started_at',
  lastFinishedAt: 'last_finished_at',
  lastStatus: 'last_status',
  lastSummary: 'last_summary',
  lastError: 'last_error',
  updatedAt: 'updated_at'
}

function taskFieldToDbValue(key: string, value: unknown): unknown {
  if (key === 'discountTypes' || key === 'tagsOverride') return json(value ?? null)
  if (key === 'autoRunEnabled' || key === 'freeOnly' || key === 'onlyFreeDownload' || key === 'deleteOnFreeExpire' || key === 'autoPush' || key === 'running') {
    return bool(value as boolean | undefined)
  }
  return value === undefined ? null : value
}

function taskFromRow(row: any): TaskRecord {
  return {
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
    deleteOnFreeExpire: fromBool(row.delete_on_free_expire),
    lowUploadKbps: row.low_upload_kbps ?? undefined,
    lowUploadMinutes: row.low_upload_minutes ?? undefined,
    autoPush: fromBool(row.auto_push),
    discountTypes: parseJson(row.discount_types_json, defaultTaskDiscountTypes),
    seederCondition: row.seeder_condition ?? undefined,
    seederCount: row.seeder_count ?? undefined,
    sizeMinGb: row.size_min_gb ?? 0,
    sizeMaxGb: row.size_max_gb ?? 0,
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
  }
}

export async function listProxiesFromDb(): Promise<ProxyRecord[]> {
  const db = await readyDb()
  return proxiesFromDb(db)
}

export async function getProxyFromDb(id: string): Promise<ProxyRecord | undefined> {
  const db = await readyDb()
  const row = db.prepare('SELECT * FROM proxies WHERE id = ?').get(id) as any
  if (!row) return undefined
  return {
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
  }
}

export async function insertProxyToDb(proxy: ProxyRecord): Promise<void> {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    upsertProxy(db, proxy)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function updateProxyInDb(proxy: ProxyRecord): Promise<void> {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    upsertProxy(db, proxy)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function deleteProxyFromDb(id: string): Promise<boolean> {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = db.prepare('DELETE FROM proxies WHERE id = ?').run(id)
    db.exec('COMMIT')
    return result.changes > 0
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function findUserByUsername(username: string): Promise<UserRecord | undefined> {
  const db = await readyDb()
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any
  return row ? userFromRow(row) : undefined
}

export async function findUserById(id: string): Promise<UserRecord | undefined> {
  const db = await readyDb()
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
  return row ? userFromRow(row) : undefined
}

export async function listUsersFromDb(): Promise<UserRecord[]> {
  const db = await readyDb()
  return usersFromDb(db)
}

export async function updateUserLastLoginAt(id: string, lastLoginAt: string): Promise<void> {
  const db = await readyDb()
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(lastLoginAt, id)
}

export async function updateUserPassword(id: string, passwordHash: string, passwordChangedAt: string): Promise<void> {
  const db = await readyDb()
  db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(passwordHash, passwordChangedAt, id)
}

function userFromRow(row: any): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    passwordChangedAt: row.password_changed_at ?? undefined,
    lastLoginAt: row.last_login_at ?? undefined
  }
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

// ============================================================================
// Independent sites repository (operates only on `sites` and
// `site_traffic_snapshots` tables, never touches other tables). Use this from
// site routes and the `site-traffic-sync` scheduler so concurrent writes from
// torrent / task / downloader modules stay isolated to their own tables.
// ============================================================================

export async function listSitesFromDb(): Promise<SiteRecord[]> {
  const db = await readyDb()
  return sitesFromDb(db)
}

export async function getSiteFromDb(id: string): Promise<SiteRecord | undefined> {
  const db = await readyDb()
  const row = db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as any
  if (!row) return undefined
  return sitesFromDbFromRow(row)
}

export async function insertSiteToDb(site: SiteRecord): Promise<void> {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    upsertSite(db, site)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function updateSiteInDb(site: SiteRecord): Promise<void> {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    upsertSite(db, site)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function deleteSiteFromDb(id: string): Promise<boolean> {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = db.prepare('DELETE FROM sites WHERE id = ?').run(id)
    db.exec('COMMIT')
    return result.changes > 0
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function saveSiteTrafficSnapshotToDb(snapshot: SiteTrafficSnapshotRecord): Promise<void> {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    upsertSnapshot(db, snapshot)
    db.exec(`
      DELETE FROM site_traffic_snapshots
      WHERE id NOT IN (
        SELECT id FROM site_traffic_snapshots
        ORDER BY date DESC, synced_at DESC
        LIMIT 3660
      )
    `)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function listSiteTrafficSnapshotsFromDb(): Promise<SiteTrafficSnapshotRecord[]> {
  const db = await readyDb()
  return snapshotsFromDb(db)
}

export async function findLatestSiteSnapshotFromDb(siteId: string, date: string): Promise<SiteTrafficSnapshotRecord | undefined> {
  const db = await readyDb()
  const row = db.prepare(
    'SELECT * FROM site_traffic_snapshots WHERE site_id = ? AND date = ? ORDER BY synced_at DESC LIMIT 1'
  ).get(siteId, date) as any
  return row ? snapshotFromRow(row) : undefined
}

function snapshotFromRow(row: any): SiteTrafficSnapshotRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    siteName: row.site_name,
    date: row.date,
    uploaded: row.uploaded ?? undefined,
    downloaded: row.downloaded ?? undefined,
    ratio: row.ratio ?? undefined,
    ratioInfinite: row.ratio_infinite === null ? undefined : fromBool(row.ratio_infinite),
    syncedAt: row.synced_at
  }
}

function sitesFromDbFromRow(row: any): SiteRecord {
  return {
    id: row.id,
    name: row.name || row.domain,
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
    signinEnabled: row.signin_enabled === undefined ? false : fromBool(row.signin_enabled),
    signinTime: row.signin_time ?? '09:00',
    lastSigninAt: row.last_signin_at ?? undefined,
    lastSigninStatus: row.last_signin_status ?? undefined,
    lastSigninMessage: row.last_signin_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// ============================================================================
// Independent downloaders repository (operates only on the `downloaders` table,
// never touches other tables). Use this from downloader routes so concurrent
// writes from torrent / task / site modules stay isolated to their own tables.
// ============================================================================

export async function listDownloadersFromDb(): Promise<DownloaderRecord[]> {
  const db = await readyDb()
  return downloadersFromDb(db)
}

export async function getDownloaderFromDb(id: string): Promise<DownloaderRecord | undefined> {
  const db = await readyDb()
  const row = db.prepare('SELECT * FROM downloaders WHERE id = ?').get(id) as any
  if (!row) return undefined
  return downloaderFromRow(row)
}

export async function insertDownloaderToDb(downloader: DownloaderRecord): Promise<void> {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    upsertDownloader(db, downloader)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function updateDownloaderInDb(downloader: DownloaderRecord): Promise<void> {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    upsertDownloader(db, downloader)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function deleteDownloaderFromDb(id: string): Promise<boolean> {
  const db = await readyDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = db.prepare('DELETE FROM downloaders WHERE id = ?').run(id)
    db.exec('COMMIT')
    return result.changes > 0
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function downloaderFromRow(row: any): DownloaderRecord {
  return {
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
    hasIpv6Peers: row.has_ipv6_peers === null ? undefined : fromBool(row.has_ipv6_peers),
    ipv6TorrentCount: row.ipv6_torrent_count ?? undefined,
    ipv6SyncedAt: row.ipv6_synced_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
