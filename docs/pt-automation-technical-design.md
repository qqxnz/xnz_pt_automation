# PT 自动化系统技术方案

> 本文档以代码 `v0.5.0`（数据库 schema `v20`）为基准，对原方案文档进行全量重写。所有描述均与 `backend/src/`、`frontend/src/` 实际实现保持一致。

## 1. 目标

实现一个部署在 NAS 上的 PT 自动化系统，用于按用户任务规则定时抓取 PT 站点种子，自动推送到下载器，定时检查免费时间是否过期、检测低上传速度并按配置自动删除下载器任务。同时统计各 PT 站点上传量、下载量、分享率等数据。

支持能力：

- 单容器 Docker 部署
- 单用户登录与密码管理
- 多 PT 站点（m-team / NexusPHP / TTG 等适配器）
- 多下载器（首版只支持 qBittorrent，架构上可扩展）
- 任务自动执行 + 手动测试 + 手动运行
- 站点连通性检测、连通失败原因记录
- 站点自动签到（按站点 `signinEnabled` + `signinTime` 调度）
- 站点流量定时同步
- 种子抓取、过滤、推送、批量推送、单条/批量删除
- 推送后下载器状态、流量、IPv6 Peer 同步
- 过期免费种子 + 低速种子自动删除
- 每日上传/下载增量与按站点分布统计
- 任务日志、调度日志、操作日志、签到日志、种子日志

非目标：多用户、插件市场、RSS 订阅、复杂规则引擎、Transmission / Deluge 下载器。

## 2. 技术选型

### 后端

- Node.js 22（容器基础镜像 `node:22-alpine`）
- Express 4
- TypeScript 5.7（ESM、`tsx` 开发态）
- **不使用 Prisma**；直接用 `node:sqlite` 的 `DatabaseSync` 维护表结构与迁移
- SQLite，启用 `journal_mode = WAL` 与 `foreign_keys = ON`
- 内置 1 秒轮询的 `setInterval` 调度器（无 `node-cron`）
- `fetch` + `AbortController`（不依赖 axios / undici）
- `cheerio` 不在生产代码使用；解析用原生 `RegExp` + `split` + 手写 HTML 工具
- `pino` 不使用；使用自写 `logger.ts` 写控制台 + 落库
- 密码哈希使用 Node `crypto.scrypt`（无 bcrypt / argon2）
- 进程管理：容器内 `pm2-runtime` + `ecosystem.config.cjs`

### 前端

- Vue 3.5（Composition API）
- Vite 6
- TypeScript 5.7
- Varlet UI 3.6（`@varlet/ui`）
- Pinia 2.3
- Vue Router 4.5
- 自写 SVG 折线 / 柱状 / 饼图（**未使用 ECharts**）

### 部署

- Docker 单容器 + 多阶段构建
- 容器内由 `pm2-runtime` 启动 `backend/dist/server.js`
- Express 同时提供 API 与前端静态文件（`frontend/dist`）
- SQLite 数据库与缓存挂载到 `/data`

## 3. 总体架构

```text
Browser
  |
  | HTTP (Cookie + Authorization: Bearer)
  v
Express Application  (app.ts)
  |
  |-- /api/*               REST API
  |     |-- auth / sites / downloaders / tasks / torrents
  |     |-- proxies / settings / stats / site-statistics / logs
  |     |-- /api/health
  |
  |-- /                   前端 SPA 静态文件
  |
  |-- 1s 轮询 Scheduler   (utils/scheduler.ts)
  |     |-- task-auto-run-scan
  |     |-- task-stuck-check
  |     |-- torrent-download-stats-sync
  |     |-- torrent-ipv6-peer-sync
  |     |-- expired-free-download-cleanup
  |     |-- site-traffic-sync
  |     |-- site-auto-signin
  |
  |-- 站点适配器          (routes/sites/adapters.ts)
  |     |-- m-team (API Key)
  |     |-- totheglory (Cookie, /browse.php?c=M)
  |     |-- baseNexusPhp 兜底
  |
  |-- 签到处理器          (routes/signin/*)
  |     |-- 各站点专用 handler
  |     |-- baseNexusPhp 兜底
  |
  |-- 下载器抽象          (utils/qbittorrent.ts)
  |     |-- qBittorrent Client
  |
  |-- 免费/低速守卫       (utils/freeDownloadGuard.ts)
  |
  |-- Peer / 流量同步     (utils/peerSync.ts + utils/torrentSync.ts)
  |
  |-- SQLite Database     (storage.ts, schema v20)
```

核心业务链路：

```text
站点模块新增站点 → 下载器模块新增 QB 下载器
  → 任务模块选择站点、下载器、间隔、抓取与删除规则
  → 任务打开自动执行 → 按 intervalMinutes 自动触发 runTaskById('AUTO')
  → 抓取 → 过滤 → 入库 → 推送（若 autoPush） → 记录任务/调度/操作/种子日志
  → torrent-download-stats-sync 每 3s 同步下载器状态
  → torrent-ipv6-peer-sync 每 30s 同步 IPv6 peer
  → expired-free-download-cleanup 每 60s 检查免费/低速并删除
  → site-traffic-sync 每 6h 同步站点流量
  → site-auto-signin 每 60s 检查站点签到时间
```

访问路径：

```text
/                 前端 SPA
/api/*            后端接口
```

部署端口：`process.env.PORT ?? 3180`。

## 4. 推荐目录结构

> 实际工程结构（已与本节描述一致）

```text
xnz_pt_automation
├── backend
│   ├── src
│   │   ├── app.ts                  # Express 装配 + 路由挂载 + 前端静态托管
│   │   ├── server.ts               # 启动 HTTP + Scheduler + 重置残留任务
│   │   ├── storage.ts              # SQLite 表结构、迁移、所有 CRUD
│   │   ├── middleware/
│   │   │   └── auth.ts             # requireAuth
│   │   ├── routes/
│   │   │   ├── auth.ts             # 登录/登出/me/改密
│   │   │   ├── downloaders.ts      # 下载器 CRUD + 测试 + 状态/任务列表
│   │   │   ├── logs.ts             # 五类日志查询/导出/清空
│   │   │   ├── proxies.ts          # 代理列表（只读）
│   │   │   ├── settings.ts         # 系统设置 CRUD + system-info
│   │   │   ├── siteStatistics.ts   # 站点流量按日聚合
│   │   │   ├── sites/
│   │   │   │   ├── index.ts        # 站点 CRUD + 连通性 + 流量同步 + 签到入口
│   │   │   │   ├── adapters.ts     # SITE_ADAPTERS、SITE_METADATA
│   │   │   │   ├── base.ts
│   │   │   │   ├── util.ts         # 抓取/HTML 解析工具
│   │   │   │   ├── nexusphp.ts     # NexusPHP 抓取与流量解析
│   │   │   │   ├── mteam.ts        # m-team API 抓取与流量
│   │   │   │   ├── totheglory.ts   # TTG /browse.php?c=M 抓取
│   │   │   │   └── types.ts
│   │   │   ├── signin/             # 签到处理器分发与各站点实现
│   │   │   ├── stats.ts            # Dashboard overview
│   │   │   ├── tasks.ts            # 任务 CRUD + run/test/auto-run/stuck reset
│   │   │   └── torrents.ts         # 种子列表 + push/batch/delete/reset
│   │   └── utils/
│   │       ├── freeDownloadGuard.ts
│   │       ├── logger.ts
│   │       ├── password.ts
│   │       ├── peerSync.ts
│   │       ├── qbittorrent.ts
│   │       ├── scheduler.ts
│   │       ├── session.ts
│   │       └── torrentSync.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend
│   ├── src
│   │   ├── api/                    # 每个模块一个 api 文件
│   │   ├── pages/                  # 10 个页面 + ModulePage 占位
│   │   ├── components/             # AppLayout、AppSelect、Statistics*Chart
│   │   ├── composables/useMediaQuery.ts
│   │   ├── stores/auth.ts          # Pinia auth store
│   │   ├── router/index.ts
│   │   ├── api/client.ts           # apiRequest 统一拦截 401
│   │   ├── main.ts
│   │   ├── App.vue
│   │   └── styles.css
│   ├── package.json
│   ├── vite.config.ts
│   └── index.html
├── docs                            # 总体技术方案 + 各模块方案
├── designs                         # SVG 设计稿 + design-spec.md
├── scripts
│   └── test-all-sites.ts           # 站点连通性调试脚本
├── data                            # SQLite + cache + logs
├── Dockerfile
├── docker-compose.yml
├── ecosystem.config.cjs
├── build-and-push.sh
├── package.json                    # npm workspaces
└── README.md
```

## 5. 系统设置

`SystemSettings`（`storage.ts:265-271`）由后端持久化到 `system_settings` 表，前端只读 + 改写白名单字段。默认值与校验规则如下（`routes/settings.ts:36-77`）：

| 字段 | 默认值 | 校验 | 说明 |
| --- | --- | --- | --- |
| `sessionTtlHours` | `168`（7 天） | 整数 `1–720` | 登录 Cookie / Bearer 过期时间 |
| `requestTimeoutMs` | `15000` | 整数 `3000–120000` | 站点抓取 / 下载器 HTTP 超时基线 |
| `proxyTestUrl` | `https://www.gstatic.com/generate_204` | 必须可解析为 http(s) URL | 代理测试目标；`GET /api/settings` 响应会**隐藏**该字段 |
| `maxConcurrentTasks` | `2` | 整数 `1–10` | 当前版本仅记录；并发执行未按此字段限流（由 1s 轮询 + `runningTaskIds` Set + `running` 标志保证单实例单任务） |
| `defaultUserAgent` | Chrome 120 UA | trim 后 `20–300` 字符 | 站点 UA 缺省值 |

`PUT /api/settings` 接收的载荷必须为已知字段白名单，否则 `400`。保存成功后会写入 `SETTINGS_UPDATE` 操作日志，列出变化的字段名。

`GET /api/settings/system-info` 返回：

```ts
{
  version: string,             // 来自 backend/package.json
  env: 'development' | 'production',
  nodeVersion: string,
  startedAt: string,
  timezone: string,             // IANA tz
  database: {
    type: 'sqlite',
    path: string,
    sizeBytes: number,
    schemaVersion: number,
    lastMigrationAt: string | null,
    lastMigrationStatus: 'SUCCESS' | 'FAILED' | null,
    lastMigrationError: string | null
  },
  paths: { dataDir, logDir, cacheDir },
  security: { defaultPasswordInUse: boolean }   // scrypt 校验 admin 是否仍为 123456
}
```

## 6. 认证与账户

系统采用单用户模式。`users` 表为单行记录 `id='admin'`。

- 默认用户名 `admin`，默认密码 `123456`（来自 `process.env.DEFAULT_ADMIN_PASSWORD ?? '123456'`，仅在首次初始化、且 `users` 表为空时写入，并使用 scrypt 哈希）
- 登录后可以修改密码；新密码必须满足 `^(?=.*[A-Za-z])(?=.*\d).{8,64}$` 且不能与旧密码相同
- 登录态为**自签 token**，由 `utils/session.ts` 生成：
  - 载荷 `{ userId, nonce, expiresAt }` JSON → `base64url` + `.` + HMAC-SHA256（密钥 `process.env.SESSION_SECRET ?? 'dev-session-secret-change-me'`）
  - Cookie 名 `pt_session`，`httpOnly` + `sameSite=lax` + `path=/` + `maxAge = sessionTtlHours * 3600s`
  - 允许 `Authorization: Bearer <token>` 作为备选（前端 localStorage `pt_session_token` 持久化并随请求发送）
  - `req.secure` 或 `x-forwarded-proto=https` 时 Cookie `secure=true`（受 `process.env.SESSION_COOKIE_SECURE` 控制：`'auto'|'true'|'false'`）
- 所有 `/api/*` 接口（除 `POST /api/auth/login` 与 `GET /api/health`）需通过 `requireAuth` 中间件
- 401 由前端 `apiRequest` 拦截后清状态并跳 `/login?redirect=...`

接口：

```text
POST /api/auth/login            # { username, password } -> { user, sessionToken }
POST /api/auth/logout
GET  /api/auth/me
PUT  /api/auth/password         # { oldPassword, newPassword } -> { success, otherSessionsRevoked, user }
```

## 7. 站点

### 7.1 数据模型

`SiteRecord`（`storage.ts:225-251`）：

```ts
type SiteRecord = {
  id: string
  name: string                   // 显示名（迁移时按域名映射；未知域名=domain）
  domain: string                 // 用户原始输入的 host（小写匹配；保留 www. 与子域）
  enabled: boolean
  apiKey?: string                // 明文存储（接口不返回明文）
  cookie?: string
  userAgent?: string
  proxyId?: string               // 可选；引自 proxies.id
  connectivityStatus: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  currentCredential?: 'API_KEY' | 'COOKIE'
  userLevel?: string
  ratio?: number
  ratioInfinite?: boolean
  uploaded?: number
  downloaded?: number
  trafficSyncedAt?: string
  lastConnectedAt?: string
  lastConnectError?: string
  signinEnabled: boolean
  signinTime: string             // HH:mm，默认 '09:00'
  lastSigninAt?: string
  lastSigninStatus?: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  lastSigninMessage?: string
  createdAt: string
  updatedAt: string
}
```

### 7.2 字段与表单规则

- `domain`：用户输入 host；保存时**不**强转小写、不剥离 `www.`（保留与 `c_secure_*` Cookie 兼容），但**只有 lower(domain) 命中 `SITE_METADATA` 时**才参与显示名匹配
- `apiKey` / `cookie`：二者**至少一项**必填；保存时接口不返回明文
- `userAgent`：留空时使用 `system_settings.defaultUserAgent` 兜底（站点抓取时按 `site.userAgent || defaultUserAgent` 生效）
- `proxyId`：可选；引用 `proxies.id`，禁用或被删除后任务运行会失败并写明原因
- `signinEnabled` + `signinTime`：开启签到时 `signinTime` 必须匹配 `^([01]\d|2[0-3]):[0-5]\d$`
- `enabled` 默认 `true`

### 7.3 适配器与抓取

`routes/sites/adapters.ts` 维护 `SITE_ADAPTERS = [mteamAdapter, tothegloryAdapter]` 与 `SITE_METADATA`。`pickAdapter(site)` 按 `match(site)` 顺序匹配；未命中走 `baseAdapter`（仅返回默认值，browse/traffic 走 NexusPHP 通用逻辑）。

支持的站点清单（`SITE_METADATA`，按 lower(domain) 匹配）：

| 域名 lower | 显示名 | torrentPath | 适配器 | 签到 |
| --- | --- | --- | --- | --- |
| `m-team.cc` / `pt.m-team.cc` / `api.m-team.cc` | 馒头 | mteamAdapter | mteamAdapter | SKIPPED（暂未提供） |
| `totheglory.im` / `www.totheglory.im` | 听听歌 | `/browse.php?c=M` | tothegloryAdapter | baseNexusPhp |
| `hhanclub.net` / `www.hhanclub.net` | 憨憨 | `/torrents.php` | base + NexusPHP | baseNexusPhp |
| `hdhome.org` / `www.hdhome.org` | 家园 | 同上 | 同上 | baseNexusPhp |
| `hdkyl.in` / `www.hdkyl.in` | 麒麟 | 同上 | 同上 | baseNexusPhp |
| `pt.keepfrds.com` / `keepfrds.com` | 朋友 | 同上 | 同上 | baseNexusPhp |
| `ptchdbits.co` / `www.ptchdbits.co` | 彩虹岛 | 同上 | 同上 | baseNexusPhp |
| `pterclub.net` / `pterclub.com` / `www.pterclub.com` | 猫站 | 同上 | 同上 | pterclub（JSON 接口，详情里取"X 克猫粮"） |
| `ourbits.club` / `www.ourbits.club` | 我堡 | 同上 | 同上 | baseNexusPhp |
| `pthome.net` / `www.pthome.net` | 铂金家 | 同上 | 同上 | baseNexusPhp |
| `ubits.club` / `www.ubits.club` | 优堡 | 同上 | 同上 | baseNexusPhp |
| `pttime.org` / `www.pttime.org` | 时间 | 同上 | 同上 | baseNexusPhp |

未命中元数据的域名按 `NexusPHP` 通用逻辑处理（兜底）。

### 7.4 访问凭证策略

`browseTorrents(site, keyword, page, pageSize)`（`routes/sites/index.ts:108`）的优先级：

1. 命中 mteamAdapter → 走 m-team API
2. 命中 tothegloryAdapter → 走 TTG 抓取
3. 否则：
   - 优先用 `apiKey`（当 `adapter.browseTorrents` 存在且无 cookie 时优先 apiKey）
   - 否则用 `cookie`
   - 都没有 → 抛错

`testSite(site)`（`routes/sites/index.ts:149`）依次尝试 `API_KEY` → `COOKIE`，失败时抛出包含 `finalUrl` / `httpStatus` / `bodyExcerpt` 的诊断信息。

### 7.5 流量同步与状态

- 调度 `site-traffic-sync` 每 6 小时（21600000ms）调用 `syncSiteTrafficStats({ staleOnly: true })`（`utils/scheduler.ts:30-43`）
- `isStaleForAutoUpdate`：当前时间 - `site.trafficSyncedAt`（或 `updatedAt` 当 `connectivityStatus !== 'UNKNOWN'`）≥ 6h 即视为过期
- 批量更新采用工作池，**最大并发 5**（`SITE_UPDATE_BATCH_CONCURRENCY`）
- 单站更新总超时 `SITE_UPDATE_OVERALL_TIMEOUT_MS = 90s`；每个站保存 `siteUpdatePromises` 实现单飞
- 60s watchdog：`siteUpdateWatchdogTick` 强制清理超过 `SITE_UPDATE_WATCHDOG_MAX_AGE_MS=5min` 的卡死条目

### 7.6 站点接口

```text
GET    /api/sites                          # ?keyword, connectivityStatus, enabled, signinEnabled, page, pageSize
GET    /api/sites/:id
POST   /api/sites
PUT    /api/sites/:id
DELETE /api/sites/:id
POST   /api/sites/:id/test-connectivity    # 立即测试一次
POST   /api/sites/:id/update               # 202：单站入队更新
POST   /api/sites/update-all               # 202：批量入队（staleOnly=true）
POST   /api/sites/sync-traffic             # 同步执行批量更新，返回完整结果
POST   /api/sites/:id/signin               # 手动签到
POST   /api/sites/signin-all               # 顺序签到所有 enabled+signinEnabled
POST   /api/sites/:id/browse-torrents      # { keyword, page, pageSize } -> 浏览
```

## 8. 代理

`ProxyRecord`：

```ts
type ProxyRecord = {
  id: string
  name: string
  enabled: boolean
  type: 'HTTP' | 'HTTPS' | 'SOCKS5'
  host: string
  port: number
  username?: string
  password?: string              // 接口不返回明文
  lastTestStatus?: 'UNKNOWN' | 'ONLINE' | 'OFFLINE'
  lastTestedAt?: string
}
```

> 当前代码状态下 `routes/proxies.ts` **只暴露 `GET /api/proxies`**（去掉 password 字段的列表）。CRUD、测试、`/api/proxies/options` 等仍按 `proxies-plan.md` 作为后续待实现项（`designs/proxies.svg` 已存在，方案文档已就绪）。

规则：

- 站点 `proxyId` 留空 → 直接访问，不走代理
- 下载器 API **永远直连**，不走代理
- `proxyId` 指向的代理被禁用或不存在 → 任务运行、连通性测试、种子抓取、流量同步**全部失败并写明原因**
- 代理密码按站点 `cookie` 同样方式处理（不打印到日志）

## 9. 下载器

### 9.1 数据模型

```ts
type DownloaderRecord = {
  id: string
  name: string
  type: 'QBITTORRENT'              // 当前版本固定为 QBITTORRENT
  enabled: boolean
  host: string                     // 已 trim 尾斜杠、不含 userinfo
  username?: string
  password?: string
  savePath?: string
  status: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  statusMessage?: string
  lastTestedAt?: string
  lastSyncedAt?: string
  hasIpv6Peers?: boolean
  ipv6TorrentCount?: number
  ipv6SyncedAt?: string
  createdAt: string
  updatedAt: string
}
```

### 9.2 使用的 qBittorrent API

```text
POST   /api/v2/auth/login
GET    /api/v2/app/version        # 测试用
GET    /api/v2/transfer/info      # 测试、状态、overview
GET    /api/v2/torrents/info      # 实时任务列表
POST   /api/v2/torrents/add       # 推送（multipart，torrents 字段为 Blob）
POST   /api/v2/torrents/delete    # hashes + deleteFiles
GET    /api/v2/sync/torrentPeers  # rid 增量 + 全部；用于 IPv6 peer 统计
```

### 9.3 推送 / 删除 / 同步

- 推送：`addTorrentUrlToQb(downloader, site, url, filename, options)` → `fetchTorrentFile` → 校验首字节 `0x64`（BitTorrent v1 标识）→ 登录 → 提交 multipart → 等待 1s → 拉取列表 → 通过 hash 或 name 定位新任务；若 `state` 以 `paused` 开头则抛错
- 删除：`deleteTorrentFromQb(downloader, hash, deleteFiles=true)` → 验证 hash 存在 → POST 删除 → 1s 后再次拉取；若 hash 仍在列表中抛 `下载器删除任务未生效`
- 同步：`syncTorrentDownloadStats(downloaderId?)`（`utils/torrentSync.ts:70`）每 3 秒触发，对 `pushStatus='PUSHED' AND has torrentHash` 的种子回填：
  - `downloadProgress` / `downloadState` / `downloaderState` / `ratio`
  - `uploadSpeed` / `downloadSpeed` / `uploaded` / `downloaded` / `downloaderSavePath`
  - `downloadStatsSyncedAt = now`
  - **低速窗口起点 `lowUploadSince`**：当 `lowUploadKbps>0 && lowUploadMinutes≥1` 且 `uploadSpeed < kbps*1024` 时设置；速度恢复后清空
  - 不在 qB 列表中的标记为 `downloadState=missing` 并清空速度字段

### 9.4 下载器接口

```text
GET    /api/downloaders                # ?keyword, status, enabled
GET    /api/downloaders/:id            # 包含明文密码
POST   /api/downloaders
PUT    /api/downloaders/:id            # passwordAction: KEEP | UPDATE | CLEAR
DELETE /api/downloaders/:id
POST   /api/downloaders/test           # 草稿测试
POST   /api/downloaders/:id/test
GET    /api/downloaders/:id/status     # 实时 transfer info
GET    /api/downloaders/:id/torrents   # 实时 qB torrents 列表
GET    /api/downloaders/:id/task-references   # 引用此下载器的任务名（删除前检查）
```

## 10. 任务

### 10.1 数据模型

```ts
type TaskRecord = {
  id: string
  name: string
  siteId: string
  downloaderId: string
  autoRunEnabled: boolean
  autoRunStartedAt?: string
  nextRunAt?: string                  // 调度器按 nextRunAt 触发
  intervalMinutes: number             // 最小 10 分钟
  onlyFreeDownload: boolean
  deleteOnFreeExpire: boolean
  lowUploadKbps?: number              // 与 lowUploadMinutes 同时存在
  lowUploadMinutes?: number
  autoPush: boolean
  discountTypes: Array<'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'>
  seederMin: number                   // 0 = 不限
  seederMax: number
  sizeMinGb: number                   // 0 = 不限
  sizeMaxGb: number
  torrentCountCondition?: 'GT' | 'EQ' | 'LT'   // 与 torrentCount 配对
  torrentCount?: number
  sortRule?: 'SEEDERS_ASC' | 'SEEDERS_DESC' | 'CREATED_DESC' | 'CREATED_ASC' | 'SIZE_DESC' | 'SIZE_ASC'
  fetchLimit: number                  // 1..1000，默认 100
  savePathOverride?: string
  categoryOverride?: string           // 实际作为 qB category
  tagsOverride?: string[]
  running: boolean                    // DB 锁标志
  lastRunMode?: 'AUTO' | 'MANUAL_RUN'
  lastStartedAt?: string
  lastFinishedAt?: string
  lastStatus?: 'SUCCESS' | 'FAILED'
  lastSummary?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}
```

> 数据库保留 `expiring_soon_minutes` / `seeder_condition` / `seeder_count` / `free_only` 等旧列以兼容历史 schema，运行时**不再使用**。

### 10.2 默认与校验

- `name`：必填，≤60 字符，不区分大小写全局唯一
- `intervalMinutes`：整数 ≥ 10，默认 30
- `discountTypes`：至少 1 项；默认 `['FREE', 'TWO_X_FREE']`
- `seederMin` / `seederMax` / `sizeMinGb` / `sizeMaxGb`：整数 ≥ 0；同时 > 0 时要求 min ≤ max
- `torrentCountCondition` ∈ `GT|EQ|LT|''`；设置时 `torrentCount` 为整数 ≥ 1
- `fetchLimit`：整数 1..1000，默认 100
- `lowUploadKbps` 与 `lowUploadMinutes` 必须**同时设置或同时为空**；各自整数 ≥ 1
- `autoRunEnabled = true` 时：保存成功后 `nextRunAt = now + intervalMinutes`；关闭后清空 `nextRunAt`
- 默认值：新建时 `onlyFreeDownload=true`、`autoPush=true`、`intervalMinutes=30`

### 10.3 任务执行流程（`runTaskById`）

```text
内存 runningTaskIds Set + DB running=1 双重锁
  -> 读取 task、site、downloader
  -> 校验 site/downloader 已启用
  -> 标记 running=true, lastStartedAt=now, lastRunMode='AUTO'|'MANUAL_RUN'
  -> AUTO 时写 RUNNING 调度日志
  -> browseTorrents(site, '', 1, fetchLimit)  // fetchedCount
  -> sortRule 排序
  -> 与已有种子按 siteId:torrentId 去重        // skippedExistingCount
  -> matched = 过滤 discountTypes / sizeMinGb / sizeMaxGb / seederMin / seederMax
  -> 若 torrentCountCondition 设置：slice(0, torrentCount)  // matchedCount / pushableCount
  -> 逐条：
        autoPush=false  -> 记录"未推送"，不入库（仅占位）—— 实际当前实现会创建记录但 pushStatus=NEW
        autoPush=true   -> addTorrentUrlToQb 成功 -> PUSHED；失败 -> PUSH_FAILED
        写 INSERTED + (PUSHED|PUSH_FAILED) 两条种子日志
  -> 批量 updateTaskFieldsInDb
  -> 成功：running=false, lastStatus=SUCCESS, lastSummary, nextRunAt = autoRunEnabled ? now+interval : undefined
         写 SUCCESS 任务日志 + AUTO 调度日志
  -> 失败：lastStatus=FAILED, lastError=fetchErrorMessage|pushErrorMessages|message
         写 FAILED 任务日志 + AUTO 调度日志
  -> finally：清除 runningTaskIds
```

注意：

- `test` 接口（`POST /api/tasks/:id/test`）**不写种子记录、不推送、不写任务日志**，只返回 `{ fetchedCount, skippedExistingCount, matchedCount, pushableCount, items }`，并写操作日志
- 同一任务在内存 / DB 都加锁；`resetStuckRunningTasks` 在启动与每分钟 watchdog 中处理 `running=true` 且 `now - lastStartedAt ≥ 10min` 的残留任务
- `run` 接口（`POST /api/tasks/:id/run`）→ 409 if running；404 if missing；400 on error

### 10.4 任务接口

```text
GET    /api/tasks                       # ?keyword, autoRun
GET    /api/tasks/:id
POST   /api/tasks
PUT    /api/tasks/:id
DELETE /api/tasks/:id
POST   /api/tasks/:id/auto-run          # { autoRunEnabled } -> 切换
POST   /api/tasks/:id/test              # 不入库
POST   /api/tasks/:id/run               # 立即真实执行
GET    /api/tasks/:id/logs              # ?page, pageSize
```

## 11. 种子抓取、过滤与入库

### 11.1 流程

```text
任务触发（AUTO/MANUAL_RUN）
  -> 根据 site.userAgent || defaultUserAgent 创建 fetch
  -> 凭证策略：API_KEY -> COOKIE
  -> 请求站点列表 / 适配器
  -> 解析：title / size / discountType / freeEndAt / seeders / leechers / downloadUrl
  -> 任务过滤：discountTypes / sizeMinGb / sizeMaxGb / seederMin / seederMax / sortRule
  -> torrentCountCondition 截断
  -> siteId:torrentId 去重
  -> 写 torrents 表 + torrent_logs
  -> autoPush 时调用 addTorrentUrlToQb
```

### 11.2 数据模型（`TorrentRecord`）

```ts
type TorrentRecord = {
  id: string
  siteId: string
  siteName: string                      // 快照
  torrentId?: string
  title: string
  size: number
  discountType: 'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'
  isFreeNow: boolean                    // 实时计算
  currentState: 'NEW' | 'FREE_NOW' | 'EXPIRING_SOON' | 'EXPIRED' | 'PUSHED' | 'PUSH_FAILED' | 'DOWNLOADER_DELETED'
  freeEndAt?: string
  seeders?: number
  leechers?: number
  pushStatus: 'NEW' | 'PUSHED' | 'PUSH_FAILED' | 'DELETED'
  linkStatus: 'SAVED' | 'MISSING' | 'INVALID'
  onlyFreeDownload: boolean             // 从任务复制
  deleteOnFreeExpire: boolean
  lowUploadKbps?: number
  lowUploadMinutes?: number
  lowUploadSince?: string               // 由 torrentSync 维护
  detailUrl?: string
  downloaderId?: string
  downloaderName?: string               // 快照
  downloaderType?: 'QBITTORRENT'
  downloaderState?: string
  torrentHash?: string
  downloadProgress?: number
  downloadState?: string
  ratio?: number
  uploadSpeed?: number
  downloadSpeed?: number
  uploaded?: number
  downloaded?: number
  taskSavePath?: string
  downloaderSavePath?: string
  downloadStatsSyncedAt?: string
  sourceTaskId?: string
  sourceTaskName?: string               // 快照
  sourceRunMode: 'AUTO' | 'MANUAL_RUN'
  errorMessage?: string
  firstSeenAt: string
  lastSeenAt: string
  pushedAt?: string
  downloadUrlHash?: string              // sha1(siteId + ':' + torrentId)
  downloadUrl?: string                  // 列表接口不返回；只通过详情接口或 PATCH 上送
  hasIpv6Peers?: boolean
  ipv6PeerCount?: number
  totalPeerCount?: number
  peerSyncRid?: number
  peerSyncedAt?: string
}
```

### 11.3 免费状态实时计算

`refreshStoredTorrentFreeStates()`（被 `GET /api/torrents` 与 `GET /api/stats/overview` 调用）：

- `isFreeNow` = `discountType !== 'NORMAL' && (!freeEndAt || freeEndAt > now)`
- `currentState`：
  - `PUSH_FAILED` / `PUSHED` / `DOWNLOADER_DELETED` 不变
  - 否则：
    - `discountType === 'NORMAL'` → `NEW`
    - 否则若 `freeEndAt <= now` → `EXPIRED`
    - 否则若 `freeEndAt - now <= EXPIRING_SOON_THRESHOLD` → `EXPIRING_SOON`
    - 否则 → `FREE_NOW`

### 11.4 种子接口

```text
GET    /api/torrents              # ?keyword, siteId, downloaderId, taskId, pushStatus, sourceRunMode, page, pageSize
GET    /api/torrents/:id
PATCH  /api/torrents/:id          # 修改 onlyFreeDownload / deleteOnFreeExpire / lowUpload* / downloaderId / taskSavePath
POST   /api/torrents/:id/push
POST   /api/torrents/batch-push
POST   /api/torrents/batch-delete            # 删记录
POST   /api/torrents/batch-delete-from-downloader
POST   /api/torrents/batch-reset-task        # 仅 PUSHED；不联系下载器
POST   /api/torrents/:id/delete-from-downloader
```

注意：

- 列表 / 详情接口都通过 `safeTorrent()` 剔除 `downloadUrl`；若 `pushStatus='PUSHED'` 但 `downloadUrl` 缺失则降级为 `PUSH_FAILED`，`errorMessage='缺少真实下载链接，无法确认已推送到下载器'`
- `PATCH` 时若种子已 PUSHED 且有 hash，**禁止**修改 `downloaderId` / `taskSavePath`
- 推送成功后会触发 `syncTorrentDownloadStats(downloaderId)` 同步状态

## 12. 免费 / 低速守卫

`utils/freeDownloadGuard.ts` 由 `expired-free-download-cleanup`（每 60s）调用。

候选：`pushStatus='PUSHED' && torrentHash && (onlyFreeDownload || deleteOnFreeExpire || (lowUploadKbps>0 && lowUploadMinutes≥1))`。

`evaluateReason(torrent, now)` 顺序判定：

1. **Rule ① 仅免费下载 + 免费过期 + 未下载完成** → `仅免费下载：已过免费期且未下载完成`（`isDownloadIncomplete = progress===undefined || progress<1`）
2. **Rule ② 免费到期**（无视下载进度）→ `免费已到期`
3. **Rule ③ 低速持续**：`now - lowUploadSince ≥ lowUploadMinutes * 60s` → `上传速度低于 X KB/秒 持续 Y 分钟`

下载器调用 `deleteTorrentFromQb(downloader, hash, true)`，成功后：

- `pushStatus='DELETED'`，`currentState='DOWNLOADER_DELETED'`，`downloaderState='deleted'`
- `errorMessage=reason`，`lowUploadSince=undefined`
- 写 `AUTO_DELETE_TASK` / `SUCCESS` 种子日志（`source='SCHEDULER'`）

失败时 `errorMessage="${reason}，删除失败：${msg}"`，写 FAILED 种子日志。

## 13. 流量统计

### 13.1 站点流量

- `site_traffic_snapshots` 表每次 `updateSiteStats` 成功后写一条；`uploadedDelta` / `downloadedDelta` 由相邻两次 snapshot 相减得到
- `site_torrent_traffic_daily` 表按 `(date, site_id)` 聚合每个种子在 qB 上的上传/下载增量（`recordTorrentTraffic` 维护）
- `torrent_traffic_cursors` 表记录每个种子上次同步的上传/下载基线，避免重复累加
- `GET /api/site-statistics?startDate&endDate&siteId&page&pageSize` 返回按站点聚合的 `daily[] = [{ date, uploaded, downloaded }]`
- `GET /api/stats/overview` 提供 Dashboard 所需的：
  - 站点计数（total / online / offline / auth-failed / unknown / signinEnabled / todaySigninSuccess / todaySigninPending）
  - 下载器列表（status / speed）
  - 任务统计（total / autoRunEnabled / running / failed）+ 最近 5 条 task_logs
  - 今日总上传 / 总下载（来自 `site_torrent_traffic_daily`）
  - 风险横幅：`DEFAULT_PASSWORD` / `DOWNLOADER_NOT_CONFIGURED` / `AUTH_FAILED` / `ALL_OFFLINE`

### 13.2 流量相关迁移

- `v6` 新增 `site_torrent_traffic_daily` / `torrent_traffic_cursors` 表，并执行 `seedTorrentTrafficStatistics` 把迁移当天的已有 torrent 上传/下载基线落库
- `v9` 自我修复：补齐 `sites` 表的 `signin_*` 列（某些老库 v8 没建）
- `v10` 站点显示名映射 + 自动按域名填 `name`

## 14. 签到

### 14.1 调度与触发

- 调度器 `site-auto-signin` 每 60s 调用 `runDueSignins`（`utils/scheduler.ts:229`）
- 规则：`enabled && signinEnabled` 的站点 + 当前时间（`HH:mm`）≥ `signinTime` + `lastSigninAt` 不在今天 → 调 `performSiteSignin(site, { runMode:'AUTO', triggerSource:'scheduler' })`
- 顺序执行，无并发；每个站点通过 `signinLocks` Map 单飞
- 手动入口：`POST /api/sites/:id/signin` 与 `POST /api/sites/signin-all`

### 14.2 处理器

`signin/index.ts:20` 的 `HANDLERS` 数组按特异性优先 + `baseNexusPhpSignin` 兜底：

- `mteamSignin` → SKIPPED（m-team 未提供自动签到端点）
- `pterclubSignin` → `/attendance-ajax.php` JSON 响应，按 `status=1` / `status=0` 判定成功/已签到，提取"X 克猫粮"作为详情
- 其他 10 个站点 → `makeStandardNexusPhpSignin({ matchDomains: [...] })`：默认 POST `/attendance.php` body `action=post&content=`，按 HTML 关键字 + 跳转 `login.php` 判定

`SigninResult`：

```ts
{
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED',
  message: string,         // 详情，例如 "我堡 签到成功 5 魔力"
  errorMessage?: string,
  durationMs?: number
}
```

### 14.3 日志

- `site_signin_logs` 表记录所有签到（`{siteId, siteName, runMode, triggerSource, status, message, errorMessage, startedAt, finishedAt, durationMs, createdAt}`）
- 站点表同步更新 `lastSigninAt` / `lastSigninStatus` / `lastSigninMessage`
- 手动签到 + 批量签到 + 调度签到都进入 `site_signin_logs`；同时手动签到会写操作日志

## 15. 调度器

`utils/scheduler.ts` 启动一个 `setInterval(tick, 1000)`，每个 job 独立 nextRunAt 计时：

| Job 名 | intervalMs | 行为 |
| --- | --- | --- |
| `task-auto-run-scan` | 1000 | 扫表 `autoRunEnabled && nextRunAt && !running`，触发 `runTaskById(id, 'AUTO')` |
| `task-stuck-check` | 60000 | `resetStuckRunningTasks({ thresholdMs: 10*60*1000 })` |
| `torrent-download-stats-sync` | 3000 | `syncTorrentDownloadStats()`，维护 `lowUploadSince` |
| `torrent-ipv6-peer-sync` | 30000 | `syncTorrentIpv6Peers()`，统计每个种子的 IPv4/IPv6 peer |
| `expired-free-download-cleanup` | 60000 | `cleanupExpiredFreeDownloads()` |
| `site-traffic-sync` | 21600000 | `syncSiteTrafficStats({ staleOnly: true })` |
| `site-auto-signin` | 60000 | `runDueSignins()` |

每个 job 在执行前后会写一条 `schedule_logs`（默认 SUCCESS / FAILED，可通过 `shouldLogSuccess` 关闭成功日志）。

## 16. 日志体系

5 类日志，全部进入 `operation_logs` / `task_logs` / `schedule_logs` / `site_signin_logs` / `torrent_logs` 表。

```text
GET    /api/logs                # ?type=operation|task|schedule|signin|torrent, page, pageSize, keyword, status, taskId, runMode
GET    /api/logs/export         # 返回 CSV (BOM \uFEFF)
DELETE /api/logs                # 按 type 清空
```

写入位置与触发点：

- `operation_logs`（`action`, `message`, `actorId`, `actorName`, `ip`, `userAgent`, `status`）：
  - 登录成功 / 失败 / 登出 / 改密
  - 任务创建 / 编辑 / 开启自动 / 关闭自动 / 测试 / 运行 / 删除
  - 站点创建 / 编辑 / 删除 / 手动签到 / 批量签到
  - 下载器创建 / 编辑 / 删除 / 测试
  - 种子推送 / 批量推送 / 删除 / 批量删除 / 批量重置
  - 设置修改 `SETTINGS_UPDATE`
  - 数据库迁移 `STORAGE_MIGRATION` / 自我修复 `STORAGE_SCHEMA_REPAIR`
- `task_logs`（`taskId`, `taskName`, `runMode='AUTO'|'MANUAL_RUN'`, `message`, `status='SUCCESS'|'FAILED'|'RUNNING'`, `startedAt`, `finishedAt`, `fetchedCount`, `matchedCount`, `skippedExistingCount`, `pushedCount`, `pushFailedCount`, `summary`, `errorMessage`, `fetchErrorMessage`, `pushErrorMessages[]`, `failureDetails[]`）：
  - 仅 AUTO / MANUAL_RUN 的真实执行；**TEST 不进入**
- `schedule_logs`（`jobName`, `message`, `status`, `scheduledAt`, `triggeredAt`, `startedAt`, `finishedAt`, `durationMs`, `summary`, `errorMessage`, `details`）
- `site_signin_logs`：所有签到
- `torrent_logs`（`torrentId`, `siteId`, `siteName`, `torrentTitle`, `event`, `status`, `message`, `reason`, `source='AUTO'|'MANUAL'|'SCHEDULER'|'TASK'`, `actorId`, `actorName`）
  - `event ∈ INSERTED | PUSHED | PUSH_FAILED | AUTO_DELETE_TASK | MANUAL_DELETE_TASK | MANUAL_RESET_TASK | DELETE_RECORD | UPDATE_SETTINGS`

## 17. 前端页面

### 17.1 路由

```text
/                    -> redirect /dashboard
/login               -> LoginPage（guestOnly）
/dashboard           -> DashboardPage
/sites               -> SitesPage
/statistics          -> SiteStatisticsPage
/downloaders         -> DownloadersPage
/tasks               -> TasksPage
/torrents            -> TorrentsPage
/logs                -> LogsPage
/settings            -> SettingsPage
/:pathMatch(.*)*     -> redirect /dashboard
```

未登录访问 `requiresAuth` 路由 → `/login?redirect=<from>`；已登录访问 `/login` → `/dashboard`。

### 17.2 Dashboard

`GET /api/stats/overview` 数据；5 个面板：站点、下载器、种子、流量、任务。风险横幅统一在顶部展示。

### 17.3 登录页

- 用户名（默认 `admin`）、密码（带显示/隐藏）
- 提交后跳 `route.query.redirect` 或 `/dashboard`
- 401 由 `apiRequest` 统一拦截

### 17.4 站点页

- 统计卡：总 / 在线 / 认证失败 / 离线 / 未知
- 工具栏：`keyword` / `connectivityStatus` / `enabled` / `signinEnabled` + URL query 同步
- 表格：站点 / 连通 / 等级 / 分享率 / 上传 / 下载 / 昨日 / 今日 / 当前凭证 / 签到 / 操作
- 行操作：签到 / 更新 / 浏览 / 编辑 / 删除
- 表单：基础（domain, enabled）+ 凭证（apiKey, cookie, userAgent + "恢复当前浏览器"）+ 签到（signinEnabled, signinTime HH:mm）
- 浏览弹窗：keyword + 类别 + 搜索 → 显示 标题 / 剩余免费 / 大小 / 做种 / 下载
- 进入页面时自动触发 `POST /api/sites/update-all`，并 3s 轮询（仅当存在 `updating`）刷新 `signinRunning` / `updating` 状态

### 17.5 下载器页

- 卡片列表：状态、类型、host、savePath、最后同步、上下行速度、可选 IPv6 角标
- 表单：name, type(QBITTORRENT 只读), enabled, host(http(s) URL 无 userinfo), username, password, savePath, testAfterSave
- 三个按钮：取消 / 测试连接（草稿测试 `POST /api/downloaders/test`）/ 保存
- 5s 轮询调用 `GET /api/downloaders/:id/status`，`document.hidden` 时暂停

### 17.6 任务页

- 统计卡：总 / 自动 / 运行中 / 失败
- 行操作：测试 / 运行 / 编辑 / 日志 / 删除 / 自动执行开关
- 表单：
  - 基础：name, intervalMinutes(默认 30, min 10), site, downloader, autoRunEnabled, autoPush, savePathOverride
  - 抓取规则：fetchLimit(1-1000, 默认 100), sortRule, torrentCount(>0 → torrentCountCondition='LT'), discountTypes(≥1), sizeMinGb/sizeMaxGb, seederMin/seederMax
  - 删除规则：onlyFreeDownload, deleteOnFreeExpire, lowUploadKbps+lowUploadMinutes 同时 >0 或同时 0
- 测试结果弹窗：fetchedCount / skippedExistingCount / matchedCount / pushableCount + 每个条目的 `去重/命中/待入库` 标记

### 17.7 种子页

- 工具栏：keyword / site / task / downloader / pushStatus
- 表格：checkbox / title / push+free chip / progress+state / save path / speed / uploaded / downloaded / actions
- 行操作：修改删除条件 / 修改下载器 / 推送 / 详情 / 删除任务
- 批量：批量推送 / 删除记录 / 删除任务 / 重置任务
- 详情弹窗（只读）+ 4 个动作按钮
- 3s 轮询刷新；`document.hidden` 暂停

### 17.8 流量统计页

- 总览卡：总上传 / 总下载 / 总站点数
- 时间区间：起止日期 + 快捷（今天 / 昨天 / 最近 7 天 / 最近 30 天）
- 两张饼图：上传 Top 8 站点 + 下载 Top 8 站点；其余合并为"其他（N）"
- 列表：每站 + 每日明细 + 占比 + 分页（20/页）
- `StatisticsBarChart.vue` 组件已实现但**未使用**（`SiteStatisticsPage` 仅使用 `StatisticsPieChart`）

### 17.9 日志页

- 5 个 Tab：操作 / 任务 / 定时 / 签到 / 种子
- 列表：时间 / 状态 / 主文 / 副文；失败详情可展开
- 导出 CSV（带 BOM）+ 清空 + 刷新
- 通过 `route.query.type` 决定默认 Tab

### 17.10 系统设置页

- 修改密码（8-64 字符，含字母+数字，不等于旧密码）
- 系统信息：版本、runtime、Node、startedAt、时区、数据库（type/path/size/schemaVersion/lastMigration{At,Status,Error}）、路径、是否使用默认密码
- 基础参数：会话（sessionTtlHours 1-720, maxConcurrentTasks 1-10）+ 网络（requestTimeoutMs 3000-120000, defaultUserAgent 20-300 字符）
- 离开 / 关闭未保存弹窗提示
- 通过 `route.query.section` 滚动到对应小节

## 18. 数据库设计

> 实际表结构以 `backend/src/storage/health.ts` 的 `TABLE_SPECS` 为准；schema 版本 `SCHEMA_VERSION` 常量在 `backend/src/storage/migrations/index.ts`（当前为 21）。每个版本的迁移脚本在 `backend/src/storage/migrations/v{N}.ts`，由 `runMigrations` 串行执行。

迁移文件按版本号递增，完整清单见 `backend/src/storage/migrations/index.ts` 的 `MIGRATIONS` 数组。新增/修改字段的流程见 [docs/database-migration.md](./database-migration.md)。

```text
app_meta                       # key/value 元数据（含 schema_version、last_migration_*、last_backup_*）
users                          # 单行 admin
sites                          # 站点
proxies                        # 代理
downloaders                    # 下载器
tasks                          # 任务
torrents                       # 种子
operation_logs
task_logs
schedule_logs
site_signin_logs
torrent_logs
site_traffic_snapshots
site_torrent_traffic_daily
torrent_traffic_cursors
system_settings                # 单行 id=1
```

主要索引：

```text
idx_torrents_first_seen        (first_seen_at DESC, id)
idx_torrents_site              (site_id)
idx_torrents_downloader        (downloader_id)
idx_torrents_task              (source_task_id)
idx_torrents_push_status       (push_status)
idx_torrents_current_state     (current_state)
idx_torrents_run_mode          (source_run_mode)
idx_torrents_download_url_hash (download_url_hash)
idx_torrents_torrent_hash      (torrent_hash)
idx_site_torrent_traffic_daily_site_date (site_id, date)
idx_operation_logs_created     (created_at DESC)
idx_task_logs_created          (created_at DESC)
idx_task_logs_task_created     (task_id, created_at DESC)
idx_schedule_logs_created      (created_at DESC)
idx_site_signin_logs_created   (created_at DESC)
idx_site_signin_logs_site      (site_id, created_at DESC)
idx_torrent_logs_created       (created_at DESC)
idx_torrent_logs_torrent       (torrent_id, created_at DESC)
```

SQLite 启动项：

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

数据保留（当前实现未做硬删除）：

- 任务 / 调度 / 签到 / 种子 / 操作日志长期保留，由用户在【日志】页手动清空
- 站点流量快照可长期保留
- 高频聚合后续可按天落库（已有 `site_torrent_traffic_daily`）

## 19. 启动与初始化

```text
容器启动 (pm2-runtime -> node dist/server.js)
  -> app.listen(port)
       -> resetStuckRunningTasks({ source: 'startup' })
       -> startScheduler()
```

`storage.ts:824` 的 `ensureStorage` 在第一次访问 storage 时执行：

```text
mkdir dataDir + cacheDir
打开 SQLite dbFile
  PRAGMA journal_mode=WAL; foreign_keys=ON
  createStructuredTables  （所有 CREATE TABLE IF NOT EXISTS）
  user_version = schemaVersion = 20 ?
    -> 是：inspectTaskSchemaCompatibility，缺列则 ALTER/DROP 并写 STORAGE_SCHEMA_REPAIR
    -> 否 (>=2)：migrateStructuredDatabase 按版本逐级 ALTER / 建表 / seed
    -> 否 (<2)：
         从 app_state 单行表 或 app-state.json 文件读旧状态
         写 users/sites/proxies/downloaders/tasks/torrents/operation_logs/task_logs/schedule_logs/site_traffic_snapshots/system_settings
         seedTorrentTrafficStatistics（生成 site_torrent_traffic_daily + torrent_traffic_cursors 基线）
         PRAGMA user_version = 20
         写 STORAGE_MIGRATION 成功日志
```

迁移失败处理：

- 整个 `BEGIN IMMEDIATE` 回滚
- `app_meta.last_migration_status = FAILED`
- 启动时 HTTP / Scheduler 仍会运行（与原方案文档的"不启动"不同 — 这是基于实际代码的当前行为）。但站点流量 seed 等可恢复性高的步骤会在下次启动时通过 `inspectTaskSchemaCompatibility` 重新兜底

## 20. Docker 部署

### 20.1 docker-compose.yml

```yaml
services:
  xnz-pt-automation:
    image: qqxnz/xnz-pt-automation:0.5.0
    container_name: xnz-pt-automation
    restart: unless-stopped
    ports:
      - "3180:3180"
    environment:
      PORT: "3180"
      DATA_DIR: /data
      DEFAULT_ADMIN_PASSWORD: "123456"
      TZ: Asia/Shanghai
    volumes:
      - ./data:/data
```

### 20.2 Dockerfile（3 阶段）

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json backend/
COPY frontend/package*.json frontend/
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3180
ENV DATA_DIR=/data
ENV DEFAULT_ADMIN_PASSWORD=123456
ENV TZ=Asia/Shanghai
ENV NODE_OPTIONS=--max-old-space-size=512
RUN apk add --no-cache tzdata && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
RUN addgroup -S node && adduser -S node -G node
RUN npm i -g pm2
COPY ecosystem.config.cjs ./
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/package*.json backend/
COPY --from=build /app/frontend/dist backend/public
RUN npm ci --omit=dev --prefix backend && chown -R node:node /app
USER node
EXPOSE 3180
VOLUME ["/data"]
CMD ["pm2-runtime", "ecosystem.config.cjs"]
```

构建时由 `npm run build` 在 monorepo 根目录先编译 backend（`tsc`）再编译 frontend（`vue-tsc` + `vite build`），然后将 dist 复制到后端镜像。

### 20.3 镜像版本与升级

- 镜像发布到 Docker Hub 与阿里云镜像仓库（`build-and-push.sh` 多架构 `linux/amd64,linux/arm64`）
- 当前稳定版本 `0.5.0`；升级：`docker compose pull && docker compose up -d`

## 21. Express 托管前端

`app.ts:38-45` 仅当 `frontend/dist` 存在时挂载静态资源与 `*` 兜底：

```ts
const frontendDist = path.resolve(backendDir, '..', 'frontend', 'dist')
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}
```

由于 API 路由优先注册，未匹配的 path 全部走前端入口，避免 Vue Router history 模式刷新 404。

## 22. 安全设计

需要保护的敏感数据（接口脱敏 + 日志脱敏）：

- PT Cookie / API Key / 下载器用户名密码 / passkey / torrent 下载链接 / 代理密码 / `SESSION_SECRET`
- 当前版本：站点 Cookie / API Key / 下载器密码 / 代理密码**明文存储**（`storage.ts`），`apiKey` / `cookie` / `password` 在列表/详情接口会被剔除（`passwordAction` 控制更新）
- 日志脱敏：`utils/logger.ts` 的 `sanitizeLogText` 替换 `cookie: ...`、`api_key=...`、`passkey=...`、`authorization: ...`、HTTP 链接为 `[已脱敏]`
- 站点连通性日志只写访问方式（API_KEY / COOKIE）+ 失败原因，不写完整凭证
- 前端敏感字段默认遮罩，带"显示 / 隐藏"切换
- 改密校验旧密码，强制 8-64 字符 + 字母数字
- 默认密码提示：`system-info` 接口 `security.defaultPasswordInUse` 由 scrypt 验证

## 23. 实施范围与状态

### 23.1 当前已实现

- 单容器 Docker + pm2-runtime 部署
- Express + TypeScript 后端；Vue 3 + Vite + Varlet UI 前端
- SQLite + 自写迁移（`schemaVersion=20`）；启动时自动建表、迁移、seed
- 单用户登录、改密；HTTP-only Cookie + Bearer 双轨会话
- 站点 CRUD + API Key 优先 / Cookie 兜底 + 适配器分发（m-team / TTG / NexusPHP 通用）
- 站点连通性 + 诊断（`finalUrl/httpStatus/bodyExcerpt`）
- 站点流量批量同步（6h）+ 立即同步 + 6h 自动 stale 触发
- 代理管理（当前**仅 GET 列表**；CRUD/测试/options 接口为下一阶段）
- 下载器 CRUD + qBittorrent 客户端（登录、列表、添加、删除、状态、IPv6 peer）
- 任务 CRUD + 自动执行 / 手动运行 / 手动测试 / 启动残留重置
- 抓取规则（折扣类型 / 大小 / 做种 / 排序 / 抓取上限 / 数量条件）
- 种子入库 + 推送 + 批量推送 + 单/批删除 + 批量重置
- 推送后 3s 状态同步 + 30s IPv6 peer 同步
- 免费过期 / 仅免费下载 / 低速持续三规则守卫（60s 周期）
- 5 类日志（操作 / 任务 / 调度 / 签到 / 种子）+ 导出 CSV + 清空
- Dashboard overview 风险横幅（默认密码 / 无下载器 / 认证失败 / 全部离线）
- 系统设置（密码 + 基础参数 + 系统信息）+ 离开确认
- 流量统计页（按日聚合 + 饼图 Top 8 + 站点明细分页）
- 站点签到（按 `signinEnabled + signinTime` 调度 + 手动 + 批量；各站点独立 handler + baseNexusPhp 兜底）

### 23.2 当前未实现 / 与方案文档差异

- **代理管理**：`routes/proxies.ts` 当前只实现 `GET /api/proxies` 列表（剔除 password）；`proxies-plan.md` 中的 CRUD、`/test`、`/api/proxies/options`、`REFERENCED_BY_SITES / PROXY_DISABLED` 保护等仍待补充
- **下载器状态/任务列表的实时刷新**：前端 `DownloadersPage` 5s 轮询；后端只读 qB API
- **`expiring_soon_minutes`**：DB 列保留，运行时未使用；前端无 UI
- **`ModulePage.vue` 与 `StatisticsBarChart.vue`**：组件实现完毕但未在路由/页面中引用
- **ECharts**：未引入；图表全部自写 SVG
- **DASHBOARD 当前速度**：来自 `getQbTransferInfo`（仅下载器 HTTP 端点；非 torrent-level 实时累计）

## 24. 模块文档体系

工程按模块推进，每个模块都有独立方案文档（`docs/<module>-plan.md`）+ SVG 设计稿（`designs/<module>.svg`），粒度满足 AI 读取即可直接实现。

模块文档索引：

| 模块 | 文档 | 设计稿 |
| --- | --- | --- |
| 登录 | `docs/login-plan.md` | `designs/login.svg` |
| 首页 | `docs/dashboard-plan.md` | `designs/dashboard.svg` |
| 站点 | `docs/sites-plan.md` | `designs/sites.svg`、`designs/sites-form.svg` |
| 种子 | `docs/torrents-plan.md` | `designs/torrents.svg` |
| 下载器 | `docs/downloaders-plan.md` | `designs/downloaders.svg`、`designs/downloaders-form.svg` |
| 代理管理 | `docs/proxies-plan.md` | `designs/proxies.svg` |
| 数据统计 | `docs/statistics-plan.md` | `designs/statistics.svg` |
| 任务 | `docs/tasks-plan.md` | `designs/tasks.svg` |
| 日志 | `docs/logs-plan.md` | `designs/logs.svg` |
| 系统设置 | `docs/settings-plan.md` | `designs/settings.svg` |

每个模块文档包含：模块目标、业务边界、页面入口 / 跳转、布局 / 响应式、功能列表 / 表单 / 列表字段、接口路径 / 请求 / 响应 / 错误、loading / 空 / 异常状态、后端处理 / 数据持久化 / 安全、逐项可执行开发清单、TODO、验收标准。

模块开发状态以 `README.md` 当前进度表为准。

模块开发前限制规则：

- 每个功能模块开发前必须先检查 `README.md` 当前进度表
- 只有该模块【设计稿】与【方案&执行清单】均为 `✅ 已完成` 时才能开始功能开发
- 任意一项未完成时暂停该模块功能开发；补齐后同步更新 `README.md` 当前进度表，再继续开发

## 25. 关键技术决策（与原方案的差异）

1. **不引入 Prisma**：实际实现使用 `node:sqlite` + 自写迁移；Prisma 优势（类型生成、migration 工具）通过 TypeScript 类型 + 自写 `migrateStructuredDatabase` 实现
2. **不引入 node-cron**：1s 轮询 + 内存 `nextRunAt` 即可覆盖任务 / 签到 / 同步 / 守卫等所有周期任务；实现更简单、启动 / 关闭更可控
3. **不引入 pino / axios / cheerio / bcrypt / argon2**：自写 `logger`、原生 `fetch` + `AbortController`、原生 `RegExp` / `split` 解析、`crypto.scrypt` 已能覆盖需求
4. **不引入 ECharts**：所有图表（饼图、柱状）使用纯 SVG 自写，体积更小、样式更可控
5. **HTTP-only Cookie + Bearer 双轨**：单用户 + NAS 部署场景下，前端 localStorage 缓存 token 用于 axios/fetch 拦截 401；后端同时支持 Cookie，避免纯 localStorage 在 XSS 下泄露
6. **站点 `proxyId` 单绑定、无全局默认代理**：与原方案一致
7. **任务自动执行开关替代旧 enabled/paused**：与原方案一致；`autoRunEnabled=true` 时立刻重置 `nextRunAt = now + intervalMinutes`
8. **种子下载链接脱敏**：`torrents` 表保存明文 `downloadUrl`（用于推送），但 `safeTorrent()` 在所有 GET 接口中剔除；只有推送路径（`POST /api/torrents/:id/push` 与 `batch-push`）使用
9. **下载器 / 代理密码同样明文存储**：受限于 MVP 范围；接口剔除 password 字段
10. **数据库自迁移而非 Prisma migrate**：启动时执行 `migrateStructuredDatabase`，失败时回滚事务并写 `app_meta.last_migration_status=FAILED`

## 26. 最终推荐方案

```text
Node 22 + Express 4 + TypeScript 5.7 + SQLite (node:sqlite) + Vue 3.5 + Varlet UI 3.6
+ 自写 1s 轮询调度器 + pm2-runtime 单容器部署
```

该方案：

- 部署简单（单容器 + 单端口 + 数据卷）
- 不需要单独数据库服务
- 不需要 Nginx
- 前后端无跨域（Express 静态托管）
- 数据库方便备份和迁移
- 性能足够支撑个人 PT 自动化场景
- 维护成本低：依赖最少、必要工具自写、可读性高

