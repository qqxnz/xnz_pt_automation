import type { SiteRecord } from '../../storage.js'
import { normalizeSiteName, siteDisplayName } from '../sites.js'
import type { SigninContext, SigninHandler, SigninResult } from './types.js'

export const mteamSignin: SigninHandler = {
  match: (site) => ['馒头', 'mteam', 'm-team'].map(normalizeSiteName).includes(normalizeSiteName(site.name)),
  signin: async (site, _ctx: SigninContext): Promise<SigninResult> => {
    const displayName = siteDisplayName(site)
    if (!site.enabled) return { status: 'SKIPPED', message: '站点已禁用，跳过签到' }
    if (!site.apiKey?.trim()) {
      return { status: 'SKIPPED', message: `${displayName} 暂未提供自动签到端点，请手动签到` }
    }
    return { status: 'SKIPPED', message: `${displayName} 暂未提供自动签到端点，请手动签到` }
  }
}
