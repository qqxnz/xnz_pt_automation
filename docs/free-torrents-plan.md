# 免费种子模块方案

## 1. 模块目标

免费种子模块负责展示各站点抓取到的免费种子，支持筛选、查看状态、单个推送、批量推送和删除 qBittorrent 任务。

业务边界：本模块只管理已抓取入库的种子记录和推送操作，不负责站点配置、下载器配置和定时任务配置。

## 2. 页面和入口

页面路径：`/free-torrents`

入口：左侧导航、首页快捷操作、站点同步完成后的跳转入口。

跳转：点击站点名进入 `/sites` 并带站点筛选；点击 qB 状态可进入 `/qbittorrent`。

## 3. 功能方案

列表字段：

```text
站点
标题
大小
免费类型
免费结束时间
剩余免费时间
做种数
下载数
推送状态
qBittorrent 状态
失败原因
操作
```

筛选项：

- 关键词
- 站点
- 免费类型：全部、FREE、TWO_X_FREE、HALF_FREE
- 推送状态：全部、待推送、已推送、推送失败、已删除
- 免费状态：全部、免费中、即将过期、已过期

操作：

- 单个推送到 qBittorrent。
- 批量推送选中的待推送种子。
- 删除 qBittorrent 任务。
- 查看失败原因。
- 刷新列表。

## 4. 接口和数据

接口：

```text
GET  /api/torrents?keyword=&siteId=&discountType=&status=&freeState=&page=&pageSize=
GET  /api/torrents/:id
POST /api/torrents/:id/push
POST /api/torrents/:id/delete-from-qb
POST /api/torrents/batch-push
```

列表项：

```ts
type TorrentListItem = {
  id: string
  siteId: string
  siteName: string
  title: string
  size: number
  discountType: 'FREE' | 'TWO_X_FREE' | 'HALF_FREE'
  freeEndAt?: string
  seeders?: number
  leechers?: number
  status: 'NEW' | 'PUSHED' | 'PUSH_FAILED' | 'DELETED'
  qbState?: string
  torrentHash?: string
  errorMessage?: string
}
```

错误处理：推送失败时记录失败原因，不删除原种子记录；批量推送需要返回成功数、失败数和失败明细。

## 5. 状态和安全

- torrent 下载链接不在列表中明文展示。
- 操作按钮 loading 期间禁止重复点击。
- 已过期种子允许展示但默认不推送，除非后端允许。
- 删除 qB 任务前需要二次确认，并明确是否删除文件。
- 空状态提示用户先配置站点并同步免费种子。

## 6. 设计稿

设计稿文件：待生成 `designs/free-torrents.svg`。

桌面端使用筛选区 + 表格 + 分页。移动端使用筛选折叠区 + 种子卡片列表。

## 7. 执行清单

- 创建 `/free-torrents` 路由和页面。
- 实现免费种子 API 客户端。
- 实现列表、分页、筛选和刷新。
- 实现剩余免费时间计算和即将过期样式。
- 实现单个推送和批量推送。
- 实现删除 qB 任务二次确认。
- 实现失败原因查看。
- 实现空状态、loading 和接口错误状态。
- 后端实现查询、详情、单推、批推和删除接口。
- 后端记录推送结果和失败原因。

## 8. TODO

- [ ] 生成 `designs/free-torrents.svg`。
- [ ] 确认即将过期阈值，推荐 2 小时。
- [ ] 确认已过期种子是否允许手动推送。
- [ ] 确认删除 qB 任务是否支持删除文件选项。

## 9. 验收标准

- 可按站点、状态、关键词筛选种子。
- 可单个和批量推送待推送种子。
- 推送失败可查看明确失败原因。
- 删除 qB 任务前有二次确认。
- 移动端不出现横向宽表格。
