# PT 自动化系统技术方案

## 1. 目标

实现一个部署在 NAS 上的 PT 自动化系统，用于定时抓取 PT 站点免费种子，自动推送到 qBittorrent，定时检查免费时间是否过期，并按配置自动删除任务。同时统计各 PT 站点上传量、下载量、分享率等数据。

系统面向个人或家庭 NAS 使用，不考虑大型分布式部署。

## 2. 技术选型

### 后端

- Node.js
- Express
- TypeScript
- Prisma
- SQLite
- node-cron
- axios 或 undici
- cheerio
- pino

### 前端

- Vue 3
- Vite
- TypeScript
- Varlet UI
- Pinia
- Vue Router
- ECharts

### 部署

- Docker 单容器部署
- Express 同时提供 API 和前端静态文件
- SQLite 数据库挂载到 NAS 持久化目录

## 3. 总体架构

```text
Browser
  |
  | HTTP
  v
Express Application
  |
  |-- Vue 静态页面
  |-- REST API
  |-- 定时任务 Scheduler
  |-- PT 站点适配器
  |-- 站点访问策略和代理管理
  |-- qBittorrent Client
  |-- SQLite Database
```

访问路径：

```text
/                 前端页面
/api/*            后端接口
```

最终部署后只需要暴露一个端口，例如：

```text
http://nas-ip:3000
```

## 4. 推荐目录结构

```text
xnz_pt_automation
├── backend
│   ├── src
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── routes
│   │   ├── services
│   │   ├── adapters
│   │   ├── jobs
│   │   ├── prisma
│   │   └── utils
│   ├── prisma
│   │   └── schema.prisma
│   ├── package.json
│   └── tsconfig.json
├── frontend
│   ├── src
│   │   ├── api
│   │   ├── pages
│   │   ├── components
│   │   ├── stores
│   │   └── router
│   ├── package.json
│   └── vite.config.ts
├── docs
│   └── pt-automation-technical-design.md
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 5. 核心功能

### 5.1 站点管理

用于配置 PT 站点信息。

主要功能：

- 新增、编辑、删除站点
- 启用、禁用站点
- 配置站点 Cookie
- 配置站点密钥
- 配置 User-Agent
- 配置站点代理策略
- 配置免费种子页面地址
- 测试密钥是否有效
- 测试 Cookie 是否有效
- 显示站点连通状态
- 测试免费种子解析是否正常
- 测试上传下载统计解析是否正常

站点数据示例：

```ts
type Site = {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  accessKey?: string
  cookie?: string
  userAgent?: string
  parserType: string
  freeTorrentUrl: string
  profileUrl?: string
  proxyId?: string
  proxyMode: 'NONE' | 'GLOBAL' | 'CUSTOM'
  connectivityStatus: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  lastConnectedAt?: Date
  lastConnectError?: string
  checkIntervalMinutes: number
  createdAt: Date
  updatedAt: Date
}
```

### 5.2 站点访问策略

站点访问同时支持密钥和 Cookie。

访问优先级：

```text
优先使用站点密钥访问
  |
密钥访问成功
  |
继续使用密钥

优先使用站点密钥访问
  |
密钥访问失败
  |
如果配置了 Cookie，则自动降级使用 Cookie
  |
Cookie 成功则继续执行任务
  |
Cookie 失败则标记站点不可用
```

站点状态：

```text
UNKNOWN      未检测
ONLINE       可连通
OFFLINE      网络不可达或代理失败
AUTH_FAILED  密钥和 Cookie 都不可用
```

连通性检测需要记录：

- 当前使用的访问方式
- 最近检测时间
- 最近成功时间
- 最近失败原因
- 是否经过代理

访问方式示例：

```ts
type SiteAccessMethod = 'ACCESS_KEY' | 'COOKIE'

type SiteConnectivityCheckResult = {
  siteId: string
  ok: boolean
  status: 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  accessMethod?: SiteAccessMethod
  usedProxy: boolean
  errorMessage?: string
  checkedAt: Date
}
```

### 5.3 代理配置

系统支持全局代理和站点级代理。

代理模式：

```text
NONE    不使用代理
GLOBAL  使用全局默认代理
CUSTOM  使用站点绑定的指定代理
```

代理配置示例：

```ts
type ProxyConfig = {
  id: string
  name: string
  enabled: boolean
  type: 'HTTP' | 'HTTPS' | 'SOCKS5'
  host: string
  port: number
  username?: string
  password?: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}
```

使用规则：

- 每个站点可以选择不走代理
- 每个站点可以选择使用全局默认代理
- 每个站点可以绑定一个指定代理
- qBittorrent API 默认不走站点代理
- 测试站点连接时必须使用该站点的代理策略
- 抓取免费种子、统计上传下载、下载 torrent 文件都必须使用该站点的代理策略

## 6. 免费种子抓取

### 6.1 抓取流程

```text
定时任务触发
  |
读取已启用站点
  |
根据站点代理策略创建 HTTP Client
  |
按密钥优先、Cookie 兜底的策略获取访问凭证
  |
请求免费种子页面
  |
使用站点适配器解析页面
  |
提取免费种子信息
  |
按 siteId + torrentId 去重
  |
写入数据库
```

如果密钥访问失败但 Cookie 成功，需要记录本次任务使用了 Cookie 兜底。如果密钥和 Cookie 都失败，需要将站点状态更新为 `AUTH_FAILED`，并跳过该站点后续抓取。

免费种子数据示例：

```ts
type FreeTorrent = {
  siteId: string
  torrentId: string
  title: string
  size: number
  discountType: 'FREE' | 'TWO_X_FREE' | 'HALF_FREE'
  freeEndAt?: Date
  downloadUrl: string
  detailUrl: string
  seeders?: number
  leechers?: number
  snatches?: number
  publishAt?: Date
}
```

### 6.2 去重规则

优先使用：

```text
siteId + torrentId
```

如果站点没有稳定的 torrentId，可退化使用：

```text
siteId + downloadUrl
```

推送到 qBittorrent 后，应记录 qBittorrent 返回或同步到的 torrent hash。

## 7. qBittorrent 集成

### 7.1 配置项

```ts
type QbittorrentConfig = {
  host: string
  username: string
  password: string
  savePath?: string
  category?: string
  tags?: string[]
  paused?: boolean
}
```

### 7.2 使用的 qBittorrent API

```text
POST /api/v2/auth/login
POST /api/v2/torrents/add
GET  /api/v2/torrents/info
POST /api/v2/torrents/delete
GET  /api/v2/transfer/info
```

### 7.3 推送流程

```text
找到待推送免费种子
  |
检查是否已经推送
  |
下载 torrent 文件或提交下载 URL
  |
调用 qBittorrent 添加任务接口
  |
同步 qBittorrent 任务 hash
  |
更新数据库状态为 PUSHED
```

## 8. 免费时间过期检查与自动删除

### 8.1 检查流程

```text
定时任务触发
  |
查询已推送且未删除的免费种子
  |
判断 freeEndAt 是否已过期
  |
判断是否满足删除规则
  |
调用 qBittorrent 删除接口
  |
更新数据库状态
```

### 8.2 删除规则

建议支持全局配置和站点级配置。

```ts
type AutoDeleteRule = {
  enabled: boolean
  deleteAfterFreeExpired: boolean
  deleteTorrentFile: boolean
  deleteDownloadedFiles: boolean
  delayMinutesAfterExpired: number
  minRatio?: number
  minSeedingMinutes?: number
}
```

推荐默认值：

- 自动删除默认关闭
- 免费结束后延迟 30 分钟再处理
- 默认只删除 qBittorrent 任务，不删除文件
- 可手动开启删除已下载文件
- 支持达到最小分享率后再删除

## 9. 上传下载统计

### 9.1 PT 站点统计

定时访问用户个人信息页，解析上传量、下载量、分享率和魔力值。

```ts
type SiteTrafficSnapshot = {
  id: string
  siteId: string
  uploaded: bigint
  downloaded: bigint
  ratio: number
  bonus?: number
  seedingCount?: number
  leechingCount?: number
  createdAt: Date
}
```

前端展示：

- 当前上传量
- 当前下载量
- 当前分享率
- 24 小时上传增量
- 7 天上传下载趋势
- 30 天上传下载趋势

### 9.2 qBittorrent 统计

通过 qBittorrent API 同步当前任务状态。

```ts
type QbTorrentSnapshot = {
  torrentHash: string
  name: string
  size: number
  uploaded: number
  downloaded: number
  ratio: number
  state: string
  category?: string
  tags?: string[]
  createdAt: Date
}
```

## 10. 定时任务

建议任务列表：

```text
sync-free-torrents
每 10-30 分钟执行一次
抓取各站点免费种子并入库

push-free-torrents
每 5-10 分钟执行一次
将符合规则的免费种子推送到 qBittorrent

check-free-expired
每 10 分钟执行一次
检查免费期是否结束，并按规则删除

sync-site-traffic
每 30-60 分钟执行一次
采集站点上传、下载、分享率

sync-qb-status
每 1-5 分钟执行一次
同步 qBittorrent 当前任务状态
```

任务要求：

- 同一个任务未结束时，不允许重复启动
- 任务失败需要记录错误日志
- 手动执行任务也需要走同一套任务锁
- 避免高频访问 PT 站点

## 11. 后端 API 设计

### 11.1 站点接口

```text
GET    /api/sites
POST   /api/sites
GET    /api/sites/:id
PUT    /api/sites/:id
DELETE /api/sites/:id
POST   /api/sites/:id/test-access-key
POST   /api/sites/:id/test-cookie
POST   /api/sites/:id/test-connectivity
POST   /api/sites/:id/test-parser
POST   /api/sites/:id/sync-free-torrents
POST   /api/sites/:id/sync-traffic
```

站点连通性接口需要返回当前最终可用的访问方式。

```ts
type TestSiteConnectivityResponse = {
  ok: boolean
  status: 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  accessMethod?: 'ACCESS_KEY' | 'COOKIE'
  usedProxy: boolean
  errorMessage?: string
}
```

### 11.2 免费种子接口

```text
GET    /api/torrents
GET    /api/torrents/:id
POST   /api/torrents/:id/push
POST   /api/torrents/:id/delete-from-qb
POST   /api/torrents/batch-push
```

### 11.3 qBittorrent 接口

```text
GET    /api/qb/config
PUT    /api/qb/config
POST   /api/qb/test
GET    /api/qb/torrents
GET    /api/qb/status
```

### 11.4 统计接口

```text
GET /api/stats/overview
GET /api/stats/sites
GET /api/stats/sites/:id/traffic
GET /api/stats/torrents
```

### 11.5 定时任务接口

```text
GET  /api/jobs
POST /api/jobs/:name/run
PUT  /api/jobs/:name/config
GET  /api/jobs/:name/logs
```

### 11.6 代理接口

```text
GET    /api/proxies
POST   /api/proxies
GET    /api/proxies/:id
PUT    /api/proxies/:id
DELETE /api/proxies/:id
POST   /api/proxies/:id/test
PUT    /api/proxies/:id/default
```

### 11.7 认证与账户接口

系统采用单用户模式，默认初始化用户为：

```text
username: admin
password: 123456
```

首次启动时如果数据库中不存在用户，则自动创建默认用户。密码必须使用 `bcrypt` 或 `argon2` 哈希后存储，不能明文保存。

接口设计：

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
PUT  /api/auth/password
```

修改密码请求示例：

```ts
type ChangePasswordRequest = {
  oldPassword: string
  newPassword: string
}
```

登录成功后返回 JWT 或设置 HTTP-only Cookie。NAS 单用户场景推荐使用 HTTP-only Cookie，降低前端泄露 token 的风险。

## 12. 前端页面

### 12.1 页面列表

```text
/dashboard       首页概览
/login           登录
/sites           站点管理
/sites/:id       站点详情
/free-torrents   免费种子
/qbittorrent     下载器管理
/statistics      数据统计
/jobs            定时任务
/proxies         代理管理
/settings        系统设置
```

### 12.2 Dashboard

展示：

- 已配置站点数量
- 今日新增免费种子数
- 已推送 qBittorrent 数量
- 即将过期免费种子数量
- 当前上传速度
- 当前下载速度
- 总上传量
- 总下载量
- 站点健康状态
- 代理健康状态

### 12.3 登录页

功能：

- 输入用户名和密码登录
- 默认账号提示为 `admin`
- 不在页面展示默认密码
- 登录失败显示明确错误提示
- 登录成功后跳转 Dashboard

### 12.4 站点管理页

展示字段：

- 站点名称
- 启用状态
- 连通状态
- 当前可用访问方式
- 代理模式
- 最近成功连接时间
- 最近失败原因
- 操作

支持操作：

- 配置站点密钥
- 配置站点 Cookie
- 配置站点代理策略
- 测试密钥
- 测试 Cookie
- 测试站点连通性
- 手动同步免费种子
- 手动同步上传下载统计

### 12.5 免费种子页

展示字段：

- 站点
- 标题
- 大小
- 免费类型
- 免费结束时间
- 剩余免费时间
- 做种数
- 下载数
- 推送状态
- qBittorrent 状态
- 操作

支持操作：

- 单个推送
- 批量推送
- 删除 qBittorrent 任务
- 查看失败原因
- 按站点筛选
- 按状态筛选
- 按关键词搜索

### 12.6 代理管理页

展示字段：

- 代理名称
- 代理类型
- 地址
- 端口
- 启用状态
- 是否默认代理
- 最近测试结果
- 操作

支持操作：

- 新增代理
- 编辑代理
- 删除代理
- 测试代理连通性
- 设置默认代理

### 12.7 统计页

展示：

- 各站点上传趋势
- 各站点下载趋势
- 分享率趋势
- 每日上传增量
- 每日下载增量
- 免费种子推送数量趋势
- 自动删除数量统计

### 12.8 系统设置页

功能：

- 修改当前用户密码
- 查看当前系统版本
- 查看数据库路径
- 查看最近一次数据库迁移结果
- 配置系统基础参数

## 13. 数据库设计

核心表：

```text
users
sites
proxy_configs
site_connectivity_logs
qbittorrent_configs
torrents
torrent_events
push_rules
auto_delete_rules
site_traffic_snapshots
qb_torrent_snapshots
job_configs
job_logs
settings
schema_migrations
```

常用索引：

```text
sites.enabled
sites.connectivityStatus
sites.proxyId
proxy_configs.enabled
torrents.siteId
torrents.torrentId
torrents.status
torrents.freeEndAt
torrents.createdAt
site_traffic_snapshots.siteId
site_traffic_snapshots.createdAt
job_logs.jobName
job_logs.startedAt
schema_migrations.version
```

`users` 表采用单用户设计，但仍保留用户表，便于认证和后续扩展。

```ts
type User = {
  id: string
  username: string
  passwordHash: string
  passwordChangedAt?: Date
  lastLoginAt?: Date
  createdAt: Date
  updatedAt: Date
}
```

`sites` 表需要保存站点密钥、Cookie、代理模式、最近连通状态等字段。密钥、Cookie 和代理密码必须加密存储。

`site_connectivity_logs` 用于记录每次连通性检测结果，便于前端展示站点是否可用以及失败原因。

`schema_migrations` 用于记录数据库结构版本、迁移执行时间和迁移结果。即使使用 Prisma，也建议保留应用级迁移记录，方便前端设置页展示和故障排查。

## 14. SQLite 可行性

SQLite 适合本系统的 NAS 使用场景。

原因：

- 单用户或少用户访问
- 写入频率低
- 无需额外数据库服务
- 资源占用小
- 备份简单
- Docker 单容器部署方便

建议启动时设置：

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

数据持久化目录：

```text
/app/data/app.db
```

NAS 推荐挂载：

```text
/volume1/docker/pt-automation/data:/app/data
```

需要做数据保留策略：

- 任务日志保留 30-90 天
- qBittorrent 快照保留 7-30 天
- 站点流量快照可长期保留
- 高频快照后续可按天聚合

### 14.1 启动初始化与迁移

应用启动时必须先完成数据库检查、表结构初始化和迁移，再启动 HTTP 服务和定时任务。

启动流程：

```text
容器启动
  |
检查 /app/data 目录是否存在，不存在则创建
  |
检查 SQLite 数据库文件是否存在
  |
不存在则创建数据库文件
  |
执行数据库迁移，创建或更新数据表
  |
执行基础数据初始化
  |
启动 Express HTTP 服务
  |
启动定时任务 Scheduler
```

初始化内容：

- 创建所有数据表
- 创建必要索引
- 写入默认系统设置
- 写入默认任务配置
- 如果不存在用户，创建默认用户 `admin`
- 默认用户密码为 `123456`，存储时必须哈希
- 写入当前数据库 schema 版本

升级处理：

```text
应用版本升级
  |
启动时检测数据库 schema 版本
  |
发现存在未执行迁移
  |
按版本顺序执行迁移
  |
更新 schema_migrations 记录
  |
迁移成功后继续启动服务
```

迁移失败处理：

- 不启动 HTTP 服务
- 不启动定时任务
- 在容器日志中输出错误原因
- 不删除已有数据库文件
- 不自动回滚用户数据
- 提示用户备份数据库后处理

推荐实现方式：

```text
entrypoint.ts 或 bootstrap.ts
  |
ensureDataDirectory()
  |
runDatabaseMigrations()
  |
seedInitialData()
  |
startServer()
```

如果使用 Prisma：

- 构建镜像时生成 Prisma Client
- 启动时执行 `prisma migrate deploy`
- 迁移完成后执行 seed 逻辑
- seed 逻辑必须幂等，重复执行不能产生重复数据

seed 规则：

```text
users 表为空
  |
创建 admin / 123456

users 表不为空
  |
不修改现有用户和密码
```

### 14.2 单用户认证

系统采用单用户模式，不做多用户权限划分。

认证要求：

- 默认用户名为 `admin`
- 默认密码为 `123456`
- 登录后可以修改密码
- 修改密码需要验证旧密码
- 密码只保存哈希值
- 登录态过期时间可配置，默认 7 天
- 所有 `/api/*` 接口默认需要登录，`/api/auth/login` 除外

建议在首次登录后前端提示用户修改默认密码，但不强制阻断使用。

## 15. Docker 部署方案

### 15.1 单容器方案

构建时：

```text
构建 Vue 前端
  |
生成 frontend/dist
  |
构建 Express 后端
  |
把前端 dist 复制到后端 public
  |
运行 Express
```

运行时：

```text
Express 提供 /api 接口
Express 托管 Vue 静态文件
SQLite 文件写入 /app/data
启动时自动检查数据库、执行迁移并初始化默认数据
```

### 15.2 Dockerfile 示例

```dockerfile
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM node:22-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/prisma ./prisma
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=frontend-builder /app/frontend/dist ./public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/bootstrap.js"]
```

### 15.3 docker-compose.yml 示例

```yaml
services:
  pt-automation:
    build: .
    container_name: pt-automation
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      NODE_ENV: production
      DATABASE_URL: file:/app/data/app.db
      APP_SECRET: change-me
      JWT_SECRET: change-me
      TZ: Asia/Shanghai
    restart: unless-stopped
```

## 16. Express 托管前端

后端需要先注册 API，再注册静态文件。

```ts
import express from 'express'
import path from 'node:path'

const app = express()

app.use(express.json())
app.use('/api', apiRouter)

const publicDir = path.resolve(process.cwd(), 'public')

app.use(express.static(publicDir))

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'))
})

app.listen(3000)
```

## 17. 安全设计

需要保护的敏感数据：

- PT Cookie
- PT 站点密钥
- qBittorrent 用户名和密码
- passkey
- torrent 下载链接
- 代理用户名和密码
- JWT Secret

安全要求：

- 敏感字段加密存储
- 默认用户 `admin` 的密码 `123456` 只能在首次初始化时写入，且必须哈希存储
- 修改密码必须校验旧密码
- 登录接口需要限制失败重试频率
- 日志中不打印密钥、Cookie、密码、passkey、下载链接
- 前端敏感字段脱敏展示
- 站点连通性日志只记录访问方式，不记录完整凭证
- 代理测试日志不记录代理密码
- 后端 API 增加登录鉴权
- 限制手动任务执行频率
- 支持 Docker 环境变量配置密钥

## 18. MVP 实施范围

第一版建议实现：

- Docker 单容器部署
- Express 后端基础框架
- Vue + Varlet UI 前端基础框架
- SQLite + Prisma 数据库
- 启动时数据库自动创建、迁移和初始化
- 单用户登录
- 默认用户 `admin` / `123456`
- 修改密码
- qBittorrent 配置和连接测试
- 站点管理
- 站点密钥和 Cookie 双凭证访问
- 站点连通状态检测
- 代理配置和站点级代理策略
- NexusPHP 免费种子抓取
- 免费种子列表
- 手动推送到 qBittorrent
- 定时抓取免费种子
- 免费过期自动删除
- 站点上传下载统计
- 任务日志
- Dashboard 基础概览

第一版暂不实现：

- 多用户权限系统
- 插件市场
- 多下载器支持
- 复杂规则引擎
- 高级数据分析
- RSS 自动订阅

## 19. 模块文档体系

工程开发按模块推进，每个模块都必须有独立方案文档。模块文档需要达到 AI 读取后即可完成该模块所有功能开发的粒度，不能只写概要。

模块文档索引：

| 模块 | 文档 | 设计稿 |
| --- | --- | --- |
| 登录 | `docs/login-plan.md` | `designs/login.svg` |
| 首页 | `docs/dashboard-plan.md` | `designs/dashboard.svg` |
| 站点 | `docs/sites-plan.md` | `designs/sites.svg`、`designs/sites-form.svg` |
| 免费种子 | `docs/free-torrents-plan.md` | 待生成 |
| qBittorrent | `docs/qbittorrent-plan.md` | 待生成 |
| 代理管理 | `docs/proxies-plan.md` | 待生成 |
| 数据统计 | `docs/statistics-plan.md` | 待生成 |
| 定时任务 | `docs/jobs-plan.md` | 待生成 |
| 系统设置 | `docs/settings-plan.md` | 待生成 |

每个模块文档必须包含：

- 模块目标和业务边界
- 页面路径、入口和跳转关系
- 页面布局、响应式规则和设计稿文件
- 功能列表、交互流程、表单和列表字段
- 接口路径、请求参数、响应结构和错误处理
- 前端状态、loading、空状态和异常状态
- 后端处理规则、数据持久化规则和安全要求
- 可逐项执行的开发清单、TODO 和验收标准

模块开发状态以 `README.md` 当前进度表为准。

## 20. 开发顺序

1. 初始化 monorepo 目录结构
2. 初始化 Express + TypeScript 后端
3. 初始化 Vue + Vite + Varlet UI 前端
4. 接入 Prisma + SQLite
5. 实现启动时数据库检查、迁移和 seed 初始化
6. 实现单用户登录和修改密码
7. 实现 Dockerfile 和 docker-compose.yml
8. 实现 qBittorrent API Client
9. 实现代理配置和 HTTP Client 工厂
10. 实现站点 CRUD
11. 实现站点密钥优先、Cookie 兜底的访问策略
12. 实现站点连通性检测和状态记录
13. 实现 NexusPHP 站点适配器
14. 实现免费种子抓取和入库
15. 实现免费种子推送到 qBittorrent
16. 实现过期检查和自动删除
17. 实现上传下载统计采集
18. 实现前端管理页面
19. 实现任务日志和 Dashboard
20. 增加鉴权和敏感信息加密

## 21. 最终推荐方案

本项目推荐采用：

```text
Express + Vue 3 + Varlet UI + SQLite + Prisma + Docker 单容器部署
```

该方案适合 NAS：

- 部署简单
- 维护成本低
- 不需要单独数据库服务
- 不需要 Nginx
- 前后端无跨域问题
- 数据库方便备份和迁移
- 性能足够支撑个人 PT 自动化场景
