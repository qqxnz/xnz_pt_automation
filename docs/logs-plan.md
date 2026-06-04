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
  |-- 操作日志
  |-- 任务日志
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
GET /api/logs?type=operation&page=&pageSize=&keyword=&status=&startAt=&endAt=
GET /api/logs?type=task&page=&pageSize=&keyword=&status=&taskId=&runMode=&startAt=&endAt=
```

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

## 7. 执行清单

- 将前端任务日志 Tab 文案统一为【任务日志】。
- 将任务日志空状态统一为【暂无任务日志】。
- 实现任务日志字段展示：运行来源、抓取数量、命中数量、推送成功数量、推送失败数量、摘要和报错信息。
- 实现任务日志筛选：任务、运行来源、状态、关键词和时间范围。
- 后端扩展 TaskLog 数据结构。
- 后端记录 AUTO 和 MANUAL_RUN 的真实任务执行日志。
- 后端确保 TEST 不写任务日志。
- 后端记录任务操作到操作日志。
- 后端实现日志脱敏。

## 8. TODO

- [x] 明确旧任务日志命名更名为【任务日志】。
- [x] 明确测试按钮不写任务日志。
- [x] 明确任务操作写操作日志。
- [ ] 补充 `designs/logs.svg`。
- [ ] 确认任务日志保留周期是否沿用系统设置默认 60 天。

## 9. 验收标准

- 日志页显示【操作日志】和【任务日志】两个 Tab。
- 前端不再出现旧任务日志命名。
- 点击任务测试只产生操作日志，不产生任务日志。
- 自动执行和手动运行都会产生任务日志。
- 任务日志能查看执行时间、抓取结果、推送结果和执行报错信息。
- 日志内容不泄露 Cookie、密钥、密码、passkey 和完整下载链接。
