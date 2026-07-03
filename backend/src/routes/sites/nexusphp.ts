// NexusPHP 通用实现：列表抓取 + 个人资料抓取
// 这是所有未自定义的 NexusPHP 站点的默认行为（也通过 baseAdapter 间接被自定义站点继承）
import type { SiteRecord } from '../../storage.js'
import type { BrowseTorrentsResult, FetchTrafficResult, TrafficStats, TorrentListItem, Credential } from './types.js'
import {
  fetchWithCookie, looksLikeAuthPage, parseSizeToBytes, parseFreeEndAt, readLinkedNumber,
  textFromHtml, toNumber, resolveSiteUrl, sleep, siteBaseUrl, decodeHtml
} from './util.js'

// NexusPHP 列表页单页默认行数（多数站点默认 50，部分站点可被管理员调整；用于估算需要的页数）
export const NEXUSPHP_DEFAULT_PAGE_SIZE = 50
// 单次 browseTorrents 最多翻多少页，避免单次任务拉取过多触发站点反爬
export const NEXUSPHP_MAX_PAGES_PER_CALL = 20
// NexusPHP 跨页请求间隔（毫秒），防反爬；只在实际翻下一页时生效
export const NEXUSPHP_PAGE_INTERVAL_MS = 800

const KNOWN_USER_LEVELS = [
  '保种员', '保種員', '发布员', '發布員', '总督', '總督',
  'Power User', 'Elite User', 'Crazy User', 'Insane User', 'Veteran User', 'Extreme User', 'Ultimate User',
  'mTorrent Master', 'Donor', 'User'
]

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

function parseSizeByLabel(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = `(?:^|[；;。\\n]|[^上下载])${escaped}\\s*[:：=]?\\s*([\\d,.]+\\s*(?:TiB|TB|GiB|GB|MiB|MB|KiB|KB|B))`
    const match = text.match(new RegExp(pattern, 'i'))
    if (match && match[1]) return parseSizeToBytes(match[1])
  }
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

function findOwnProfilePath(html: string, site: SiteRecord) {
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*userdetails\.php\?id=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = textFromHtml(match[2])
    if (label && !/做种数|下載數|下载数|seeder|leecher/i.test(label)) {
      return new URL(decodeHtml(match[1]), `${siteBaseUrl(site)}/`).toString()
    }
  }
  return undefined
}

export async function fetchNexusProfileHtml(site: SiteRecord, profilePath: string): Promise<{ text: string; finalUrl: string; httpStatus: number }> {
  const first = await fetchWithCookie(site, profilePath)
  const ownProfilePath = findOwnProfilePath(first.text, site)
  if (!ownProfilePath || resolveSiteUrl(site, profilePath) === ownProfilePath) return first
  return fetchWithCookie(site, ownProfilePath)
}

export async function fetchNexusTraffic(site: SiteRecord, profilePath: string, _credential: Credential): Promise<FetchTrafficResult> {
  const fetched = await fetchNexusProfileHtml(site, profilePath)
  const stats = parseTrafficStats(fetched.text)
  const bodyExcerpt = fetched.text.replace(/\s+/g, ' ').trim().slice(0, 300)
  return { stats, meta: { finalUrl: fetched.finalUrl, httpStatus: fetched.httpStatus, bodyExcerpt } }
}

// 从行 HTML 中抽取 HR 标记（H3/H5 是 CHDBits 在 <div class="circle-text">hN</div> 这种结构里的文字，
// 通用 H&R 是其他 NexusPHP 站点的行内文本/图标 alt）。结果以 tag 形式合并到 TorrentListItem.tags。
function parseHitRunTags(row: string, text: string): string[] {
  const tags: string[] = []
  const levelMatch = row.match(/<div[^>]*class=["']circle-text["'][^>]*>\s*(h[1-6])\s*<\/div>/i)
  if (levelMatch) tags.push(levelMatch[1].toUpperCase())
  const genericHr = /H&R|hit\.?\s*and\.?\s*run|hit\.?\s*run/i.test(text)
  if (genericHr) {
    if (/未完成|未达标|未做种|未达到|未还种/i.test(text)) tags.push('HR')
    else if (/已完成|已达标|已做种|已还种|completed|done/i.test(text)) tags.push('HR_DONE')
    else tags.push('HR')
  }
  return tags
}

function buildRowTags(row: string, text: string): string[] {
  const base = [...text.matchAll(/(免费|FREE|50%|2X|中字|粤配|官组)/gi)].map((match) => match[1])
  return [...new Set([...base, ...parseHitRunTags(row, text)])]
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
      tags: buildRowTags(row, text)
    })
  }
  return items.length && items.some((item) => item.size !== undefined || item.seeders !== undefined || item.leechers !== undefined) ? items : parseNexusTorrentLinks(html)
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
      tags: buildRowTags(segment, text)
    })
  }
  return items
}

function buildNexusListUrl(torrentPath: string, keyword: string, page: number): string {
  const params: string[] = []
  if (page > 1) params.push(`page=${page}`)
  if (keyword) params.push(`search=${encodeURIComponent(keyword)}`)
  const query = params.length ? `?${params.join('&')}` : ''
  return `${torrentPath}${query}`
}

export async function browseNexusTorrents(site: SiteRecord, keyword: string, torrentPath: string, page: number, pageSize: number): Promise<BrowseTorrentsResult> {
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

    // 还要继续翻页且还没到上限时才 sleep，避免最后一页和单页请求都白白等
    if (fetched + 1 < maxPages && items.length < target) {
      await sleep(NEXUSPHP_PAGE_INTERVAL_MS)
    }
  }

  if (!items.length && firstPageAuthError) {
    const e: Error & { diagnostic?: unknown } = new Error('Cookie 访问失败：需要重新登录')
    e.diagnostic = firstPageAuthError
    throw e
  }

  return { total: items.length, items }
}
