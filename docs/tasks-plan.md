# 任务模块方案

## 1. 模块目标

任务模块负责创建、展示和运行用户配置的抓取推送任务。用户选择一个站点、一个下载器，设定执行间隔、是否只抓免费、是否自动推送、保存路径等规则后，系统按任务配置定时抓取站点种子并推送到下载器。

业务边界：本模块管理任务规则、调度状态和任务日志；具体站点凭证由站点模块维护，下载器连接由下载器模块维护，抓取到的种子记录由种子模块展示。

## 2. 页面和入口

页面路径：`/tasks`

入口：左侧导航、首页最近任务、站点详情页快捷创建入口。

核心链路：先在站点模块新增站点，再在下载器模块新增 QB 下载器，然后在本模块选择站点和下载器并创建任务，最后到种子模块查看抓取和推送结果。

## 3. 功能方案

任务列表字段：

```text
任务名称
站点
下载器
启用状态
执行间隔
抓取范围
自动推送
最近执行时间
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
是否只抓免费
是否自动推送到下载器
免费类型范围：FREE、TWO_X_FREE、HALF_FREE
即将过期阈值
保存路径覆盖
分类覆盖
标签覆盖
添加后是否暂停
启用状态
```

操作：新增、编辑、启用、禁用、修改间隔、手动运行、查看日志、删除。

## 4. 接口和数据

接口：

```text
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
PUT    /api/tasks/:id
DELETE /api/tasks/:id
POST   /api/tasks/:id/run
GET    /api/tasks/:id/logs?page=&pageSize=
```

任务项：

```ts
type TaskItem = {
  id: string
  name: string
  siteId: string
  siteName: string
  downloaderId: string
  downloaderName: string
  enabled: boolean
  intervalMinutes: number
  freeOnly: boolean
  autoPush: boolean
  discountTypes: Array<'FREE' | 'TWO_X_FREE' | 'HALF_FREE'>
  expiringSoonMinutes?: number
  savePathOverride?: string
  categoryOverride?: string
  tagsOverride?: string[]
  paused?: boolean
  running: boolean
  lastStartedAt?: string
  lastFinishedAt?: string
  lastStatus?: 'SUCCESS' | 'FAILED'
  lastSummary?: string
  lastError?: string
}
```

运行流程：

```text
任务触发
  |
读取任务绑定站点和下载器
  |
使用站点保存的 User-Agent 和可选代理抓取种子
  |
按 freeOnly、discountTypes、过期阈值过滤
  |
写入或更新种子记录
  |
autoPush=true 时推送到任务绑定下载器
  |
记录目标下载器、torrent hash、推送状态和任务日志
```

## 5. 状态和安全

- 同一个任务未结束时不允许重复启动。
- 手动执行需要限频。
- 站点或下载器被禁用时任务不可运行，并记录明确错误。
- 站点绑定的代理不存在或已禁用时任务不可运行，并记录明确错误。
- 日志不输出 Cookie、密钥、密码、下载链接。
- 修改执行间隔需要最小值限制，避免高频访问 PT 站点。
- 删除任务不删除已抓取种子记录，只停止后续调度。

## 6. 设计稿

设计稿文件：`designs/tasks.svg`。

桌面端任务表格 + 新增/编辑弹窗 + 日志抽屉。移动端任务卡片 + 表单全屏弹层 + 日志全屏弹层。

## 7. 执行清单

- 创建 `/tasks` 路由和页面。
- 实现任务列表。
- 实现新增和编辑任务表单。
- 实现站点和下载器下拉选择。
- 实现 freeOnly、autoPush、免费类型范围、间隔时间等配置项。
- 实现启用、禁用、删除任务。
- 实现手动运行任务。
- 实现任务日志查看和分页。
- 实现运行中 loading 和重复执行禁用。
- 后端实现任务锁、配置、调度和日志接口。
- 后端实现日志脱敏。
- 后端将抓取和推送结果写入种子模块数据表。

## 8. TODO

- [x] 生成 `designs/tasks.svg`。
- [ ] 确认任务默认间隔，推荐 30 分钟。
- [ ] 确认手动执行限频时间。
- [ ] 确认 autoPush=false 时是否允许在种子模块批量补推。

## 9. 验收标准

- 可选择站点和下载器创建任务。
- 可设置任务执行间隔、是否只抓免费和是否自动推送。
- 任务运行后种子模块能看到抓取记录、免费状态和目标下载器。
- 运行中的任务不能重复启动。
- 可修改任务间隔。
- 可查看失败日志且敏感信息不泄露。
