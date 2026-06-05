import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
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
  discountTypes: Array<'FREE' | 'TWO_X_FREE' | 'HALF_FREE'>
  seederCondition?: 'GT' | 'EQ' | 'LT'
  seederCount?: number
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
  systemSettings: SystemSettings
  systemSettingsUpdatedAt?: string
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data')
const stateFile = path.join(dataDir, 'app-state.json')

export const storagePaths = {
  root,
  dataDir,
  stateFile,
  logDir: path.join(dataDir, 'logs')
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
    systemSettings: defaultSystemSettings
  }
}

function normalizeState(state: Partial<AppState>): AppState {
  const systemSettings = {
    ...defaultSystemSettings,
    ...(state.systemSettings ?? {})
  }

  return {
    users: state.users ?? [],
    operationLogs: state.operationLogs ?? [],
    taskLogs: state.taskLogs ?? [],
    sites: (state.sites ?? []).filter((site) => typeof site.domain === 'string'),
    proxies: state.proxies ?? [],
    downloaders: (state.downloaders ?? []).filter((downloader) => typeof downloader.name === 'string'),
    tasks: (state.tasks ?? []).filter((task) => typeof task.name === 'string'),
    torrents: (state.torrents ?? []).filter((torrent) => typeof torrent.title === 'string'),
    systemSettings,
    systemSettingsUpdatedAt: state.systemSettingsUpdatedAt
  }
}

export async function readState(): Promise<AppState> {
  try {
    const raw = await readFile(stateFile, 'utf8')
    return normalizeState(JSON.parse(raw) as Partial<AppState>)
  } catch (error) {
    const state = await initialState()
    await writeState(state)
    return state
  }
}

export async function writeState(state: AppState) {
  await mkdir(dataDir, { recursive: true })
  await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8')
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
