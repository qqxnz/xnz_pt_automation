# qBittorrent 模块方案

## 1. 模块目标

qBittorrent 模块负责配置下载器连接信息、测试连接、查看下载器状态和当前任务。

业务边界：本模块只处理 qBittorrent 配置与状态，不处理 PT 站点访问和种子抓取规则。

## 2. 页面和入口

页面路径：`/qbittorrent`

入口：左侧导航、首页风险提示、免费种子推送失败提示。

## 3. 功能方案

配置字段：

```text
服务地址
用户名
密码
默认保存路径
默认分类
默认标签
添加后是否暂停
```

页面区域：

- 连接配置表单。
- 连接测试结果。
- 传输状态：上传速度、下载速度、总上传、总下载。
- 当前任务列表：名称、大小、进度、状态、分享率、分类、标签。

## 4. 接口和数据

接口：

```text
GET  /api/qb/config
PUT  /api/qb/config
POST /api/qb/test
GET  /api/qb/status
GET  /api/qb/torrents
```

配置：

```ts
type QbittorrentConfig = {
  host: string
  username: string
  password?: string
  savePath?: string
  category?: string
  tags?: string[]
  paused?: boolean
}
```

保存规则：密码留空表示不修改旧密码；清空密码必须提供明确操作。

## 5. 状态和安全

- 密码不明文回显。
- 测试连接时按钮 loading，禁止重复提交。
- 接口错误需要区分认证失败、网络失败、地址无效。
- 日志不打印用户名密码和完整下载链接。

## 6. 设计稿

设计稿文件：待生成 `designs/qbittorrent.svg`。

桌面端左侧配置表单，右侧连接状态和传输状态，下方任务表格。移动端配置、状态、任务按卡片纵向排列。

## 7. 执行清单

- 创建 `/qbittorrent` 路由和页面。
- 实现配置读取和保存。
- 实现密码脱敏和留空不修改。
- 实现连接测试。
- 实现传输状态展示。
- 实现任务列表展示。
- 实现 loading、空状态和错误提示。
- 后端实现 qB API Client。
- 后端实现配置加密存储。
- 后端实现连接测试和状态同步接口。

## 8. TODO

- [ ] 生成 `designs/qbittorrent.svg`。
- [ ] 确认默认保存路径是否必填。
- [ ] 确认分类和标签默认值。
- [ ] 确认连接测试超时时间。

## 9. 验收标准

- 可保存 qBittorrent 配置。
- 密码不明文回显。
- 可测试连接并展示明确结果。
- 可展示传输速度和任务列表。
- 配置错误时有明确错误提示。
