# 站点模块方案

## 1. 文档依据

本方案基于以下本地文档整理：

- `README.md`
- `docs/pt-automation-technical-design.md`
- `docs/ui-design-login-sites.md`
- `designs/design-spec.md`

## 2. 模块目标

站点模块负责 PT 站点配置、凭证维护、代理策略、启停控制和连通性检测。

交付结果：

- `/sites` 站点页面
- 站点列表和筛选
- 新增站点
- 编辑站点
- 删除站点
- 启用和禁用站点
- 测试站点连通性
- 同步种子和同步流量统计入口
- 桌面表格和移动卡片布局

## 3. 功能方案

站点路径为 `/sites`。

列表功能：

- 站点统计卡片。
- 关键词搜索。
- 连通状态筛选。
- 代理模式筛选。
- 启用状态筛选。
- 桌面表格展示。
- 移动卡片展示。

列表字段：

```text
站点名称
启用状态
连通状态
当前凭证
代理模式
最近成功连接
最近失败原因
操作
```

操作：

- 新增站点。
- 编辑站点。
- 删除站点，删除前二次确认。
- 启用或禁用站点。
- 测试连通性。
- 同步种子。
- 同步流量统计。

## 4. 新增和编辑

设计稿文件：`designs/sites-form.svg`

桌面端使用弹窗，移动端使用全屏弹层。新增和编辑共用同一个表单。

表单结构：

```text
基础信息
  站点名称
  站点地址
  启用状态
  解析类型

访问凭证
  站点密钥
  Cookie
  User-Agent

抓取配置
  种子地址
  个人信息地址
  检查间隔

代理配置
  代理模式
  指定代理

底部操作
  取消
  保存并测试
  保存
```

表单类型：

```ts
type SiteForm = {
  name: string
  baseUrl: string
  enabled: boolean
  accessKey?: string
  cookie?: string
  userAgent?: string
  parserType: 'NEXUSPHP'
  freeTorrentUrl: string
  profileUrl?: string
  proxyMode: 'NONE' | 'GLOBAL' | 'CUSTOM'
  proxyId?: string
  checkIntervalMinutes: number
}
```

校验规则：

- 站点名称必填。
- 站点地址必填且必须是 URL。
- 站点密钥和 Cookie 至少填写一个。
- `proxyMode` 为 `CUSTOM` 时必须选择指定代理。
- 检查间隔最小 5 分钟。
- 编辑时敏感字段默认展示为脱敏占位，不返回明文。

保存规则：

- 点击保存：校验表单，调用新增或编辑接口，成功后关闭弹窗并刷新列表。
- 点击保存并测试：先保存配置，再调用连通性测试接口，并展示最终访问方式。
- 新增成功但测试失败时保留站点配置，并展示错误原因。
- 编辑敏感字段留空时表示不修改原值。
- 清空敏感字段需要明确操作，不能因为输入框留空而误删原值。

保存并测试结果：

```text
连接成功，当前使用密钥访问
连接成功，密钥失败，已使用 Cookie 访问
连接失败，代理不可用
认证失败，密钥和 Cookie 都不可用
```

## 5. 状态和接口

状态展示：

```text
ONLINE       在线       绿色
OFFLINE      离线       红色
AUTH_FAILED  认证失败   橙色
UNKNOWN      未检测     灰色
```

当前凭证展示：

```text
ACCESS_KEY  密钥
COOKIE      Cookie
NONE        无可用凭证
```

代理模式展示：

```text
NONE    不代理
GLOBAL  全局代理
CUSTOM  自定义代理
```

接口：

```text
GET    /api/sites?keyword=&connectivityStatus=&proxyMode=&enabled=&page=&pageSize=
POST   /api/sites
GET    /api/sites/:id
PUT    /api/sites/:id
DELETE /api/sites/:id
POST   /api/sites/:id/test-connectivity
POST   /api/sites/:id/sync-torrents
POST   /api/sites/:id/sync-traffic
```

列表项：

```ts
type SiteListItem = {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  connectivityStatus: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  currentAccessMethod?: 'ACCESS_KEY' | 'COOKIE'
  proxyMode: 'NONE' | 'GLOBAL' | 'CUSTOM'
  proxyName?: string
  lastConnectedAt?: string
  lastConnectError?: string
}
```

连通性测试返回：

```ts
type TestSiteConnectivityResponse = {
  ok: boolean
  status: 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  accessMethod?: 'ACCESS_KEY' | 'COOKIE'
  usedProxy: boolean
  errorMessage?: string
}
```

## 6. 设计稿

设计稿文件：

- `designs/sites.svg`
- `designs/sites-form.svg`

桌面端：

- 顶部展示站点标题和新增站点按钮。
- 使用统计卡片展示全部、在线、认证失败、离线、未知状态。
- 使用筛选区承载关键词、状态、代理模式、启用状态和刷新按钮。
- 使用表格展示站点列表。

移动端：

- 顶部展示页面标题和新增入口。
- 筛选项垂直或两列排列。
- 使用卡片展示站点信息。
- 快捷操作展示测试、编辑、更多。

## 7. 执行清单

- 创建 `/sites` 路由。
- 创建 `SitesPage.vue`。
- 创建站点 API 客户端。
- 实现站点列表查询。
- 实现关键词筛选。
- 实现连通状态筛选。
- 实现代理模式筛选。
- 实现启用状态筛选。
- 实现顶部统计卡片。
- 桌面端使用表格展示站点。
- 移动端使用卡片展示站点。
- 实现新增站点入口。
- 实现编辑站点入口。
- 实现新增和编辑共用表单。
- 实现 `SiteForm` 表单组件。
- 实现敏感字段脱敏占位。
- 实现站点名称必填校验。
- 实现站点地址 URL 校验。
- 实现密钥和 Cookie 至少一个的校验。
- 实现自定义代理必选校验。
- 实现检查间隔最小值校验。
- 实现保存。
- 实现保存并测试。
- 实现启用和禁用站点。
- 实现删除二次确认。
- 实现测试连通性按钮和结果提示。
- 实现同步种子按钮。
- 实现同步流量统计按钮。
- 实现失败原因完整查看。
- 实现无站点空状态。
- 实现全部离线提示。
- 实现认证失败提示。
- 后端实现站点 CRUD。
- 后端实现敏感字段加密存储。
- 后端实现密钥优先、Cookie 兜底连通性测试。
- 后端记录连通性日志。

## 8. TODO

- [ ] 确认第一版支持的 `parserType` 是否只有 `NEXUSPHP`。
- [ ] 确认 `accessKey` 的具体含义是否等同于 passkey。
- [ ] 确认编辑时清空密钥或 Cookie 的交互方式。
- [ ] 确认 `profileUrl` 是否第一版必填。
- [ ] 确认代理列表接口是否在站点模块前完成。
- [ ] 确认“同步种子”和“同步流量统计”第一版是否只触发任务，不展示任务详情。

## 9. 验收标准

- 可新增站点，保存后列表刷新。
- 可编辑站点，敏感字段不明文回显。
- 可删除站点，删除前有二次确认。
- 可启用和禁用站点。
- 连通性测试能展示最终状态和访问方式。
- 密钥和 Cookie 至少一个为空校验生效。
- 自定义代理未选择代理时不能保存。
- 最近失败原因过长时可查看完整内容。
- 无站点时展示空状态和新增入口。
- 移动端不出现横向宽表格。

## 10. 开发补充规范

页面入口和跳转：

- `/sites` 使用后台主布局。
- URL 查询参数需要支持 `keyword`、`connectivityStatus`、`proxyMode`、`enabled`，便于从首页风险提示跳转。
- 从首页“新增站点”进入时可使用 `?action=create` 打开新增弹窗。

前端状态：

```ts
type SitesState = {
  items: SiteListItem[]
  total: number
  loading: boolean
  filters: SiteFilter
  formVisible: boolean
  editingSiteId?: string
}
```

筛选类型：

```ts
type SiteFilter = {
  keyword?: string
  connectivityStatus?: 'ALL' | 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  proxyMode?: 'ALL' | 'NONE' | 'GLOBAL' | 'CUSTOM'
  enabled?: 'ALL' | 'ENABLED' | 'DISABLED'
  page: number
  pageSize: number
}
```

空状态和异常状态：

- 无站点时展示新增站点主按钮。
- 筛选无结果时展示“没有符合条件的站点”，并提供清空筛选。
- 全部离线时展示网络、代理、Cookie 检查提示。
- 认证失败站点行突出显示“编辑凭证”快捷操作。

后端处理：

- 新增和编辑时对 `baseUrl`、`freeTorrentUrl`、`profileUrl` 做 URL 规范化。
- `accessKey`、`cookie`、`userAgent`、代理密码等敏感字段写入前加密。
- 列表接口只返回是否已配置敏感字段，不返回明文。
- 连通性测试必须按密钥优先、Cookie 兜底执行。
- 连通性测试必须使用站点代理策略。
- 每次测试写入 `site_connectivity_logs`。
- 删除站点前如果存在关联 torrent，需要确认是软删除站点还是阻止删除；第一版建议阻止删除并提示先处理关联数据。

安全和日志：

- 日志不记录 Cookie、密钥、passkey、完整下载链接。
- 测试失败原因需要脱敏后存储和展示。
- 手动同步种子和同步流量需要限频，避免频繁访问 PT 站点。
