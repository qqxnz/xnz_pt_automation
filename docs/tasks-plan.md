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
执行间隔分钟
自动执行开关
是否只抓免费
是否自动推送到下载器
免费类型范围：FREE、TWO_X_FREE、HALF_FREE
抓取数量
排序规则
入库数量
种子体积范围（GB）
做种人数条件
即将过期阈值
保存路径覆盖
分类覆盖
标签覆盖
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
执行间隔分钟：默认 30，最小 30，必须为正整数
自动执行开关：默认关闭；打开后从打开时间开始计时
是否只抓免费：默认开启
是否自动推送到下载器：默认开启
免费类型范围：默认 FREE、TWO_X_FREE、HALF_FREE 全选
抓取数量：默认 100，整数，1 到 1000 之间，控制每次从站点列表抓取的种子候选上限；后端调用站点抓取时按此值请求 pageSize
排序规则：默认不排序（按抓取顺序），可选做种人数升降序、发布时间升降序、种子体积升降序
入库数量：默认 0（不限制），按任务过滤规则命中后取前 N 个入库
即将过期阈值：默认 120 分钟
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

`POST /api/tasks/:id/test` 响应：

```ts
type TaskTestResult = {
  taskId: string
  taskName: string
  siteId: string
  siteName: string
  fetchedCount: number
  matchedCount: number
  items: Array<{
    title: string
    size: number
    discountType: 'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'
    isFreeNow: boolean
    freeEndAt?: string
    seeders?: number
    leechers?: number
    linkStatus: 'SAVED' | 'MISSING' | 'INVALID'
  }>
  errorMessage?: string
}
```

任务项：

```ts
type TaskRunMode = 'AUTO' | 'MANUAL_RUN' | 'TEST'

type TaskItem = {
  id: string
  name: string
  siteId: string
  siteName: string
  downloaderId: string
  downloaderName: string
  autoRunEnabled: boolean
  autoRunStartedAt?: string
  nextRunAt?: string
  intervalMinutes: number
  freeOnly: boolean
  autoPush: boolean
  discountTypes: Array<'FREE' | 'TWO_X_FREE' | 'HALF_FREE'>
  fetchLimit?: number
  sortRule?: 'SEEDERS_ASC' | 'SEEDERS_DESC' | 'CREATED_DESC' | 'CREATED_ASC' | 'SIZE_DESC' | 'SIZE_ASC'
  torrentCountCondition?: 'GT' | 'EQ' | 'LT'
  torrentCount?: number
  seederMin?: number
  seederMax?: number
  sizeMinGb?: number
  sizeMaxGb?: number
  expiringSoonMinutes?: number
  savePathOverride?: string
  categoryOverride?: string
  tagsOverride?: string[]
  running: boolean
  lastRunMode?: Exclude<TaskRunMode, 'TEST'>
  lastStartedAt?: string
  lastFinishedAt?: string
  lastStatus?: 'SUCCESS' | 'FAILED'
  lastSummary?: string
  lastError?: string
}
```

创建任务请求如果没有传 `intervalMinutes`，后端需要写入 `30`；编辑任务时如果传入小于 `30` 的值，接口返回校验错误。旧字段 `enabled` 和 `paused` 不再使用，迁移时按 `autoRunEnabled = enabled && !paused` 兼容一次。

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
- 修改执行间隔需要最小值限制，最小 `30` 分钟。
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
