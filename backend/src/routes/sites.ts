import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
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
} from '../storage.js'
import { logger, recordOperationLog } from '../utils/logger.js'
import { isSiteSigninRunning, signinSiteById } from './signin/index.js'

export const sitesRouter = Router()

const SITE_AUTO_UPDATE_COOLDOWN_MS = 6 * 60 * 60 * 1000
const SITE_FETCH_TIMEOUT_MS = 25 * 1000
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

type SiteStrategy = 'MTEAM_API' | 'NEXUSPHP'
type Credential = 'API_KEY' | 'COOKIE'

type SiteDefinition = {
  displayName: string
  domains: string[]
  strategy: SiteStrategy
  profilePath: string
  torrentPath: string
}

type SitePayload = {
  domain?: string
  enabled?: boolean
  apiKey?: string
  cookie?: string
  userAgent?: string
  signinEnabled?: boolean
  signinTime?: string
}

type TrafficStats = {
  userLevel?: string
  ratio?: number
  ratioInfinite?: boolean
  uploaded?: number
  downloaded?: number
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

type AppState = {
  sites: SiteRecord[]
  siteTrafficSnapshots: SiteTrafficSnapshotRecord[]
}

export type TorrentListItem = {
  id: string
  title: string
  subtitle?: string
  createdAt?: string
  size?: number
  freeEndAt?: string
  seeders?: number
  leechers?: number
  tags: string[]
}

const SITE_DEFINITIONS: SiteDefinition[] = [
  {
    displayName: '馒头',
    domains: ['m-team.cc', 'pt.m-team.cc', 'api.m-team.cc'],
    strategy: 'MTEAM_API',
    profilePath: '/api/member/profile',
    torrentPath: '/api/torrent/search'
  },
  {
    displayName: '憨憨',
    domains: ['hhanclub.net', 'www.hhanclub.net'],
    strategy: 'NEXUSPHP',
    profilePath: '/userdetails.php',
    torrentPath: '/torrents.php'
  },
  {
    displayName: '家园',
    domains: ['hdhome.org', 'www.hdhome.org'],
    strategy: 'NEXUSPHP',
    profilePath: '/userdetails.php',
    torrentPath: '/torrents.php'
  },
  {
    displayName: '麒麟',
    domains: ['hdkyl.in', 'www.hdkyl.in'],
    strategy: 'NEXUSPHP',
    profilePath: '/userdetails.php',
    torrentPath: '/torrents.php'
  },
  {
    displayName: '听听歌',
    domains: ['totheglory.im', 'www.totheglory.im'],
    strategy: 'NEXUSPHP',
    profilePath: '/userdetails.php',
    torrentPath: '/torrents.php'
  },
  {
    displayName: '朋友',
    domains: ['pt.keepfrds.com', 'keepfrds.com'],
    strategy: 'NEXUSPHP',
    profilePath: '/userdetails.php',
    torrentPath: '/torrents.php'
  },
  {
    displayName: '彩虹岛',
    domains: ['ptchdbits.co', 'www.ptchdbits.co'],
    strategy: 'NEXUSPHP',
    profilePath: '/userdetails.php',
    torrentPath: '/torrents.php'
  },
  {
    displayName: '猫站',
    domains: ['pterclub.net', 'pterclub.com', 'www.pterclub.com'],
    strategy: 'NEXUSPHP',
    profilePath: '/userdetails.php',
    torrentPath: '/torrents.php'
  },
  {
    displayName: '我堡',
    domains: ['ourbits.club', 'www.ourbits.club'],
    strategy: 'NEXUSPHP',
    profilePath: '/userdetails.php',
    torrentPath: '/torrents.php'
  },
  {
    displayName: '铂金家',
    domains: ['pthome.net', 'www.pthome.net'],
    strategy: 'NEXUSPHP',
    profilePath: '/userdetails.php',
    torrentPath: '/torrents.php'
  },
  {
    displayName: '优堡',
    domains: ['ubits.club', 'www.ubits.club'],
    strategy: 'NEXUSPHP',
    profilePath: '/userdetails.php',
    torrentPath: '/torrents.php'
  },
  {
    displayName: '时间',
    domains: ['pttime.org', 'www.pttime.org'],
    strategy: 'NEXUSPHP',
    profilePath: '/userdetails.php',
    torrentPath: '/torrents.php'
  }
]

const DEFAULT_NEXUSPHP_DEFINITION: SiteDefinition = {
  displayName: '',
  domains: [],
  strategy: 'NEXUSPHP',
  profilePath: '/userdetails.php',
  torrentPath: '/torrents.php'
}

const KNOWN_USER_LEVELS = [
  '保种员',
  '保種員',
  '发布员',
  '發布員',
  '总督',
  '總督',
  'Power User',
  'Elite User',
  'Crazy User',
  'Insane User',
  'Veteran User',
  'Extreme User',
  'Ultimate User',
  'mTorrent Master',
  'Donor',
  'User'
]

const MTEAM_ROLE_LEVELS: Record<string, string> = {
  '0': '平民',
  '1': '用户',
  '2': '侠客',
  '3': '骑士',
  '4': '捕头',
  '5': '知县',
  '6': '通判',
  '7': '知州',
  '8': '总督',
  '9': '大臣'
}

function extractHostname(value: string) {
  const trimmed = value.trim()
  const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  return url.hostname.toLowerCase()
}

function extractHostnamePreserveCase(value: string) {
  const trimmed = value.trim()
  const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  return url.hostname
}

export function normalizeSiteDomain(value: string) {
  return extractHostname(value)
}

function getSiteDefinition(domain: string) {
  const normalized = normalizeSiteDomain(domain)
  return SITE_DEFINITIONS.find((definition) => definition.domains.some((item) => normalizeSiteDomain(item) === normalized))
}

function getSiteAdapter(domain: string) {
  return getSiteDefinition(domain) ?? DEFAULT_NEXUSPHP_DEFINITION
}

export function siteDisplayName(site: SiteRecord) {
  return getSiteDefinition(site.domain)?.displayName ?? site.domain
}

export function siteBaseUrl(site: SiteRecord) {
  return `https://${site.domain}`
}

export function resolveSiteUrl(site: SiteRecord, value: string) {
  return new URL(value, `${siteBaseUrl(site)}/`).toString()
}

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

// 看门狗：兜底清理那些因极端情况（事件循环异常、模块热重载等）而残留过久的 in-flight 标记，
// 防止前端轮询永远停不下来导致按钮持续显示「更新中...」
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
    todaySigninStatus: latest?.status,
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
    extractHostname(payload.domain)
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

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
}

function readHtmlAttribute(tag: string, attribute: string) {
  const match = tag.match(new RegExp(`${attribute}\\s*=\\s*(['"])(.*?)\\1`, 'i'))
  return match?.[2] ? decodeHtml(match[2]).trim() : undefined
}

function textFromHtml(value: string) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<img\b[^>]*>/gi, (tag) => ` ${readHtmlAttribute(tag, 'title') || readHtmlAttribute(tag, 'alt') || ''} `)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractHtmlAttributes(html: string, attributes: string[]) {
  const values: string[] = []
  for (const attribute of attributes) {
    const pattern = new RegExp(`${attribute}\\s*=\\s*(['"])(.*?)\\1`, 'gi')
    for (const match of html.matchAll(pattern)) {
      const value = decodeHtml(match[2]).replace(/\s+/g, ' ').trim()
      if (value) values.push(value)
    }
  }
  return values
}

function extractCells(html: string) {
  const cells: string[] = []
  for (const match of html.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)) {
    const text = textFromHtml(match[1])
    if (text) cells.push(text)
  }
  return cells
}

function toNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function parseSizeToBytes(value: string) {
  const match = value.match(/([\d,.]+)\s*(TiB|TB|GiB|GB|MiB|MB|KiB|KB|B)\b/i)
  if (!match) return undefined
  const amount = toNumber(match[1])
  if (amount === undefined) return undefined
  const unit = match[2].toUpperCase()
  const powerByUnit: Record<string, number> = {
    B: 0,
    KB: 1,
    KIB: 1,
    MB: 2,
    MIB: 2,
    GB: 3,
    GIB: 3,
    TB: 4,
    TIB: 4
  }
  return amount * 1024 ** powerByUnit[unit]
}

function parseSizeByLabel(text: string, labels: string[]) {
  for (const label of labels) {
    // 用分句边界或非「上下」字做前缀锚定，避免「上下载:不限速」里的「下载」被误匹配
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = `(?:^|[；;。\\n]|[^上下载])${escaped}\\s*[:：=]?\\s*([\\d,.]+\\s*(?:TiB|TB|GiB|GB|MiB|MB|KiB|KB|B))`
    const match = text.match(new RegExp(pattern, 'i'))
    if (match && match[1]) return parseSizeToBytes(match[1])
  }
  return undefined
}

function toIsoDate(value?: string | number) {
  if (value === undefined || value === '') return undefined
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const numberValue = Number(value)
    const timestamp = numberValue < 10_000_000_000 ? numberValue * 1000 : numberValue
    const date = new Date(timestamp)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  const normalized = String(value).trim().replace(/\//g, '-')
  const date = new Date(normalized.includes('T') ? normalized : normalized.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function textWithAttributes(html: string) {
  const attributeText = [...html.matchAll(/\b(?:title|alt|data-title|data-original-title)=["']([^"']+)["']/gi)]
    .map((match) => decodeHtml(match[1]))
    .join(' ')
  return `${textFromHtml(html)} ${attributeText}`.replace(/\s+/g, ' ').trim()
}

function parseRelativeFreeEndAt(text: string) {
  if (!/(?:免费|免費|free|2x|2 x|two.?x|50%|half|剩余|剩餘|过期|過期|到期|expire|remaining|left)/i.test(text)) return undefined
  const segment = text.slice(0, 240)
  const day = segment.match(/(\d+(?:\.\d+)?)\s*(?:天|日|day|days|d)/i)
  const hour = segment.match(/(\d+(?:\.\d+)?)\s*(?:小时|小時|时|時|hour|hours|h)/i)
  const minute = segment.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分鐘|分|minute|minutes|min|m)/i)
  const clock = segment.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  const days = day ? Number(day[1]) : 0
  const hours = hour ? Number(hour[1]) : clock ? Number(clock[1]) : 0
  const minutes = minute ? Number(minute[1]) : clock ? Number(clock[2]) : 0
  const seconds = clock?.[3] ? Number(clock[3]) : 0
  const durationMs = (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000
  if (!durationMs) return undefined
  return new Date(Date.now() + durationMs).toISOString()
}

function parseFreeEndAt(text: string, html = '') {
  const source = `${text} ${html ? textWithAttributes(html) : ''}`.replace(/\s+/g, ' ').trim()
  const markerMatch = source.match(/(?:免费|免費|free|2x|2 x|two.?x|50%|half|过期|過期|到期|截止|expire)[\s\S]{0,120}?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i)
  const anyDateMatch = source.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/)
  const absolute = toIsoDate(markerMatch?.[1] ?? anyDateMatch?.[1])
  return absolute ?? parseRelativeFreeEndAt(source)
}

function parseRatioByLabel(text: string) {
  const match = text.match(/(?:分享率|分享率\s*\[[^\]]+\]|Share.?Ratio|Ratio)\s*[:：=]?\s*(∞|inf|infinity|[\d,.]+)/i)
  if (!match) return {}
  if (['∞', 'inf', 'infinity'].includes(match[1].toLowerCase())) return { ratioInfinite: true }
  const ratio = toNumber(match[1])
  return ratio !== undefined ? { ratio, ratioInfinite: false } : {}
}

function normalizeUserLevel(value: string) {
  const compactValue = value.replace(/\s+/g, ' ').trim()
  return KNOWN_USER_LEVELS.find((level) => compactValue.toLowerCase() === level.toLowerCase()) || KNOWN_USER_LEVELS.find((level) => compactValue.includes(level))
}

function parseUserLevel(html: string, cells: string[], text: string) {
  const attributeValues = extractHtmlAttributes(html, ['title', 'alt'])
  for (const knownLevel of KNOWN_USER_LEVELS) {
    if (attributeValues.some((value) => normalizeUserLevel(value) === knownLevel)) {
      return knownLevel
    }
  }

  const labels = ['用户等级', '用戶等級', '會員等級', '会员等级', '等级', '等級', '级别', '級別']
  for (let index = 0; index < cells.length; index += 1) {
    if (labels.some((label) => cells[index].includes(label))) {
      const sameCell = cells[index].match(/(?:用户等级|用戶等級|會員等級|会员等级|等级|等級|级别|級別)\s*[:：]\s*(.+)$/)
      if (sameCell?.[1]) return normalizeUserLevel(sameCell[1]) ?? sameCell[1].trim()
      const nextCell = cells[index + 1]
      if (nextCell && !labels.some((label) => nextCell.includes(label))) return normalizeUserLevel(nextCell) ?? nextCell.trim()
    }
  }

  const textLevel = text.match(/(?:用户等级|用戶等級|會員等級|会员等级|等级|等級|级别|級別)\s*[:：]?\s*([^\s]+)/)?.[1]?.trim()
  if (textLevel) return normalizeUserLevel(textLevel) ?? textLevel
  return undefined
}

function parseTrafficStats(html: string): TrafficStats {
  const text = textFromHtml(html)
  const cells = extractCells(html)
  return {
    userLevel: parseUserLevel(html, cells, text),
    ...parseRatioByLabel(text),
    uploaded: parseSizeByLabel(text, ['上传量', '上傳量', '上载量', '上載量', '上传', '上傳', 'Uploaded']),
    downloaded: parseSizeByLabel(text, ['下载量', '下載量', '下载总量', '下載總量', '下载', '下載', 'Downloaded'])
  }
}

function looksLikeAuthPage(html: string) {
  const text = textFromHtml(html).toLowerCase()
  return /login|logout|password|passkey|登录|登入|登錄|密码|密碼|用户名|用戶名/.test(text)
}

function cookieHeaderValue(value: string) {
  return value
    .replace(/^\s*cookie\s*:\s*/i, '')
    .replace(/[\r\n]+/g, '; ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s*;\s*/g, '; ')
    .trim()
}

async function fetchWithCookie(site: SiteRecord, path: string): Promise<{ text: string; finalUrl: string; httpStatus: number }> {
  const cookie = site.cookie ? cookieHeaderValue(site.cookie) : ''
  if (!cookie) throw new Error('Cookie 未配置或不可用')
  const errors: string[] = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SITE_FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(resolveSiteUrl(site, path), {
        headers: {
          Cookie: cookie,
          'User-Agent': site.userAgent || 'Mozilla/5.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        redirect: 'follow',
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return { text: await response.text(), finalUrl: response.url, httpStatus: response.status }
    } catch (error) {
      const msg = error instanceof Error
        ? (error.name === 'AbortError' ? `请求超时（${SITE_FETCH_TIMEOUT_MS / 1000}s）` : error.message)
        : 'fetch failed'
      errors.push(msg)
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`Cookie 访问失败：${errors.at(-1) ?? 'fetch failed'}`)
}

function findOwnProfilePath(html: string, site: SiteRecord) {
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*userdetails\.php\?id=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = textFromHtml(match[2])
    if (label && !/做种数|下載數|下载数|seeder|leecher/i.test(label)) {
      return new URL(decodeHtml(match[1]), `${siteBaseUrl(site)}/`).toString()
    }
  }
  return undefined
}

async function fetchNexusProfileHtml(site: SiteRecord, profilePath: string): Promise<{ text: string; finalUrl: string; httpStatus: number }> {
  const first = await fetchWithCookie(site, profilePath)
  const ownProfilePath = findOwnProfilePath(first.text, site)
  if (!ownProfilePath || resolveSiteUrl(site, profilePath) === ownProfilePath) return first
  return fetchWithCookie(site, ownProfilePath)
}

async function fetchMTeamProfile(site: SiteRecord): Promise<TrafficStats> {
  if (!site.apiKey?.trim()) throw new Error('API Key 未配置或不可用')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SITE_FETCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch('https://api.m-team.cc/api/member/profile', {
      method: 'POST',
      headers: {
        'x-api-key': site.apiKey,
        'User-Agent': site.userAgent || 'Mozilla/5.0',
        Accept: 'application/json'
      },
      signal: controller.signal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`API Key 访问失败：请求超时（${SITE_FETCH_TIMEOUT_MS / 1000}s）`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) throw new Error(`API Key 访问失败：HTTP ${response.status}`)
  const result = (await response.json()) as {
    code?: string | number
    message?: string
    data?: {
      role?: string | number
      memberCount?: {
        uploaded?: string | number
        downloaded?: string | number
        shareRate?: string | number
      }
    }
  }
  if (String(result.code) !== '0' || !result.data) throw new Error(result.message || 'API Key 访问失败')
  const role = result.data.role === undefined ? undefined : String(result.data.role)
  return {
    userLevel: role === undefined ? undefined : MTEAM_ROLE_LEVELS[role] ?? role,
    ratio: toNumber(result.data.memberCount?.shareRate),
    ratioInfinite: false,
    uploaded: toNumber(result.data.memberCount?.uploaded),
    downloaded: toNumber(result.data.memberCount?.downloaded)
  }
}

async function fetchTrafficByCredential(site: SiteRecord, credential: Credential): Promise<{ stats: TrafficStats; meta?: { finalUrl: string; httpStatus: number; bodyExcerpt: string } }> {
  const definition = getSiteAdapter(site.domain)
  if (credential === 'API_KEY') {
    if (definition?.strategy !== 'MTEAM_API') throw new Error('该站点不支持 API Key 获取用户信息')
    return { stats: await fetchMTeamProfile(site) }
  }
  const fetched = await fetchNexusProfileHtml(site, definition.profilePath)
  const stats = parseTrafficStats(fetched.text)
  const bodyExcerpt = fetched.text.replace(/\s+/g, ' ').trim().slice(0, 300)
  return { stats, meta: { finalUrl: fetched.finalUrl, httpStatus: fetched.httpStatus, bodyExcerpt } }
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

  // 合并最后一条 credential 的诊断信息到错误信息中
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

function parseNexusTorrentRows(html: string): TorrentListItem[] {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1])
  const items: TorrentListItem[] = []
  for (const row of rows) {
    const detailsMatch = row.match(/href=["']((?:https?:\/\/[^\/"']+\/)?details\.php\?id=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i)
    if (!detailsMatch) continue
    const title = textFromHtml(detailsMatch[3])
    if (!title || title.length < 3) continue
    const text = textFromHtml(row)
    const sizes = [...text.matchAll(/([\d,.]+)\s*(?:TiB|TB|GiB|GB|MiB|MB|KiB|KB)\b/gi)]
    const seeders = readLinkedNumber(row, '#seeders')
    const leechers = readLinkedNumber(row, '#leechers')
    items.push({
      id: detailsMatch[2],
      title,
      subtitle: text.replace(title, '').trim().slice(0, 140) || undefined,
      size: sizes.length ? parseSizeToBytes(sizes[sizes.length - 1][0]) : undefined,
      freeEndAt: parseFreeEndAt(text, row),
      seeders,
      leechers,
      tags: [...new Set([...text.matchAll(/(免费|FREE|50%|2X|中字|粤配|官组)/gi)].map((match) => match[1]))]
    })
  }
  return items.length && items.some((item) => item.size !== undefined || item.seeders !== undefined || item.leechers !== undefined) ? items : parseNexusTorrentLinks(html)
}

function readLinkedNumber(html: string, marker: string) {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(new RegExp(`<a\\b[^>]*href=["'][^"']*${escapedMarker}[^"']*["'][^>]*>([\\s\\S]*?)<\\/a>`, 'i'))
  return match ? toNumber(textFromHtml(match[1])) : undefined
}

function parseNexusTorrentLinks(html: string): TorrentListItem[] {
  const linkMatches = [...html.matchAll(/<a\b[^>]*href=["']((?:https?:\/\/[^\/"']+\/)?details\.php\?id=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)].filter((match) => {
    const title = textFromHtml(match[3])
    return Boolean(title && !/^\d+$/.test(title) && !/^poster$/i.test(title) && title.length >= 3)
  })
  const items: TorrentListItem[] = []

  for (let index = 0; index < linkMatches.length; index += 1) {
    const match = linkMatches[index]
    const title = textFromHtml(match[3])

    const start = match.index ?? 0
    const nextStart = linkMatches[index + 1]?.index ?? html.length
    const segment = html.slice(start, nextStart)
    const text = textFromHtml(segment)
    const sizes = [...text.matchAll(/([\d,.]+)\s*(?:TiB|TB|GiB|GB|MiB|MB|KiB|KB|B)\b/gi)]
    items.push({
      id: match[2],
      title,
      subtitle: text.replace(title, '').trim().slice(0, 140) || undefined,
      size: sizes.length ? parseSizeToBytes(sizes[sizes.length - 1][0]) : undefined,
      freeEndAt: parseFreeEndAt(text, segment),
      seeders: readLinkedNumber(segment, '#seeders'),
      leechers: readLinkedNumber(segment, '#leechers'),
      tags: [...new Set([...text.matchAll(/(免费|FREE|50%|2X|中字|粤配|官组)/gi)].map((tagMatch) => tagMatch[1]))]
    })
    if (items.length >= 50) break
  }

  return items
}

async function browseMTeamTorrents(site: SiteRecord, keyword: string, page: number, pageSize: number) {
  if (!site.apiKey?.trim()) throw new Error('M-Team 浏览需要 API Key')
  const response = await fetch('https://api.m-team.cc/api/torrent/search', {
    method: 'POST',
    headers: {
      'x-api-key': site.apiKey,
      'User-Agent': site.userAgent || 'Mozilla/5.0',
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ pageNumber: page, pageSize, keyword })
  })
  if (!response.ok) throw new Error(`M-Team 种子列表请求失败：HTTP ${response.status}`)
  const result = (await response.json()) as {
    code?: string | number
    message?: string
    data?: {
      total?: string | number
      data?: Array<{
        id?: string | number
        name?: string
        smallDescr?: string
        createdDate?: string
        size?: string | number
        status?: {
          seeders?: string | number
          leechers?: string | number
          discount?: string
          discountEndTime?: string | number
          freeEndTime?: string | number
          discountEndDate?: string | number
        }
      }>
    }
  }
  if (String(result.code) !== '0' || !result.data) throw new Error(result.message || 'M-Team 种子列表请求失败')
  return {
    total: toNumber(result.data.total) ?? 0,
    items: (result.data.data ?? []).map((item) => ({
      id: String(item.id ?? ''),
      title: item.name ?? '-',
      subtitle: item.smallDescr,
      createdAt: item.createdDate,
      size: toNumber(item.size),
      freeEndAt: toIsoDate(item.status?.discountEndTime ?? item.status?.freeEndTime ?? item.status?.discountEndDate),
      seeders: toNumber(item.status?.seeders),
      leechers: toNumber(item.status?.leechers),
      tags: item.status?.discount ? [item.status.discount] : []
    }))
  }
}

// NexusPHP 列表页单页默认行数（多数站点默认 50，部分站点可被管理员调整；用于估算需要的页数）
const NEXUSPHP_DEFAULT_PAGE_SIZE = 50
// 单次 browseTorrents 最多翻多少页，避免单次任务拉取过多触发站点反爬
const NEXUSPHP_MAX_PAGES_PER_CALL = 20

function buildNexusListUrl(torrentPath: string, keyword: string, page: number): string {
  const params: string[] = []
  if (page > 1) params.push(`page=${page}`)
  if (keyword) params.push(`search=${encodeURIComponent(keyword)}`)
  const query = params.length ? `?${params.join('&')}` : ''
  return `${torrentPath}${query}`
}

async function browseNexusTorrents(site: SiteRecord, keyword: string, torrentPath = '/torrents.php', page = 1, pageSize = NEXUSPHP_DEFAULT_PAGE_SIZE) {
  const target = Math.max(1, pageSize)
  const startPage = Math.max(1, page)
  const maxPages = Math.min(NEXUSPHP_MAX_PAGES_PER_CALL, Math.max(1, Math.ceil(target / NEXUSPHP_DEFAULT_PAGE_SIZE) + 1))
  const items: TorrentListItem[] = []
  const seen = new Set<string>()
  let firstPageAuthError: { finalUrl?: string; httpStatus?: number; bodyExcerpt: string } | undefined

  for (let p = startPage, fetched = 0; fetched < maxPages && items.length < target; p += 1, fetched += 1) {
    const path = buildNexusListUrl(torrentPath, keyword, p)
    const { text: html, finalUrl, httpStatus } = await fetchWithCookie(site, path)
    const isAuthPage = looksLikeAuthPage(html)

    if (p === startPage && isAuthPage) {
      firstPageAuthError = { finalUrl, httpStatus, bodyExcerpt: html.replace(/\s+/g, ' ').trim().slice(0, 300) }
      break
    }
    if (isAuthPage) break

    const pageItems = parseNexusTorrentRows(html)
    if (!pageItems.length) break

    let addedFromPage = 0
    for (const item of pageItems) {
      if (!item.id || seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
      addedFromPage += 1
      if (items.length >= target) break
    }
    if (addedFromPage === 0) break
  }

  if (!items.length && firstPageAuthError) {
    const e: Error & { diagnostic?: unknown } = new Error('Cookie 访问失败：需要重新登录')
    e.diagnostic = firstPageAuthError
    throw e
  }

  return { total: items.length, items }
}

export async function browseTorrents(site: SiteRecord, keyword: string, page: number, pageSize: number) {
  const definition = getSiteDefinition(site.domain)
  const errors: string[] = []

  if (site.apiKey && definition?.strategy === 'MTEAM_API') {
    try {
      return { credential: 'API_KEY' as Credential, ...(await browseMTeamTorrents(site, keyword, page, pageSize)) }
    } catch (error) {
      errors.push(`API_KEY: ${error instanceof Error ? error.message : '访问失败'}`)
    }
  }

  if (definition?.strategy === 'MTEAM_API') {
    if (site.cookie) errors.push('COOKIE: M-Team 种子列表需要可用 API Key')
    throw new Error(errors.join('；') || 'M-Team 种子列表需要 API Key')
  }

  if (site.cookie) {
    try {
      const torrentPath = definition?.strategy === 'NEXUSPHP' ? definition.torrentPath : '/torrents.php'
      return { credential: 'COOKIE' as Credential, ...(await browseNexusTorrents(site, keyword, torrentPath, page, pageSize)) }
    } catch (error) {
      errors.push(`COOKIE: ${error instanceof Error ? error.message : '访问失败'}`)
    }
  }

  throw new Error(errors.join('；') || 'API Key 和 Cookie 都不可用')
}

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
    // 保留用户输入的原始 hostname（不去除 www. / 不强制小写），用于登录态对齐；
    // 大小写在 DNS 协议层面等价，但 PT 站点 cookie 通常按 host 匹配，保留原值可减少回话丢失
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
