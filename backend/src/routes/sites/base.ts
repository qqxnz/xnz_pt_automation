// 默认回退 adapter：match 任意站点，无覆盖，调用方走 NexusPHP 通用实现
// 这样既支持"全部用通用"的简单情况，也支持"匹配到但方法没实现，回退到通用"
import type { SiteAdapter } from './types.js'

export const baseAdapter: SiteAdapter = {
  match: () => true
}
