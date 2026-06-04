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
  message: string
  status: 'SUCCESS' | 'FAILED' | 'RUNNING'
  startedAt?: string
  finishedAt?: string
  createdAt: string
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
  baseUrl: string
  enabled: boolean
  accessKey?: string
  cookie?: string
  userAgent?: string
  parserType: 'NEXUSPHP'
  freeTorrentUrl: string
  profileUrl?: string
  proxyId?: string
  connectivityStatus: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  currentAccessMethod?: 'ACCESS_KEY' | 'COOKIE'
  lastConnectedAt?: string
  lastConnectError?: string
  checkIntervalMinutes: number
  createdAt: string
  updatedAt: string
}

type AppState = {
  users: UserRecord[]
  operationLogs: OperationLogRecord[]
  taskLogs: TaskLogRecord[]
  sites: SiteRecord[]
  proxies: ProxyRecord[]
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data')
const stateFile = path.join(dataDir, 'app-state.json')

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
    proxies: []
  }
}

function normalizeState(state: Partial<AppState>): AppState {
  return {
    users: state.users ?? [],
    operationLogs: state.operationLogs ?? [],
    taskLogs: state.taskLogs ?? [],
    sites: state.sites ?? [],
    proxies: state.proxies ?? []
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
