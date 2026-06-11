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
pttime.org           时间   NEXUSPHP
```

规则：

- 用户只填写站点域名，显示名称由映射表决定。
- 支持同站多个域名，域名归一化后匹配映射表。
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
GET    /api/sites?keyword=&connectivityStatus=&proxyUsage=&enabled=&signinEnabled=&page=&pageSize=
POST   /api/sites
GET    /api/sites/:id
PUT    /api/sites/:id
DELETE /api/sites/:id
POST   /api/sites/:id/test-connectivity
POST   /api/sites/:id/browse-torrents
POST   /api/sites/:id/signin
POST   /api/sites/signin-all
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

- `mteam.ts` / `hhanclub.ts` / `hdhome.ts` / `hdkyl.ts` 通过 `normalizeDomain` 匹配对应站点。
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
- 实现 `POST /api/sites/:id/signin` 手动签到接口，含同站防重入。
- 实现 `POST /api/sites/signin-all` 批量签到。
- 调度器新增 `site-auto-signin` job。
- 站点列表新增「签到」列与【签到】按钮，按钮运行中变 loading。
- 站点表单新增「签到设置」section，含开关和 HH:mm 时间字段。
- 列表过滤器新增「签到：全部 / 已开启 / 已关闭」。
- 日志模块新增「签到日志」Tab，支持查询、导出 CSV、清空。
- 更新设计稿和 UI 文档。
- 通过后端、前端类型检查和完整构建。
