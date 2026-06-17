// 纯工具函数：HTML 解析、字符串/数字/日期转换、抓取常量
// 不依赖任何站点特定逻辑，import 此文件的代码都可以自由组合
import type { SiteRecord } from '../../storage.js'

export const SITE_FETCH_TIMEOUT_MS = 25 * 1000

export function extractHostname(value: string) {
  const trimmed = value.trim()
  const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  return url.hostname.toLowerCase()
}

export function extractHostnamePreserveCase(value: string) {
  const trimmed = value.trim()
  const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  return url.hostname
}

export function normalizeSiteDomain(value: string) {
  return extractHostname(value)
}

export function siteBaseUrl(site: SiteRecord) {
  return `https://${site.domain}`
}

export function resolveSiteUrl(site: SiteRecord, value: string) {
  return new URL(value, `${siteBaseUrl(site)}/`).toString()
}

export function cookieHeaderValue(value: string) {
  return value
    .replace(/^\s*cookie\s*:\s*/i, '')
    .replace(/[\r\n]+/g, '; ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s*;\s*/g, '; ')
    .trim()
}

export async function fetchWithCookie(site: SiteRecord, path: string): Promise<{ text: string; finalUrl: string; httpStatus: number }> {
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

export function looksLikeAuthPage(html: string): boolean {
  // 真正的登录页才有密码输入框或指向 login.php 的表单；普通列表页/详情页都满足不了这两个条件
  // 之前用"登录/退出登录/密码/用户名"等关键词太宽，导航栏里的"退出登录"会把正常页误判
  return /<input\b[^>]*type=["']?password/i.test(html) ||
    /<form\b[^>]*action=["'][^"']*login\.php/i.test(html)
}

export function decodeHtml(value: string) {
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

export function readHtmlAttribute(tag: string, attribute: string) {
  const match = tag.match(new RegExp(`${attribute}\\s*=\\s*(['"])(.*?)\\1`, 'i'))
  return match?.[2] ? decodeHtml(match[2]).trim() : undefined
}

export function textFromHtml(value: string) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<img\b[^>]*>/gi, (tag) => ` ${readHtmlAttribute(tag, 'title') || readHtmlAttribute(tag, 'alt') || ''} `)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractHtmlAttributes(html: string, attributes: string[]) {
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

export function extractCells(html: string) {
  const cells: string[] = []
  for (const match of html.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)) {
    const text = textFromHtml(match[1])
    if (text) cells.push(text)
  }
  return cells
}

export function toNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(numberValue) ? numberValue : undefined
}

export function parseSizeToBytes(value: string) {
  const match = value.match(/([\d,.]+)\s*(TiB|TB|GiB|GB|MiB|MB|KiB|KB|B)\b/i)
  if (!match) return undefined
  const amount = toNumber(match[1])
  if (amount === undefined) return undefined
  const unit = match[2].toUpperCase()
  const powerByUnit: Record<string, number> = {
    B: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, TB: 4, TIB: 4
  }
  return amount * 1024 ** powerByUnit[unit]
}

export function parseSizeByLabel(text: string, labels: string[]) {
  for (const label of labels) {
    // 用分句边界或非「上下」字做前缀锚定，避免「上下载:不限速」里的「下载」被误匹配
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = `(?:^|[；;。\\n]|[^上下载])${escaped}\\s*[:：=]?\\s*([\\d,.]+\\s*(?:TiB|TB|GiB|GB|MiB|MB|KiB|KB|B))`
    const match = text.match(new RegExp(pattern, 'i'))
    if (match && match[1]) return parseSizeToBytes(match[1])
  }
  return undefined
}

export function toIsoDate(value?: string | number) {
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

export function textWithAttributes(html: string) {
  const attributeText = [...html.matchAll(/\b(?:title|alt|data-title|data-original-title)=["']([^"']+)["']/gi)]
    .map((match) => decodeHtml(match[1]))
    .join(' ')
  return `${textFromHtml(html)} ${attributeText}`.replace(/\s+/g, ' ').trim()
}

export function parseRelativeFreeEndAt(text: string) {
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

export function parseFreeEndAt(text: string, html = '') {
  const source = `${text} ${html ? textWithAttributes(html) : ''}`.replace(/\s+/g, ' ').trim()
  const markerMatch = source.match(/(?:免费|免費|free|2x|2 x|two.?x|50%|half|过期|過期|到期|截止|expire)[\s\S]{0,120}?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i)
  const anyDateMatch = source.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/)
  const absolute = toIsoDate(markerMatch?.[1] ?? anyDateMatch?.[1])
  return absolute ?? parseRelativeFreeEndAt(source)
}

export function readLinkedNumber(html: string, marker: string) {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(new RegExp(`<a\\b[^>]*href=["'][^"']*${escapedMarker}[^"']*["'][^>]*>([\\s\\S]*?)<\\/a>`, 'i'))
  return match ? toNumber(textFromHtml(match[1])) : undefined
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
