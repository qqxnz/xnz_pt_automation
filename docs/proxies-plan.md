# 代理管理模块方案

## 1. 模块目标

代理管理模块负责维护系统可用代理，并供站点在需要时选择一个已启用代理。站点默认不使用代理。

业务边界：

- 本模块只维护代理配置、代理启用状态、代理连通性测试结果和代理引用信息。
- 本模块不直接修改站点配置；删除或禁用被站点引用的代理时，只提示影响范围并按规则阻止或确认。
- 本模块不提供全局默认代理，不影响下载器 API 访问。下载器 API 默认直连。
- 站点、任务和种子模块只通过 `proxyId` 引用代理，不读取代理密码明文。

核心链路：用户新增一个启用代理，测试成功后，在站点表单中选择该代理；站点连通性检测、任务抓取和种子浏览按站点绑定的代理访问 PT 站点。

## 2. 页面和入口

页面路径：`/proxies`

入口：

- 左侧导航【代理】。
- 站点新增/编辑表单中的代理选择入口。
- Dashboard 网络或站点风险提示中的【查看代理】。
- 任务执行失败原因为代理不可用时，日志详情中的【查看代理】。

跳转关系：

- 点击【新增代理】，打开新增弹窗。
- 点击列表行【编辑】，打开编辑弹窗。
- 点击列表行【测试】，立即测试该代理并更新最近测试结果。
- 点击【查看引用站点】，跳转 `/sites?proxyId=:id`。
- 站点表单选择代理时，只展示已启用代理；禁用代理不进入可选列表。

## 3. 页面布局和状态

桌面端布局：

- 顶部：页面标题、说明文案、【新增代理】主按钮。
- 统计区：全部代理、已启用、测试成功、测试失败四个统计卡片。
- 筛选区：关键词、代理类型、启用状态、测试状态、刷新按钮。
- 列表区：代理表格，包含代理基础信息、引用站点数、最近测试结果和操作。
- 新增/编辑：居中弹窗，分为基础信息、连接信息、认证信息、状态和底部操作区。

移动端布局：

- 顶部展示标题、统计摘要和新增按钮。
- 筛选项折叠为筛选抽屉或横向紧凑控件。
- 列表改为代理卡片，展示名称、类型、地址、启用状态、测试结果和主要操作。
- 新增/编辑弹窗使用全屏弹层，字段单列排列，底部固定操作按钮。

页面状态：

- 首次 loading：展示统计卡片和列表骨架屏。
- 空状态：提示“还没有代理”，提供【新增代理】。
- 筛选无结果：提示“没有符合条件的代理”，提供清空筛选。
- 测试中状态：当前行测试按钮 loading，避免重复点击。
- 测试失败状态：展示失败原因、失败时间和重试入口。
- 禁用状态：列表保留代理，标记“已禁用”；站点新选择时不可见。
- 被引用状态：展示引用站点数，删除按钮点击后给出阻止提示。

## 4. 列表、筛选和操作

列表字段：

```text
代理名称
代理类型
地址
端口
认证方式
启用状态
引用站点数
最近测试结果
最近测试时间
操作
```

认证方式展示：

```text
无认证
用户名密码
```

最近测试结果：

```text
UNTESTED 未测试
SUCCESS 成功
FAILED 失败
TIMEOUT 超时
```

列表操作：

```text
测试
编辑
启用 / 禁用
查看引用站点
删除
```

筛选项：

- 关键词：匹配代理名称、Host 和备注。
- 类型：全部、HTTP、HTTPS、SOCKS5。
- 启用状态：全部、已启用、已禁用。
- 测试状态：全部、未测试、成功、失败、超时。

排序规则：

- 默认按更新时间倒序。
- 可按名称、类型、启用状态、最近测试时间排序。
- 测试中的行保持原位置，测试完成后刷新该行数据。

## 5. 新增/编辑表单

设计稿文件：`designs/proxies.svg`。

表单标题：

- 新增：`新增代理`
- 编辑：`编辑代理 - 代理名称`

表单字段：

```ts
type ProxyForm = {
  name: string
  type: 'HTTP' | 'HTTPS' | 'SOCKS5'
  host: string
  port: number
  username?: string
  password?: string
  passwordAction?: 'KEEP' | 'UPDATE' | 'CLEAR'
  enabled: boolean
  remark?: string
  testAfterSave: boolean
}
```

字段说明和控件：

| 字段 | 控件 | 新增默认值 | 编辑默认值 | 规则 |
| --- | --- | --- | --- | --- |
| 代理名称 | 文本输入 | 空 | 已保存名称 | 必填，1-40 字，同名不允许重复。 |
| 类型 | 下拉选择 | SOCKS5 | 已保存类型 | 必填，只允许 HTTP、HTTPS、SOCKS5。 |
| Host | 文本输入 | 空 | 已保存 Host | 必填，支持域名、IPv4、IPv6，不填写协议头。 |
| 端口 | 数字输入 | 空 | 已保存端口 | 必填，1-65535。 |
| 用户名 | 文本输入 | 空 | 已保存用户名 | 可选，去除首尾空格。 |
| 密码 | 密码输入 | 空 | 不回显，显示占位 `已保存，留空不修改` | 新增时加密保存；编辑时默认不修改。 |
| 密码处理 | 单选/按钮组 | 更新密码 | 保持原密码 | 编辑时提供保持原密码、更新密码、清空密码。 |
| 启用代理 | 开关 | 开启 | 已保存值 | 关闭后站点不可新选择，已绑定站点运行时失败并记录原因。 |
| 备注 | 多行文本 | 空 | 已保存备注 | 可选，最多 200 字，不展示敏感信息。 |
| 保存后测试 | 复选框 | 开启 | 关闭 | 勾选后保存成功立即调用测试接口。 |

校验规则：

- 名称、类型、Host、端口必填。
- Host 不允许包含 `http://`、`https://`、用户名、密码、路径和查询参数。
- IPv6 地址允许填写 `::1` 或 `2001:db8::1`，保存时不要求用户加方括号。
- 端口必须是整数，范围 1-65535。
- 用户名为空时，密码可以为空；用户名不为空且密码为空时允许保存，但测试可能失败。
- 编辑时密码为空且 `passwordAction=KEEP` 表示不修改旧密码。
- 编辑时选择 `UPDATE` 但密码为空，提示“请输入新密码或改为保持原密码”。
- 编辑时选择 `CLEAR`，提交前二次确认“清空后将以无认证方式连接代理”。
- 名称去除首尾空格后不能为空，同名比较忽略首尾空格。

表单交互：

- 打开新增弹窗时，焦点落在代理名称。
- 打开编辑弹窗时，先读取详情接口；详情 loading 期间禁用提交。
- 编辑状态下密码不展示真实值，只展示占位提示。
- 修改类型、Host、端口、用户名、密码任意一项后，最近测试状态标记为“待重新测试”。
- 点击【测试代理】时先执行前端校验，通过后调用临时测试接口；测试不要求先保存。
- 测试成功后展示目标 URL、响应状态、耗时和出口 IP。出口 IP 获取失败不影响成功结果。
- 测试失败后展示明确原因，不关闭弹窗，不清空用户输入。
- 点击【保存】只保存配置。
- 点击【保存并测试】先保存，保存成功后测试，并将测试结果同步到列表。
- 关闭弹窗前如果表单有改动，弹出离开确认。
- 新增成功后自动选中新代理并刷新统计。

表单底部按钮：

```text
取消
测试代理
保存并测试
保存
```

按钮状态：

- 表单 loading 时所有输入禁用。
- 测试 loading 时禁用测试按钮和提交按钮。
- 保存 loading 时禁用所有底部按钮，主按钮显示 loading。
- 新增场景默认突出【保存并测试】。
- 编辑场景默认突出【保存】。

## 6. 接口和数据

接口：

```text
GET    /api/proxies?keyword=&type=&enabled=&testStatus=&page=&pageSize=
POST   /api/proxies
GET    /api/proxies/:id
PUT    /api/proxies/:id
DELETE /api/proxies/:id
POST   /api/proxies/:id/test
POST   /api/proxies/test
GET    /api/proxies/options
GET    /api/proxies/:id/references
```

接口说明：

- `GET /api/proxies` 返回分页列表、统计和筛选后的数据。
- `POST /api/proxies` 新增代理，密码加密存储。
- `GET /api/proxies/:id` 返回代理详情，不返回密码明文。
- `PUT /api/proxies/:id` 更新代理，支持密码保持、更新和清空。
- `DELETE /api/proxies/:id` 删除代理；被站点引用时返回 `REFERENCED_BY_SITES`。
- `POST /api/proxies/:id/test` 测试已保存代理并落库最近测试结果。
- `POST /api/proxies/test` 测试表单中的临时代理配置，不落库，供新增/编辑弹窗使用。
- `GET /api/proxies/options` 返回站点表单可选代理，只包含已启用代理。
- `GET /api/proxies/:id/references` 返回引用该代理的站点列表。

列表响应：

```ts
type ProxyListResponse = {
  items: ProxyListItem[]
  total: number
  stats: {
    total: number
    enabled: number
    testSuccess: number
    testFailed: number
  }
}
```

列表项：

```ts
type ProxyListItem = Omit<ProxyConfig, 'passwordEncrypted'> & {
  hasUsername: boolean
  hasPassword: boolean
}
```

数据结构：

```ts
type ProxyConfig = {
  id: string
  name: string
  enabled: boolean
  type: 'HTTP' | 'HTTPS' | 'SOCKS5'
  host: string
  port: number
  username?: string
  passwordEncrypted?: string
  remark?: string
  referenceCount: number
  lastTestStatus: 'UNTESTED' | 'SUCCESS' | 'FAILED' | 'TIMEOUT'
  lastTestAt?: string
  lastTestTargetUrl?: string
  lastTestLatencyMs?: number
  lastTestError?: string
  createdAt: string
  updatedAt: string
}
```

前端详情数据不包含 `passwordEncrypted`：

```ts
type ProxyDetail = Omit<ProxyConfig, 'passwordEncrypted'> & {
  hasPassword: boolean
}
```

测试请求：

```ts
type ProxyTestRequest = {
  targetUrl?: string
  timeoutMs?: number
}
```

临时测试请求：

```ts
type ProxyDraftTestRequest = ProxyForm & {
  targetUrl?: string
  timeoutMs?: number
}
```

测试响应：

```ts
type ProxyTestResponse = {
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT'
  targetUrl: string
  httpStatus?: number
  latencyMs?: number
  outboundIp?: string
  errorCode?: string
  message?: string
  testedAt: string
}
```

可选代理响应：

```ts
type ProxyOption = {
  id: string
  name: string
  type: 'HTTP' | 'HTTPS' | 'SOCKS5'
  host: string
  port: number
}
```

错误码：

```text
INVALID_PROXY_TYPE       代理类型不支持
INVALID_HOST             Host 格式不正确
INVALID_PORT             端口必须为 1-65535
DUPLICATE_NAME           代理名称已存在
PROXY_NOT_FOUND          代理不存在
REFERENCED_BY_SITES      代理已被站点引用，不能删除
PROXY_DISABLED           代理已禁用
NETWORK_ERROR            无法通过代理访问目标地址
AUTH_FAILED              代理认证失败
TIMEOUT                  代理测试超时
TARGET_UNREACHABLE       测试目标不可达
```

## 7. 代理测试规则

默认测试目标：

- 第一版默认目标为系统设置中的 `proxyTestUrl`。
- 初始值为 `https://www.gstatic.com/generate_204`。
- 用户可在系统设置中修改测试目标 URL。
- 单次测试允许在请求中覆盖目标 URL，但页面第一版可不暴露该高级输入。

测试行为：

- HTTP 和 HTTPS 代理使用标准 HTTP CONNECT 或 HTTP 代理协议。
- SOCKS5 代理使用 SOCKS5 协议访问目标 URL。
- 默认超时时间读取系统设置 `requestTimeoutMs`，初始值 15000 ms。
- 目标返回 2xx、3xx 或 204 视为连通成功。
- DNS 失败、连接拒绝、TLS 错误、代理认证失败和超时需要区分错误原因。
- 已保存代理测试完成后写入 `lastTestStatus`、`lastTestAt`、`lastTestLatencyMs`、`lastTestError`。
- 临时测试不写入数据库，不写操作日志中的密码。

## 8. 与其他模块关系

站点模块：

- 站点表单通过 `GET /api/proxies/options` 获取已启用代理。
- 站点保存时，如果提交的 `proxyId` 不存在或已禁用，返回“请选择已启用代理”。
- 站点连通性检测时，如果代理不存在或已禁用，检测失败并记录原因。

任务模块：

- 任务运行时使用站点绑定代理抓取站点数据。
- 代理不存在、已禁用或测试失败不直接阻止任务创建，但任务运行时应失败并写入任务日志。
- 任务日志错误原因使用“代理不存在”“代理已禁用”“代理连接失败”等明确文案。

日志模块：

- 新增、编辑、删除、启用、禁用代理写入操作日志。
- 代理测试写入操作日志，记录代理 ID、测试目标、结果和耗时，不记录用户名密码。
- 任务运行中的代理错误写入任务日志。

系统设置模块：

- 提供 `proxyTestUrl` 和 `requestTimeoutMs` 两个基础参数。
- 代理模块读取这些设置作为默认测试目标和超时时间。

## 9. 状态和安全

- 代理密码必须加密存储，不明文落库。
- 前端详情接口不返回密码明文或密文。
- 编辑代理时，密码留空默认不修改。
- 日志不记录代理密码、完整认证 URL 或包含凭证的错误堆栈。
- 删除已被站点使用的代理时阻止删除，并提示先解绑关联站点。
- 禁用已被站点使用的代理时允许禁用，但必须二次确认并展示影响站点数量。
- 禁用代理后，站点已有绑定关系保留，方便用户重新启用后恢复。
- 不允许通过代理 Host 字段保存包含用户名密码的 URL。
- 代理连通性测试只由登录用户触发，接口需要鉴权。

## 10. 持久化建议

建议表：`proxies`

```text
id
name
type
host
port
username
password_encrypted
enabled
remark
last_test_status
last_test_at
last_test_target_url
last_test_latency_ms
last_test_error
created_at
updated_at
```

建议索引：

```text
idx_proxies_name_unique
idx_proxies_enabled
idx_proxies_type
idx_sites_proxy_id
```

加密：

- 复用站点 Cookie、API Key 的加密工具。
- 如环境未配置加密密钥，启动时生成或拒绝启动的策略以技术方案为准。

## 11. 执行清单

- 创建 `/proxies` 路由和页面。
- 实现统计卡片、筛选、列表、空状态和 loading 状态。
- 实现新增和编辑表单。
- 实现字段校验、离开确认和保存状态。
- 实现密码脱敏、保持、更新和清空逻辑。
- 实现删除二次确认和引用校验。
- 实现禁用被引用代理的影响确认。
- 实现已保存代理测试和临时代理测试。
- 实现站点表单代理选项接口，只返回已启用代理。
- 后端实现代理 CRUD、分页筛选和统计。
- 后端实现代理连接测试、默认测试目标读取和超时控制。
- 后端实现代理密码加密存储和日志脱敏。
- 后端实现引用站点查询和删除阻止。
- 补充单元测试：字段校验、密码更新语义、引用校验、测试错误映射。
- 补充集成测试：站点选择已启用代理、禁用代理后的任务失败日志。

## 12. TODO

- [x] 生成 `designs/proxies.svg`。
- [x] 确认代理测试目标 URL：默认 `https://www.gstatic.com/generate_204`，可在系统设置中修改。
- [x] 确认删除被站点引用代理时的处理策略：阻止删除，提示先解绑关联站点。
- [ ] 确认是否需要展示出口 IP；第一版接口保留字段，页面可按返回值展示。
- [ ] 确认是否允许批量测试全部代理；第一版不实现批量操作。

## 13. 验收标准

- 可新增、编辑、启用、禁用、删除代理。
- 新增和编辑表单按规则校验 Host、端口、类型和密码处理。
- 密码不明文回显，编辑留空不会覆盖原密码。
- 删除被站点引用的代理会被阻止，并能看到引用站点入口。
- 禁用被站点引用的代理需要二次确认。
- 可测试已保存代理并展示成功、失败、超时和耗时。
- 代理测试失败原因清晰，日志不泄露用户名密码。
- 站点只能从已启用代理中选择代理；不选择时表示不使用代理。
- 站点绑定的代理不存在或已禁用时，站点测试和任务运行失败并记录明确原因。
- 系统设置中的测试目标和超时时间能影响代理测试默认行为。
