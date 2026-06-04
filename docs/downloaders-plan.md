# 下载器模块方案

## 1. 模块目标

下载器模块负责配置种子下载工具连接信息、测试连接、查看下载器状态和当前任务。第一版支持 qBittorrent/QB，数据结构和接口保留 `type` 字段，后续可扩展 Transmission、Deluge 等下载器。

业务边界：

- 本模块只管理下载器配置、连接状态、传输状态和下载器任务快照。
- 不处理 PT 站点访问、种子抓取规则、任务调度规则和种子推送策略。
- 不在本模块删除已抓取种子记录；删除下载器任务的能力归种子模块或任务清理流程处理。

## 2. 页面和入口

页面路径：`/downloaders`

入口：

- 左侧导航【下载器】。
- Dashboard 风险提示中的【配置下载器】。
- Dashboard 快捷操作中的【新增下载器】。
- 任务创建表单中的下载器下拉为空时，提供跳转入口。
- 种子推送失败提示中的【查看下载器】。

跳转关系：

- 点击下载器列表项，右侧展示该下载器状态和当前任务。
- 点击【新增下载器】，打开新增弹窗。
- 点击列表或详情中的【编辑】，打开编辑弹窗。
- 点击【查看引用任务】，跳转 `/tasks?downloaderId=:id`。
- 点击当前任务行中的种子名称，跳转 `/torrents?downloaderId=:id&hash=:hash`。

核心链路：用户在本模块新增一个启用的 QB 下载器并测试成功后，可在任务模块选择该下载器作为推送目标。

## 3. 页面布局和状态

桌面端布局：

- 顶部：页面标题、说明文案、【新增下载器】主按钮。
- 左侧：下载器卡片列表，展示名称、类型、连接状态、服务地址、默认保存路径和最近同步时间。
- 右侧上方：选中下载器的传输状态，展示上传速度、下载速度、总上传、总下载、最近同步、测试连接入口。
- 右侧下方：当前任务表格，展示下载器内任务快照。
- 新增/编辑：居中弹窗，分为基础信息、连接信息、默认推送设置、高级选项和底部操作区。

移动端布局：

- 顶部展示标题和新增按钮。
- 下载器列表、状态详情、当前任务按纵向卡片排列。
- 当前任务表格改为卡片列表，只保留名称、进度、状态、分享率、分类和标签。
- 新增/编辑弹窗使用底部抽屉或全屏弹层，字段单列排列，底部固定操作按钮。

页面状态：

- 首次 loading：展示列表和详情骨架屏。
- 空状态：提示“还没有下载器”，提供【新增下载器】。
- 未选中状态：列表有数据但无选中项时，默认选中第一项；请求失败时展示错误重试。
- 离线状态：保留配置详情，可编辑和测试，状态卡展示离线原因。
- 认证失败状态：展示“用户名或密码错误”，提供【编辑凭证】。
- 禁用状态：列表和详情显示“已禁用”，任务模块不可选择该下载器。

## 4. 列表和详情

下载器列表字段：

```text
名称
类型
服务地址
连接状态
默认保存路径
是否启用
最近同步时间
操作
```

列表操作：

```text
测试
编辑
删除
查看引用任务
```

详情状态字段：

```text
上传速度
下载速度
总上传
总下载
剩余空间
连接状态
最近同步时间
默认保存路径
添加后是否暂停
```

当前任务字段：

```text
名称
大小
进度
状态
分享率
分类
标签
上传速度
下载速度
添加时间
hash
```

筛选项：

- 关键词：匹配名称和服务地址。
- 状态：全部、在线、离线、认证失败、未检测。
- 启用状态：全部、已启用、已禁用。

## 5. 新增/编辑表单

设计稿文件：`designs/downloaders-form.svg`。

表单标题：

- 新增：`新增下载器`
- 编辑：`编辑下载器 - 下载器名称`

表单字段：

```ts
type DownloaderForm = {
  name: string
  type: 'QBITTORRENT'
  host: string
  username?: string
  password?: string
  passwordAction?: 'KEEP' | 'UPDATE' | 'CLEAR'
  savePath?: string
  paused: boolean
  enabled: boolean
  testAfterSave: boolean
}
```

字段说明和控件：

| 字段 | 控件 | 新增默认值 | 编辑默认值 | 规则 |
| --- | --- | --- | --- | --- |
| 下载器名称 | 文本输入 | 空 | 已保存名称 | 必填，1-40 字，列表内唯一。 |
| 类型 | 下拉选择 | qBittorrent | 已保存类型 | 第一版仅 qBittorrent，可展示为禁用下拉，接口仍提交 `QBITTORRENT`。 |
| 服务地址 | 文本输入 | 空 | 已保存地址 | 必填，支持 `http://nas:8080`、`https://host:port`，保存前去除首尾空格和末尾 `/`。 |
| 用户名 | 文本输入 | 空 | 已保存用户名 | 可选；如果 QB 未开启认证可留空。 |
| 密码 | 密码输入 | 空 | 不回显，显示占位 `已保存，留空不修改` | 新增时原样加密保存；编辑时默认不修改。 |
| 密码处理 | 单选/按钮组 | 更新密码 | 保持原密码 | 编辑时提供保持原密码、更新密码、清空密码；清空需二次确认。 |
| 默认保存路径 | 文本输入 | 空 | 已保存路径 | 可选；不填时由 QB 默认路径或任务覆盖值决定。 |
| 添加后暂停 | 开关 | 关闭 | 已保存值 | 开启后推送种子时使用暂停状态添加。 |
| 启用下载器 | 开关 | 开启 | 已保存值 | 关闭后任务模块不可选择，已有任务运行时跳过。 |
| 保存后测试连接 | 复选框 | 开启 | 关闭 | 勾选后保存成功立即调用测试接口。 |

校验规则：

- 下载器名称必填，去除首尾空格后不能为空。
- 服务地址必填且必须以 `http://` 或 `https://` 开头。
- 服务地址必须能被 `URL` 解析，允许内网 IP、局域网主机名和端口。
- 不允许在服务地址中保存用户名和密码，例如 `http://user:pass@host:8080`。
- `type` 第一版只允许 `QBITTORRENT`。
- 新增时如果密码为空，允许保存，但测试连接可能因 QB 配置返回认证失败。
- 编辑时密码为空且 `passwordAction=KEEP` 表示不修改旧密码。
- 编辑时选择更新密码但密码为空，提示“请输入新密码或改为保持原密码”。
- 编辑时选择清空密码，提交前弹出确认：“清空后将以无密码方式连接下载器”。

表单交互：

- 打开新增弹窗时，表单使用默认值，焦点落在下载器名称。
- 打开编辑弹窗时，先读取详情接口；详情 loading 期间禁用提交。
- 编辑状态下密码字段不展示真实值，只展示“已保存，留空不修改”。
- 修改服务地址、用户名、密码、类型任意一项后，连接测试结果标记为“待重新测试”。
- 点击【测试连接】时先执行前端校验，通过后调用临时测试接口或保存后测试接口。
- 测试连接成功后，在弹窗内展示下载器版本、当前上传/下载速度和登录用户。
- 测试连接失败后，在弹窗内展示明确原因，不关闭弹窗，不清空用户输入。
- 点击【保存】只保存配置。
- 点击【保存并测试】先保存，保存成功后测试连接，并将测试结果同步到列表和详情。
- 关闭弹窗前如果表单有改动，弹出离开确认。
- 保存成功后关闭弹窗，刷新列表；新增成功后自动选中新下载器。

表单底部按钮：

```text
取消
测试连接
保存并测试
保存
```

按钮状态：

- 表单 loading 时所有输入禁用。
- 测试连接 loading 时禁用【测试连接】和提交按钮。
- 保存 loading 时禁用所有底部按钮，主按钮显示 loading。
- 新增场景默认突出【保存并测试】。
- 编辑场景默认突出【保存】。

错误提示：

- `INVALID_HOST`：服务地址格式不正确。
- `NETWORK_ERROR`：无法连接下载器，请检查地址和网络。
- `AUTH_FAILED`：认证失败，请检查用户名和密码。
- `UNSUPPORTED_TYPE`：暂不支持该下载器类型。
- `TIMEOUT`：连接测试超时。
- `DUPLICATE_NAME`：下载器名称已存在。
- `REFERENCED_BY_TASKS`：下载器已被任务引用，不能删除。

## 6. 接口和数据

接口：

```text
GET    /api/downloaders?keyword=&status=&enabled=
POST   /api/downloaders
GET    /api/downloaders/:id
PUT    /api/downloaders/:id
DELETE /api/downloaders/:id
POST   /api/downloaders/test
POST   /api/downloaders/:id/test
GET    /api/downloaders/:id/status
GET    /api/downloaders/:id/torrents
GET    /api/downloaders/:id/task-references
```

新增请求：

```ts
type CreateDownloaderRequest = {
  name: string
  type: 'QBITTORRENT'
  enabled: boolean
  host: string
  username?: string
  password?: string
  savePath?: string
  paused: boolean
}
```

编辑请求：

```ts
type UpdateDownloaderRequest = {
  name: string
  enabled: boolean
  host: string
  username?: string
  passwordAction: 'KEEP' | 'UPDATE' | 'CLEAR'
  password?: string
  savePath?: string
  paused: boolean
}
```

临时测试请求：

```ts
type TestDownloaderDraftRequest = {
  type: 'QBITTORRENT'
  host: string
  username?: string
  password?: string
}
```

配置响应：

```ts
type DownloaderConfig = {
  id: string
  name: string
  type: 'QBITTORRENT'
  enabled: boolean
  host: string
  username?: string
  hasPassword: boolean
  savePath?: string
  paused: boolean
  status: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  statusMessage?: string
  lastTestedAt?: string
  lastSyncedAt?: string
  createdAt: string
  updatedAt: string
}
```

测试响应：

```ts
type DownloaderTestResult = {
  success: boolean
  status: 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  message: string
  version?: string
  user?: string
  uploadSpeed?: number
  downloadSpeed?: number
  testedAt: string
}
```

状态响应：

```ts
type DownloaderStatus = {
  downloaderId: string
  uploadSpeed: number
  downloadSpeed: number
  totalUploaded?: number
  totalDownloaded?: number
  freeSpace?: number
  status: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  lastSyncedAt?: string
}
```

当前任务响应：

```ts
type DownloaderTorrentItem = {
  hash: string
  name: string
  size?: number
  progress: number
  state: string
  ratio?: number
  category?: string
  tags: string[]
  uploadSpeed?: number
  downloadSpeed?: number
  addedAt?: string
}
```

持久化规则：

- 密码加密存储，不参与普通列表查询。
- 响应中只返回 `hasPassword`，不返回明文或密文密码。
- 密码留空且 `passwordAction=KEEP` 表示不修改旧密码。
- `passwordAction=CLEAR` 将密码字段置空，并记录审计日志。
- 删除下载器前检查任务引用；被引用时禁止删除并返回引用任务数量和前 5 个任务名称。
- 保存配置时规范化 host：去除首尾空格、去除末尾 `/`，保留协议、主机、端口和路径前缀。

## 7. qBittorrent 集成

第一版使用 qBittorrent Web API：

```text
POST /api/v2/auth/login
GET  /api/v2/app/version
GET  /api/v2/transfer/info
GET  /api/v2/torrents/info
```

连接测试流程：

1. 使用 `host` 拼接 QB Web API 地址。
2. 如果配置了用户名或密码，调用登录接口并保存会话 Cookie。
3. 调用版本接口确认可用。
4. 调用传输信息接口获取速度快照。
5. 成功时将状态更新为 `ONLINE`，失败时根据错误更新为 `OFFLINE` 或 `AUTH_FAILED`。

超时规则：

- 连接测试默认超时 8 秒。
- 状态同步默认超时 10 秒。
- 任务列表同步默认超时 15 秒。

刷新规则：

- 下载器详情页的上传速度、下载速度、总上传、总下载和剩余空间每 3 秒刷新一次。
- 当前任务列表默认每 15 秒刷新一次，用户也可以手动点击刷新。
- 页面不可见、离开 `/downloaders` 或切换到未选中的下载器时，停止对应轮询。
- 切换选中下载器时立即请求一次状态，然后进入 3 秒轮询。
- 连续 3 次状态刷新失败后暂停自动刷新，并展示【重试】入口。

## 8. 安全和日志

- 密码不明文回显，不进入前端状态持久化。
- 日志不打印用户名、密码、Cookie、密钥和完整下载链接。
- 后端错误日志中的 URL 只保留协议、主机和端口。
- 前端异常提示不展示内部堆栈。
- 测试连接时按钮 loading，禁止重复提交。
- 任务引用中的下载器被禁用后，任务运行时跳过并记录明确错误。
- 下载器 API 默认不走站点代理。

## 9. 设计稿

设计稿文件：

- `designs/downloaders.svg`：下载器列表、状态详情、当前任务和移动端卡片。
- `designs/downloaders-form.svg`：新增/编辑下载器弹窗、密码处理、连接测试结果和移动端抽屉。

设计说明：

- 桌面端主页面采用左侧列表 + 右侧状态详情 + 当前任务表格。
- 新增/编辑弹窗宽度约 900px，左右两列布局，字段分组清晰。
- 弹窗底部固定校验提示和操作按钮。
- 移动端表单采用单列全屏弹层，底部固定保存按钮。
- 敏感信息以“已保存，留空不修改”表达，不画真实密码。
- 下载器配置不提供默认分类和默认标签；如需分类或标签，由任务推送配置单独决定。

## 10. 执行清单

- 创建 `/downloaders` 路由和页面。
- 实现下载器列表查询、关键词筛选、状态筛选和启用状态筛选。
- 实现列表空状态、loading 状态、错误重试和默认选中第一项。
- 实现下载器详情状态卡，展示速度、总量、剩余空间和最近同步时间。
- 实现下载器状态 3 秒轮询刷新，并在页面不可见或离开页面时停止轮询。
- 实现当前任务列表查询、刷新、loading、空状态和异常状态。
- 实现新增下载器弹窗的表单字段、默认值和前端校验。
- 实现编辑下载器弹窗的详情读取、密码脱敏和 `passwordAction` 交互。
- 实现服务地址规范化和 URL 合法性校验。
- 实现弹窗内临时测试连接，不保存配置。
- 实现新增保存接口调用，新增成功后刷新列表并选中新下载器。
- 实现编辑保存接口调用，保存成功后刷新列表和详情。
- 实现保存并测试流程，保存成功后调用对应下载器测试接口。
- 实现清空密码二次确认。
- 实现关闭弹窗前的未保存改动确认。
- 实现删除下载器二次确认。
- 实现删除前任务引用检查，被引用时展示引用任务并提供跳转。
- 实现禁用下载器后任务模块不可选择。
- 后端实现下载器数据模型、存储、列表、详情、新增、编辑和删除接口。
- 后端实现密码加密存储、`hasPassword` 响应和日志脱敏。
- 后端实现下载器抽象接口和 qBittorrent Client。
- 后端实现临时测试连接和已保存下载器测试连接接口。
- 后端实现状态同步接口和当前任务同步接口。
- 后端实现错误码映射：地址无效、网络失败、认证失败、类型不支持、超时。
- 补充前端类型、API Client、表单组件单元测试和后端接口测试。
- 通过前端类型检查、后端类型检查和完整构建。

## 11. TODO

- [x] 生成 `designs/downloaders.svg`。
- [x] 生成 `designs/downloaders-form.svg`。
- [x] 明确默认保存路径为可选，不填时使用 QB 默认路径或任务覆盖值。
- [x] 明确下载器不提供默认分类和默认标签配置。
- [x] 明确连接测试超时时间：默认 8 秒。
- [x] 明确下载器速度刷新间隔：详情页每 3 秒刷新一次。
- [ ] 确认后续下载器类型的适配接口是否需要在第一版暴露高级字段。

## 12. 验收标准

- 桌面端可打开 `/downloaders`，查看下载器列表、详情状态和当前任务。
- 移动端可按卡片形式查看下载器、状态和任务，表单单列显示且按钮不遮挡字段。
- 可新增一个 QB 下载器并保存。
- 可新增一个 QB 下载器并执行保存并测试，成功后状态更新为在线。
- 可编辑下载器名称、服务地址、用户名、默认保存路径、暂停和启用状态。
- 编辑时密码不明文回显，留空不会修改旧密码。
- 编辑时可更新密码，也可二次确认后清空密码。
- 表单能拦截空名称、非法服务地址和重复名称等错误。
- 测试连接能展示成功结果和版本信息。
- 下载器详情页速度和总量每 3 秒自动刷新，页面不可见或离开页面后停止刷新。
- 测试连接失败时能区分认证失败、网络失败、地址无效、类型不支持和超时。
- 被任务引用的下载器不能删除，并能跳转查看引用任务。
- 禁用下载器后，任务模块不能新选择该下载器，已有任务运行时跳过并记录错误。
- 配置、测试和状态同步日志不包含密码、Cookie、密钥和完整下载链接。
