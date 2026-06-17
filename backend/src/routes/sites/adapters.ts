// Adapter 注册表：按声明顺序查找第一个匹配站点的 adapter
// 加新站点只需：1) 在这里加一行 import + 2) 在 SITE_ADAPTERS 数组里 push 进去
// （参考 signin/index.ts 的 HANDLERS 模式）
import type { SiteRecord } from '../../storage.js'
import type { SiteAdapter } from './types.js'
import { mteamAdapter } from './mteam.js'
import { tothegloryAdapter } from './totheglory.js'
import { baseAdapter } from './base.js'
import { normalizeSiteDomain } from './util.js'

// 按"特异性优先"排：自定义 adapter 必须在 baseAdapter 前面
const SITE_ADAPTERS: SiteAdapter[] = [
  mteamAdapter,
  tothegloryAdapter
]

export function pickAdapter(site: SiteRecord): SiteAdapter {
  return SITE_ADAPTERS.find((adapter) => adapter.match(site)) ?? baseAdapter
}

// 静态站点元数据：只放显示名 + 种子列表路径等纯展示/路径信息，不参与行为 dispatch
// 新增站点只需要在这里加一行（即使没有自定义行为）
const SITE_METADATA: Array<{ domains: string[]; displayName: string; torrentPath?: string }> = [
  { domains: ['m-team.cc', 'pt.m-team.cc', 'api.m-team.cc'], displayName: '馒头' },
  { domains: ['hhanclub.net', 'www.hhanclub.net'], displayName: '憨憨' },
  { domains: ['hdhome.org', 'www.hdhome.org'], displayName: '家园' },
  { domains: ['hdkyl.in', 'www.hdkyl.in'], displayName: '麒麟' },
  { domains: ['totheglory.im', 'www.totheglory.im'], displayName: '听听歌', torrentPath: '/browse.php?c=M' },
  { domains: ['pt.keepfrds.com', 'keepfrds.com'], displayName: '朋友' },
  { domains: ['ptchdbits.co', 'www.ptchdbits.co'], displayName: '彩虹岛' },
  { domains: ['pterclub.net', 'pterclub.com', 'www.pterclub.com'], displayName: '猫站' },
  { domains: ['ourbits.club', 'www.ourbits.club'], displayName: '我堡' },
  { domains: ['pthome.net', 'www.pthome.net'], displayName: '铂金家' },
  { domains: ['ubits.club', 'www.ubits.club'], displayName: '优堡' },
  { domains: ['pttime.org', 'www.pttime.org'], displayName: '时间' }
]

export function siteDisplayNameByDomain(domain: string): string | undefined {
  const normalized = normalizeSiteDomain(domain)
  return SITE_METADATA.find((item) => item.domains.some((item) => normalizeSiteDomain(item) === normalized))?.displayName
}

export function siteTorrentPathByDomain(domain: string): string | undefined {
  const normalized = normalizeSiteDomain(domain)
  return SITE_METADATA.find((item) => item.domains.some((item) => normalizeSiteDomain(item) === normalized))?.torrentPath
}
