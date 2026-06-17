import { stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  defaultSystemSettings,
  findUserByUsername,
  readStorageMigrationStatus,
  readStorageSchemaVersion,
  readSystemSettings,
  readSystemSettingsMeta,
  storagePaths,
  type SystemSettings,
  writeSystemSettings
} from '../storage.js'
import { recordOperationLog } from '../utils/logger.js'
import { verifyPassword } from '../utils/password.js'

export const settingsRouter = Router()

const startedAt = new Date().toISOString()
const settingsKeys = Object.keys(defaultSystemSettings) as Array<keyof SystemSettings>
const publicSettingsKeys = settingsKeys.filter((key) => key !== 'proxyTestUrl')
type PublicSystemSettings = Omit<SystemSettings, 'proxyTestUrl'>

function publicSettings(settings: SystemSettings): PublicSystemSettings {
  const { proxyTestUrl: _proxyTestUrl, ...rest } = settings
  return rest
}

function isIntegerInRange(value: unknown, min: number, max: number) {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
}

function validateSettings(payload: unknown, allowInternalKeys = false): { settings?: SystemSettings; message?: string; code?: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { message: '设置内容不正确', code: 'INVALID_SETTINGS' }
  }

  const record = payload as Record<string, unknown>
  const allowedKeys = allowInternalKeys ? settingsKeys : publicSettingsKeys
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.includes(key as keyof SystemSettings))
  if (unknownKey) return { message: `不支持的设置项：${unknownKey}`, code: 'UNKNOWN_SETTING_KEY' }

  const settings = { ...defaultSystemSettings, ...record } as SystemSettings

  if (!isIntegerInRange(settings.sessionTtlHours, 1, 720)) {
    return { message: '登录态有效期需在 1-720 小时之间', code: 'INVALID_SESSION_TTL' }
  }
  if (!isIntegerInRange(settings.requestTimeoutMs, 3000, 120000)) {
    return { message: '请求超时时间需在 3000-120000 ms 之间', code: 'INVALID_REQUEST_TIMEOUT' }
  }
  try {
    const url = new URL(String(settings.proxyTestUrl))
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol')
  } catch {
    return { message: '代理测试目标 URL 不正确', code: 'INVALID_PROXY_TEST_URL' }
  }
  if (!isIntegerInRange(settings.maxConcurrentTasks, 1, 10)) {
    return { message: '最大并发任务数需在 1-10 之间', code: 'INVALID_CONCURRENT_TASKS' }
  }
  const userAgent = String(settings.defaultUserAgent ?? '').trim()
  if (userAgent.length < 20 || userAgent.length > 300) {
    return { message: '默认 User-Agent 需为 20-300 字', code: 'INVALID_USER_AGENT' }
  }

  return {
    settings: {
      sessionTtlHours: Number(settings.sessionTtlHours),
      requestTimeoutMs: Number(settings.requestTimeoutMs),
      proxyTestUrl: String(settings.proxyTestUrl).trim(),
      maxConcurrentTasks: Number(settings.maxConcurrentTasks),
      defaultUserAgent: userAgent
    }
  }
}

async function packageVersion() {
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const packagePath = path.join(backendDir, 'package.json')
  try {
    const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as { version?: string }
    return pkg.version || 'dev'
  } catch {
    return 'dev'
  }
}

async function fileSize(filePath: string) {
  try {
    return (await stat(filePath)).size
  } catch {
    return undefined
  }
}

function changedKeys(before: SystemSettings, after: SystemSettings) {
  return settingsKeys.filter((key) => before[key] !== after[key])
}

settingsRouter.get('/system-info', requireAuth, async (_req, res) => {
  const admin = await findUserByUsername('admin')
  const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD ?? '123456'

  res.json({
    version: await packageVersion(),
    runtimeEnv: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    startedAt,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    database: {
      type: 'sqlite',
      path: storagePaths.dbFile,
      sizeBytes: await fileSize(storagePaths.dbFile),
      schemaVersion: await readStorageSchemaVersion(),
      lastMigrationStatus: await readStorageMigrationStatus()
    },
    paths: {
      dataDir: storagePaths.dataDir,
      logDir: storagePaths.logDir,
      cacheDir: storagePaths.cacheDir
    },
    security: {
      defaultPasswordInUse: admin ? await verifyPassword(defaultPassword, admin.passwordHash) : false
    }
  })
})

settingsRouter.get('/', requireAuth, async (_req, res) => {
  const meta = await readSystemSettingsMeta()
  res.json({ settings: publicSettings(meta.settings), updatedAt: meta.updatedAt })
})

settingsRouter.post('/validate', requireAuth, async (req, res) => {
  const result = validateSettings(req.body)
  if (!result.settings) return res.status(400).json({ message: result.message, code: result.code })
  res.json({ settings: publicSettings(result.settings) })
})

settingsRouter.put('/', requireAuth, async (req, res) => {
  const currentSettings = await readSystemSettings()
  const publicResult = validateSettings(req.body)
  if (!publicResult.settings) return res.status(400).json({ message: publicResult.message, code: publicResult.code })
  const result = validateSettings({ ...currentSettings, ...req.body }, true)
  if (!result.settings) return res.status(400).json({ message: result.message, code: result.code })

  const before = currentSettings
  const changed = changedKeys(before, result.settings)
  const updatedAt = new Date().toISOString()
  await writeSystemSettings(result.settings, updatedAt)

  await recordOperationLog({
    action: 'SETTINGS_UPDATE',
    message: changed.length ? `更新系统设置：${changed.join(', ')}` : '保存系统设置',
    actorId: res.locals.user.id,
    actorName: res.locals.user.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })

  res.json({ settings: publicSettings(result.settings), updatedAt })
})
