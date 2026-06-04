# 种子模块方案

## 1. 模块目标

种子模块负责展示各站点按任务规则抓取到的种子记录，记录种子名称、站点、大小、当前状态、种链接、来源任务名称、推送给了哪个下载器等信息，支持筛选、查看当前是否免费、查看推送到哪个下载器、单个推送、批量推送和删除下载器任务。

业务边界：本模块只管理已抓取入库的种子记录和推送操作，不负责站点配置、下载器配置和任务规则配置。种链接用于后端推送和详情跳转，列表中默认不明文展示下载链接。任务模块【测试】按钮的抓取结果只在测试结果弹窗展示，不写入本模块。

## 2. 页面和入口

页面路径：`/torrents`

入口：左侧导航、首页快捷操作、任务执行完成后的跳转入口。

跳转：点击站点名进入 `/sites` 并带站点筛选；点击下载器名进入 `/downloaders` 并定位下载器。

核心链路：任务自动执行或用户点击【运行】后，系统抓取站点种子并按配置推送到下载器，用户在本模块查看种子名称、站点、大小、当前状态、来源任务、来源运行模式、目标下载器和失败原因。

## 3. 功能方案

列表字段：

```text
站点
种子名称
大小
优惠类型
当前是否免费
当前状态
免费结束时间
剩余免费时间
做种数
下载数
推送状态
种链接状态
目标下载器
下载器任务状态
下载器任务 Hash
失败原因
抓取任务
任务名称
来源运行模式
操作
```

字段口径：

```text
种子名称：站点解析出的种子标题，作为列表主标题。
站点：来源站点名称和 siteId，用于筛选和跳转站点模块。
大小：以字节持久化，前端格式化为 GiB、MiB 等。
当前状态：综合免费状态、推送状态和下载器任务状态生成，例如待推送、已推送、推送失败、免费中、即将过期、已过期、下载器已删除。
种链接状态：只显示已保存、缺失或失效，不在列表展示完整下载 URL。
任务名称：抓取该记录的来源任务名称；任务被删除后仍保留快照名称。
来源运行模式：AUTO 表示自动执行产生，MANUAL_RUN 表示用户点击【运行】产生；TEST 不写入种子记录。
目标下载器：任务自动推送或手动推送选择的下载器名称；下载器被删除后仍保留快照名称。
```

筛选项：

- 关键词
- 站点
- 下载器
- 优惠类型：全部、FREE、TWO_X_FREE、HALF_FREE、NORMAL
- 免费状态：全部、免费中、即将过期、已过期、非免费
- 推送状态：全部、待推送、已推送、推送失败、已删除
- 当前状态：全部、待推送、已推送、推送失败、下载器已删除、免费中、即将过期、已过期
- 来源任务

操作：

- 单个推送到指定下载器。
- 批量推送选中的待推送种子。
- 删除下载器任务。
- 查看失败原因。
- 查看详情，展示种子记录、来源任务、种链接脱敏信息和推送历史。
- 刷新列表。

## 4. 接口和数据

接口：

```text
GET  /api/torrents?keyword=&siteId=&downloaderId=&taskId=&discountType=&pushStatus=&freeState=&currentState=&page=&pageSize=
GET  /api/torrents/:id
POST /api/torrents/:id/push
POST /api/torrents/:id/delete-from-downloader
POST /api/torrents/batch-push
```

详情接口需要返回脱敏后的链接展示信息和推送历史；完整下载链接只允许后端用于下载 torrent 文件或提交下载器，不直接返回给列表接口。

列表项：

```ts
type TorrentListItem = {
  id: string
  siteId: string
  siteName: string
  torrentId?: string
  title: string
  size: number
  discountType: 'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'
  isFreeNow: boolean
  currentState: 'NEW' | 'FREE_NOW' | 'EXPIRING_SOON' | 'EXPIRED' | 'PUSHED' | 'PUSH_FAILED' | 'DOWNLOADER_DELETED'
  freeEndAt?: string
  seeders?: number
  leechers?: number
  pushStatus: 'NEW' | 'PUSHED' | 'PUSH_FAILED' | 'DELETED'
  linkStatus: 'SAVED' | 'MISSING' | 'INVALID'
  detailUrl?: string
  downloaderId?: string
  downloaderName?: string
  downloaderType?: 'QBITTORRENT'
  downloaderState?: string
  torrentHash?: string
  sourceTaskId?: string
  sourceTaskName?: string
  sourceRunMode: 'AUTO' | 'MANUAL_RUN'
  errorMessage?: string
  firstSeenAt: string
  lastSeenAt: string
  pushedAt?: string
}
```

持久化字段：

```ts
type TorrentRecord = TorrentListItem & {
  downloadUrlEncrypted?: string
  downloadUrlHash?: string
  detailUrl?: string
  targetDownloaderId?: string
  targetDownloaderName?: string
  sourceTaskNameSnapshot?: string
  downloaderNameSnapshot?: string
}
```

错误处理：推送失败时记录失败原因，不删除原种子记录；批量推送需要返回成功数、失败数和失败明细。

写入规则：

```text
AUTO 自动执行：写入或更新种子记录，sourceRunMode=AUTO。
MANUAL_RUN 点击运行：写入或更新种子记录，sourceRunMode=MANUAL_RUN。
TEST 点击测试：不写入种子记录，不影响种子统计，不进入推送历史。
```

## 5. 状态和安全

- torrent 下载链接不在列表中明文展示。
- downloadUrl 需要加密或按敏感字段存储，日志和接口错误中不得输出完整链接。
- detailUrl 可用于详情页跳转；如果包含 passkey 或 token，需要按敏感链接处理并脱敏展示。
- 操作按钮 loading 期间禁止重复点击。
- 已过期种子允许展示但默认不推送，除非后端策略允许。
- 删除下载器任务前需要二次确认，并明确是否删除文件。
- 空状态提示用户先配置站点、下载器并创建任务。
- 来源任务或目标下载器被删除后，种子记录不删除，继续展示快照名称和已删除状态。
- 任务测试结果不进入种子列表、统计和推送历史。

## 6. 设计稿

设计稿文件：`designs/torrents.svg`。

桌面端使用筛选区 + 表格 + 分页。移动端使用筛选折叠区 + 种子卡片列表。

## 7. 执行清单

- 创建 `/torrents` 路由和页面。
- 实现种子 API 客户端。
- 实现列表、分页、筛选和刷新。
- 实现来源任务筛选和当前状态筛选。
- 实现当前是否免费、剩余免费时间和即将过期样式。
- 实现种子名称、站点、大小、当前状态、种链接状态、来源任务名称、来源运行模式和目标下载器展示。
- 实现目标下载器展示和跳转。
- 实现单个推送和批量推送。
- 实现删除下载器任务二次确认。
- 实现失败原因查看。
- 实现详情弹窗，展示种子记录详情、脱敏链接信息和推送历史。
- 实现空状态、loading 和接口错误状态。
- 后端实现查询、详情、单推、批推和删除接口。
- 后端记录种子名称、站点、大小、当前状态、下载链接、详情链接、来源任务 id、来源任务名称、目标下载器、下载器任务 hash 和失败原因。
- 后端记录 sourceRunMode，并确保只允许 AUTO 和 MANUAL_RUN 写入种子记录。
- 后端确保 TEST 测试结果不写种子记录、不进入推送历史。
- 后端实现下载链接敏感存储、日志脱敏和列表接口隐藏完整下载链接。

## 8. TODO

- [x] 生成 `designs/torrents.svg`。
- [x] 明确种子记录字段：名称、站点、大小、当前状态、种链接、任务名称、目标下载器。
- [x] 明确测试结果不写入种子记录。
- [ ] 确认即将过期阈值，推荐 2 小时。
- [ ] 确认已过期种子是否允许手动推送。
- [ ] 确认删除下载器任务是否支持删除文件选项。

## 9. 验收标准

- 可按站点、下载器、免费状态、推送状态和关键词筛选种子。
- 可查看种子当前是否免费。
- 可查看种子名称、站点、大小、当前状态、来源任务名称、来源运行模式和种链接保存状态。
- 可查看种子推送到了哪个下载器。
- 点击任务测试不会新增或更新种子记录。
- 可单个和批量推送待推送种子。
- 推送失败可查看明确失败原因。
- 删除下载器任务前有二次确认。
- 移动端不出现横向宽表格。
