import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState, type DownloaderRecord, writeState } from '../storage.js'
import { getQbTorrentItems, getQbTransferInfo, QbittorrentError, testQbConnection } from '../utils/qbittorrent.js'

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

function statusFromError(error: unknown) {
  if (error instanceof DownloaderError) {
    return error.code === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'OFFLINE'
  }
  if (error instanceof QbittorrentError) {
    return error.code === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'OFFLINE'
  }
  return 'OFFLINE'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '下载器访问失败'
}

async function getQbStatus(config: DownloaderRecord) {
  const transfer = await getQbTransferInfo(config).catch((error) => {
    if (error instanceof QbittorrentError && error.code === 'AUTH_FAILED') throw new DownloaderError('AUTH_FAILED', '认证失败，请检查用户名和密码')
    throw new DownloaderError('NETWORK_ERROR', errorMessage(error))
  })
  return {
    downloaderId: config.id,
    uploadSpeed: transfer.uploadSpeed,
    downloadSpeed: transfer.downloadSpeed,
    totalUploaded: transfer.uploadedTotal,
    totalDownloaded: transfer.downloadedTotal,
    freeSpace: transfer.freeSpace,
    status: 'ONLINE' as const,
    lastSyncedAt: new Date().toISOString()
  }
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
    const result = await testQbConnection({
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
    const result = await testQbConnection(downloader)
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
    const items = await getQbTorrentItems(downloader)
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
