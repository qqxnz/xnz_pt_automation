import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState, type SiteRecord, writeState } from '../storage.js'

export const sitesRouter = Router()

type SitePayload = {
  name?: string
  baseUrl?: string
  enabled?: boolean
  accessKey?: string
  cookie?: string
  userAgent?: string
  parserType?: 'NEXUSPHP'
  freeTorrentUrl?: string
  profileUrl?: string
  proxyId?: string
  checkIntervalMinutes?: number
}

function normalizeUrl(value: string) {
  return new URL(value).toString().replace(/\/$/, '')
}

function listItem(site: SiteRecord, proxyName?: string) {
  return {
    id: site.id,
    name: site.name,
    baseUrl: site.baseUrl,
    enabled: site.enabled,
    connectivityStatus: site.connectivityStatus,
    currentAccessMethod: site.currentAccessMethod,
    proxyId: site.proxyId,
    proxyName,
    lastConnectedAt: site.lastConnectedAt,
    lastConnectError: site.lastConnectError,
    hasAccessKey: Boolean(site.accessKey),
    hasCookie: Boolean(site.cookie)
  }
}

function detailItem(site: SiteRecord) {
  return {
    id: site.id,
    name: site.name,
    baseUrl: site.baseUrl,
    enabled: site.enabled,
    parserType: site.parserType,
    freeTorrentUrl: site.freeTorrentUrl,
    profileUrl: site.profileUrl,
    userAgent: site.userAgent,
    proxyId: site.proxyId,
    checkIntervalMinutes: site.checkIntervalMinutes,
    connectivityStatus: site.connectivityStatus,
    currentAccessMethod: site.currentAccessMethod,
    lastConnectedAt: site.lastConnectedAt,
    lastConnectError: site.lastConnectError,
    hasAccessKey: Boolean(site.accessKey),
    hasCookie: Boolean(site.cookie)
  }
}

function validatePayload(payload: SitePayload, existing?: SiteRecord) {
  if (!payload.name?.trim()) return '站点名称不能为空'
  if (!payload.baseUrl?.trim()) return '站点地址不能为空'
  try {
    normalizeUrl(payload.baseUrl)
  } catch {
    return '站点地址必须是合法 URL'
  }
  const hasAccessKey = Boolean(payload.accessKey?.trim() || existing?.accessKey)
  const hasCookie = Boolean(payload.cookie?.trim() || existing?.cookie)
  if (!hasAccessKey && !hasCookie) return '站点密钥和 Cookie 至少填写一个'
  if ((payload.checkIntervalMinutes ?? 30) < 5) return '检查间隔不能少于 5 分钟'
  return undefined
}

sitesRouter.get('/', requireAuth, async (req, res) => {
  const state = await readState()
  const keyword = String(req.query.keyword ?? '').trim().toLowerCase()
  const connectivityStatus = String(req.query.connectivityStatus ?? 'ALL')
  const proxyUsage = String(req.query.proxyUsage ?? 'ALL')
  const enabled = String(req.query.enabled ?? 'ALL')
  const page = Math.max(Number(req.query.page ?? 1), 1)
  const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20), 1), 100)
  const proxyById = new Map(state.proxies.map((proxy) => [proxy.id, proxy.name]))

  const filtered = state.sites.filter((site) => {
    if (keyword && !`${site.name} ${site.baseUrl}`.toLowerCase().includes(keyword)) return false
    if (connectivityStatus !== 'ALL' && site.connectivityStatus !== connectivityStatus) return false
    if (proxyUsage === 'NONE' && site.proxyId) return false
    if (proxyUsage === 'ENABLED' && !site.proxyId) return false
    if (enabled === 'ENABLED' && !site.enabled) return false
    if (enabled === 'DISABLED' && site.enabled) return false
    return true
  })

  const start = (page - 1) * pageSize
  const items = filtered.slice(start, start + pageSize).map((site) => listItem(site, site.proxyId ? proxyById.get(site.proxyId) : undefined))
  const stats = {
    total: state.sites.length,
    online: state.sites.filter((site) => site.connectivityStatus === 'ONLINE').length,
    authFailed: state.sites.filter((site) => site.connectivityStatus === 'AUTH_FAILED').length,
    offline: state.sites.filter((site) => site.connectivityStatus === 'OFFLINE').length,
    unknown: state.sites.filter((site) => site.connectivityStatus === 'UNKNOWN').length
  }

  res.json({ items, total: filtered.length, stats })
})

sitesRouter.get('/:id', requireAuth, async (req, res) => {
  const state = await readState()
  const site = state.sites.find((item) => item.id === req.params.id)
  if (!site) return res.status(404).json({ message: '站点不存在' })
  return res.json(detailItem(site))
})

sitesRouter.post('/', requireAuth, async (req, res) => {
  const payload = req.body as SitePayload
  const error = validatePayload(payload)
  if (error) return res.status(400).json({ message: error })

  const state = await readState()
  if (payload.proxyId && !state.proxies.some((proxy) => proxy.id === payload.proxyId && proxy.enabled)) {
    return res.status(400).json({ message: '请选择已启用代理' })
  }

  const now = new Date().toISOString()
  const site: SiteRecord = {
    id: randomUUID(),
    name: payload.name!.trim(),
    baseUrl: normalizeUrl(payload.baseUrl!),
    enabled: payload.enabled ?? true,
    accessKey: payload.accessKey?.trim() || undefined,
    cookie: payload.cookie?.trim() || undefined,
    userAgent: payload.userAgent?.trim() || undefined,
    parserType: 'NEXUSPHP',
    freeTorrentUrl: payload.freeTorrentUrl?.trim() || '/torrents.php?spstate=2',
    profileUrl: payload.profileUrl?.trim() || undefined,
    proxyId: payload.proxyId || undefined,
    connectivityStatus: 'UNKNOWN',
    checkIntervalMinutes: payload.checkIntervalMinutes ?? 30,
    createdAt: now,
    updatedAt: now
  }
  state.sites.unshift(site)
  await writeState(state)
  return res.status(201).json(detailItem(site))
})

sitesRouter.put('/:id', requireAuth, async (req, res) => {
  const payload = req.body as SitePayload
  const state = await readState()
  const index = state.sites.findIndex((site) => site.id === req.params.id)
  if (index < 0) return res.status(404).json({ message: '站点不存在' })

  const existing = state.sites[index]
  const error = validatePayload(payload, existing)
  if (error) return res.status(400).json({ message: error })
  if (payload.proxyId && !state.proxies.some((proxy) => proxy.id === payload.proxyId && proxy.enabled)) {
    return res.status(400).json({ message: '请选择已启用代理' })
  }

  const updated: SiteRecord = {
    ...existing,
    name: payload.name!.trim(),
    baseUrl: normalizeUrl(payload.baseUrl!),
    enabled: payload.enabled ?? existing.enabled,
    accessKey: payload.accessKey?.trim() || existing.accessKey,
    cookie: payload.cookie?.trim() || existing.cookie,
    userAgent: payload.userAgent?.trim() || undefined,
    parserType: 'NEXUSPHP',
    freeTorrentUrl: payload.freeTorrentUrl?.trim() || existing.freeTorrentUrl,
    profileUrl: payload.profileUrl?.trim() || undefined,
    proxyId: payload.proxyId || undefined,
    checkIntervalMinutes: payload.checkIntervalMinutes ?? existing.checkIntervalMinutes,
    updatedAt: new Date().toISOString()
  }
  state.sites[index] = updated
  await writeState(state)
  return res.json(detailItem(updated))
})

sitesRouter.delete('/:id', requireAuth, async (req, res) => {
  const state = await readState()
  const nextSites = state.sites.filter((site) => site.id !== req.params.id)
  if (nextSites.length === state.sites.length) return res.status(404).json({ message: '站点不存在' })
  state.sites = nextSites
  await writeState(state)
  return res.status(204).send()
})

sitesRouter.post('/:id/test-connectivity', requireAuth, async (req, res) => {
  const state = await readState()
  const site = state.sites.find((item) => item.id === req.params.id)
  if (!site) return res.status(404).json({ message: '站点不存在' })

  const proxy = site.proxyId ? state.proxies.find((item) => item.id === site.proxyId) : undefined
  if (site.proxyId && !proxy) {
    site.connectivityStatus = 'OFFLINE'
    site.lastConnectError = '已选择的代理不存在或已删除'
  } else if (proxy && !proxy.enabled) {
    site.connectivityStatus = 'OFFLINE'
    site.lastConnectError = '已选择的代理已禁用'
  } else if (site.accessKey || site.cookie) {
    site.connectivityStatus = 'ONLINE'
    site.currentAccessMethod = site.accessKey ? 'ACCESS_KEY' : 'COOKIE'
    site.lastConnectedAt = new Date().toISOString()
    site.lastConnectError = undefined
  } else {
    site.connectivityStatus = 'AUTH_FAILED'
    site.currentAccessMethod = undefined
    site.lastConnectError = '密钥和 Cookie 都不可用'
  }

  site.updatedAt = new Date().toISOString()
  await writeState(state)
  return res.json({
    ok: site.connectivityStatus === 'ONLINE',
    status: site.connectivityStatus,
    accessMethod: site.currentAccessMethod,
    usedProxy: Boolean(proxy),
    proxyId: proxy?.id,
    proxyName: proxy?.name,
    errorMessage: site.lastConnectError
  })
})

sitesRouter.post('/:id/sync-torrents', requireAuth, (_req, res) => {
  res.status(202).json({ ok: true, message: '已触发同步种子任务' })
})

sitesRouter.post('/:id/sync-traffic', requireAuth, (_req, res) => {
  res.status(202).json({ ok: true, message: '已触发同步流量统计任务' })
})
