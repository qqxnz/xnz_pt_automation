import type { SiteRecord } from '../../storage.js'
import { siteBaseUrl, siteDisplayName } from '../sites/index.js'
import type { SigninContext, SigninHandler, SigninResult } from './types.js'

const SUCCESS_PATTERNS = [/已连续签到/, /签到成功/, /本次签到/, /签到已得/, /签到获得/, /明日再来/, /已签到/]
const REPEAT_PATTERNS = [/你今天已经签到过了/, /今日已签到/, /今天已经签到/, /已经签到/, /已领取/]
const FAIL_PATTERNS = [/Cookie.*失效/, /签到失败/, /请先登录/, /需要登录/]

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

function textFromHtml(value: string) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cookieHeaderValue(value: string) {
  return value
    .replace(/^\s*cookie\s*:\s*/i, '')
    .replace(/[\r\n]+/g, '; ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s*;\s*/g, '; ')
    .trim()
}

async function postAttendance(site: SiteRecord) {
  if (!site.cookie?.trim()) {
    throw new Error('未配置 Cookie，无法签到')
  }
  const url = `${siteBaseUrl(site)}/attendance.php`
  const body = new URLSearchParams({ action: 'post', content: '' }).toString()
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Cookie: cookieHeaderValue(site.cookie),
      'User-Agent': site.userAgent || 'Mozilla/5.0',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body,
    redirect: 'follow'
  })
  if (!response.ok) throw new Error(`签到接口返回 HTTP ${response.status}`)
  return { url, body: await response.text(), finalUrl: response.url }
}

function classify(html: string, finalUrl: string, displayName: string): SigninResult {
  const text = textFromHtml(html)
  if (/login\.php/.test(finalUrl) || /login\.php/.test(html) || /请先登录|需要登录/.test(text)) {
    return { status: 'FAILED', message: `${displayName} 签到失败：Cookie 已失效`, errorMessage: 'Cookie 已失效' }
  }
  for (const pattern of REPEAT_PATTERNS) {
    if (pattern.test(text)) {
      return { status: 'SUCCESS', message: `${displayName} 今日已签到` }
    }
  }
  for (const pattern of SUCCESS_PATTERNS) {
    if (pattern.test(text)) {
      const match = text.match(/签到[\s\S]{0,80}?(\d+)\s*(?:魔力|积分|奖励|经验|点)/)
      const detail = match ? `（${match[1]} 魔力/积分）` : ''
      return { status: 'SUCCESS', message: `${displayName} 签到成功${detail}` }
    }
  }
  for (const pattern of FAIL_PATTERNS) {
    if (pattern.test(text)) {
      return { status: 'FAILED', message: `${displayName} 签到失败：${text.slice(0, 80)}`, errorMessage: text.slice(0, 200) }
    }
  }
  return { status: 'FAILED', message: `${displayName} 签到接口返回无法识别`, errorMessage: text.slice(0, 200) }
}

export const baseNexusPhpSignin: SigninHandler = {
  match: () => true,
  signin: async (site, _ctx): Promise<SigninResult> => {
    if (!site.enabled) {
      return { status: 'SKIPPED', message: '站点已禁用，跳过签到' }
    }
    if (!site.cookie?.trim()) {
      return { status: 'SKIPPED', message: '未配置 Cookie，无法签到' }
    }
    const displayName = siteDisplayName(site)
    try {
      const { body, finalUrl } = await postAttendance(site)
      return classify(body, finalUrl, displayName)
    } catch (error) {
      return {
        status: 'FAILED',
        message: `${displayName} 签到失败：${error instanceof Error ? error.message : '未知错误'}`,
        errorMessage: error instanceof Error ? error.message : '未知错误'
      }
    }
  }
}
