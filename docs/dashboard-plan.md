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
今日新增种子数
已推送下载器数量
即将过期种子数量
当前上传速度
当前下载速度
总上传量
总下载量
```

模块区域：

- 站点健康状态：展示在线、离线、认证失败、未检测。
- 最近任务：展示同步种子、同步流量、连通性测试等任务的最近结果。
- 快捷操作：新增站点、新增下载器、新建任务、查看种子。
- 风险提示：认证失败、全部离线、默认密码未修改、下载器未配置。

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
    signinEnabled: number
    todaySigninSuccess: number
    todaySigninPending: number
  }
  downloaders: Array<{
    id: string
    name: string
    type: 'QBITTORRENT'
    enabled: boolean
    status: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
    statusMessage?: string
    uploadSpeed: number
    downloadSpeed: number
    lastSyncedAt?: string
  }>
  tasks: {
    total: number
    autoRunEnabled: number
    running: number
    failed: number
    recent: Array<{
      id: string
      taskName: string
      runMode: 'AUTO' | 'MANUAL_RUN'
      status: 'SUCCESS' | 'FAILED' | 'RUNNING'
      startedAt?: string
      finishedAt?: string
      summary?: string
    }>
  }
  torrents: {
    total: number
    running: number
    notRunning: number
    totalUploaded: number
    totalDownloaded: number
  }
  traffic: {
    uploadedTotal: number
    downloadedTotal: number
    todayUploaded: number
    todayDownloaded: number
  }
  risks: Array<{
    type: 'AUTH_FAILED' | 'ALL_OFFLINE' | 'DEFAULT_PASSWORD' | 'DOWNLOADER_NOT_CONFIGURED'
    message: string
    actionText?: string
    actionPath?: string
    siteId?: string        // AUTH_FAILED 关联具体站点
  }>
  quickActions: Array<{
    label: string
    path: string
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
- 实现种子统计卡片。
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
- [ ] 确认快捷操作是否需要直接打开对应新增弹窗。
- [ ] 确认上传下载速度来自下载器还是站点统计。

## 9. v0.5.0 实际实现差异

> 本节记录 `backend/src/routes/stats.ts` + 前端 `DashboardPage.vue` 当前实现与上文的差异。

### 9.1 风险横幅（后端统一生成）

- 4 类风险按优先级：
  - `DEFAULT_PASSWORD`：`security.defaultPasswordInUse === true`（scrypt 校验）
  - `DOWNLOADER_NOT_CONFIGURED`：无任何下载器
  - `AUTH_FAILED`：每个 `connectivityStatus='AUTH_FAILED'` 的站点生成一条（带 `siteId`）
  - `ALL_OFFLINE`：所有站点都非 `ONLINE` 时追加在顶部
- 排序：`AUTH_FAILED` 与 `ALL_OFFLINE` 通过 unshift 推到最前

### 9.2 速度与总量

- `uploadSpeed` / `downloadSpeed`：并发调用所有启用下载器的 `getQbTransferInfo()` 求和
- `totalUploaded` / `totalDownloaded`：同上
- **未做**站点级或任务级速度聚合

### 9.3 任务

- `recent[]` 取最近 5 条 `task_logs`（按 `createdAt DESC`），不区分 AUTO/MANUAL_RUN
- `running` 当前实时数（DB `running=1`）
- `failed` 取所有 `lastStatus='FAILED'`

### 9.4 流量

- `traffic.uploadedTotal` / `downloadedTotal`：来自 `site_torrent_traffic_daily` 全量聚合
- `traffic.todayUploaded` / `todayDownloaded`：取当天 `site_torrent_traffic_daily` 聚合
- **未实现**"今日新增种子数"（文档中 `torrents.todayNew` 字段当前未填充，前端无展示）

### 9.5 实时刷新

- 顶部【刷新】按钮：手动调用 `loadOverview()`，前端无自动轮询
- 进入页面即加载一次（`onMounted`）

### 9.6 TODO 状态

- [x] 首页指标全部接真实接口
- [x] 最近任务来自 `task_logs` 聚合
- [x] 风险提示包含 `DEFAULT_PASSWORD`
- [x] 快捷操作项为 `/sites` `/downloaders` `/tasks` `/torrents` 4 个（`quickActions[]` 字段后端拼装）
- [x] 上传下载速度来自下载器
- [ ] "今日新增种子数"暂未在 `torrents` 字段中提供（需补 `first_seen_at = today` 聚合）

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
- 点击“新增下载器”跳转 `/downloaders`。
- 点击“新建任务”跳转 `/tasks`。
- 点击“查看种子”跳转 `/torrents`。
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
- 下载器未配置时速度和总量展示 `--`，同时展示配置提示。
- 统计接口失败时保留旧数据，并展示顶部错误提示和重试按钮。
- 首次加载无数据时展示骨架屏或 loading 卡片。

后端聚合规则：

- `sites` 指标来自 `sites` 表按连通状态聚合。
- `torrents.todayNew` 按当天创建时间统计。
- `torrents.expiringSoon` 默认统计 2 小时内免费结束且未删除的种子。
- `transfer` 优先来自下载器状态接口；未配置时返回 `null` 或 0，并由前端展示占位。
- `risks` 由后端统一生成，避免前端重复判断业务规则。

安全和性能：

- Dashboard 不返回 Cookie、密钥、下载链接等敏感数据。
- 聚合接口避免逐站实时请求 PT 站点，只读取数据库快照和下载器当前状态。
- 刷新按钮需要前端防抖，避免频繁请求。
