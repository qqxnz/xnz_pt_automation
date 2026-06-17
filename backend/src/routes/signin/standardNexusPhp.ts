import type { SiteRecord } from '../../storage.js'
import { normalizeSiteDomain, siteBaseUrl, siteDisplayName } from '../sites/index.js'
import type { SigninContext, SigninHandler, SigninResult } from './types.js'

export type StandardNexusPhpOptions = {
  matchDomains: string[]
  signinPath?: string
  method?: 'POST' | 'GET'
  bodyBuilder?: () => URLSearchParams | string
  successPatterns?: RegExp[]
  repeatPatterns?: RegExp[]
  authFailurePatterns?: RegExp[]
  extraContentType?: string
  responseType?: 'html' | 'json'
  jsonStatusKey?: string
  jsonStatusSuccessValue?: string | number
  jsonRepeatValue?: string | number
  detailExtractor?: (text: string) => string | undefined
  successMessageBuilder?: (displayName: string, text: string, responseJson: unknown) => string
}

const DEFAULT_SUCCESS_PATTERNS = [/已连续签到/, /签到成功/, /本次签到/, /签到已得/, /签到获得/, /明日再来/]
const DEFAULT_REPEAT_PATTERNS = [/你今天已经签到过了/, /今日已签到/, /今天已经签到/, /已经签到/, /已领取/, /已签到/]
const DEFAULT_AUTH_FAILURE_PATTERNS = [/Cookie.*失效/, /请先登录/, /需要登录/]

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

export function makeStandardNexusPhpSignin(options: StandardNexusPhpOptions): SigninHandler {
  const successPatterns = options.successPatterns ?? DEFAULT_SUCCESS_PATTERNS
  const repeatPatterns = options.repeatPatterns ?? DEFAULT_REPEAT_PATTERNS
  const authFailurePatterns = options.authFailurePatterns ?? DEFAULT_AUTH_FAILURE_PATTERNS
  const matchDomains = new Set(options.matchDomains.map((domain) => normalizeSiteDomain(domain)))
  const signinPath = options.signinPath ?? '/attendance.php'
  const method = options.method ?? 'POST'
  const bodyBuilder = options.bodyBuilder ?? (() => new URLSearchParams({ action: 'post', content: '' }))
  const responseType = options.responseType ?? 'html'

  return {
    match: (site) => matchDomains.has(normalizeSiteDomain(site.domain)),
    signin: async (site, _ctx: SigninContext): Promise<SigninResult> => {
      const displayName = siteDisplayName(site)
      if (!site.enabled) {
        return { status: 'SKIPPED', message: `${displayName} 站点已禁用，跳过签到` }
      }
      if (!site.cookie?.trim()) {
        return { status: 'SKIPPED', message: `${displayName} 未配置 Cookie，无法签到` }
      }

      const url = `${siteBaseUrl(site)}${signinPath}`
      const builtBody = bodyBuilder()
      const body = typeof builtBody === 'string' ? builtBody : builtBody.toString()
      const headers: Record<string, string> = {
        Cookie: cookieHeaderValue(site.cookie),
        'User-Agent': site.userAgent || 'Mozilla/5.0',
        Accept: responseType === 'json' ? 'application/json,text/plain,*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
      if (method === 'POST' && !options.extraContentType) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
      if (options.extraContentType) {
        headers['Content-Type'] = options.extraContentType
      }

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: method === 'GET' ? undefined : body,
          redirect: 'follow'
        })
        if (!response.ok) {
          return {
            status: 'FAILED',
            message: `${displayName} 签到失败：HTTP ${response.status} (${response.url})`,
            errorMessage: `HTTP ${response.status} | ${response.url}`
          }
        }
        const rawText = await response.text()
        const finalUrl = response.url
        const text = responseType === 'html' ? textFromHtml(rawText) : rawText

        if (/login\.php/.test(finalUrl) || /login\.php/.test(rawText) || /请先登录|需要登录/.test(text)) {
          return {
            status: 'FAILED',
            message: `${displayName} 签到失败：Cookie 已失效`,
            errorMessage: 'Cookie 已失效'
          }
        }

        if (responseType === 'json' && options.jsonStatusKey) {
          let parsed: Record<string, unknown> = {}
          try {
            parsed = JSON.parse(rawText) as Record<string, unknown>
          } catch (error) {
            return {
              status: 'FAILED',
              message: `${displayName} 签到失败：返回非 JSON 数据`,
              errorMessage: error instanceof Error ? error.message : 'JSON parse failed'
            }
          }
          const statusValue = parsed[options.jsonStatusKey]
          const successValue = options.jsonStatusSuccessValue
          if (statusValue === successValue) {
            const detail = options.detailExtractor?.(JSON.stringify(parsed))
            const message = options.successMessageBuilder
              ? options.successMessageBuilder(displayName, JSON.stringify(parsed), parsed)
              : `${displayName} 签到成功${detail ? `（${detail}）` : ''}`
            return { status: 'SUCCESS', message }
          }
          const messageText = String(parsed.message ?? parsed.data ?? '')
          if (options.jsonRepeatValue !== undefined && statusValue === options.jsonRepeatValue) {
            return { status: 'SUCCESS', message: `${displayName} 今日已签到` }
          }
          if (messageText) {
            return {
              status: 'FAILED',
              message: `${displayName} 签到失败：${messageText.slice(0, 120)}`,
              errorMessage: messageText.slice(0, 200)
            }
          }
          return {
            status: 'FAILED',
            message: `${displayName} 签到失败：返回状态未识别`,
            errorMessage: JSON.stringify(parsed).slice(0, 200)
          }
        }

        for (const pattern of authFailurePatterns) {
          if (pattern.test(text)) {
            return {
              status: 'FAILED',
              message: `${displayName} 签到失败：${text.slice(0, 80)}`,
              errorMessage: text.slice(0, 200)
            }
          }
        }
        for (const pattern of repeatPatterns) {
          if (pattern.test(text)) {
            return { status: 'SUCCESS', message: `${displayName} 今日已签到` }
          }
        }
        for (const pattern of successPatterns) {
          if (pattern.test(text)) {
            const detail = options.detailExtractor?.(text) ?? text.match(/签到[\s\S]{0,80}?(\d+)\s*(?:魔力|积分|奖励|经验|猫粮|点)/)?.[1]
            return {
              status: 'SUCCESS',
              message: detail ? `${displayName} 签到成功（${detail} 魔力/积分）` : `${displayName} 签到成功`
            }
          }
        }
        return {
          status: 'FAILED',
          message: `${displayName} 签到接口返回无法识别`,
          errorMessage: text.slice(0, 200)
        }
      } catch (error) {
        return {
          status: 'FAILED',
          message: `${displayName} 签到失败：${error instanceof Error ? error.message : '未知错误'}`,
          errorMessage: error instanceof Error ? error.message : '未知错误'
        }
      }
    }
  }
}
