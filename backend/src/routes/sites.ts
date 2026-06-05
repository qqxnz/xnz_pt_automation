import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState, type SiteRecord, writeState } from '../storage.js'

export const sitesRouter = Router()

type SiteStrategy = 'MTEAM_API' | 'NEXUSPHP'
type Credential = 'API_KEY' | 'COOKIE'

type SiteDefinition = {
  displayName: string
  domains: string[]
  canonicalDomain?: string
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
}

type TrafficStats = {
  userLevel?: string
  ratio?: number
  ratioInfinite?: boolean
  uploaded?: number
  downloaded?: number
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
    canonicalDomain: 'www.hdkyl.in',
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

function normalizeDomain(value: string) {
  const trimmed = value.trim()
  const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

function getSiteDefinition(domain: string) {
  return SITE_DEFINITIONS.find((definition) => definition.domains.some((item) => normalizeDomain(item) === domain))
}

function getSiteAdapter(domain: string) {
  return getSiteDefinition(domain) ?? DEFAULT_NEXUSPHP_DEFINITION
}

export function siteDisplayName(site: SiteRecord) {
  return getSiteDefinition(site.domain)?.displayName ?? site.domain
}

export function siteBaseUrl(site: SiteRecord) {
  return `https://${getSiteDefinition(site.domain)?.canonicalDomain ?? site.domain}`
}

export function resolveSiteUrl(site: SiteRecord, value: string) {
  return new URL(value, `${siteBaseUrl(site)}/`).toString()
}

function listItem(site: SiteRecord) {
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
    trafficSyncedAt: site.trafficSyncedAt,
    lastConnectedAt: site.lastConnectedAt,
    lastConnectError: site.lastConnectError,
    hasApiKey: Boolean(site.apiKey),
    hasCookie: Boolean(site.cookie)
  }
}

function detailItem(site: SiteRecord) {
  return {
    ...listItem(site),
    apiKey: site.apiKey,
    cookie: site.cookie,
    userAgent: site.userAgent
  }
}

function validatePayload(payload: SitePayload, existing?: SiteRecord) {
  if (!payload.domain?.trim()) return '站点域名不能为空'
  try {
    normalizeDomain(payload.domain)
  } catch {
    return '站点域名必须是合法域名或 URL'
  }
  const hasApiKey = Boolean(payload.apiKey?.trim() || existing?.apiKey)
  const hasCookie = Boolean(payload.cookie?.trim() || existing?.cookie)
  if (!hasApiKey && !hasCookie) return 'API Key 和 Cookie 至少填写一个'
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
    const match = text.match(new RegExp(`${label}\\s*[:：]?\\s*([\\d,.]+\\s*(?:TiB|TB|GiB|GB|MiB|MB|KiB|KB|B))`, 'i'))
    if (match) return parseSizeToBytes(match[1])
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

function parseFreeEndAt(text: string) {
  const markerMatch = text.match(/(?:免费|免費|free|2x|2 x|two.?x|50%|half)[\s\S]{0,80}?(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i)
  return toIsoDate(markerMatch?.[1])
}

function parseRatioByLabel(text: string) {
  const match = text.match(/(?:分享率|分享率\s*\[[^\]]+\])\s*[:：]?\s*(∞|inf|infinity|[\d,.]+)/i)
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
    uploaded: parseSizeByLabel(text, ['上传量', '上傳量', '上传', '上傳']),
    downloaded: parseSizeByLabel(text, ['下载量', '下載量', '下载', '下載'])
  }
}

function looksLikeAuthPage(html: string) {
  const text = textFromHtml(html).toLowerCase()
  return /login|logout|password|passkey|登录|登入|登錄|密码|密碼|用户名|用戶名/.test(text)
}

async function fetchWithCookie(site: SiteRecord, path: string) {
  if (!site.cookie?.trim()) throw new Error('Cookie 未配置或不可用')
  const errors: string[] = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(resolveSiteUrl(site, path), {
        headers: {
          Cookie: site.cookie,
          'User-Agent': site.userAgent || 'Mozilla/5.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        redirect: 'follow'
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'fetch failed')
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
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

async function fetchNexusProfileHtml(site: SiteRecord, profilePath: string) {
  const html = await fetchWithCookie(site, profilePath)
  const ownProfilePath = findOwnProfilePath(html, site)
  if (!ownProfilePath || resolveSiteUrl(site, profilePath) === ownProfilePath) return html
  return fetchWithCookie(site, ownProfilePath)
}

async function fetchMTeamProfile(site: SiteRecord): Promise<TrafficStats> {
  if (!site.apiKey?.trim()) throw new Error('API Key 未配置或不可用')
  const response = await fetch('https://api.m-team.cc/api/member/profile', {
    method: 'POST',
    headers: {
      'x-api-key': site.apiKey,
      'User-Agent': site.userAgent || 'Mozilla/5.0',
      Accept: 'application/json'
    }
  })
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

async function fetchTrafficByCredential(site: SiteRecord, credential: Credential) {
  const definition = getSiteAdapter(site.domain)
  if (credential === 'API_KEY') {
    if (definition?.strategy !== 'MTEAM_API') throw new Error('该站点不支持 API Key 获取用户信息')
    return fetchMTeamProfile(site)
  }
  return parseTrafficStats(await fetchNexusProfileHtml(site, definition.profilePath))
}

async function testSite(site: SiteRecord) {
  const attempts: Credential[] = site.apiKey ? ['API_KEY'] : []
  if (site.cookie) attempts.push('COOKIE')
  const errors: string[] = []

  for (const credential of attempts) {
    try {
      const stats = await fetchTrafficByCredential(site, credential)
      if (stats.uploaded === undefined || stats.downloaded === undefined || (stats.ratio === undefined && !stats.ratioInfinite)) {
        throw new Error('未找到上传量、下载量或分享率')
      }
      return { credential, stats }
    } catch (error) {
      errors.push(`${credential}: ${error instanceof Error ? error.message : '访问失败'}`)
    }
  }

  throw new Error(errors.join('；') || 'API Key 和 Cookie 都不可用')
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
    const sizes = [...text.matchAll(/([\d,.]+)\s*(?:TiB|TB|GiB|GB|MiB|MB|KiB|KB|B)\b/gi)]
    const seeders = readLinkedNumber(row, '#seeders')
    const leechers = readLinkedNumber(row, '#leechers')
    items.push({
      id: detailsMatch[2],
      title,
      subtitle: text.replace(title, '').trim().slice(0, 140) || undefined,
      size: sizes.length ? parseSizeToBytes(sizes[sizes.length - 1][0]) : undefined,
      freeEndAt: parseFreeEndAt(text),
      seeders,
      leechers,
      tags: [...new Set([...text.matchAll(/(免费|FREE|50%|2X|中字|粤配|官组)/gi)].map((match) => match[1]))]
    })
    if (items.length >= 50) break
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
      freeEndAt: parseFreeEndAt(text),
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

async function browseNexusTorrents(site: SiteRecord, keyword: string, torrentPath = '/torrents.php') {
  const path = `${torrentPath}${keyword ? `?search=${encodeURIComponent(keyword)}` : ''}`
  const html = await fetchWithCookie(site, path)
  const items = parseNexusTorrentRows(html)
  if (!items.length && looksLikeAuthPage(html)) throw new Error('Cookie 访问失败：需要重新登录')
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
      return { credential: 'COOKIE' as Credential, ...(await browseNexusTorrents(site, keyword, torrentPath)) }
    } catch (error) {
      errors.push(`COOKIE: ${error instanceof Error ? error.message : '访问失败'}`)
    }
  }

  throw new Error(errors.join('；') || 'API Key 和 Cookie 都不可用')
}

sitesRouter.get('/', requireAuth, async (req, res) => {
  const state = await readState()
  const keyword = String(req.query.keyword ?? '').trim().toLowerCase()
  const connectivityStatus = String(req.query.connectivityStatus ?? 'ALL')
  const enabled = String(req.query.enabled ?? 'ALL')
  const page = Math.max(Number(req.query.page ?? 1), 1)
  const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20), 1), 100)

  const filtered = state.sites.filter((site) => {
    if (keyword && !`${siteDisplayName(site)} ${site.domain}`.toLowerCase().includes(keyword)) return false
    if (connectivityStatus !== 'ALL' && site.connectivityStatus !== connectivityStatus) return false
    if (enabled === 'ENABLED' && !site.enabled) return false
    if (enabled === 'DISABLED' && site.enabled) return false
    return true
  })

  const start = (page - 1) * pageSize
  const items = filtered.slice(start, start + pageSize).map((site) => listItem(site))
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

  const now = new Date().toISOString()
  const site: SiteRecord = {
    id: randomUUID(),
    domain: normalizeDomain(payload.domain!),
    enabled: payload.enabled ?? true,
    apiKey: payload.apiKey?.trim() || undefined,
    cookie: payload.cookie?.trim() || undefined,
    userAgent: payload.userAgent?.trim() || undefined,
    connectivityStatus: 'UNKNOWN',
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

  const updated: SiteRecord = {
    ...existing,
    domain: normalizeDomain(payload.domain!),
    enabled: payload.enabled ?? existing.enabled,
    apiKey: payload.apiKey?.trim() || existing.apiKey,
    cookie: payload.cookie?.trim() || existing.cookie,
    userAgent: payload.userAgent?.trim() || undefined,
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

  try {
    const result = await testSite(site)
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
    await writeState(state)
    return res.json({ ok: true, status: site.connectivityStatus, credential: site.currentCredential, ...result.stats })
  } catch (error) {
    site.connectivityStatus = 'AUTH_FAILED'
    site.currentCredential = undefined
    site.lastConnectError = error instanceof Error ? error.message : '站点测试失败'
    site.updatedAt = new Date().toISOString()
    await writeState(state)
    return res.status(400).json({ ok: false, status: site.connectivityStatus, message: site.lastConnectError, errorMessage: site.lastConnectError })
  }
})

sitesRouter.post('/:id/browse-torrents', requireAuth, async (req, res) => {
  const state = await readState()
  const site = state.sites.find((item) => item.id === req.params.id)
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
