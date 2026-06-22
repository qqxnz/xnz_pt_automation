# 系统设置模块方案

## 1. 模块目标

系统设置模块负责修改当前登录用户密码、查看系统运行信息、查看数据库和迁移状态、配置第一版基础参数。

业务边界：

- 本模块不管理站点、代理、下载器、任务、种子和日志业务数据。
- 本模块不提供数据库下载、数据库编辑、环境变量编辑、重置管理员账号等高风险能力。
- 本模块只配置对系统运行有明确影响的基础参数；复杂业务规则放在对应业务模块。
- 第一版为单用户系统，不设计多用户、角色、权限组和审计审批。

核心链路：用户进入系统设置，修改密码并保存基础参数；系统信息用于确认版本、数据库路径、迁移状态和运行环境，便于 NAS 部署时排查问题。

## 2. 页面和入口

页面路径：`/settings`

入口：

- 左侧导航【系统】。
- 顶部用户菜单【系统设置】。
- 默认密码风险提示中的【修改密码】。
- 登录态即将过期提示中的【调整会话】。
- 日志保留策略提示中的【系统设置】。

跳转关系：

- 点击默认密码风险提示，进入 `/settings?section=password` 并聚焦修改密码区域。
- 点击日志保留策略提示，进入 `/settings?section=retention`。
- 点击代理测试失败中的测试目标提示，进入 `/settings?section=network`。

## 3. 页面布局和状态

桌面端布局：

- 顶部：页面标题、说明文案、保存状态提示。
- 左列：修改密码、安全提示。
- 右列：系统信息、数据库和迁移状态。
- 下方：基础参数设置，按会话、安全、网络、数据保留分组。

移动端布局：

- 单列卡片顺序：修改密码、系统信息、基础参数、安全提示。
- 基础参数分组使用折叠面板或分段标题。
- 底部保存按钮在参数有变更时固定显示。

页面状态：

- 首次 loading：展示系统信息和设置表单骨架屏。
- 加载失败：展示错误提示和重试按钮，不影响修改密码表单展示。
- 无修改状态：保存按钮禁用或隐藏。
- 有修改状态：展示未保存提示，离开页面前二次确认。
- 保存成功：展示成功提示，并刷新设置详情。
- 保存失败：保留用户输入，展示字段级或全局错误。
- 默认密码风险：如果系统检测到仍使用默认密码，展示安全提示并引导修改。

## 4. 修改密码

字段：

```ts
type ChangePasswordForm = {
  oldPassword: string
  newPassword: string
  confirmPassword: string
}
```

校验规则：

- 旧密码必填。
- 新密码必填，长度 8-64 位。
- 新密码至少包含字母和数字。
- 新密码不能与旧密码相同。
- 确认新密码必须与新密码一致。
- 密码输入框不自动填充到日志或错误详情。

交互：

- 修改密码表单独立提交，不与基础参数保存绑定。
- 点击提交前执行前端校验。
- 后端验证旧密码，失败返回“旧密码不正确”。
- 修改成功后清空三个密码输入框。
- 修改成功后强制当前会话继续有效，其他会话失效。第一版单用户系统通常只有当前会话，但接口按“废弃其他会话”语义实现。
- 如果当前用户使用默认密码，修改成功后清除默认密码风险提示。

按钮状态：

- 提交中禁用三个密码输入和提交按钮。
- 提交成功展示成功提示。
- 提交失败保留输入，但不回显密码内容到错误文案。

错误码：

```text
OLD_PASSWORD_REQUIRED       旧密码必填
NEW_PASSWORD_WEAK           新密码不符合复杂度要求
PASSWORD_CONFIRM_MISMATCH   两次新密码不一致
PASSWORD_REUSED             新密码不能与旧密码相同
OLD_PASSWORD_INVALID        旧密码不正确
```

## 5. 系统信息

系统信息展示字段：

```text
系统版本
运行环境
Node.js 版本
启动时间
系统时区
数据库类型
数据库路径
数据库大小
Schema 版本
最近迁移时间
最近迁移结果
最近迁移错误
数据目录
日志目录
```

展示规则：

- 数据库路径、数据目录和日志目录可以展示。
- 密钥类环境变量不展示，包括但不限于 token、secret、key、password、cookie。
- 迁移失败时展示简短错误摘要，不展示包含敏感环境变量的完整堆栈。
- 系统版本优先读取 `package.json` 版本；无版本时显示 `dev`。
- 启动时间按 ISO 字符串返回，前端按用户本地时区展示。

系统信息响应：

```ts
type SystemInfo = {
  version: string
  runtimeEnv: 'development' | 'production' | 'test'
  nodeVersion: string
  startedAt: string
  timezone: string
  database: {
    type: 'sqlite'
    path: string
    sizeBytes?: number
    schemaVersion: string
    lastMigrationAt?: string
    lastMigrationStatus?: 'SUCCESS' | 'FAILED' | 'PENDING'
    lastMigrationError?: string
  }
  paths: {
    dataDir?: string
    logDir?: string
  }
  security: {
    defaultPasswordInUse: boolean
  }
}
```

## 6. 基础参数

第一版可配置参数（v0.5.0 **实际**持久化的字段）：

```ts
type SystemSettings = {
  sessionTtlHours: number
  requestTimeoutMs: number
  proxyTestUrl: string            // GET /api/settings 响应中隐藏，不展示给前端
  maxConcurrentTasks: number
  defaultUserAgent: string
}
```

字段说明：

| 字段 | 分组 | 默认值 | 范围 | v0.5.0 影响 |
| --- | --- | --- | --- | --- |
| 登录态有效期 | 会话 | 168 小时 | 1-720 小时 | 新签发会话的过期时间；当前会话保持原 TTL。 |
| 请求超时时间 | 网络 | 15000 ms | 3000-120000 ms | 站点抓取/测试、下载器 HTTP 默认超时。 |
| 代理测试目标 URL | 网络 | `https://www.gstatic.com/generate_204` | 合法 http/https URL | 内部使用；`GET /api/settings` 响应**隐藏**该字段，前端无法读取；只由后端内部模块使用。 |
| 最大并发任务数 | 任务 | 2 | 1-10 | 当前仅记录；并发执行由 1s 轮询 + 内存 `runningTaskIds` Set + DB `running` 标志保证单实例单任务。 |
| 默认 User-Agent | 网络 | Chrome 120 UA | trim 后 20-300 字符 | 站点 UA 缺省值。 |

**与原方案差异**：原方案列出 `operationLogRetentionDays / taskLogRetentionDays / torrentRetentionDays` 3 个数据保留字段，v0.5.0 **未持久化**也**未实现**清理任务；当前日志/种子记录由用户在【日志】页手动清空。

保存规则：

- 参数分组展示，但一次保存全部基础参数。
- 保存前执行前端校验；后端必须重复校验。
- 保存成功后影响后续新请求和新调度，不强制中断正在执行的任务。
- `sessionTtlHours` 只影响新签发会话；当前会话保留原过期时间。
- `requestTimeoutMs` 影响后续站点测试、代理测试和任务抓取。
- `defaultUserAgent` 只影响新增站点默认值，不覆盖已有站点。
- 保留天数修改后，由下一次系统清理作业执行，不立即删除数据。

校验规则：

- 数字字段必须是整数。
- `proxyTestUrl` 必须以 `http://` 或 `https://` 开头，且能被 URL 解析。
- 默认 User-Agent 去除首尾空格后不能为空，长度 20-300 字。
- 未在白名单的字段返回 `400`（`unknown setting: xxx`）。
- `proxyTestUrl` 字段**只允许**通过内部 PUT 写入；公开 `PUT /api/settings` 接受 `proxyTestUrl` 但 `GET` 不返回。

## 7. 接口和数据

接口：

```text
PUT /api/auth/password
GET /api/settings/system-info
GET /api/settings
PUT /api/settings
POST /api/settings/validate
```

接口说明：

- `PUT /api/auth/password` 修改当前用户密码。
- `GET /api/settings/system-info` 获取系统信息、数据库和迁移状态。
- `GET /api/settings` 获取基础参数。
- `PUT /api/settings` 保存基础参数。
- `POST /api/settings/validate` 校验基础参数草稿；第一版可选实现，前端也可以在保存时直接使用 `PUT` 的错误响应。

修改密码请求：

```ts
type ChangePasswordRequest = {
  oldPassword: string
  newPassword: string
}
```

修改密码响应：

```ts
type ChangePasswordResponse = {
  success: true
  otherSessionsRevoked: boolean
}
```

设置响应：

```ts
type SystemSettingsResponse = {
  settings: SystemSettings
  updatedAt?: string
}
```

保存设置请求：

```ts
type UpdateSystemSettingsRequest = SystemSettings
```

保存设置响应：

```ts
type UpdateSystemSettingsResponse = {
  settings: SystemSettings
  updatedAt: string
}
```

错误码：

```text
INVALID_SESSION_TTL          登录态有效期范围不正确
INVALID_RETENTION_DAYS       数据保留天数范围不正确
INVALID_REQUEST_TIMEOUT      请求超时时间范围不正确
INVALID_PROXY_TEST_URL       代理测试目标 URL 不正确
INVALID_CONCURRENT_TASKS     最大并发任务数范围不正确
INVALID_USER_AGENT           默认 User-Agent 不正确
SYSTEM_INFO_UNAVAILABLE      系统信息暂不可用
SETTINGS_SAVE_FAILED         设置保存失败
```

## 8. 与其他模块关系

登录模块：

- 修改密码复用登录模块的密码哈希工具。
- 修改密码成功后废弃其他会话。
- `sessionTtlHours` 影响新登录会话过期时间。

代理模块：

- `proxyTestUrl` 是代理默认测试目标。
- `requestTimeoutMs` 是代理测试默认超时时间。

站点模块：

- `requestTimeoutMs` 是站点连通性检测和浏览种子的默认超时时间。
- `defaultUserAgent` 是新增站点时 User-Agent 的默认值。

任务模块：

- `maxConcurrentTasks` 控制调度器并发数。
- `requestTimeoutMs` 是任务抓取请求默认超时时间。

日志模块：

- `operationLogRetentionDays` 控制操作日志保留周期。
- `taskLogRetentionDays` 控制任务日志保留周期。
- 修改密码和保存设置写入操作日志，但不记录密码和敏感字段。

种子模块：

- `torrentRetentionDays` 控制历史种子记录保留周期。

## 9. 状态和安全

- 所有接口必须鉴权。
- 密码不写入请求日志、操作日志或错误详情。
- 系统信息不展示密钥类环境变量。
- 数据库路径可展示，但不提供下载数据库能力。
- 修改密码、保存设置均写入操作日志。
- 保存设置的操作日志只记录变更字段名和脱敏后的新旧值；URL 和数字可记录，密码类字段不存在。
- 默认密码风险提示只根据后端返回的 `defaultPasswordInUse` 展示，不在前端硬编码判断。
- 设置接口不接受未知字段，避免用户写入未设计配置。
- 环境变量优先级高于数据库设置时，需要在系统信息或字段提示中标记“由环境变量锁定”。第一版如不支持锁定，可暂不展示该状态。

## 10. 持久化建议

实际表：`system_settings`（v0.5.0 schema v20）

```text
id INTEGER PRIMARY KEY CHECK (id = 1)
settings_json TEXT NOT NULL     -- JSON.stringify(SystemSettings)
updated_at TEXT
```

实际默认数据（`storage.ts:376`）：

```text
sessionTtlHours              168
requestTimeoutMs             15000
proxyTestUrl                 https://www.gstatic.com/generate_204
maxConcurrentTasks           2
defaultUserAgent             Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
```

迁移记录：使用 `app_meta` 表（`key/value`）：

```text
key                   value
schema_version        20
last_migration_status SUCCESS|FAILED
migrated_at           ISO 时间
migrated_from         'app_state' | 'app-state.json' | 'v<n>-additive' | 'initial'
torrent_traffic_seeded_at  ISO 时间
```

- 启动时 `app_meta.schema_version` < 20 走 `migrateStructuredDatabase`（v3..v19）
- 启动时 `schema_version == 20` 走 `inspectTaskSchemaCompatibility`，缺列自动 ALTER 并写 `STORAGE_SCHEMA_REPAIR` 操作日志
- `system_settings` 启动时缺失默认设置会自动补齐

## 11. 设计稿

设计稿文件：`designs/settings.svg`。

设计说明：

- 桌面端使用分组卡片展示修改密码、系统信息和基础参数。
- 移动端使用单列卡片。
- 修改密码和基础参数保存是两个独立提交区域。
- 系统信息不出现密钥、Token、Cookie、完整环境变量列表。

## 12. 执行清单

- 创建 `/settings` 路由和页面。
- 实现修改密码表单、字段校验、提交状态和成功提示。
- 实现系统信息展示、loading、失败重试和默认密码风险提示。
- 实现基础参数读取、字段校验、保存和未保存离开确认。
- 实现系统设置 API 客户端。
- 后端实现系统信息接口。
- 后端实现设置读取、默认值补齐、保存和校验。
- 后端实现修改密码后废弃其他会话。
- 后端实现设置变更操作日志和敏感信息脱敏。
- 将代理模块默认测试目标和超时时间接入系统设置。
- 将日志清理周期、种子保留周期和任务并发数接入后续系统维护作业。
- 补充单元测试：密码复杂度、旧密码校验、设置范围校验、未知字段拒绝。
- 补充集成测试：修改密码后旧密码不可登录、新密码可登录、设置保存后代理测试读取新目标。

## 13. TODO

- [x] 生成 `designs/settings.svg`。
- [x] 确认密码复杂度规则：8-64 位，至少包含字母和数字。
- [x] 确认修改密码后是否强制退出登录：当前会话继续有效，其他会话失效。
- [x] 确认第一版可配置的系统基础参数范围：会话、日志保留、种子保留、网络超时、代理测试 URL、最大并发任务数、默认 User-Agent。
- [ ] 确认环境变量是否需要锁定部分系统设置；第一版可先不实现锁定。
- [ ] 确认系统信息是否需要展示磁盘剩余空间；第一版不强制。

## 14. 验收标准

- 可修改密码且旧密码校验生效。
- 新密码不满足复杂度、与旧密码相同或确认密码不一致时不能提交。
- 修改密码成功后，新密码可登录，旧密码不可登录。
- 可查看版本、运行环境、数据库路径、数据库大小、Schema 版本和迁移状态。
- 页面不泄露环境变量密钥、密码、Token 或 Cookie。
- 可读取和保存第一版基础参数。
- 基础参数保存失败时保留用户输入并展示明确错误。
- 未保存设置离开页面时有确认提示。
- 代理测试目标和请求超时时间保存后能被代理模块后续测试使用。
- 日志和种子保留周期保存后能被后续系统维护作业读取。

## 15. v0.5.0 实际实现差异

> 本节记录 `backend/src/routes/settings.ts` + `storage.ts` + 前端 `SettingsPage.vue` 当前实现与上文的差异。

### 15.1 接口

```text
GET    /api/settings/system-info      # 系统信息
GET    /api/settings                  # 当前设置（隐藏 proxyTestUrl）
PUT    /api/settings                  # 保存设置（白名单字段）
POST   /api/settings/validate         # 校验草稿
PUT    /api/auth/password             # 改密
```

- 原方案中 `POST /api/settings/validate` 已实现：返回 `{ valid: true }` 或 `{ valid: false, field, message }`
- 改密响应：`{ success, otherSessionsRevoked, user }`（`otherSessionsRevoked` 当前固定 `true`；单会话设备不感知差异）

### 15.2 system-info 响应

```ts
{
  version, env, nodeVersion, startedAt, timezone,
  database: { type:'sqlite', path, sizeBytes, schemaVersion,
              lastMigrationAt, lastMigrationStatus, lastMigrationError },
  paths: { dataDir, logDir, cacheDir },
  security: { defaultPasswordInUse: boolean }   // scrypt 校验 admin 是否仍为 123456
}
```

- `security.defaultPasswordInUse` 是 Dashboard 风险横幅的输入

### 15.3 白名单字段

`PUT /api/settings` 接受字段（其他字段被 `400 unknown setting` 拒绝）：

- `sessionTtlHours`、`requestTimeoutMs`、`proxyTestUrl`、`maxConcurrentTasks`、`defaultUserAgent`
- **未持久化**：`operationLogRetentionDays` / `taskLogRetentionDays` / `torrentRetentionDays`

### 15.4 校验规则

- `sessionTtlHours`：整数 1-720
- `requestTimeoutMs`：整数 3000-120000
- `proxyTestUrl`：必须可解析为 http(s) URL
- `maxConcurrentTasks`：整数 1-10
- `defaultUserAgent`：trim 后长度 20-300

### 15.5 设置修改日志

- `PUT /api/settings` 成功写 `action=SETTINGS_UPDATE, status=SUCCESS, message` 包含变更字段名列表（仅字段名，不含值）

### 15.6 前端展示

- `?section=password|network|session` 滚动到对应小节（`onMounted`）
- `beforeunload` + `onBeforeRouteLeave` 在 dirty 时弹确认
- 顶部"有未保存修改"提示 + 保存按钮 disabled

### 15.7 TODO 状态

- [x] 修改密码 + 旧密码校验 + 8-64 字符 + 字母数字
- [x] 系统信息（version / runtime / node / startedAt / tz / database / paths / defaultPasswordInUse）
- [x] 基础参数：会话 / 网络（请求超时、UA） / 最大并发任务数
- [x] `proxyTestUrl` 内部使用 + GET 响应隐藏
- [x] `PUT /api/settings/validate` 草稿校验
- [ ] 数据保留天数（operationLogRetentionDays / taskLogRetentionDays / torrentRetentionDays）字段未实现
- [ ] 数据保留清理任务未实现
- [ ] 环境变量锁定（高优先级覆盖 DB）未实现
- [ ] 磁盘剩余空间展示未实现
