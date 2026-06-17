import type { SiteRecord } from '../../storage.js'
import { normalizeSiteDomain, siteDisplayName } from '../sites/index.js'
import type { SigninContext, SigninHandler, SigninResult } from './types.js'

export const mteamSignin: SigninHandler = {
  match: (site) => ['m-team.cc', 'pt.m-team.cc', 'api.m-team.cc'].map(normalizeSiteDomain).includes(normalizeSiteDomain(site.domain)),
  signin: async (site, _ctx: SigninContext): Promise<SigninResult> => {
    const displayName = siteDisplayName(site)
    if (!site.enabled) return { status: 'SKIPPED', message: '站点已禁用，跳过签到' }
    if (!site.apiKey?.trim()) {
      return { status: 'SKIPPED', message: `${displayName} 暂未提供自动签到端点，请手动签到` }
    }
    return { status: 'SKIPPED', message: `${displayName} 暂未提供自动签到端点，请手动签到` }
  }
}
