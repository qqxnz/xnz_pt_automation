// 听听歌（totheglory.im）适配器：HTML 结构跟标准 NexusPHP 不同
// 差异点：
//   1. URL 是 /browse.php?c=M（不是 /torrents.php）
//   2. 种子链接用 /t/{id}/（不是 /details.php?id=...）
//   3. 标题在链接里，但链接外还有 "剩余 X 小时"、"8.3"（discount 倍数）等
//   4. 表格列布局：分类图 | 标题+免费 | 回复 | 收藏 | 时间 | 时长 | 体积 | 下载次数 | 做种/下载 | 发布人
//
// 这里只实现 browseTorrents，fetchTraffic 走默认 NexusPHP 通用实现
import type { SiteRecord } from '../../storage.js'
import type { BrowseTorrentsResult, SiteAdapter, TorrentListItem } from './types.js'
import { fetchWithCookie, looksLikeAuthPage, normalizeSiteDomain, parseSizeToBytes, parseFreeEndAt, sleep } from './util.js'

const NEXUSPHP_DEFAULT_PAGE_SIZE = 50
const MAX_PAGES_PER_CALL = 20
const PAGE_INTERVAL_MS = 800

function parseTothegloryRows(html: string): TorrentListItem[] {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1])
  const items: TorrentListItem[] = []
  for (const row of rows) {
    // 标题链接是 /t/{id}/（不是 /details.php?id=）
    const titleMatch = row.match(/<a\b[^>]*href=["']\/t\/(\d+)\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
    if (!titleMatch) continue
    const id = titleMatch[1]
    const rawTitleHtml = titleMatch[2]
    // 标题里可能嵌套 <br><span>副标题</span>，把 <br> 当成分隔符
    const titleParts = rawTitleHtml.split(/<br\s*\/?>/i).map((s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    const title = titleParts[0] ?? ''
    if (title.length < 3) continue
    const subtitle = titleParts[1] || undefined

    // 抽 td 单元格
    const tds = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1])
    // td[6] = 体积 (如 "37.41 GB")
    const sizeText = tds[6]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
    // td[8] = "272 / 39" 做种 / 下载
    const slText = tds[8]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
    const slMatch = slText.match(/(\d+)\s*\/\s*(\d+)/)
    const seeders = slMatch ? Number(slMatch[1]) : 0
    const leechers = slMatch ? Number(slMatch[2]) : 0
    // td[1] 包含 "剩余 X 小时" / "剩余 X 分钟" / "剩余 X 天" + discount 数字
    const cellText = tds[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
    const freeEndAt = parseFreeEndAt(cellText, tds[1] ?? '')
    // 标记免费中：图标的 alt="free" 或者 src 含 ico_free
    const isFreeNow = /alt\s*=\s*["']?free/i.test(tds[1] ?? '') || /ico_free/i.test(tds[1] ?? '') || /剩余/.test(cellText)
    // 标签：从标题/td 文本里抓 free/2x/50% 等关键词
    const tags = [...new Set([...cellText.matchAll(/(免费|FREE|50%|2X|2x)/gi)].map((m) => m[1]))]

    items.push({
      id,
      title,
      subtitle,
      size: parseSizeToBytes(sizeText),
      freeEndAt,
      seeders,
      leechers,
      tags
    })
  }
  return items
}

function buildTothegloryListUrl(keyword: string, page: number): string {
  // 路径已经在 SITE_METADATA 里定为 /browse.php?c=M，这里只追加 page 和 search
  const params: string[] = []
  if (page > 1) params.push(`page=${page}`)
  if (keyword) params.push(`search=${encodeURIComponent(keyword)}`)
  const query = params.length ? `&${params.join('&')}` : ''
  return `/browse.php?c=M${query}`
}

async function browseTothegloryTorrents(site: SiteRecord, keyword: string, page: number, pageSize: number): Promise<BrowseTorrentsResult> {
  const target = Math.max(1, pageSize)
  const startPage = Math.max(1, page)
  const maxPages = Math.min(MAX_PAGES_PER_CALL, Math.max(1, Math.ceil(target / NEXUSPHP_DEFAULT_PAGE_SIZE) + 1))
  const items: TorrentListItem[] = []
  const seen = new Set<string>()
  let firstPageAuthError: { finalUrl?: string; httpStatus?: number; bodyExcerpt: string } | undefined

  for (let p = startPage, fetched = 0; fetched < maxPages && items.length < target; p += 1, fetched += 1) {
    const path = buildTothegloryListUrl(keyword, p)
    const { text: html, finalUrl, httpStatus } = await fetchWithCookie(site, path)
    const isAuthPage = looksLikeAuthPage(html)

    if (p === startPage && isAuthPage) {
      firstPageAuthError = { finalUrl, httpStatus, bodyExcerpt: html.replace(/\s+/g, ' ').trim().slice(0, 300) }
      break
    }
    if (isAuthPage) break

    const pageItems = parseTothegloryRows(html)
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

    if (fetched + 1 < maxPages && items.length < target) {
      await sleep(PAGE_INTERVAL_MS)
    }
  }

  if (!items.length && firstPageAuthError) {
    const e: Error & { diagnostic?: unknown } = new Error('Cookie 访问失败：需要重新登录')
    e.diagnostic = firstPageAuthError
    throw e
  }

  return { total: items.length, items }
}

export const tothegloryAdapter: SiteAdapter = {
  match: (site) => ['totheglory.im', 'www.totheglory.im'].map(normalizeSiteDomain).includes(normalizeSiteDomain(site.domain)),
  browseTorrents: async (site, keyword, page, pageSize) => {
    const result = await browseTothegloryTorrents(site, keyword, page, pageSize)
    return { ...result, credential: 'COOKIE' as const }
  }
}
