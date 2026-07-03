# 任务模块方案

## 1. 模块目标

任务模块负责创建、展示和运行用户配置的抓取推送任务。用户选择一个站点、一个下载器，设定执行间隔、是否只抓免费、是否自动推送、保存路径等规则后，系统按任务配置抓取站点种子并按需推送到下载器。

业务边界：本模块管理任务规则、自动执行开关、调度状态和任务执行入口；具体站点凭证由站点模块维护，下载器连接由下载器模块维护，真实写入的种子记录由种子模块展示，任务执行记录统一进入日志模块的【任务日志】。

默认规则：新建任务时执行间隔默认 `30` 分钟，后端保存时如果请求未传 `intervalMinutes` 也按 `30` 分钟处理。

冲突处理：原“启用状态”和“添加后是否暂停”不再作为独立调度字段，统一由“自动执行开关”替代。

## 2. 页面和入口

页面路径：`/tasks`

入口：左侧导航、首页最近任务、站点详情页快捷创建入口。

核心链路：先在站点模块新增站点，再在下载器模块新增 QB 下载器，然后在本模块选择站点和下载器创建任务。用户可以打开自动执行开关按间隔执行，也可以点击【测试】核对抓取效果，或点击【运行】立即执行一次真实任务。

## 3. 功能方案

任务列表字段：

```text
任务名称
站点
下载器
自动执行开关
执行间隔
下一次执行时间
抓取范围
自动推送
最近执行时间
最近运行来源
最近结果
运行中状态
操作
```

新增/编辑任务字段：

```text
任务名称
站点
下载器
执行间隔分钟（默认 30，最小 10）
自动执行开关
是否只抓免费（默认 true）
是否自动推送到下载器（默认 true）
免费类型范围：FREE、TWO_X_FREE、HALF_FREE、NORMAL（默认 FREE+TWO_X_FREE）
抓取数量（默认 100，1-1000）
排序规则
入库数量（GT/EQ/LT + 整数）
种子体积范围（GB）
做种人数范围（min/max）
保存路径覆盖
分类覆盖（同时作为 qB 推送的 category）
标签覆盖
仅免费下载开关
免费到期删除开关
跳过 HR 开关（H3/H5/未完成 HR，默认勾选）
低速阈值（kbps + minutes，同时设置或同时为空）
```

操作：

```text
新增
编辑
打开自动执行
关闭自动执行
测试
运行
修改间隔
查看任务日志
删除
```

字段默认值和校验：

```text
执行间隔分钟：默认 30，最小 10，必须为正整数
自动执行开关：默认关闭；打开后从打开时间开始计时
是否只抓免费：默认开启
是否自动推送到下载器：默认开启
免费类型范围：默认 FREE + TWO_X_FREE（前端实现）
抓取数量：默认 100，整数，1 到 1000 之间，控制每次从站点列表抓取的种子候选上限
排序规则：默认不排序（按抓取顺序），可选做种人数升降序、发布时间升降序、种子体积升降序
入库数量：torrentCountCondition ∈ GT|EQ|LT 配 torrentCount 整数（前端当前仅暴露 LT 语义）
做种人数范围：seederMin / seederMax（0 = 不限；同时 >0 时要求 min ≤ max）
种子体积范围：sizeMinGb / sizeMaxGb（0 = 不限；同时 >0 时要求 min ≤ max）
仅免费下载：默认 true，控制自动删除条件 ①
免费到期删除：默认 false，控制自动删除条件 ②
跳过 HR：默认 true，抓取时拦截 H3/H5/未完成 HR 标记的种子；关闭后会照常抓取
低速阈值：lowUploadKbps + lowUploadMinutes（同时设置或同时为 0/null），控制自动删除条件 ③
```

自动执行开关规则：

```text
打开开关
  |
记录 autoRunStartedAt = now
  |
设置 nextRunAt = now + intervalMinutes
  |
调度器到达 nextRunAt 后执行一次真实任务
  |
任务完成后设置 nextRunAt = finishedAt + intervalMinutes

关闭开关
  |
停止自动计时
  |
清空 nextRunAt
```

【测试】按钮规则：

```text
点击测试
  |
读取任务绑定站点和任务过滤规则
  |
抓取并过滤种子
  |
弹窗展示抓取结果，供用户核对任务规则是否达到效果
  |
不写入种子记录
  |
不推送下载器
  |
不写入任务日志
  |
只写操作日志，记录用户点击测试和测试成功/失败摘要
```

【运行】按钮规则：

```text
点击运行
  |
不检查 nextRunAt 是否到期，立即执行一次真实任务
  |
写入或更新种子记录
  |
autoPush=true 时推送到绑定下载器
  |
写入任务日志
  |
写入操作日志，记录用户点击运行
  |
如果自动执行开关打开，任务完成后设置 nextRunAt = finishedAt + intervalMinutes
```

## 4. 接口和数据

接口：

```text
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
PUT    /api/tasks/:id
DELETE /api/tasks/:id
POST   /api/tasks/:id/auto-run
POST   /api/tasks/:id/test
POST   /api/tasks/:id/run
GET    /api/tasks/:id/logs?page=&pageSize=
```

`POST /api/tasks/:id/auto-run` 请求：

```ts
type UpdateTaskAutoRunRequest = {
  autoRunEnabled: boolean
}
```

`POST /api/tasks/:id/test` 响应（实际字段）：

```ts
type TaskTestResult = {
  taskId: string
  taskName: string
  siteId: string
  siteName: string
  fetchedCount: number
  skippedExistingCount: number
  matchedCount: number
  excludedByHitAndRunCount: number
  pushableCount: number
  items: Array<{
    title: string
    size: number
    discountType: 'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'
    isFreeNow: boolean
    freeEndAt?: string
    seeders?: number
    leechers?: number
    linkStatus: 'SAVED' | 'MISSING' | 'INVALID'
    skippedExisting?: boolean   // 命中 siteId:torrentId 已存在
    matched?: boolean           // 命中任务过滤规则
    pushable?: boolean          // matched && linkStatus=SAVED
    excludedBy?: 'HIT_AND_RUN'  // 被 HR 过滤
  }>
  errorMessage?: string
}
```

任务项（实际 `TaskRecord` 字段）：

```ts
type TaskRunMode = 'AUTO' | 'MANUAL_RUN' | 'TEST'

type TaskItem = {
  id: string
  name: string
  siteId: string
  downloaderId: string
  autoRunEnabled: boolean
  autoRunStartedAt?: string
  nextRunAt?: string
  intervalMinutes: number
  onlyFreeDownload: boolean       // 原 freeOnly 改名
  deleteOnFreeExpire: boolean
  skipHitAndRun: boolean          // 默认 true，跳过 H3/H5/未完成 HR
  lowUploadKbps?: number
  lowUploadMinutes?: number
  autoPush: boolean
  discountTypes: Array<'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'>
  seederMin: number
  seederMax: number
  sizeMinGb: number
  sizeMaxGb: number
  torrentCountCondition?: 'GT' | 'EQ' | 'LT'
  torrentCount?: number
  sortRule?: 'SEEDERS_ASC' | 'SEEDERS_DESC' | 'CREATED_DESC' | 'CREATED_ASC' | 'SIZE_DESC' | 'SIZE_ASC'
  fetchLimit: number              // 默认 100
  savePathOverride?: string
  categoryOverride?: string
  tagsOverride?: string[]
  running: boolean
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

创建任务请求如果没有传 `intervalMinutes`，后端需要写入 `30`；编辑任务时如果传入小于 `10` 的值，接口返回校验错误（实际后端最小值 10，原文档"30"已下调）。旧字段 `enabled` 和 `paused` 不再使用，迁移时按 `autoRunEnabled = enabled && !paused` 兼容一次。

真实任务运行流程：

```text
任务触发：AUTO 或 MANUAL_RUN
  |
读取任务绑定站点和下载器
  |
使用站点保存的 User-Agent 和可选代理抓取种子
  |
按 freeOnly、discountTypes、过期阈值过滤
  |
写入或更新种子记录，记录 sourceRunMode
  |
记录种子来源任务 id、任务名称、目标下载器 id、下载器名称
  |
autoPush=true 时推送到任务绑定下载器
  |
记录目标下载器、torrent hash、推送状态和任务日志
  |
如果 autoRunEnabled=true，重置 nextRunAt
```

运行来源规则：

```text
AUTO：自动执行，写种子记录，按配置推送，写任务日志。
MANUAL_RUN：点击【运行】，写种子记录，按配置推送，写任务日志，并重置下一次计时。
TEST：点击【测试】，只返回弹窗结果，不写种子记录，不推送，不写任务日志。
```

## 5. 状态和安全

- 同一个任务未结束时不允许重复启动。
- 手动【运行】需要限频。
- 【测试】需要限频，避免高频访问 PT 站点。
- 站点或下载器被禁用时真实任务不可运行，并记录明确错误。
- 测试只需要站点可用；下载器禁用不影响测试抓取。
- 站点绑定的代理不存在或已禁用时任务不可运行，并记录明确错误。
- 日志不输出 Cookie、密钥、密码、下载链接。
- 修改执行间隔需要最小值限制，最小 `10` 分钟（v0.5.0 后端实际最小值；前端表单限制 min=10）。
- 抓取数量需要在 1 到 1000 之间，超出范围返回校验错误。
- 删除任务不删除已抓取种子记录，只停止后续调度。
- 新建、编辑、打开开关、关闭开关、测试、运行和删除任务都需要写操作日志。

## 6. 设计稿

设计稿文件：`designs/tasks.svg`。

桌面端任务表格 + 新增/编辑弹窗 + 测试结果弹窗 + 任务日志入口。移动端任务卡片 + 表单全屏弹层 + 测试结果全屏弹层。

设计稿需要同步调整：列表和表单展示“自动执行开关”“下一次执行时间”“测试”“运行”，移除“添加后暂停”。

## 7. 执行清单

- 创建 `/tasks` 路由和页面。
- 实现任务列表。
- 实现新增和编辑任务表单。
- 实现站点和下载器下拉选择。
- 实现自动执行开关、下一次执行时间和运行来源展示。
- 实现 freeOnly、autoPush、免费类型范围、间隔时间等配置项。
- 实现打开和关闭自动执行开关。
- 实现测试按钮和测试结果弹窗。
- 实现运行按钮和真实任务执行流程。
- 实现删除任务。
- 实现任务日志跳转或查看入口，数据来自日志模块【任务日志】。
- 实现运行中 loading 和重复执行禁用。
- 后端实现任务锁、配置、调度、测试和运行接口。
- 后端实现自动执行开关计时和运行后重置 nextRunAt。
- 后端实现操作日志和任务日志脱敏。
- 后端将 AUTO、MANUAL_RUN 的抓取和推送结果写入种子模块数据表。
- 后端确保 TEST 不写种子记录、不推送、不写任务日志。
- 后端写入种子记录时保留来源任务 id、任务名称、目标下载器 id、目标下载器名称、sourceRunMode 和推送状态。

## 8. TODO

- [x] 生成 `designs/tasks.svg`。
- [x] 确认任务默认间隔：30 分钟。
- [x] 确认自动执行开关替代启用/暂停。
- [x] 确认测试按钮不写种子记录、不推送、不写任务日志。
- [x] 确认任务操作写入操作日志。
- [x] 确认抓取数量默认 100，可配置范围 1~1000。
- [ ] 确认手动运行和测试的限频时间。
- [ ] 确认 autoPush=false 时是否允许在种子模块批量补推。

## 9. 验收标准

- 可选择站点和下载器创建任务。
- 可设置任务执行间隔、自动执行开关、是否只抓免费和是否自动推送。
- 可在新增/编辑任务时设置抓取数量（默认 100，1~1000），控制每次从站点列表抓取的种子候选上限。
- 打开自动执行开关后，从打开时间开始按间隔分钟执行。
- 关闭自动执行开关后，不再自动计时执行。
- 点击【测试】能弹出抓取结果，且不产生种子记录、不推送、不写任务日志。
- 点击【运行】不管是否到执行时间都立即执行一次真实任务，并重新开始计时。
- 任务运行后种子模块能看到抓取记录、免费状态、来源运行模式和目标下载器。
- 真实任务执行记录能在日志模块【任务日志】中查看。
- 新建、编辑、开启、关闭、测试、运行和删除任务能在操作日志中查看。
- 运行中的任务不能重复启动。
- 可查看失败日志且敏感信息不泄露。

## 10. v0.5.0 实际实现差异

> 本节记录 `backend/src/routes/tasks.ts` 当前实现与上文的差异。

### 10.1 执行流程（实际）

`runTaskById(taskId, runMode)`：

```text
1. 内存 runningTaskIds Set + DB running=1 双重锁
2. 读取 task、site、downloader；site/downloader 禁用或缺失 → 直接失败
3. 标记 running=true, lastStartedAt=now, lastRunMode='AUTO'|'MANUAL_RUN'
4. AUTO 时写 RUNNING 调度日志
5. browseTorrents(site, '', 1, fetchLimit)        -> fetchedCount
6. sortCandidatesByRule(sortRule)                 -> 排序
7. siteId:torrentId 去重                          -> skippedExistingCount
8. matched = filter(discountTypes, sizeMinGb, sizeMaxGb, seederMin, seederMax)
9. 若 torrentCountCondition 设置，slice(0, torrentCount) -> matchedCount / pushableCount
10. 对每条 matched：
    - autoPush=false → 入库 pushStatus=NEW（不推送）
    - autoPush=true  → addTorrentUrlToQb 成功 → PUSHED；失败 → PUSH_FAILED
    - 复制 onlyFreeDownload / deleteOnFreeExpire / lowUploadKbps / lowUploadMinutes 到 torrent
    - 写 INSERTED + (PUSHED|PUSH_FAILED) 两条 torrent_logs
11. 批量 updateTaskFieldsInDb
12. 成功：running=false, lastStatus=SUCCESS, lastSummary, nextRunAt = autoRunEnabled ? now+interval : undefined
       写 SUCCESS task_log + AUTO schedule_log
13. 失败：lastStatus=FAILED, lastError
       写 FAILED task_log + AUTO schedule_log（fetchErrorMessage|pushErrorMessages|message）
14. finally：清除 runningTaskIds
```

### 10.2 run 与 test 区别

- `POST /api/tasks/:id/run`：调用 `runTaskById(id, 'MANUAL_RUN')`；**总是**从 now 重新计时（不管 nextRunAt）
- `POST /api/tasks/:id/test`：**不**走 `runTaskById`，而是单独的实现：
  - 仅 `browseTorrents → sort → 去重 → 过滤 → 截断`，**不写种子、不推送、不写 task_logs**
  - 写一条 `action=任务测试` 操作日志
  - 响应 `items[]` 每条带 `skippedExisting / matched / pushable` 三个布尔位供前端弹窗分组展示

### 10.3 启动残留重置

- `resetStuckRunningTasks({ source, thresholdMs })`：
  - 阈值默认 10 分钟
  - 找 `running=true && (lastStartedAt 未填 || NaN || now - lastStartedAt ≥ threshold) && 不在内存 runningTaskIds`
  - 改为 `running=false, lastStatus='FAILED'`，写 `task_log` 与 console warn
- 调用时机：`server.ts` 启动 + `task-stuck-check` 调度（每 60s）

### 10.4 默认值与校验（后端实测）

```text
intervalMinutes     整数 ≥ 10，默认 30
discountTypes       至少 1，默认 ['FREE','TWO_X_FREE']
seederMin/Max       整数 ≥ 0；同时 >0 时 min ≤ max
sizeMinGb/Max       整数 ≥ 0；同时 >0 时 min ≤ max
torrentCountCondition  ∈ GT|EQ|LT|''；设置时 torrentCount 整数 ≥ 1
fetchLimit          整数 1..1000，默认 100
lowUploadKbps       与 lowUploadMinutes 必须同时设置或同时为空；各自整数 ≥ 1
skipHitAndRun       布尔，默认 true（跳过 H3/H5/未完成 HR）；DB 列 DEFAULT 1
autoRunEnabled      true → nextRunAt = now + intervalMinutes
```

### 10.5 任务日志结构

`TaskLogRecord` 实际字段：

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

### 10.6 列表 & 详情

- `GET /api/tasks` 支持 `?keyword=&autoRun=`（autoRun 接受 `ON|OFF`）
- `GET /api/tasks/:id/logs?page=&pageSize=`：默认 20/页，最大 100
- 响应 `tasks.items` 不直接包含 `siteName` / `downloaderName` 字段（由前端 `loadOptions()` 加载 `getSites` + `getDownloaders` 后本地匹配）

### 10.7 操作日志动作名

- `TASK_CREATE` / `TASK_UPDATE` / `TASK_DELETE`
- `TASK_AUTO_RUN`（开关切换）
- `TASK_RUN`（手动运行）
- `TASK_TEST`（测试）
- 调度日志 `jobName ∈ 'task-auto-run-scan' | 'task-stuck-check' | ...`

### 10.8 TODO 状态

- [x] 任务 CRUD + 调度 + 测试 + 运行 + 自动执行
- [x] 抓取数量默认 100，1-1000
- [x] 测试不写种子记录 / 推送 / task_log
- [x] 启动 + watchdog 重置残留任务
- [x] 操作日志 / 调度日志记录
- [ ] 手动运行 / 测试的限频（当前未实现）
- [ ] `autoPush=false` 时批量补推入口（当前依赖 `POST /api/torrents/batch-push` 单独处理）
- [ ] `expiringSoonMinutes` 字段 UI 暴露（DB 仍保留）

### 10.9 HR 拦截（v0.5.x 增量）

抓取层和过滤层独立加 HR 拦截，与 `discountTypes` 解耦：

- `tasks` 表新增 `skip_hit_and_run INTEGER NOT NULL DEFAULT 1`（v21 迁移；老任务升级后默认勾选，行为变化需关注）。
- `TaskRecord` / `TaskPayload` 新增 `skipHitAndRun: boolean`；前端新增「HR 策略」独立复选框，默认勾选。
- 抓取层（`sites/nexusphp.ts`）：`parseNexusTorrentRows` / `parseNexusTorrentLinks` 加 `parseHitRunTags` 工具，识别：
  - CHDBits 专用 `<div class="circle-text">hN</div>` → 写入 `H3`/`H5` tag；
  - 通用 `H&R` / `hit and run` 文本 + 「未完成/未达标/未做种/未达到/未还种」 → 写入 `HR` tag；
  - 同上但带「已完成/已达标/已做种/已还种/completed/done」 → 写入 `HR_DONE` tag（过滤函数识别，**不**被拦截）。
- 过滤层（`tasks.ts`）：`hitRunFromBrowseItem(item)` 从 `tags` 中识别 H3/H5/HR；`matchedCandidates` 在原有过滤后追加 `task.skipHitAndRun && hitRunFromBrowseItem(item) !== null` 的二次过滤。
- `matchedCandidates` 改为返回 `{ matched, excludedByHitAndRun }` 以便 `runTaskById` 与 `testTask` 共享同一过滤管道。
- `runTaskById` 的 `lastSummary` 改为：`抓取 N，去重 M，命中 K（HR 排除 X），待入库 Z，推送 P，失败 Q`。
- `testTask` 响应新增 `excludedByHitAndRunCount` 与 `items[].excludedBy?: 'HIT_AND_RUN'`。
- 测试结果弹窗新增 `H&R 已过滤` badge 与 `HR 跳过 N 个` 统计；任务列表「抓取范围」概要加 `跳过 HR`。
- 设计权衡：H&R 优先于 FREE。HR 标记的免费种按 HR 处理——勾选 `skipHitAndRun` 即跳过，不勾即抓。`discountType` 仍只表达 `FREE/TWO_X_FREE/HALF_FREE/NORMAL` 四种，不污染既有语义。
