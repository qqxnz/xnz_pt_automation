# 数据统计模块方案

## 1. 模块目标

数据统计模块负责展示站点上传下载趋势、分享率趋势、每日增量和种子推送统计。

业务边界：本模块只展示已采集快照和聚合数据，不负责采集任务配置。

## 2. 页面和入口

页面路径：`/statistics`

入口：左侧导航、首页概览卡片。

## 3. 功能方案

### 3.1 v0.5.0 实际展示内容

- 总览卡：总上传 / 总下载 / 总站点数（来自 `site_torrent_traffic_daily` 全量聚合）
- 时间区间：起止日期 `YYYY-MM-DD` + 快捷预设（今天 / 昨天 / 最近 7 天 / 最近 30 天）
- 两张饼图（Top 8 站点）：
  - 上传 Top 8 站点 + 其余合并为"其他（N）"
  - 下载 Top 8 站点 + 其余合并为"其他（N）"
- 列表：每站 + 每日明细 + 占比 + 分页（20/页）
  - 每条：站点名、上传/下载总量、占比、每日 `uploaded / downloaded` 明细

### 3.2 原方案与实际的差异

- 原方案列出"分享率趋势 / 每日上传下载增量 / 种子推送数量趋势 / 自动删除数量统计" 5 项图表
- v0.5.0 仅实现"按站点聚合的上传/下载饼图 + 每日明细"；其他图表未开发

## 4. 接口和数据

### 4.1 接口现状

```text
GET /api/site-statistics?startDate=&endDate=&siteId=&page=&pageSize=
GET /api/stats/overview
```

- `GET /api/site-statistics` 是实际接口路径（不是原方案中的 `/api/stats/sites`）
- `GET /api/stats/overview` 提供 Dashboard 所需的全部聚合
- **未实现**：`/api/stats/sites`、`/api/stats/sites/:id/traffic`、`/api/stats/torrents`（原方案）

### 4.2 响应结构（实际 `readSiteStatistics`）

```ts
type SiteStatisticsItem = {
  siteId: string
  siteName: string
  totalUploaded: number
  totalDownloaded: number
  sharePercent?: number   // 按当前列表页总上传占比
  daily: Array<{
    date: string           // YYYY-MM-DD
    uploaded: number
    downloaded: number
  }>
}

type SiteStatisticsResponse = {
  items: SiteStatisticsItem[]
  total: number           // 站点数
  page: number
  pageSize: number
  pageUploaded: number    // 当前页累计上传
  pageDownloaded: number  // 当前页累计下载
}
```

### 4.3 数据来源

- `site_torrent_traffic_daily` 表：按 `(date, site_id)` 聚合每个种子上传/下载
- `torrent_traffic_cursors` 表：每个种子上次同步基线
- `torrentSync.syncTorrentDownloadStats()` 每 3s 从 qB 拉回增量
- v6 迁移时执行 `seedTorrentTrafficStatistics` 把迁移当天的种子基线落库

### 4.4 校验

- `startDate <= endDate`（YYYY-MM-DD）
- `page ≥ 1`、`pageSize 1-100`

## 5. 状态和安全

- 无快照数据时展示空状态和"暂无流量数据"
- 大数值统一格式化为 KB / MB / GB / TB / PB
- 不展示敏感下载链接
- 图表交互：hover 显示数值；点击切片"钉住" tooltip，再次点击或外部点击关闭

## 6. 设计稿

设计稿文件：`designs/statistics.svg`。

桌面端使用筛选区 + 饼图卡片 + 站点明细分页。移动端单列堆叠。

## 7. 图表实现

- **未使用 ECharts**；使用自写纯 SVG 组件：
  - `StatisticsPieChart.vue`：donut-style 饼图（8 色 palette），支持 hover/click 钉住
  - `StatisticsBarChart.vue`：双柱状图（上传绿色 / 下载蓝色），含 Y 轴 nice max、X 轴自适应、tooltip
- `SiteStatisticsPage.vue` **当前仅引用 `StatisticsPieChart`**；`StatisticsBarChart` 组件已实现但未使用

## 8. 执行清单

- [x] `/statistics` 路由 + `SiteStatisticsPage.vue`
- [x] 自写 SVG 饼图组件
- [x] 时间区间 + 快捷预设
- [x] 按日聚合接口 `/api/site-statistics`
- [x] 站点列表 + 占比 + 分页
- [ ] 分享率趋势图（`/api/stats/sites`）
- [ ] 每日上传/下载增量柱状图（当前未用 `StatisticsBarChart`）
- [ ] 种子推送数量趋势 / 自动删除数量统计

## 9. TODO

- [x] 生成 `designs/statistics.svg`。
- [x] 图表库：自写 SVG（不引入 ECharts）
- [x] 默认时间范围：7 天
- [ ] 分享率趋势与每日增量柱状图

## 10. 验收标准

- 可按站点和时间范围查看上传/下载聚合。
- 无数据时提示"暂无流量数据"。
- 数值单位展示正确（KB/MB/GB/TB/PB）。
- 移动端图表不溢出。
- 时间区间预设（今天 / 昨天 / 最近 7 / 30 天）正确。
- 饼图 Top 8 之外合并为"其他"切片。
- 大数据查询分页不卡顿。
