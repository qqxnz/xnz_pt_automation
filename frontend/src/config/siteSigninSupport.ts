// 与后端 backend/src/routes/sites/adapters.ts 的 SITE_METADATA 保持同步：
// 仅用于前端展示（表单提示"此站点不支持签到功能"、按钮置灰文案等）。
// 真实派发仍由后端负责短路，前端只是为了在用户编辑时给出即时反馈。

export const UNSUPPORTED_SIGNIN_DOMAINS = new Set<string>([
  'm-team.cc',
  'pt.m-team.cc',
  'api.m-team.cc',
  'totheglory.im',
  'www.totheglory.im',
  'keepfrds.com',
  'pt.keepfrds.com',
  'ptchdbits.co',
  'www.ptchdbits.co'
])

function normalizeDomain(input: string): string {
  const trimmed = input.trim()
  const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  return url.hostname.toLowerCase()
}

export function isSigninSupportedByDomain(domain: string): boolean {
  try {
    return !UNSUPPORTED_SIGNIN_DOMAINS.has(normalizeDomain(domain))
  } catch {
    return true
  }
}