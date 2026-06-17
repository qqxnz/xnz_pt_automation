// M-Team（馒头）适配器：列表 / 资料都走自家 API
// 当前所有方法都跟 NexusPHP 完全不同，所以这里实现了完整的 browse + fetchTraffic，
// 调用方通过 match() 命中后走这里，不再回退到 nexusphp
import type { SiteRecord } from '../../storage.js'
import type { BrowseTorrentsResult, FetchTrafficResult, TrafficStats, SiteAdapter } from './types.js'
import { SITE_FETCH_TIMEOUT_MS, toNumber, toIsoDate, normalizeSiteDomain } from './util.js'

const MTEAM_ROLE_LEVELS: Record<string, string> = {
  '0': '平民', '1': '用户', '2': '侠客', '3': '骑士', '4': '捕头',
  '5': '知县', '6': '通判', '7': '知州', '8': '总督', '9': '大臣'
}

async function browseMTeamTorrents(site: SiteRecord, keyword: string, page: number, pageSize: number): Promise<BrowseTorrentsResult> {
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

async function fetchMTeamTraffic(site: SiteRecord): Promise<FetchTrafficResult> {
  return { stats: await fetchMTeamProfile(site) }
}

export const mteamAdapter: SiteAdapter = {
  displayName: '馒头',
  match: (site) => ['m-team.cc', 'pt.m-team.cc', 'api.m-team.cc'].map(normalizeSiteDomain).includes(normalizeSiteDomain(site.domain)),
  browseTorrents: async (site, keyword, page, pageSize) => {
    const result = await browseMTeamTorrents(site, keyword, page, pageSize)
    return { ...result, credential: 'API_KEY' as const }
  },
  fetchTraffic: async (site, credential) => {
    if (credential === 'API_KEY') return await fetchMTeamTraffic(site)
    throw new Error('M-Team 流量信息需要 API Key')
  }
}
