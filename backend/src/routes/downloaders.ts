import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState, type DownloaderRecord, writeState } from '../storage.js'

export const downloadersRouter = Router()

type DownloaderPayload = {
  name?: string
  type?: 'QBITTORRENT'
  enabled?: boolean
  host?: string
  username?: string
  password?: string
  passwordAction?: 'KEEP' | 'UPDATE' | 'CLEAR'
  savePath?: string
}

type QbTorrent = {
  hash?: string
  name?: string
  size?: number
  progress?: number
  state?: string
  ratio?: number
  category?: string
  tags?: string
  upspeed?: number
  dlspeed?: number
  added_on?: number
}

type QbTransferInfo = {
  up_info_speed?: number
  dl_info_speed?: number
  up_info_data?: number
  dl_info_data?: number
  free_space_on_disk?: number
}

class DownloaderError extends Error {
  constructor(
    public code: 'INVALID_HOST' | 'NETWORK_ERROR' | 'AUTH_FAILED' | 'UNSUPPORTED_TYPE' | 'TIMEOUT',
    message: string
  ) {
    super(message)
  }
}

function normalizeHost(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  const url = new URL(trimmed)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol')
  if (url.username || url.password) throw new Error('credentials in url')
  return url.toString().replace(/\/+$/, '')
}

function validatePayload(payload: DownloaderPayload, stateDownloaders: DownloaderRecord[], existingId?: string) {
  const name = payload.name?.trim()
  if (!name) return '下载器名称不能为空'
  if (name.length > 40) return '下载器名称不能超过 40 个字符'
  if (stateDownloaders.some((downloader) => downloader.id !== existingId && downloader.name.toLowerCase() === name.toLowerCase())) {
    return '下载器名称已存在'
  }
  if (payload.type && payload.type !== 'QBITTORRENT') return '暂不支持该下载器类型'
  if (!payload.host?.trim()) return '服务地址不能为空'
  try {
    normalizeHost(payload.host)
  } catch {
    return '服务地址必须是合法的 http(s) 地址，且不能包含用户名或密码'
  }
  return undefined
}

function listItem(downloader: DownloaderRecord) {
  const { password: _password, ...item } = downloader
  return {
    ...item,
    hasPassword: Boolean(downloader.password)
  }
}

function detailItem(downloader: DownloaderRecord) {
  return {
    ...listItem(downloader),
    password: downloader.password
  }
}

function stats(items: DownloaderRecord[]) {
  return {
    total: items.length,
    online: items.filter((item) => item.status === 'ONLINE').length,
    authFailed: items.filter((item) => item.status === 'AUTH_FAILED').length,
    offline: items.filter((item) => item.status === 'OFFLINE').length,
    unknown: items.filter((item) => item.status === 'UNKNOWN').length
  }
}

function splitTags(value?: string) {
  return value
    ? value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : []
}

function statusFromError(error: unknown) {
  if (error instanceof DownloaderError) {
    return error.code === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'OFFLINE'
  }
  return 'OFFLINE'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '下载器访问失败'
}

async function qbFetch(host: string, path: string, options: RequestInit = {}, timeoutMs = 10000) {
  const url = new URL(path, `${host}/`)
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/json,text/plain,*/*',
        ...(options.headers ?? {})
      }
    })
    return response
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new DownloaderError('TIMEOUT', '连接测试超时')
    }
    throw new DownloaderError('NETWORK_ERROR', '无法连接下载器，请检查地址和网络')
  }
}

async function loginQb(config: Pick<DownloaderRecord, 'host' | 'username' | 'password'>, timeoutMs = 8000) {
  if (!config.username && !config.password) return undefined
  const body = new URLSearchParams({
    username: config.username ?? '',
    password: config.password ?? ''
  })
  const response = await qbFetch(
    config.host,
    '/api/v2/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    },
    timeoutMs
  )
  const text = await response.text()
  if (!response.ok || text.trim().toLowerCase() !== 'ok.') {
    throw new DownloaderError('AUTH_FAILED', '认证失败，请检查用户名和密码')
  }
  return response.headers.get('set-cookie')?.split(';')[0]
}

async function testQb(config: Pick<DownloaderRecord, 'host' | 'username' | 'password'>) {
  const cookie = await loginQb(config, 8000)
  const headers = cookie ? { Cookie: cookie } : undefined
  const versionResponse = await qbFetch(config.host, '/api/v2/app/version', { headers }, 8000)
  if (versionResponse.status === 403) throw new DownloaderError('AUTH_FAILED', '认证失败，请检查用户名和密码')
  if (!versionResponse.ok) throw new DownloaderError('NETWORK_ERROR', `下载器返回 HTTP ${versionResponse.status}`)
  const version = (await versionResponse.text()).trim()
  const transferResponse = await qbFetch(config.host, '/api/v2/transfer/info', { headers }, 8000)
  const transfer = transferResponse.ok ? ((await transferResponse.json()) as QbTransferInfo) : {}
  return {
    success: true,
    status: 'ONLINE' as const,
    message: '连接测试成功',
    version,
    user: config.username,
    uploadSpeed: transfer.up_info_speed ?? 0,
    downloadSpeed: transfer.dl_info_speed ?? 0,
    testedAt: new Date().toISOString()
  }
}

async function getQbStatus(config: DownloaderRecord) {
  const cookie = await loginQb(config, 10000)
  const headers = cookie ? { Cookie: cookie } : undefined
  const response = await qbFetch(config.host, '/api/v2/transfer/info', { headers }, 10000)
  if (response.status === 403) throw new DownloaderError('AUTH_FAILED', '认证失败，请检查用户名和密码')
  if (!response.ok) throw new DownloaderError('NETWORK_ERROR', `下载器返回 HTTP ${response.status}`)
  const transfer = (await response.json()) as QbTransferInfo
  return {
    downloaderId: config.id,
    uploadSpeed: transfer.up_info_speed ?? 0,
    downloadSpeed: transfer.dl_info_speed ?? 0,
    totalUploaded: transfer.up_info_data ?? 0,
    totalDownloaded: transfer.dl_info_data ?? 0,
    freeSpace: transfer.free_space_on_disk,
    status: 'ONLINE' as const,
    lastSyncedAt: new Date().toISOString()
  }
}

async function getQbTorrents(config: DownloaderRecord) {
  const cookie = await loginQb(config, 15000)
  const headers = cookie ? { Cookie: cookie } : undefined
  const response = await qbFetch(config.host, '/api/v2/torrents/info', { headers }, 15000)
  if (response.status === 403) throw new DownloaderError('AUTH_FAILED', '认证失败，请检查用户名和密码')
  if (!response.ok) throw new DownloaderError('NETWORK_ERROR', `下载器返回 HTTP ${response.status}`)
  const items = (await response.json()) as QbTorrent[]
  return items.map((item) => ({
    hash: item.hash ?? '',
    name: item.name ?? '-',
    size: item.size,
    progress: item.progress ?? 0,
    state: item.state ?? 'unknown',
    ratio: item.ratio,
    category: item.category,
    tags: splitTags(item.tags),
    uploadSpeed: item.upspeed,
    downloadSpeed: item.dlspeed,
    addedAt: item.added_on ? new Date(item.added_on * 1000).toISOString() : undefined
  }))
}

downloadersRouter.get('/', requireAuth, async (req, res) => {
  const state = await readState()
  const keyword = String(req.query.keyword ?? '').trim().toLowerCase()
  const status = String(req.query.status ?? 'ALL')
  const enabled = String(req.query.enabled ?? 'ALL')
  const filtered = state.downloaders.filter((downloader) => {
    if (keyword && !`${downloader.name} ${downloader.host}`.toLowerCase().includes(keyword)) return false
    if (status !== 'ALL' && downloader.status !== status) return false
    if (enabled === 'ENABLED' && !downloader.enabled) return false
    if (enabled === 'DISABLED' && downloader.enabled) return false
    return true
  })
  res.json({ items: filtered.map(listItem), total: filtered.length, stats: stats(state.downloaders) })
})

downloadersRouter.get('/:id', requireAuth, async (req, res) => {
  const state = await readState()
  const id = String(req.params.id)
  const downloader = state.downloaders.find((item) => item.id === id)
  if (!downloader) return res.status(404).json({ message: '下载器不存在' })
  return res.json(detailItem(downloader))
})

downloadersRouter.post('/', requireAuth, async (req, res) => {
  const payload = req.body as DownloaderPayload
  const state = await readState()
  const validation = validatePayload(payload, state.downloaders)
  if (validation) return res.status(400).json({ message: validation })

  const now = new Date().toISOString()
  const downloader: DownloaderRecord = {
    id: randomUUID(),
    name: payload.name!.trim(),
    type: 'QBITTORRENT',
    enabled: payload.enabled ?? true,
    host: normalizeHost(payload.host!),
    username: payload.username?.trim() || undefined,
    password: payload.password || undefined,
    savePath: payload.savePath?.trim() || undefined,
    status: 'UNKNOWN',
    createdAt: now,
    updatedAt: now
  }
  state.downloaders.unshift(downloader)
  await writeState(state)
  return res.status(201).json(listItem(downloader))
})

downloadersRouter.put('/:id', requireAuth, async (req, res) => {
  const payload = req.body as DownloaderPayload
  const state = await readState()
  const id = String(req.params.id)
  const index = state.downloaders.findIndex((item) => item.id === id)
  if (index < 0) return res.status(404).json({ message: '下载器不存在' })
  const validation = validatePayload(payload, state.downloaders, id)
  if (validation) return res.status(400).json({ message: validation })

  const existing = state.downloaders[index]
  const passwordAction = payload.passwordAction ?? 'KEEP'
  if (passwordAction === 'UPDATE' && !payload.password) return res.status(400).json({ message: '请输入新密码或改为保持原密码' })
  const password = passwordAction === 'CLEAR' ? undefined : passwordAction === 'UPDATE' ? payload.password : existing.password

  const updated: DownloaderRecord = {
    ...existing,
    name: payload.name!.trim(),
    enabled: payload.enabled ?? existing.enabled,
    host: normalizeHost(payload.host!),
    username: payload.username?.trim() || undefined,
    password,
    savePath: payload.savePath?.trim() || undefined,
    updatedAt: new Date().toISOString()
  }
  state.downloaders[index] = updated
  await writeState(state)
  return res.json(listItem(updated))
})

downloadersRouter.delete('/:id', requireAuth, async (req, res) => {
  const state = await readState()
  const id = String(req.params.id)
  const nextDownloaders = state.downloaders.filter((downloader) => downloader.id !== id)
  if (nextDownloaders.length === state.downloaders.length) return res.status(404).json({ message: '下载器不存在' })
  state.downloaders = nextDownloaders
  await writeState(state)
  return res.status(204).send()
})

downloadersRouter.post('/test', requireAuth, async (req, res) => {
  const payload = req.body as DownloaderPayload
  if (payload.type && payload.type !== 'QBITTORRENT') return res.status(400).json({ message: '暂不支持该下载器类型' })
  if (!payload.host) return res.status(400).json({ message: '服务地址不能为空' })
  try {
    const result = await testQb({
      host: normalizeHost(payload.host),
      username: payload.username?.trim() || undefined,
      password: payload.password || undefined
    })
    return res.json(result)
  } catch (error) {
    return res.status(400).json({
      success: false,
      status: statusFromError(error),
      message: errorMessage(error),
      testedAt: new Date().toISOString()
    })
  }
})

downloadersRouter.post('/:id/test', requireAuth, async (req, res) => {
  const state = await readState()
  const id = String(req.params.id)
  const downloader = state.downloaders.find((item) => item.id === id)
  if (!downloader) return res.status(404).json({ message: '下载器不存在' })

  try {
    const result = await testQb(downloader)
    downloader.status = 'ONLINE'
    downloader.statusMessage = result.message
    downloader.lastTestedAt = result.testedAt
    downloader.lastSyncedAt = result.testedAt
    downloader.updatedAt = result.testedAt
    await writeState(state)
    return res.json(result)
  } catch (error) {
    const testedAt = new Date().toISOString()
    downloader.status = statusFromError(error)
    downloader.statusMessage = errorMessage(error)
    downloader.lastTestedAt = testedAt
    downloader.updatedAt = testedAt
    await writeState(state)
    return res.status(400).json({
      success: false,
      status: downloader.status,
      message: downloader.statusMessage,
      testedAt
    })
  }
})

downloadersRouter.get('/:id/status', requireAuth, async (req, res) => {
  const state = await readState()
  const id = String(req.params.id)
  const downloader = state.downloaders.find((item) => item.id === id)
  if (!downloader) return res.status(404).json({ message: '下载器不存在' })
  try {
    const result = await getQbStatus(downloader)
    downloader.status = 'ONLINE'
    downloader.statusMessage = undefined
    downloader.lastSyncedAt = result.lastSyncedAt
    downloader.updatedAt = result.lastSyncedAt
    await writeState(state)
    return res.json(result)
  } catch (error) {
    const now = new Date().toISOString()
    downloader.status = statusFromError(error)
    downloader.statusMessage = errorMessage(error)
    downloader.updatedAt = now
    await writeState(state)
    return res.status(400).json({
      downloaderId: downloader.id,
      uploadSpeed: 0,
      downloadSpeed: 0,
      status: downloader.status,
      message: downloader.statusMessage,
      lastSyncedAt: now
    })
  }
})

downloadersRouter.get('/:id/torrents', requireAuth, async (req, res) => {
  const state = await readState()
  const id = String(req.params.id)
  const downloader = state.downloaders.find((item) => item.id === id)
  if (!downloader) return res.status(404).json({ message: '下载器不存在' })
  try {
    const items = await getQbTorrents(downloader)
    return res.json({ items, total: items.length })
  } catch (error) {
    return res.status(400).json({ message: errorMessage(error), items: [], total: 0 })
  }
})

downloadersRouter.get('/:id/task-references', requireAuth, async (req, res) => {
  const state = await readState()
  const id = String(req.params.id)
  const downloader = state.downloaders.find((item) => item.id === id)
  if (!downloader) return res.status(404).json({ message: '下载器不存在' })
  return res.json({ items: [], total: 0 })
})
