// 站点模块入口
//
// 文件组织（参考 signin/ 的 HANDLERS 模式）：
//   types.ts       公共类型 + SiteAdapter 接口
//   util.ts        纯工具（HTML 解析、网络抓取辅助、常量）
//   nexusphp.ts    NexusPHP 站点的通用实现（默认回退目标）
//   mteam.ts       M-Team（馒头）的特殊实现
//   base.ts        默认 adapter（match 全部，无覆盖）
//   adapters.ts    SITE_ADAPTERS 数组 + pickAdapter(domain) 选择入口
//   index.ts       公共 API + 路由 + 调度（本文件）
//
// 调度约定：
//   - adapter 的每个方法都是可选的，调用方按方法粒度回退到 nexusphp 通用实现
//   - 测试用脚本（scripts/test-all-sites.ts）走的是 exports.browseTorrents 公共入口
import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import {
  type SiteRecord,
  type SiteTrafficSnapshotRecord,
  listSitesFromDb,
  getSiteFromDb,
  insertSiteToDb,
  updateSiteInDb,
  deleteSiteFromDb,
  saveSiteTrafficSnapshotToDb,
  listSiteTrafficSnapshotsFromDb,
  listLatestSigninLogBySiteAndDate
} from '../../storage.js'
import { logger, recordOperationLog } from '../../utils/logger.js'
import { isoOnLocalDate } from '../../utils/time.js'
import { isSiteSigninRunning, signinSiteById } from '../signin/index.js'
import { pickAdapter, siteDisplayNameByDomain, siteTorrentPathByDomain } from './adapters.js'
import { browseNexusTorrents, fetchNexusTraffic } from './nexusphp.js'
import {
  extractHostnamePreserveCase
} from './util.js'
import type { BrowseTorrentsCommon, FetchTrafficCommon, Credential, FetchTrafficResult, TrafficStats, TorrentListItem } from './types.js'

// 站点更新编排
const SITE_AUTO_UPDATE_COOLDOWN_MS = 6 * 60 * 60 * 1000
const SITE_UPDATE_OVERALL_TIMEOUT_MS = 90 * 1000
const SITE_UPDATE_WATCHDOG_INTERVAL_MS = 60 * 1000
const SITE_UPDATE_WATCHDOG_MAX_AGE_MS = 5 * 60 * 1000
const SITE_UPDATE_BATCH_CONCURRENCY = 5
const siteUpdatePromises = new Map<string, Promise<SiteUpdateResult>>()
const siteUpdateStartedAt = new Map<string, number>()
const queuedSiteUpdateIds = new Set<string>()
const siteUpdateRerunIds = new Set<string>()
let siteUpdateBatchPromise: Promise<SiteUpdateSummary> | undefined
let siteUpdateBatchStartPromise: Promise<SiteUpdateBatchStart> | undefined

type SitePayload = {
  domain?: string
  enabled?: boolean
  apiKey?: string
  cookie?: string
  userAgent?: string
  signinEnabled?: boolean
  signinTime?: string
}

type SiteUpdateResult = {
  siteId: string
  siteName: string
  ok: boolean
  errorMessage?: string
}

type SiteUpdateSummary = {
  successCount: number
  failedCount: number
  syncedAt: string
  errors: Array<{ siteId: string; siteName: string; message: string }>
}

type SiteUpdateBatchStart = {
  acceptedCount: number
  skippedCount: number
  alreadyRunning: boolean
}

export const sitesRouter = Router()

// ============ 公共 API（对外导出）============

// 兼容历史引用：直接定义函数（避免 re-export 在循环依赖里未初始化）
// signin/standardNexusPhp.ts 等模块会从 sites 引入这几个简单工具，
// 所以这里用直接定义 + 委托 util.ts 形式，确保循环依赖下也能立即拿到可执行函数
export function normalizeSiteDomain(value: string): string {
  const trimmed = value.trim()
  const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  return url.hostname.toLowerCase()
}

export function siteBaseUrl(site: SiteRecord): string {
  return `https://${site.domain}`
}

export function resolveSiteUrl(site: SiteRecord, value: string): string {
  return new URL(value, `${siteBaseUrl(site)}/`).toString()
}

export function siteDisplayName(site: SiteRecord) {
  return pickAdapter(site).displayName ?? siteDisplayNameByDomain(site.domain) ?? site.domain
}

// 抓取列表的调度入口：先按 adapter 找，找到了用 adapter 的（可能回退到 common），找不到用 baseAdapter → nexusphp
export async function browseTorrents(site: SiteRecord, keyword: string, page: number, pageSize: number) {
  const adapter = pickAdapter(site)
  const errors: string[] = []
  // 解析种子列表路径：adapter > metadata > 默认 /torrents.php
  const torrentPath = adapter.torrentPath ?? siteTorrentPathByDomain(site.domain) ?? '/torrents.php'

  // NexusPHP 通用 browse（adapter 也可调用它做组合）
  const commonBrowse: BrowseTorrentsCommon = (s, kw, p, ps) => browseNexusTorrents(s, kw, torrentPath, p, ps)

  if (adapter.browseTorrents) {
    try {
      return await adapter.browseTorrents(site, keyword, page, pageSize, commonBrowse)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : '访问失败')
      // M-Team 这种全自定义的不会到这里；这里主要是 adapter 内组合了多种实现时做兜底
    }
  }

  // 走到这里说明 adapter 没实现 browseTorrents（最常见的 baseAdapter），走 NexusPHP 通用
  if (site.cookie) {
    try {
      const result = await browseNexusTorrents(site, keyword, torrentPath, page, pageSize)
      return { credential: 'COOKIE' as Credential, ...result }
    } catch (error) {
      errors.push(`COOKIE: ${error instanceof Error ? error.message : '访问失败'}`)
    }
  }

  throw new Error(errors.join('；') || 'API Key 和 Cookie 都不可用')
}

// 抓取个人资料的调度入口
async function fetchTrafficByCredential(site: SiteRecord, credential: Credential): Promise<FetchTrafficResult> {
  const adapter = pickAdapter(site)
  const commonFetch: FetchTrafficCommon = (_s, c) => fetchNexusTraffic(site, '/userdetails.php', c)
  if (adapter.fetchTraffic) {
    return await adapter.fetchTraffic(site, credential, commonFetch)
  }
  return await fetchNexusTraffic(site, '/userdetails.php', credential)
}

async function testSite(site: SiteRecord) {
  const attempts: Credential[] = site.apiKey ? ['API_KEY'] : []
  if (site.cookie) attempts.push('COOKIE')
  const errors: string[] = []
  const diagnostic: { credential?: Credential; finalUrl?: string; httpStatus?: number; bodyExcerpt?: string; matchedKeywords?: string[] } = {}

  for (const credential of attempts) {
    try {
      const { stats, meta } = await fetchTrafficByCredential(site, credential)
      if (stats.uploaded === undefined || stats.downloaded === undefined || (stats.ratio === undefined && !stats.ratioInfinite)) {
        diagnostic.credential = credential
        diagnostic.finalUrl = meta?.finalUrl
        diagnostic.httpStatus = meta?.httpStatus
        diagnostic.bodyExcerpt = meta?.bodyExcerpt
        diagnostic.matchedKeywords = []
        throw new Error('未找到上传量、下载量或分享率')
      }
      return { credential, stats, diagnostic: meta }
    } catch (error) {
      const message = error instanceof Error ? error.message : '访问失败'
      errors.push(`${credential}: ${message}`)
    }
  }

  const lastDiag = diagnostic
  let detail = errors.join('；') || 'API Key 和 Cookie 都不可用'
  if (lastDiag.finalUrl || lastDiag.bodyExcerpt) {
    const parts: string[] = [detail]
    if (lastDiag.credential) parts.push(`凭证=${lastDiag.credential}`)
    if (lastDiag.httpStatus !== undefined) parts.push(`HTTP=${lastDiag.httpStatus}`)
    if (lastDiag.finalUrl) parts.push(`URL=${lastDiag.finalUrl}`)
    if (lastDiag.bodyExcerpt) parts.push(`摘要=${lastDiag.bodyExcerpt}`)
    detail = parts.join(' | ')
  }
  const e: Error & { diagnostic?: typeof diagnostic } = new Error(detail)
  e.diagnostic = lastDiag
  throw e
}

// ============ 站点更新编排（保持原行为）============

function dateKey(value = new Date()) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftDateKey(date: string, offsetDays: number) {
  const value = new Date(`${date}T00:00:00`)
  value.setDate(value.getDate() + offsetDays)
  return dateKey(value)
}

async function recordSiteTrafficSnapshot(site: SiteRecord, syncedAt: string) {
  if (site.uploaded === undefined && site.downloaded === undefined) return
  const date = dateKey(new Date(syncedAt))
  const snapshots = await listSiteTrafficSnapshotsFromDb()
  const existing = snapshots.find((item) => item.siteId === site.id && item.date === date)
  const snapshot: SiteTrafficSnapshotRecord = {
    id: existing?.id ?? randomUUID(),
    siteId: site.id,
    siteName: siteDisplayName(site),
    date,
    uploaded: site.uploaded,
    downloaded: site.downloaded,
    ratio: site.ratio,
    ratioInfinite: site.ratioInfinite,
    syncedAt
  }
  await saveSiteTrafficSnapshotToDb(snapshot)
}

async function uploadedDelta(siteId: string, date: string): Promise<number | undefined> {
  const snapshots = await listSiteTrafficSnapshotsFromDb()
  const current = snapshots.find((item) => item.siteId === siteId && item.date === date)
  if (current?.uploaded === undefined) return undefined
  const previous = snapshots
    .filter((item) => item.siteId === siteId && item.date < date && item.uploaded !== undefined)
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  if (!previous) return Math.max(current.uploaded ?? 0, 0)
  if (previous.uploaded === undefined) return undefined
  return Math.max(current.uploaded - previous.uploaded, 0)
}

async function trafficDeltas(site: SiteRecord) {
  const today = dateKey()
  const yesterday = shiftDateKey(today, -1)
  return {
    todayUploaded: await uploadedDelta(site.id, today),
    yesterdayUploaded: await uploadedDelta(site.id, yesterday)
  }
}

async function updateSiteStats(siteId: string): Promise<SiteUpdateResult> {
  const existing = siteUpdatePromises.get(siteId)
  if (existing) return existing

  const work = (async (): Promise<SiteUpdateResult> => {
    const requestedSite = await getSiteFromDb(siteId)
    if (!requestedSite) return { siteId, siteName: siteId, ok: false, errorMessage: '站点不存在' }

    try {
      const result = await testSite(requestedSite)
      const site = await getSiteFromDb(siteId)
      if (!site) return { siteId, siteName: siteDisplayName(requestedSite), ok: false, errorMessage: '站点已删除' }
      site.connectivityStatus = 'ONLINE'
      site.currentCredential = result.credential
      site.userLevel = result.stats.userLevel
      site.ratio = result.stats.ratio
      site.ratioInfinite = result.stats.ratioInfinite
      site.uploaded = result.stats.uploaded
      site.downloaded = result.stats.downloaded
      site.trafficSyncedAt = new Date().toISOString()
      site.lastConnectedAt = site.trafficSyncedAt
      site.lastConnectError = undefined
      site.updatedAt = site.trafficSyncedAt
      await recordSiteTrafficSnapshot(site, site.trafficSyncedAt)
      await updateSiteInDb(site)
      return { siteId: site.id, siteName: siteDisplayName(site), ok: true }
    } catch (error) {
      const site = await getSiteFromDb(siteId)
      if (!site) return { siteId, siteName: siteDisplayName(requestedSite), ok: false, errorMessage: '站点已删除' }
      site.connectivityStatus = 'AUTH_FAILED'
      site.currentCredential = undefined
      site.lastConnectError = error instanceof Error ? error.message : '站点更新失败'
      site.updatedAt = new Date().toISOString()
      await updateSiteInDb(site)
      return { siteId: site.id, siteName: siteDisplayName(site), ok: false, errorMessage: site.lastConnectError }
    }
  })()

  let overallTimer: NodeJS.Timeout | undefined
  const overallTimeout = new Promise<SiteUpdateResult>((_, reject) => {
    overallTimer = setTimeout(() => {
      reject(new Error(`站点更新整体超时（${SITE_UPDATE_OVERALL_TIMEOUT_MS / 1000}s）`))
    }, SITE_UPDATE_OVERALL_TIMEOUT_MS)
  })

  const promise = Promise.race([work, overallTimeout])
    .catch((error): SiteUpdateResult => ({
      siteId,
      siteName: siteId,
      ok: false,
      errorMessage: error instanceof Error ? error.message : '站点更新失败'
    }))
    .finally(() => {
      if (overallTimer) clearTimeout(overallTimer)
      siteUpdatePromises.delete(siteId)
      siteUpdateStartedAt.delete(siteId)
      if (siteUpdateRerunIds.delete(siteId)) queueSiteUpdate(siteId)
    })

  siteUpdatePromises.set(siteId, promise)
  siteUpdateStartedAt.set(siteId, Date.now())
  return promise
}

function queueSiteUpdate(siteId: string, rerunIfRunning = false) {
  const alreadyRunning = siteUpdatePromises.has(siteId)
  if (alreadyRunning && rerunIfRunning) siteUpdateRerunIds.add(siteId)
  const promise = updateSiteStats(siteId)
  promise.catch((error) => {
    logger.error('sites', '站点后台更新失败', { siteId, error: error instanceof Error ? error.message : String(error) })
  })
  return { accepted: !alreadyRunning, alreadyRunning }
}

function isStaleForAutoUpdate(site: SiteRecord, now: number) {
  const lastAttemptAt = site.trafficSyncedAt ?? (site.connectivityStatus !== 'UNKNOWN' ? site.updatedAt : undefined)
  if (!lastAttemptAt) return true
  const timestamp = Date.parse(lastAttemptAt)
  return !Number.isFinite(timestamp) || now - timestamp >= SITE_AUTO_UPDATE_COOLDOWN_MS
}

async function runSiteUpdateBatch(sites: SiteRecord[]): Promise<SiteUpdateSummary> {
  const syncedAt = new Date().toISOString()
  let successCount = 0
  let failedCount = 0
  const errors: SiteUpdateSummary['errors'] = []

  const queue = [...sites]
  async function worker() {
    while (queue.length > 0) {
      const site = queue.shift()
      if (!site) break
      try {
        const result = await updateSiteStats(site.id)
        if (result.ok) {
          successCount += 1
        } else {
          failedCount += 1
          errors.push({ siteId: result.siteId, siteName: result.siteName, message: result.errorMessage ?? '站点更新失败' })
        }
      } catch (error) {
        failedCount += 1
        errors.push({ siteId: site.id, siteName: siteDisplayName(site), message: error instanceof Error ? error.message : '站点更新失败' })
      } finally {
        queuedSiteUpdateIds.delete(site.id)
      }
    }
  }

  const concurrency = Math.max(1, Math.min(SITE_UPDATE_BATCH_CONCURRENCY, sites.length))
  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)

  return { successCount, failedCount, syncedAt, errors }
}

async function startSiteUpdateBatch(options: { staleOnly: boolean }): Promise<SiteUpdateBatchStart> {
  if (siteUpdateBatchPromise || siteUpdateBatchStartPromise) {
    if (siteUpdateBatchStartPromise) await siteUpdateBatchStartPromise
    return { acceptedCount: 0, skippedCount: 0, alreadyRunning: true }
  }

  siteUpdateBatchStartPromise = (async () => {
    const enabledSites = (await listSitesFromDb()).filter((site) => site.enabled)
    const now = Date.now()
    const candidates = options.staleOnly ? enabledSites.filter((site) => isStaleForAutoUpdate(site, now)) : enabledSites
    const skippedCount = enabledSites.length - candidates.length

    if (candidates.length) {
      candidates.forEach((site) => queuedSiteUpdateIds.add(site.id))
      siteUpdateBatchPromise = runSiteUpdateBatch(candidates).finally(() => {
        candidates.forEach((site) => queuedSiteUpdateIds.delete(site.id))
        siteUpdateBatchPromise = undefined
      })
      siteUpdateBatchPromise.catch((error) => {
        logger.error('sites', '站点批量后台更新失败', { error: error instanceof Error ? error.message : String(error) })
      })
    }
    return { acceptedCount: candidates.length, skippedCount, alreadyRunning: false }
  })()

  try {
    return await siteUpdateBatchStartPromise
  } finally {
    siteUpdateBatchStartPromise = undefined
  }
}

export async function syncSiteTrafficStats(options: { staleOnly?: boolean } = {}) {
  if (siteUpdateBatchPromise || siteUpdateBatchStartPromise) {
    return {
      successCount: 0,
      failedCount: 1,
      syncedAt: new Date().toISOString(),
      errors: [{ siteId: 'ALL', siteName: '站点同步', message: '站点统计同步正在运行' }]
    }
  }

  const enabledSites = (await listSitesFromDb()).filter((site) => site.enabled)
  const sites = options.staleOnly ? enabledSites.filter((site) => isStaleForAutoUpdate(site, Date.now())) : enabledSites
  sites.forEach((site) => queuedSiteUpdateIds.add(site.id))
  siteUpdateBatchPromise = runSiteUpdateBatch(sites).finally(() => {
    sites.forEach((site) => queuedSiteUpdateIds.delete(site.id))
    siteUpdateBatchPromise = undefined
  })
  return siteUpdateBatchPromise
}

function siteUpdateWatchdogTick() {
  const now = Date.now()
  for (const [siteId, startedAt] of siteUpdateStartedAt) {
    if (now - startedAt >= SITE_UPDATE_WATCHDOG_MAX_AGE_MS) {
      logger.warn('sites', '检测到站点更新长时间未完成，强制释放', {
        siteId,
        ageMs: now - startedAt
      })
      siteUpdatePromises.delete(siteId)
      siteUpdateStartedAt.delete(siteId)
      queuedSiteUpdateIds.delete(siteId)
      siteUpdateRerunIds.delete(siteId)
    }
  }
}

const siteUpdateWatchdogTimer = setInterval(siteUpdateWatchdogTick, SITE_UPDATE_WATCHDOG_INTERVAL_MS)
if (typeof siteUpdateWatchdogTimer.unref === 'function') siteUpdateWatchdogTimer.unref()

async function listItem(site: SiteRecord) {
  const deltas = await trafficDeltas(site)
  const today = dateKey()
  const latest = await listLatestSigninLogBySiteAndDate(site.id, today)
  // 日志缺失时回退到 sites.last_signin_*（权威状态）
  const todaySigninStatus = latest?.status
    ?? (isoOnLocalDate(site.lastSigninAt, today) ? site.lastSigninStatus : undefined)
  return {
    id: site.id,
    displayName: siteDisplayName(site),
    domain: site.domain,
    baseUrl: siteBaseUrl(site),
    enabled: site.enabled,
    connectivityStatus: site.connectivityStatus,
    currentCredential: site.currentCredential,
    userLevel: site.userLevel,
    ratio: site.ratio,
    ratioInfinite: site.ratioInfinite,
    uploaded: site.uploaded,
    downloaded: site.downloaded,
    yesterdayUploaded: deltas.yesterdayUploaded,
    todayUploaded: deltas.todayUploaded,
    trafficSyncedAt: site.trafficSyncedAt,
    lastConnectedAt: site.lastConnectedAt,
    lastConnectError: site.lastConnectError,
    hasApiKey: Boolean(site.apiKey),
    hasCookie: Boolean(site.cookie),
    signinEnabled: site.signinEnabled,
    signinTime: site.signinTime,
    todaySigninStatus,
    lastSigninAt: site.lastSigninAt,
    lastSigninStatus: site.lastSigninStatus,
    lastSigninMessage: site.lastSigninMessage,
    signinRunning: isSiteSigninRunning(site.id),
    updating: siteUpdatePromises.has(site.id) || queuedSiteUpdateIds.has(site.id)
  }
}

async function detailItem(site: SiteRecord) {
  return {
    ...(await listItem(site)),
    apiKey: site.apiKey,
    cookie: site.cookie,
    userAgent: site.userAgent
  }
}

function validatePayload(payload: SitePayload, existing?: SiteRecord) {
  if (!payload.domain?.trim()) return '站点域名不能为空'
  try {
    new URL(payload.domain.includes('://') ? payload.domain : `https://${payload.domain}`)
  } catch {
    return '站点域名必须是合法域名或 URL'
  }
  const hasApiKey = Boolean(payload.apiKey?.trim() || existing?.apiKey)
  const hasCookie = Boolean(payload.cookie?.trim() || existing?.cookie)
  if (!hasApiKey && !hasCookie) return 'API Key 和 Cookie 至少填写一个'
  const signinEnabled = payload.signinEnabled ?? existing?.signinEnabled ?? false
  const signinTime = payload.signinTime?.trim() || existing?.signinTime || '09:00'
  if (signinEnabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(signinTime)) {
    return '签到时间必须是 HH:mm 格式'
  }
  return undefined
}

// ============ Express 路由 ============

sitesRouter.get('/', requireAuth, async (req, res) => {
  const sites = await listSitesFromDb()
  const keyword = String(req.query.keyword ?? '').trim().toLowerCase()
  const connectivityStatus = String(req.query.connectivityStatus ?? 'ALL')
  const enabled = String(req.query.enabled ?? 'ALL')
  const signinEnabled = String(req.query.signinEnabled ?? 'ALL')
  const page = Math.max(Number(req.query.page ?? 1), 1)
  const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20), 1), 100)

  const filtered = sites.filter((site) => {
    if (keyword && !`${siteDisplayName(site)} ${site.domain}`.toLowerCase().includes(keyword)) return false
    if (connectivityStatus !== 'ALL' && site.connectivityStatus !== connectivityStatus) return false
    if (enabled === 'ENABLED' && !site.enabled) return false
    if (enabled === 'DISABLED' && site.enabled) return false
    if (signinEnabled === 'ENABLED' && !site.signinEnabled) return false
    if (signinEnabled === 'DISABLED' && site.signinEnabled) return false
    return true
  })

  const start = (page - 1) * pageSize
  const items = await Promise.all(filtered.slice(start, start + pageSize).map((site) => listItem(site)))
  const stats = {
    total: sites.length,
    online: sites.filter((site) => site.connectivityStatus === 'ONLINE').length,
    authFailed: sites.filter((site) => site.connectivityStatus === 'AUTH_FAILED').length,
    offline: sites.filter((site) => site.connectivityStatus === 'OFFLINE').length,
    unknown: sites.filter((site) => site.connectivityStatus === 'UNKNOWN').length
  }

  res.json({ items, total: filtered.length, stats })
})

sitesRouter.get('/:id', requireAuth, async (req, res) => {
  const site = await getSiteFromDb(String(req.params.id))
  if (!site) return res.status(404).json({ message: '站点不存在' })
  return res.json(await detailItem(site))
})

sitesRouter.post('/', requireAuth, async (req, res) => {
  const payload = req.body as SitePayload
  const error = validatePayload(payload)
  if (error) return res.status(400).json({ message: error })

  const now = new Date().toISOString()
  const site: SiteRecord = {
    id: randomUUID(),
    name: extractHostnamePreserveCase(payload.domain!),
    domain: extractHostnamePreserveCase(payload.domain!),
    enabled: payload.enabled ?? true,
    apiKey: payload.apiKey?.trim() || undefined,
    cookie: payload.cookie?.trim() || undefined,
    userAgent: payload.userAgent?.trim() || undefined,
    connectivityStatus: 'UNKNOWN',
    signinEnabled: payload.signinEnabled ?? false,
    signinTime: payload.signinTime?.trim() || '09:00',
    createdAt: now,
    updatedAt: now
  }
  await insertSiteToDb(site)
  if (site.enabled) queueSiteUpdate(site.id, true)
  return res.status(201).json(await detailItem(site))
})

sitesRouter.put('/:id', requireAuth, async (req, res) => {
  const payload = req.body as SitePayload
  const existing = await getSiteFromDb(String(req.params.id))
  if (!existing) return res.status(404).json({ message: '站点不存在' })

  const error = validatePayload(payload, existing)
  if (error) return res.status(400).json({ message: error })

  const updated: SiteRecord = {
    ...existing,
    name: extractHostnamePreserveCase(payload.domain!),
    domain: extractHostnamePreserveCase(payload.domain!),
    enabled: payload.enabled ?? existing.enabled,
    apiKey: payload.apiKey?.trim() || existing.apiKey,
    cookie: payload.cookie?.trim() || existing.cookie,
    userAgent: payload.userAgent?.trim() || undefined,
    signinEnabled: payload.signinEnabled ?? existing.signinEnabled,
    signinTime: payload.signinTime?.trim() || existing.signinTime,
    updatedAt: new Date().toISOString()
  }
  await updateSiteInDb(updated)
  if (updated.enabled) queueSiteUpdate(updated.id, true)
  return res.json(await detailItem(updated))
})

sitesRouter.delete('/:id', requireAuth, async (req, res) => {
  const deleted = await deleteSiteFromDb(String(req.params.id))
  if (!deleted) return res.status(404).json({ message: '站点不存在' })
  return res.status(204).send()
})

sitesRouter.post('/:id/test-connectivity', requireAuth, async (req, res) => {
  const site = await getSiteFromDb(String(req.params.id))
  if (!site) return res.status(404).json({ message: '站点不存在' })

  const result = await updateSiteStats(site.id)
  const updated = await getSiteFromDb(site.id)
  if (!result.ok) return res.status(400).json({ ok: false, status: updated?.connectivityStatus ?? 'AUTH_FAILED', message: result.errorMessage, errorMessage: result.errorMessage })
  return res.json({
    ok: true,
    status: updated?.connectivityStatus ?? 'ONLINE',
    credential: updated?.currentCredential,
    userLevel: updated?.userLevel,
    ratio: updated?.ratio,
    ratioInfinite: updated?.ratioInfinite,
    uploaded: updated?.uploaded,
    downloaded: updated?.downloaded
  })
})

sitesRouter.post('/:id/update', requireAuth, async (req, res) => {
  const site = await getSiteFromDb(String(req.params.id))
  if (!site) return res.status(404).json({ message: '站点不存在' })
  return res.status(202).json(queueSiteUpdate(site.id))
})

sitesRouter.post('/update-all', requireAuth, async (_req, res) => {
  return res.status(202).json(await startSiteUpdateBatch({ staleOnly: true }))
})

sitesRouter.post('/sync-traffic', requireAuth, async (_req, res) => {
  res.json(await syncSiteTrafficStats())
})

sitesRouter.post('/:id/signin', requireAuth, async (req, res) => {
  const siteId = String(req.params.id)
  const site = await getSiteFromDb(siteId)
  if (!site) return res.status(404).json({ message: '站点不存在' })

  const actor = res.locals.user as { id?: string; username?: string } | undefined
  try {
    const result = await signinSiteById(siteId, {
      runMode: 'MANUAL',
      triggerSource: 'manual-button',
      now: new Date()
    })
    await recordOperationLog({
      action: '站点签到',
      message: `${result.siteName} 手动签到：${result.message}`,
      status: result.status === 'SUCCESS' ? 'SUCCESS' : result.status === 'SKIPPED' ? 'SUCCESS' : 'FAILED',
      actorId: actor?.id,
      actorName: actor?.username,
      ip: req.ip,
      userAgent: req.get('user-agent')
    })
    const ok = result.status !== 'FAILED'
    return res.json({
      ok,
      status: result.status,
      message: result.message,
      errorMessage: result.errorMessage,
      siteId: result.siteId,
      siteName: result.siteName,
      logId: result.logId,
      durationMs: result.durationMs
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '签到失败'
    logger.error('site', 'manual signin failed', { siteId, error: message })
    await recordOperationLog({
      action: '站点签到',
      message: `${siteDisplayName(site)} 手动签到失败：${message}`,
      status: 'FAILED',
      actorId: actor?.id,
      actorName: actor?.username,
      ip: req.ip,
      userAgent: req.get('user-agent')
    })
    return res.status(400).json({ ok: false, status: 'FAILED', message, errorMessage: message })
  }
})

sitesRouter.post('/signin-all', requireAuth, async (req, res) => {
  const sites = (await listSitesFromDb()).filter((site) => site.enabled && site.signinEnabled)
  const actor = res.locals.user as { id?: string; username?: string } | undefined
  const results: Array<{ siteId: string; siteName: string; status: 'SUCCESS' | 'FAILED' | 'SKIPPED'; message: string; durationMs: number }> = []
  for (const site of sites) {
    try {
      const result = await signinSiteById(site.id, {
        runMode: 'MANUAL',
        triggerSource: 'manual-button',
        now: new Date()
      })
      results.push({
        siteId: result.siteId,
        siteName: result.siteName,
        status: result.status,
        message: result.message,
        durationMs: result.durationMs
      })
    } catch (error) {
      results.push({
        siteId: site.id,
        siteName: siteDisplayName(site),
        status: 'FAILED',
        message: error instanceof Error ? error.message : '签到失败',
        durationMs: 0
      })
    }
  }
  await recordOperationLog({
    action: '批量站点签到',
    message: `批量签到 ${results.length} 个站点，成功 ${results.filter((item) => item.status === 'SUCCESS').length}`,
    status: 'SUCCESS',
    actorId: actor?.id,
    actorName: actor?.username,
    ip: req.ip,
    userAgent: req.get('user-agent')
  })
  res.json({ total: results.length, results })
})

sitesRouter.post('/:id/browse-torrents', requireAuth, async (req, res) => {
  const site = await getSiteFromDb(String(req.params.id))
  if (!site) return res.status(404).json({ message: '站点不存在' })
  const keyword = String(req.body?.keyword ?? '').trim()
  const page = Math.max(Number(req.body?.page ?? 1), 1)
  const pageSize = Math.min(Math.max(Number(req.body?.pageSize ?? 20), 1), 100)

  try {
    const result = await browseTorrents(site, keyword, page, pageSize)
    return res.json({ ok: true, displayName: siteDisplayName(site), page, pageSize, ...result })
  } catch (error) {
    return res.status(400).json({ ok: false, message: error instanceof Error ? error.message : '种子列表获取失败' })
  }
})

// 重导出 adapter 相关类型，方便测试和外部使用
export type { BrowseTorrentsResult, FetchTrafficResult, TrafficStats, TorrentListItem, Credential, SiteAdapter } from './types.js'
