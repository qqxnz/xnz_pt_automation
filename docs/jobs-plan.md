# 定时任务模块方案

## 1. 模块目标

定时任务模块负责展示任务配置、运行状态、手动执行和任务日志。

业务边界：本模块管理任务调度和日志，不实现具体业务任务内部逻辑。

## 2. 页面和入口

页面路径：`/jobs`

入口：左侧导航、首页最近任务。

## 3. 功能方案

任务列表：

```text
任务名称
启用状态
执行间隔
最近执行时间
最近结果
运行中状态
操作
```

任务：`sync-free-torrents`、`push-free-torrents`、`check-free-expired`、`sync-site-traffic`、`sync-qb-status`。

操作：启用、禁用、修改间隔、手动运行、查看日志。

## 4. 接口和数据

接口：

```text
GET  /api/jobs
POST /api/jobs/:name/run
PUT  /api/jobs/:name/config
GET  /api/jobs/:name/logs?page=&pageSize=
```

任务项：

```ts
type JobItem = {
  name: string
  enabled: boolean
  intervalMinutes: number
  running: boolean
  lastStartedAt?: string
  lastFinishedAt?: string
  lastStatus?: 'SUCCESS' | 'FAILED'
  lastError?: string
}
```

## 5. 状态和安全

- 同一个任务未结束时不允许重复启动。
- 手动执行需要限频。
- 日志不输出 Cookie、密钥、密码、下载链接。
- 修改执行间隔需要最小值限制，避免高频访问 PT 站点。

## 6. 设计稿

设计稿文件：待生成 `designs/jobs.svg`。

桌面端任务表格 + 日志抽屉。移动端任务卡片 + 日志全屏弹层。

## 7. 执行清单

- 创建 `/jobs` 路由和页面。
- 实现任务列表。
- 实现启用和禁用任务。
- 实现修改任务间隔。
- 实现手动运行任务。
- 实现任务日志查看和分页。
- 实现运行中 loading 和重复执行禁用。
- 后端实现任务锁、配置和日志接口。
- 后端实现日志脱敏。

## 8. TODO

- [ ] 生成 `designs/jobs.svg`。
- [ ] 确认各任务默认间隔。
- [ ] 确认手动执行限频时间。

## 9. 验收标准

- 可查看任务状态和最近结果。
- 运行中的任务不能重复启动。
- 可修改任务间隔。
- 可查看失败日志且敏感信息不泄露。
