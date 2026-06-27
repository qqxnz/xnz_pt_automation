// 站点适配器接口 + 公共类型定义
//
// 设计思路（参考 signin 模块的 HANDLERS 数组 + pickHandler 模式）：
//   - 每个有特殊行为的站点一个文件（如 mteam.ts），导出一个 SiteAdapter
//   - adapters.ts 维护 SITE_ADAPTERS 数组，pickAdapter(domain) 找第一个匹配的
//   - 找不到匹配的用 baseAdapter（match 全部为 true、无覆盖，回退到 NexusPHP 公共实现）
//   - adapter 内每个方法都是可选的；调用方用 ?? 回退到 nexusphp 通用实现
//   - adapter 内方法可接收 common 参数，让 adapter 能基于通用实现做组合（例如"先通用再过滤"）
import type { SiteRecord } from '../../storage.js'

export type Credential = 'API_KEY' | 'COOKIE'

export type TrafficStats = {
  userLevel?: string
  ratio?: number
  ratioInfinite?: boolean
  uploaded?: number
  downloaded?: number
}

export type TorrentListItem = {
  id: string
  title: string
  subtitle?: string
  createdAt?: string
  size?: number
  freeEndAt?: string
  seeders?: number
  leechers?: number
  tags: string[]
  downloadUrl?: string
}

export type BrowseTorrentsResult = {
  total: number
  items: TorrentListItem[]
}

export type FetchTrafficResult = {
  stats: TrafficStats
  meta?: { finalUrl: string; httpStatus: number; bodyExcerpt: string }
}

// 通用实现签名，adapter 拿到后可以选择直接调用、包装或完全替换
export type BrowseTorrentsCommon = (
  site: SiteRecord,
  keyword: string,
  page: number,
  pageSize: number,
  torrentPath?: string
) => Promise<BrowseTorrentsResult>

export type FetchTrafficCommon = (
  site: SiteRecord,
  credential: Credential
) => Promise<FetchTrafficResult>

// 站点适配器：所有方法都是可选的，调用方按方法粒度回退到 NexusPHP 公共实现
export type SiteAdapter = {
  match: (site: SiteRecord) => boolean
  displayName?: string
  // NexusPHP 站点的种子列表路径，覆盖默认的 /torrents.php（部分站点用 /browse.php 或带 ?c=XXX 分类过滤）
  torrentPath?: string
  browseTorrents?: (site: SiteRecord, keyword: string, page: number, pageSize: number, common: BrowseTorrentsCommon) => Promise<BrowseTorrentsResult & { credential?: Credential }>
  fetchTraffic?: (site: SiteRecord, credential: Credential, common: FetchTrafficCommon) => Promise<FetchTrafficResult>
}
