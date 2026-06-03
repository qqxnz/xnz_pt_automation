# 首页模块方案

## 1. 文档依据

本方案基于以下本地文档整理：

- `README.md`
- `docs/pt-automation-technical-design.md`
- `docs/ui-design-login-sites.md`
- `designs/design-spec.md`

## 2. 模块目标

首页模块负责展示系统运行概览、站点健康状态、关键风险和常用操作入口。

交付结果：

- `/dashboard` 首页概览页面
- 核心指标卡片
- 站点健康状态展示
- 风险提示
- 最近任务摘要
- 快捷操作入口
- 桌面和移动端响应式布局

## 3. 功能方案

首页路径为 `/dashboard`，第一阶段定位为系统运行概览和关键操作入口。

概览指标：

```text
已配置站点数量
在线站点数量
认证失败站点数量
今日新增免费种子数
已推送 qBittorrent 数量
即将过期免费种子数量
当前上传速度
当前下载速度
总上传量
总下载量
```

模块区域：

- 站点健康状态：展示在线、离线、认证失败、未检测。
- 最近任务：展示同步免费种子、同步流量、连通性测试等任务的最近结果。
- 快捷操作：新增站点、测试全部站点、同步免费种子、配置 qBittorrent。
- 风险提示：认证失败、全部离线、默认密码未修改、qBittorrent 未配置。

接口建议：

```text
GET /api/stats/overview
```

响应结构：

```ts
type DashboardOverview = {
  sites: {
    total: number
    online: number
    offline: number
    authFailed: number
    unknown: number
  }
  torrents: {
    todayNew: number
    pushed: number
    expiringSoon: number
  }
  transfer: {
    uploadSpeed: number
    downloadSpeed: number
    uploadedTotal: number
    downloadedTotal: number
  }
  risks: Array<{
    type: 'AUTH_FAILED' | 'ALL_OFFLINE' | 'DEFAULT_PASSWORD' | 'QB_NOT_CONFIGURED'
    message: string
    actionText?: string
    actionPath?: string
  }>
}
```

## 4. 设计稿

设计稿文件：`designs/dashboard.svg`

桌面端：

- 顶部展示页面标题、刷新按钮和最近更新时间。
- 第一行展示核心数字卡片。
- 第二行左侧展示站点健康分布，右侧展示风险提示。
- 第三行展示最近任务和快捷操作。

移动端：

- 数字卡片改为两列。
- 风险提示放在指标之后。
- 最近任务使用卡片列表。
- 快捷操作使用紧凑按钮组。
- 不出现横向滚动表格。

## 5. 执行清单

- 创建 `/dashboard` 路由。
- 创建 `DashboardPage.vue`。
- 接入后台主布局。
- 创建首页概览 API 客户端。
- 实现 `GET /api/stats/overview` 聚合接口。
- 实现站点统计卡片。
- 实现免费种子统计卡片。
- 实现上传下载速度展示。
- 实现总上传量和总下载量展示。
- 实现站点健康状态区。
- 实现风险提示区。
- 实现最近任务列表。
- 实现快捷操作入口。
- 实现刷新按钮。
- 实现最近更新时间展示。
- 实现 loading 状态。
- 实现空数据兜底文案。
- 实现接口失败提示。
- 完成桌面端布局。
- 完成移动端卡片布局。

## 6. TODO

- [ ] 确认首页指标第一版是否全部接真实接口，还是部分使用空值占位。
- [ ] 确认最近任务数据来源，第一版可从 job logs 聚合或暂用空状态。
- [ ] 确认风险提示是否包含默认密码未修改。
- [ ] 确认快捷操作中“测试全部站点”是否第一版实现。
- [ ] 确认上传下载速度来自 qBittorrent 还是站点统计。

## 7. 验收标准

- 登录成功后默认进入 `/dashboard`。
- 首页关键指标空数据状态正常。
- 站点数量、在线、离线、认证失败数字展示正确。
- 风险提示能引导用户进入对应页面。
- 刷新时有 loading 状态。
- 移动端指标卡片不溢出屏幕。

## 8. 开发补充规范

页面入口和跳转：

- `/dashboard` 使用后台主布局。
- 点击“新增站点”跳转 `/sites` 并打开新增站点弹窗，或进入站点页后由站点模块处理新增入口。
- 点击“配置 qBittorrent”跳转 `/qbittorrent`。
- 点击认证失败风险提示跳转 `/sites?connectivityStatus=AUTH_FAILED`。

前端状态：

```ts
type DashboardState = {
  overview?: DashboardOverview
  loading: boolean
  error?: string
  lastUpdatedAt?: string
}
```

空状态和异常状态：

- 无站点时站点统计全部为 0，并展示“添加第一个站点”。
- qBittorrent 未配置时速度和总量展示 `--`，同时展示配置提示。
- 统计接口失败时保留旧数据，并展示顶部错误提示和重试按钮。
- 首次加载无数据时展示骨架屏或 loading 卡片。

后端聚合规则：

- `sites` 指标来自 `sites` 表按连通状态聚合。
- `torrents.todayNew` 按当天创建时间统计。
- `torrents.expiringSoon` 默认统计 2 小时内免费结束且未删除的种子。
- `transfer` 优先来自 qBittorrent 状态接口；未配置时返回 `null` 或 0，并由前端展示占位。
- `risks` 由后端统一生成，避免前端重复判断业务规则。

安全和性能：

- Dashboard 不返回 Cookie、密钥、下载链接等敏感数据。
- 聚合接口避免逐站实时请求 PT 站点，只读取数据库快照和 qB 当前状态。
- 刷新按钮需要前端防抖，避免频繁请求。
