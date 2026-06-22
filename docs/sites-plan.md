# 站点模块方案

## 1. 模块目标

站点模块负责维护 PT 站点域名、API Key、Cookie、User-Agent、可选代理，并完成站点测试、用户统计获取和种子列表浏览。

第一版不兼容旧字段和旧数据结构：不再使用站点名称、解析类型、个人信息地址、种子地址、检查间隔。

## 2. 站点映射表

后端维护站点映射表 `SITE_DEFINITIONS`：

```text
m-team.cc            馒头   MTEAM_API
hhanclub.net         憨憨   NEXUSPHP
hdhome.org           家园   NEXUSPHP
hdkyl.in             麒麟   NEXUSPHP
totheglory.im        听听歌 NEXUSPHP
pt.keepfrds.com      朋友   NEXUSPHP
ptchdbits.co         彩虹岛 NEXUSPHP
pterclub.net / .com  猫站   NEXUSPHP
ourbits.club         我堡   NEXUSPHP
pthome.net           铂金家 NEXUSPHP
ubits.club           优堡   NEXUSPHP
pttime.org           时间   NEXUSPHP (canonical=www.pttime.org，PTTime 把 pttime.org 302 跳到 www.pttime.org，c_secure_* cookie 必须发到 www 才能保持登录)
```

规则：

- 用户只填写站点域名，显示名称由映射表决定。
- 支持同站多个域名和子域名，匹配时仅做小写归一，**不去除 `www.` 前缀**，保留用户原始输入（包括子域名）。
- 同一站点可能在 `www.` 与裸域下登录态不同（如 PTTime 把 `pttime.org` 302 到 `www.pttime.org/login.php`，`c_secure_*` cookie 必须发到 `www.` 才能保持登录），所以保存的 `domain` 字段就是用户输入的原始主机名。
- `SITE_DEFINITIONS` 的 `canonicalDomain` 用于请求时统一 host（如 PTTime 强制 `https://www.pttime.org`），保证 `siteBaseUrl` 走对 host。
- 未知域名允许保存，显示域名本身，并默认按 NexusPHP 站点处理。
- M-Team 使用 API 特殊策略；普通站点和未知站点默认使用 Cookie 抓取 `/userdetails.php` 和 `/torrents.php`。

## 3. 表单

字段：

```ts
type SiteForm = {
  domain: string
  enabled: boolean
  apiKey?: string
  cookie?: string
  userAgent?: string
  proxyId?: string
  signinEnabled?: boolean
  signinTime?: string
}
```

校验：

- 站点域名必填，支持 `pt.m-team.cc` 或完整 URL。
- API Key 和 Cookie 至少填写一个。
- User-Agent 新增时默认使用当前浏览器。
- 代理默认不使用，只能选择已启用代理。
- 签到开关开启时，签到时间必填且必须是 `HH:mm` 格式。
- 签到开关默认关闭，签到时间默认 `09:00`。

## 4. 列表

列表字段：

```text
站点
连通状态
用户等级
分享率
上传量
下载量
当前凭证
签到
操作
```

签到列根据 `site.signinEnabled` 和 `site.todaySigninStatus` 渲染：

```text
未启用：已关闭
未签到：待签到
SUCCESS：已签到
FAILED：签到失败
SKIPPED：已跳过
```

签到列右侧紧跟一组操作按钮，新增【签到】按钮调用 `POST /api/sites/:id/signin` 立即执行一次。

当前凭证：

```text
API_KEY
COOKIE
NONE
```

操作：

```text
签到
测试
浏览
编辑
删除
```

列表过滤器新增「签到：全部 / 已开启 / 已关闭」。

## 5. 测试和用户统计

测试接口：

```text
POST /api/sites/:id/test-connectivity
```

测试行为：

- API Key 优先。
- API Key 不可用时回退 Cookie。
- 成功后更新 `currentCredential`、连通状态、用户等级、分享率、上传量、下载量。
- 两种凭证都失败时标记认证失败，并保留错误原因。
- 失败响应中携带 `diagnostic` 字段（`finalUrl` / `httpStatus` / `bodyExcerpt` / `matchedKeywords`），便于排查「认证失败」的真实原因（cookie 失效、Cloudflare 拦截、关键字未匹配等）。

M-Team：

- API：`POST https://api.m-team.cc/api/member/profile`
- Header：`x-api-key`
- 上传量：`data.memberCount.uploaded`
- 下载量：`data.memberCount.downloaded`
- 分享率：`data.memberCount.shareRate`
- 用户等级：按 API `data.role` 代码映射为中文显示名。

M-Team 等级映射：

```text
0 平民
1 用户
2 侠客
3 骑士
4 捕头
5 知县
6 通判
7 知州
8 总督
9 大臣
```

普通 NexusPHP 站点：

- 使用 Cookie 访问 `/userdetails.php`。
- 从 HTML 文本和图片 `title/alt` 中解析用户等级。
- 从页面文本解析分享率、上传量、下载量。

## 6. 浏览种子

接口：

```text
POST /api/sites/:id/browse-torrents
```

请求：

```ts
type BrowseTorrentsRequest = {
  keyword?: string
  category?: string
  page?: number
  pageSize?: number
}
```

响应：

```ts
type BrowseTorrentItem = {
  id: string
  title: string
  subtitle?: string
  createdAt?: string
  size?: number
  seeders?: number
  leechers?: number
  tags: string[]
}
```

浏览弹窗：

- 标题为 `浏览 - 站点显示名`。
- 展示关键词、资源分类、搜索按钮、结果数量和每页数量。
- 表格列为标题、时间、大小、做种、下载。
- 第一版不实现详情或下载动作。

## 7. 接口

```text
GET    /api/sites?keyword=&connectivityStatus=&enabled=&signinEnabled=&page=&pageSize=
POST   /api/sites
GET    /api/sites/:id
PUT    /api/sites/:id
DELETE /api/sites/:id
POST   /api/sites/:id/test-connectivity
POST   /api/sites/:id/browse-torrents
POST   /api/sites/:id/signin
POST   /api/sites/signin-all
POST   /api/sites/:id/update            # 单站入队更新（202）
POST   /api/sites/update-all            # 批量入队（staleOnly=true，202）
POST   /api/sites/sync-traffic          # 同步执行批量更新，返回完整结果
```

## 8. 签到

签到功能为每个站点提供「手动立即签到」入口和「按时间自动签到」调度器。签到结果会写入独立的签到日志（详见 `docs/logs-plan.md` 签到日志 Tab）。

### 8.1 签到策略

按你选定的「每个站点独立文件实现」组织。`backend/src/routes/signin/` 下：

```text
types.ts              // SigninContext / SigninResult / SigninHandler
standardNexusPhp.ts   // 工厂：通用 attendance.php + 关键词匹配
baseNexusPhp.ts       // 未匹配时的兜底实现
mteam.ts              // M-Team：当前 SKIPPED（无公开签到端点）
hhanclub.ts           // hhanclub.net
hdhome.ts             // hdhome.org
hdkyl.ts              // hdkyl.in
totheglory.ts         // totheglory.im
keepfrds.ts           // pt.keepfrds.com
chdbits.ts            // ptchdbits.co
pterclub.ts           // pterclub.net/.com（attendance-ajax.php + JSON 解析）
ourbits.ts            // ourbits.club
pthome.ts             // pthome.net
ubits.ts              // ubits.club
pttime.ts             // pttime.org
index.ts              // 派发 + 同站防重入 + 写 site_signin_logs
```

派发规则：

- `mteam.ts` / `hhanclub.ts` / `hdhome.ts` / `hdkyl.ts` / `totheglory.ts` / `keepfrds.ts` / `chdbits.ts` / `pterclub.ts` / `ourbits.ts` / `pthome.ts` / `ubits.ts` / `pttime.ts` 各自通过 `match(site)` 匹配 `site.domain`（小写归一后比对，保留原始大小写与子域名）。
- 未命中时使用 `baseNexusPhp` 通用实现，POST `attendance.php` 并解析成功/重复/失败关键词。
- 站点 `enabled === false` 或缺少 `cookie` 时直接返回 `SKIPPED`，不会调用网络。

### 8.2 立即签到接口

`POST /api/sites/:id/signin`

请求体：空。返回：

```ts
{
  ok: boolean
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  message: string
  errorMessage?: string
  siteId: string
  siteName: string
  logId: string
  durationMs: number
}
```

防重入：后端用 `Map<siteId, Promise>` 锁，相同站点未完成时返回当前 in-flight Promise；前端按钮变 `签到中...` 且 `disabled`。

### 8.3 批量签到

`POST /api/sites/signin-all`：对所有 `signinEnabled === true && enabled === true` 的站点串行签到，规避站点风控。返回 `{ total, results: SigninResultItem[] }`。

### 8.4 自动签到调度器

`backend/src/utils/scheduler.ts` 新增 `site-auto-signin` job（每 60 秒扫描一次），由 `runDueSignins()` 执行：

1. 取所有 `signinEnabled && enabled` 站点；
2. 当前时间 ≥ 当日 `signinTime` 且 `lastSigninAt` 不在今天时进入待签列表；
3. 串行调用 `performSiteSignin()`；
4. 每个站点都写一条 `site_signin_logs` 记录并更新 `site.lastSignin*`；
5. 调度器额外写一条 `scheduleLog`（`jobName='site-auto-signin'`）做汇总，手动签到不写 scheduleLog。

签到时间采用容器本地时间；规则与用户填写的 `HH:mm` 对照。

### 8.5 列表与过滤

`SiteListItem` 增字段：`signinEnabled`、`signinTime`、`todaySigninStatus`、`lastSigninAt`、`lastSigninStatus`、`lastSigninMessage`、`signinRunning`。

`GET /api/sites` 新增 `signinEnabled=ENABLED|DISABLED|ALL` 过滤。

## 9. 执行清单

- 替换站点数据模型为新字段。
- 移除旧表单字段和旧接口入参。
- 实现站点映射表和域名归一化。
- 实现 API Key 优先、Cookie 回退的测试流程。
- 实现 M-Team API 用户统计和种子浏览。
- 实现 NexusPHP Cookie 用户统计和种子浏览。
- 实现浏览弹窗。
- 站点数据模型扩展 `signinEnabled / signinTime / lastSigninAt / lastSigninStatus / lastSigninMessage`，数据库 schema 升级到 v8。
- 新建 `site_signin_logs` 表，写日志与今日状态查询。
- 实现 4 个内置站点 + 通用 NexusPHP 兜底签到实现与派发。
- 站点域名归一化仅在匹配 `SITE_DEFINITIONS` 时进行（只小写，不去 `www.`），POST/PUT 站点接口保存用户输入的原始主机名（`pttime.org` / `www.pttime.org` / `pt.keepfrds.com` 都按用户原样保留）。
- 实现 `POST /api/sites/:id/signin` 手动签到接口，含同站防重入。
- 实现 `POST /api/sites/signin-all` 批量签到。
- 调度器新增 `site-auto-signin` job。
- 站点列表新增「签到」列与【签到】按钮，按钮运行中变 loading。
- 站点表单新增「签到设置」section，含开关和 HH:mm 时间字段。
- 列表过滤器新增「签到：全部 / 已开启 / 已关闭」。
- 日志模块新增「签到日志」Tab，支持查询、导出 CSV、清空。
- 更新设计稿和 UI 文档。
- 通过后端、前端类型检查和完整构建。

## 10. v0.5.0 实际实现差异

> 本节记录 `backend/src/routes/sites/index.ts` + `routes/signin/*` + 前端 `SitesPage.vue` 当前实现与上文的差异。

### 10.1 数据模型扩展

- `sites` 表新增 `signinEnabled` / `signinTime` / `lastSigninAt` / `lastSigninStatus` / `lastSigninMessage`（v8 + v9 自我修复）
- `sites` 表新增 `name` 字段（v10），迁移时按 `lower(domain)` 映射 12 个站点的中文显示名（`馒头 / 憨憨 / 家园 / 麒麟 / 听听歌 / 朋友 / 彩虹岛 / 猫站 / 我堡 / 铂金家 / 优堡 / 时间`），未知域名 `name = domain`
- `name` 也可在创建/编辑时由前端直接传入（文档原方案未列出；前端表单当前不展示 name 字段，后端在迁移与响应中补齐）

### 10.2 站点更新与流量同步

- 调度 `site-traffic-sync` 每 6 小时（21600000ms）调用 `syncSiteTrafficStats({ staleOnly: true })`
- `isStaleForAutoUpdate`：`(now - site.trafficSyncedAt) || (now - site.updatedAt) ≥ 6h`（`connectivityStatus !== 'UNKNOWN'` 时用 `updatedAt`）
- 单站更新总超时 90s；批量并发上限 5；每站 `siteUpdatePromises` 实现单飞
- 60s watchdog：清理超过 5min 的卡死条目
- `POST /api/sites/:id/update` 返回 `{ accepted, alreadyRunning }`；`POST /api/sites/update-all` 返回 `{ accepted, alreadyRunning, sites: [...] }`
- `POST /api/sites/sync-traffic` 同步执行并返回完整汇总（包含 `results[]`）

### 10.3 列表项扩展

- `SiteListItem` 增字段（`listItem` 在 `routes/sites/index.ts:430`）：
  - `yesterdayUploaded`、`todayUploaded`：基于 `site_traffic_snapshots` 与 `site_torrent_traffic_daily` 聚合
  - `todaySigninStatus` / `lastSigninStatus` / `lastSigninMessage` / `signinRunning` / `updating`
- 列表筛选新增 `signinEnabled=ENABLED|DISABLED|ALL`

### 10.4 签到处理器现状

- `backend/src/routes/signin/` 当前文件：
  - `index.ts`：派发 + 同站防重入（`Map<siteId, Promise>`）
  - `types.ts`：`SigninContext { runMode, triggerSource, now }` / `SigninResult { status, message, errorMessage?, durationMs? }`
  - `baseNexusPhp.ts`：默认 `match: ()=>true`，POST `attendance.php?action=post&content=`
  - `standardNexusPhp.ts`：`makeStandardNexusPhpSignin({...})` 工厂
  - `mteam.ts`：m-team 域 → `SKIPPED`（无公开端点）
  - `pterclub.ts`：`/attendance-ajax.php` JSON 响应，按 `status=1` / `status=0` 判定，提取"X 克猫粮"
  - `chdbits / hdhome / hdkyl / hhanclub / keepfrds / ourbits / pthome / pttime / totheglory / ubits .ts`：每个仅声明 `matchDomains`，其余走 `standardNexusPhp` 默认
- 调度器 `site-auto-signin` 每 60s 扫描；条件：`enabled && signinEnabled && currentMinutes ≥ signinTime && !sameDay(lastSigninAt)`
- `lastSigninStatus = 'SKIPPED'` 也写入 `lastSigninAt`（避免重复触发）

### 10.5 立即签到接口返回

```ts
type SigninManualResponse = {
  ok: boolean                  // SKIPPED 视为 true
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  message: string
  errorMessage?: string
  siteId: string
  siteName: string
  logId: string
  durationMs: number
}
```

- 成功后同时写一条操作日志 `action=站点签到`；批量签到写 `action=批量站点签到`

### 10.6 浏览器弹窗现状

- 控件：keyword 输入 + 类别下拉 + 搜索按钮 + 表格（标题 / 剩余免费 / 大小 / 做种 / 下载）
- 请求 `POST /api/sites/:id/browse-torrents` body `{ keyword, page, pageSize, category? }`
- 响应第一版不返回详情 URL，类别作为可选参数

### 10.7 任务表单

- 当前 `SiteForm` 含 `domain / enabled / apiKey / cookie / userAgent / proxyId / signinEnabled / signinTime`
- 不需要 `apiKey` 和 `cookie` 同时存在，但**至少要有一个**（保持原方案）
- `signinTime` 校验正则 `^([01]\d|2[0-3]):[0-5]\d$`

### 10.8 浏览器弹窗补充

- `lastConnectError` 写入最近一次失败原因（仅错误摘要，不含完整 HTML/凭证）
- `trafficSyncedAt` 与 `lastConnectedAt` 同时记录 `updateSiteStats` 完成时间

### 10.9 前端展示

- 进入页面时自动调用 `POST /api/sites/update-all` 触发 6h 周期同步（同时启动 3s 轮询 `loadSites` 仅在存在 `updating` 时执行）
- 签到按钮 loading 期间显示"签到中..."，并禁用
- 列表响应 `yesterdayUploaded` / `todayUploaded` 在 Daily 列表中显示

### 10.10 TODO 状态

- [x] 站点数据模型扩展 signin 字段
- [x] `site_signin_logs` 表
- [x] 12 个内置站点 + NexusPHP 兜底签到实现与派发
- [x] 手动 / 批量 / 自动签到接口
- [x] 调度器 `site-auto-signin` job
- [x] 列表与表单签到字段 + 过滤器
- [x] 站点更新 / 流量同步 6h 自动 + 立即入口
- [ ] `proxyUsage` 列表过滤项（当前通过 `proxyId` 间接查询；未提供独立 filter）
- [ ] M-Team 自动签到端点（依赖站点 API）
