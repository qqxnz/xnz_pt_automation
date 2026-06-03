# 下载器模块方案

## 1. 模块目标

下载器模块负责配置种子下载工具连接信息、测试连接、查看下载器状态和当前任务。第一版支持 qBittorrent/QB，数据结构和接口需要保留 `type` 字段，后续可扩展 Transmission、Deluge 等下载器。

业务边界：本模块只管理下载器配置与状态，不处理 PT 站点访问、种子抓取规则和任务调度规则。

## 2. 页面和入口

页面路径：`/downloaders`

入口：左侧导航、首页风险提示、任务创建表单、种子推送失败提示。

核心链路：用户在本模块新增一个 QB 下载器后，可在任务模块选择该下载器作为推送目标。

## 3. 功能方案

下载器列表字段：

```text
名称
类型
服务地址
连接状态
当前上传速度
当前下载速度
默认保存路径
默认分类
默认标签
最近同步时间
操作
```

新增/编辑 QB 字段：

```text
下载器名称
类型：qBittorrent
服务地址
用户名
密码
默认保存路径
默认分类
默认标签
添加后是否暂停
是否启用
```

页面区域：

- 下载器列表和新增按钮。
- 新增/编辑下载器弹窗。
- 连接测试结果。
- 传输状态：上传速度、下载速度、总上传、总下载。
- 当前任务列表：名称、大小、进度、状态、分享率、分类、标签。

## 4. 接口和数据

接口：

```text
GET    /api/downloaders
POST   /api/downloaders
GET    /api/downloaders/:id
PUT    /api/downloaders/:id
DELETE /api/downloaders/:id
POST   /api/downloaders/:id/test
GET    /api/downloaders/:id/status
GET    /api/downloaders/:id/torrents
```

配置：

```ts
type DownloaderType = 'QBITTORRENT'

type DownloaderConfig = {
  id: string
  name: string
  type: DownloaderType
  enabled: boolean
  host: string
  username: string
  password?: string
  savePath?: string
  category?: string
  tags?: string[]
  paused?: boolean
  status: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  lastSyncedAt?: string
}
```

保存规则：密码留空表示不修改旧密码；清空密码必须提供明确操作。删除下载器前需要检查是否被任务引用，被引用时禁止删除并提示引用任务。

## 5. 状态和安全

- 密码不明文回显。
- 测试连接时按钮 loading，禁止重复提交。
- 接口错误需要区分认证失败、网络失败、地址无效和下载器类型不支持。
- 日志不打印用户名、密码、Cookie、密钥和完整下载链接。
- 任务引用中的下载器被禁用后，任务运行时需要跳过并记录错误。

## 6. 设计稿

设计稿文件：待生成 `designs/downloaders.svg`。

桌面端左侧列表 + 右侧状态详情，下方展示下载器任务表格；新增/编辑使用弹窗。移动端列表、状态、任务按纵向卡片排列。

## 7. 执行清单

- 创建 `/downloaders` 路由和页面。
- 实现下载器列表、新增、编辑、删除。
- 实现 QB 配置读取和保存。
- 实现密码脱敏和留空不修改。
- 实现连接测试。
- 实现传输状态展示。
- 实现下载器任务列表展示。
- 实现被任务引用时的删除拦截。
- 实现 loading、空状态和错误提示。
- 后端实现下载器抽象接口和 QB API Client。
- 后端实现配置加密存储。
- 后端实现连接测试和状态同步接口。

## 8. TODO

- [ ] 生成 `designs/downloaders.svg`。
- [ ] 确认默认保存路径是否必填。
- [ ] 确认分类和标签默认值。
- [ ] 确认连接测试超时时间。
- [ ] 确认后续下载器类型的适配接口。

## 9. 验收标准

- 可新增一个 QB 下载器并保存。
- 可在任务模块选择已启用下载器。
- 密码不明文回显。
- 可测试连接并展示明确结果。
- 可展示传输速度和下载器任务列表。
- 配置错误时有明确错误提示。
