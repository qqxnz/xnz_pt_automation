# 日志模块方案

## 1. 模块目标

日志模块负责集中展示系统操作记录和任务执行记录，帮助用户追踪谁做了什么操作、任务何时执行、抓取结果、推送结果和执行报错信息。

业务边界：本模块只展示和筛选日志，不负责触发任务、不修改任务配置、不写入种子记录。任务的新建、编辑、开启、关闭、测试、运行、删除等用户动作进入【操作日志】；任务真实执行结果进入【任务日志】。

命名规则：原【定时任务日志】统一更名为【任务日志】。

## 2. 页面和入口

页面路径：`/logs`

入口：左侧导航、任务模块查看日志入口、Dashboard 最近任务入口。

页面结构：

```text
日志页
  |
  |-- 操作日志 (operation)
  |-- 任务日志 (task)
  |-- 定时日志 (schedule)
  |-- 签到日志 (signin)
  |-- 种子日志 (torrent)
```

## 3. 功能方案

操作日志字段：

```text
操作时间
操作类型
操作说明
操作者
IP
状态
```

任务日志字段：

```text
执行时间
任务名称
任务 ID
运行来源
执行状态
开始时间
结束时间
抓取数量
命中数量
推送成功数量
推送失败数量
执行摘要
报错信息
```

运行来源：

```text
AUTO：自动执行。
MANUAL_RUN：用户点击【运行】。
```

日志归属：

```text
新建任务 -> 操作日志
编辑任务 -> 操作日志
打开自动执行开关 -> 操作日志
关闭自动执行开关 -> 操作日志
点击测试 -> 操作日志
点击运行 -> 操作日志
删除任务 -> 操作日志
自动执行任务 -> 任务日志
手动运行任务 -> 任务日志
测试抓取 -> 不写任务日志
```

筛选项：

- 日志类型：操作日志、任务日志
- 关键词
- 状态：全部、成功、失败、运行中
- 任务
- 运行来源：全部、自动执行、手动运行
- 时间范围

## 4. 接口和数据

接口：

```text
GET    /api/logs?type=operation&page=&pageSize=&keyword=&status=&startAt=&endAt=
GET    /api/logs?type=task&page=&pageSize=&keyword=&status=&taskId=&runMode=&startAt=&endAt=
GET    /api/logs?type=schedule&page=&pageSize=&keyword=&status=&startAt=&endAt=
GET    /api/logs?type=signin&page=&pageSize=&keyword=&status=&siteId=&runMode=&startAt=&endAt=
GET    /api/logs?type=torrent&page=&pageSize=&keyword=&status=&siteId=&startAt=&endAt=
GET    /api/logs/export?type=...                # 返回 CSV（带 BOM \uFEFF）
DELETE /api/logs?type=...                       # 清空指定类型
```

- `type` 取值白名单：`operation | task | schedule | signin | torrent`（默认 `operation`）

操作日志：

```ts
type OperationLog = {
  id: string
  type: 'OPERATION'
  action: string
  message: string
  actorId?: string
  actorName?: string
  ip?: string
  userAgent?: string
  status: 'SUCCESS' | 'FAILED'
  createdAt: string
}
```

任务日志：

```ts
type TaskLog = {
  id: string
  type: 'TASK'
  taskId?: string
  taskName: string
  runMode: 'AUTO' | 'MANUAL_RUN'
  message: string
  status: 'SUCCESS' | 'FAILED' | 'RUNNING'
  startedAt?: string
  finishedAt?: string
  fetchedCount?: number
  matchedCount?: number
  pushedCount?: number
  pushFailedCount?: number
  summary?: string
  errorMessage?: string
  createdAt: string
}
```

签到日志：

```ts
type SigninLog = {
  id: string
  type: 'SIGNIN'
  siteId: string
  siteName: string
  runMode: 'AUTO' | 'MANUAL'
  triggerSource: 'scheduler' | 'manual-button'
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  message: string
  errorMessage?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  createdAt: string
}
```

定时日志（v0.5.0 新增）：

```ts
type ScheduleLog = {
  id: string
  type: 'SCHEDULE'
  jobName: string                       // task-auto-run-scan / task-stuck-check / torrent-download-stats-sync
                                         // / torrent-ipv6-peer-sync / expired-free-download-cleanup
                                         // / site-traffic-sync / site-auto-signin
  message: string
  status: 'SUCCESS' | 'FAILED' | 'RUNNING'
  scheduledAt?: string
  triggeredAt?: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  summary?: string
  errorMessage?: string
  details?: Record<string, unknown>
  createdAt: string
}
```

种子日志（v0.5.0 新增）：

```ts
type TorrentLog = {
  id: string
  type: 'TORRENT'
  torrentId?: string
  siteId?: string
  siteName?: string
  torrentTitle: string
  event: 'INSERTED' | 'PUSHED' | 'PUSH_FAILED' | 'AUTO_DELETE_TASK' | 'MANUAL_DELETE_TASK' | 'MANUAL_RESET_TASK' | 'DELETE_RECORD' | 'UPDATE_SETTINGS'
  status: 'SUCCESS' | 'FAILED'
  message: string
  reason?: string
  source?: 'AUTO' | 'MANUAL' | 'SCHEDULER' | 'TASK'
  actorId?: string
  actorName?: string
  createdAt: string
}
```

## 5. 状态和安全

- 日志不输出 Cookie、API Key、密码、passkey 和完整下载链接。
- 下载链接只允许展示脱敏后的链接状态。
- 测试抓取结果只在任务模块弹窗展示，不进入任务日志。
- 任务执行失败时必须记录明确错误原因，但不能包含敏感凭证。
- 日志分页默认 `20` 条，最大 `100` 条。
- 任务日志保留周期由系统设置控制，默认 60 天。

## 6. 设计稿

当前日志页已有前端实现，后续如补设计稿，文件为 `designs/logs.svg`。

桌面端使用 Tab + 筛选区 + 日志列表 + 分页。移动端使用顶部 Tab + 折叠筛选 + 卡片列表。

## 7. 签到日志

签到日志独立于任务日志，用于记录【站点】模块每次签到（手动 / 自动）的结果。签到日志 Tab 复用现有日志页样式（顶部 Tab + 列表 + 分页）。

字段见上文 `SigninLog` 类型。

签到来源：

```text
AUTO：调度器每日到点触发的签到
MANUAL：用户在【站点】列表点击【签到】按钮，或调用 POST /api/sites/signin-all
```

触发方式：

```text
scheduler：调度器触发
manual-button：手动按钮触发
```

签到归属：

```text
手动点击【签到】按钮 -> 签到日志
批量签到 -> 签到日志（每条都写）
调度器自动签到 -> 签到日志
签到相关的用户操作 -> 操作日志（动作：站点签到 / 批量站点签到）
```

筛选项：

- 日志类型：操作日志、任务日志、签到日志、定时日志
- 状态：全部、成功、失败、已跳过、运行中
- 来源：全部、自动、手动
- 站点 ID（与【站点】详情页跳转联动）
- 关键词、时间范围

## 8. 执行清单

- 将前端任务日志 Tab 文案统一为【任务日志】。
- 将任务日志空状态统一为【暂无任务日志】。
- 实现任务日志字段展示：运行来源、抓取数量、命中数量、推送成功数量、推送失败数量、摘要和报错信息。
- 实现任务日志筛选：任务、运行来源、状态、关键词和时间范围。
- 后端扩展 TaskLog 数据结构。
- 后端记录 AUTO 和 MANUAL_RUN 的真实任务执行日志。
- 后端确保 TEST 不写任务日志。
- 后端记录任务操作到操作日志。
- 后端实现日志脱敏。
- 日志模块新增 `signin` 类型与 `SigninLog` 数据结构。
- `site_signin_logs` 表写入与查询：手动按钮、自动调度器、批量签到都要写入。
- 日志页新增【签到日志】Tab，渲染来源、触发方式、开始/结束、耗时、错误。
- 签到日志支持按站点、来源、状态、关键词过滤；支持导出 CSV 和清空。
- 操作日志同时记录「站点签到」「批量站点签到」动作。

## 9. TODO

- [x] 明确旧任务日志命名更名为【任务日志】。
- [x] 明确测试按钮不写任务日志。
- [x] 明确任务操作写操作日志。
- [ ] 补充 `designs/logs.svg`。
- [ ] 确认任务日志保留周期是否沿用系统设置默认 60 天。

## 10. 验收标准

- 日志页显示【操作日志】、【任务日志】、【签到日志】和【定时日志】四个 Tab。
- 前端不再出现旧任务日志命名。
- 点击任务测试只产生操作日志，不产生任务日志。
- 自动执行和手动运行都会产生任务日志。
- 任务日志能查看执行时间、抓取结果、推送结果和执行报错信息。
- 【站点】模块点击【签到】按钮后，会产生一条 MANUAL 来源的签到日志。
- 调度器到点签到时，会产生一条 AUTO 来源的签到日志。
- 签到日志能按站点、来源、状态、关键词筛选，并支持导出 CSV 和清空。
- 日志内容不泄露 Cookie、密钥、密码、passkey 和完整下载链接。

## 11. v0.5.0 实际实现差异

> 本节记录 `backend/src/routes/logs.ts` + `utils/logger.ts` + 前端 `LogsPage.vue` 当前实现与上文的差异。

### 11.1 5 类日志（v0.5.0）

| 类型 | 表 | 触发点 |
| --- | --- | --- |
| `operation` | `operation_logs` | 登录/登出/改密/任务 CRUD/开关/测试/运行/站点 CRUD/手动签到/批量签到/下载器 CRUD/种子推送/批删/重置/设置修改/STORAGE_MIGRATION/STORAGE_SCHEMA_REPAIR |
| `task` | `task_logs` | 仅 AUTO / MANUAL_RUN 真实执行；**TEST 不写** |
| `schedule` | `schedule_logs` | 7 个调度 job 每次执行前/后（含 RUNNING + SUCCESS/FAILED） |
| `signin` | `site_signin_logs` | 手动签到、批量签到、调度自动签到 |
| `torrent` | `torrent_logs` | 种子的 INSERTED / PUSHED / PUSH_FAILED / AUTO_DELETE_TASK / MANUAL_DELETE_TASK / MANUAL_RESET_TASK / DELETE_RECORD / UPDATE_SETTINGS |

### 11.2 任务日志字段扩展

实际 `TaskLogRecord`：

```ts
{
  id, type: 'TASK', taskId?, taskName, runMode?: 'AUTO' | 'MANUAL_RUN',
  message, status: 'SUCCESS' | 'FAILED' | 'RUNNING',
  startedAt?, finishedAt?,
  fetchedCount?, matchedCount?, skippedExistingCount?,
  pushedCount?, pushFailedCount?,
  summary?, errorMessage?, fetchErrorMessage?, pushErrorMessages[]?, failureDetails[]?,
  createdAt
}
```

- 比原方案多：`skippedExistingCount` / `fetchErrorMessage` / `pushErrorMessages` / `failureDetails`
- 前端任务日志弹窗"失败原因"展示 `failureDetails + fetchErrorMessage + pushErrorMessages` 合并（最多展示 4 条）

### 11.3 导出 / 清空

- `GET /api/logs/export?type=...`：返回 CSV 文本流，**第一字节为 BOM `\uFEFF`**，保证 Excel 直接打开不乱码
- `DELETE /api/logs?type=...`：先写一条 `action=LOGS_CLEAR` 操作日志（包含 clearedCount），再清表

### 11.4 状态展示

- 状态映射：`SUCCESS→成功` / `FAILED→失败` / `RUNNING→运行中` / `SKIPPED→已跳过`
- 列表默认 20/页

### 11.5 日志脱敏

- `sanitizeLogText` 替换：`cookie: ...`、`api_key=...`、`passkey=...`、`authorization: ...`、HTTP 链接 → `[已脱敏]`
- 站点连通性日志只写访问方式（API_KEY / COOKIE）+ 失败原因摘要，不写完整凭证
- 代理测试日志不记录代理密码

### 11.6 TODO 状态

- [x] 5 类日志：operation / task / schedule / signin / torrent
- [x] 任务日志字段扩展（fetchedCount / matchedCount / skippedExistingCount / pushedCount / pushFailedCount / errorMessage / fetchErrorMessage / pushErrorMessages / failureDetails）
- [x] 日志导出 CSV（带 BOM）
- [x] 日志清空（写操作日志 + 清表）
- [x] TEST 不写 task_log
- [x] 失败原因多字段合并展示
- [x] 日志脱敏
- [x] 路由 `?type=` 决定默认 Tab
- [x] 补 `designs/logs.svg`
- [ ] 任务日志保留周期实际未做硬删除（待接入系统设置 `taskLogRetentionDays`）
