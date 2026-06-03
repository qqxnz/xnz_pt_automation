# 登录与站点管理设计稿

## 1. 设计定位

前端使用 `Vue 3 + Vite + Varlet UI`。系统主要部署在 NAS 上，访问场景包括桌面浏览器、平板和手机，因此页面采用响应式布局。

设计目标：

- 管理后台清晰直接
- 移动端可用，不只适配桌面
- 关键状态一眼可见
- 敏感字段默认脱敏
- 操作按钮少而明确

## 2. 视觉规范

### 2.1 色彩

```text
主色             #3f7cff
成功             #10b981
警告             #f59e0b
错误             #ef4444
页面背景         #f6f8fb
卡片背景         #ffffff
主文本           #111827
次级文本         #6b7280
边框             #e5e7eb
```

### 2.2 状态颜色

```text
ONLINE       绿色
OFFLINE      红色
AUTH_FAILED  橙色
UNKNOWN      灰色
```

### 2.3 Varlet UI 组件

主要使用：

- `var-app-bar`
- `var-button`
- `var-card`
- `var-cell`
- `var-chip`
- `var-dialog`
- `var-form`
- `var-input`
- `var-select`
- `var-switch`
- `var-table`
- `var-tabs`
- `var-snackbar`
- `var-loading`
- `var-pagination`
- `var-menu`
- `var-divider`

## 3. 登录页

### 3.1 页面路径

```text
/login
```

### 3.2 桌面布局

```text
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  PT Automation                                               │
│  Free torrent monitor for NAS                                │
│                                                              │
│                 ┌────────────────────────────┐               │
│                 │ 登录                       │               │
│                 │ 管理你的 PT 自动化任务      │               │
│                 │                            │               │
│                 │ 用户名                     │               │
│                 │ ┌────────────────────────┐ │               │
│                 │ │ admin                  │ │               │
│                 │ └────────────────────────┘ │               │
│                 │                            │               │
│                 │ 密码                       │               │
│                 │ ┌────────────────────────┐ │               │
│                 │ │ ********               │ │               │
│                 │ └────────────────────────┘ │               │
│                 │                            │               │
│                 │ [ 登录 ]                   │               │
│                 │                            │               │
│                 │ 默认账号：admin             │               │
│                 └────────────────────────────┘               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 移动端布局

```text
┌──────────────────────┐
│ PT Automation        │
│ NAS PT 自动化工具     │
│                      │
│ ┌──────────────────┐ │
│ │ 登录             │ │
│ │ 用户名           │ │
│ │ [ admin       ]  │ │
│ │ 密码             │ │
│ │ [ ********    ]  │ │
│ │                  │ │
│ │ [ 登录        ]  │ │
│ └──────────────────┘ │
└──────────────────────┘
```

### 3.4 表单字段

```ts
type LoginForm = {
  username: string
  password: string
}
```

字段规则：

- 用户名必填
- 密码必填
- 默认填入用户名 `admin`
- 不展示默认密码
- 密码输入框支持显示和隐藏

### 3.5 交互

登录流程：

```text
点击登录
  |
前端校验必填项
  |
按钮进入 loading
  |
POST /api/auth/login
  |
成功后跳转 /dashboard
  |
失败时显示错误 snackbar
```

错误提示：

```text
用户名或密码错误
登录失败，请稍后重试
服务未初始化完成，请刷新后重试
```

### 3.6 Vue 页面结构

```text
LoginPage.vue
  |
  |-- 页面背景
  |-- 品牌区
  |-- var-card
      |-- var-form
      |-- var-input username
      |-- var-input password
      |-- var-button login
```

## 4. 站点管理页

### 4.1 页面路径

```text
/sites
```

### 4.2 桌面布局

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ PT Automation                                      admin  系统设置  退出    │
├───────────────┬────────────────────────────────────────────────────────────┤
│ Dashboard     │ 站点管理                                      [新增站点]    │
│ 站点管理      │ 管理 PT 站点访问凭证、代理策略和连通状态                    │
│ 免费种子      │                                                            │
│ qBittorrent   │ ┌────────┐ ┌────────┐ ┌────────────┐ ┌──────────────┐     │
│ 代理管理      │ │全部 12 │ │在线 9  │ │认证失败 2 │ │离线 1        │     │
│ 定时任务      │ └────────┘ └────────┘ └────────────┘ └──────────────┘     │
│ 系统设置      │                                                            │
│               │ ┌──────────────────────────────────────────────────────┐   │
│               │ │ 搜索站点 [ keyword ] 状态 [全部] 代理 [全部] [刷新] │   │
│               │ └──────────────────────────────────────────────────────┘   │
│               │                                                            │
│               │ ┌──────────────────────────────────────────────────────┐   │
│               │ │ 站点       状态       凭证     代理      最近成功    │   │
│               │ │ MTeam      在线       密钥     自定义    10:20       │   │
│               │ │ HDHome     认证失败   Cookie   不代理    昨天        │   │
│               │ │ PTP        离线       -        全局代理  -           │   │
│               │ │                                      操作            │   │
│               │ └──────────────────────────────────────────────────────┘   │
└───────────────┴────────────────────────────────────────────────────────────┘
```

### 4.3 移动端布局

移动端不使用宽表格，改用卡片列表。

```text
┌────────────────────────┐
│ 站点管理       +        │
├────────────────────────┤
│ [搜索站点]              │
│ [状态筛选] [代理筛选]    │
│                        │
│ ┌────────────────────┐ │
│ │ MTeam        在线  │ │
│ │ 凭证：密钥         │ │
│ │ 代理：自定义代理    │ │
│ │ 最近成功：10:20    │ │
│ │ [测试] [编辑] [更多]│ │
│ └────────────────────┘ │
│                        │
│ ┌────────────────────┐ │
│ │ HDHome   认证失败  │ │
│ │ 凭证：Cookie       │ │
│ │ 代理：不使用代理    │ │
│ │ 错误：登录失效      │ │
│ │ [测试] [编辑] [更多]│ │
│ └────────────────────┘ │
└────────────────────────┘
```

### 4.4 顶部统计卡片

字段：

```text
全部站点
在线站点
认证失败
离线站点
未知状态
```

组件建议：

- 使用 `var-card` 做统计卡片
- 状态数字使用大字号
- 状态说明使用次级文本
- 在线数字使用绿色
- 失败数字使用橙色或红色

### 4.5 筛选区

字段：

```text
关键词搜索
状态筛选
代理模式筛选
启用状态筛选
刷新按钮
```

筛选状态：

```ts
type SiteFilter = {
  keyword?: string
  connectivityStatus?: 'ALL' | 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
  proxyMode?: 'ALL' | 'NONE' | 'GLOBAL' | 'CUSTOM'
  enabled?: 'ALL' | 'ENABLED' | 'DISABLED'
}
```

### 4.6 表格字段

桌面端使用 `var-table`。

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

字段展示规则：

- 连通状态使用 `var-chip`
- 启用状态使用 `var-switch`
- 当前凭证显示 `密钥`、`Cookie`、`无可用凭证`
- 密钥和 Cookie 不显示明文
- 最近失败原因超过 24 字省略，悬浮或点击查看完整信息

### 4.7 站点卡片字段

移动端使用 `var-card`。

```text
站点名称
连通状态
启用状态
当前凭证
代理模式
最近成功连接
最近失败原因
快捷操作
```

快捷操作：

```text
测试
编辑
更多
```

更多操作：

```text
同步免费种子
同步流量统计
禁用站点
删除站点
```

## 5. 新增与编辑站点弹窗

### 5.1 弹窗结构

使用 `var-dialog` 或独立抽屉式页面。桌面端建议弹窗，移动端建议全屏弹层。

```text
┌──────────────────────────────────────┐
│ 新增站点                         X   │
├──────────────────────────────────────┤
│ 基础信息                             │
│ 站点名称 [                    ]       │
│ 站点地址 [                    ]       │
│ 解析类型 [ NexusPHP          v ]      │
│                                      │
│ 访问凭证                             │
│ 站点密钥 [ ********            ]      │
│ Cookie   [ ********            ]      │
│ User-Agent [                  ]       │
│                                      │
│ 抓取配置                             │
│ 免费种子地址 [                ]       │
│ 个人信息地址 [                ]       │
│ 检查间隔 [ 30 分钟            ]       │
│                                      │
│ 代理配置                             │
│ 代理模式 [不使用代理          v ]     │
│ 指定代理 [请选择              v ]     │
│                                      │
│ [取消] [保存并测试] [保存]            │
└──────────────────────────────────────┘
```

### 5.2 表单字段

```ts
type SiteForm = {
  name: string
  baseUrl: string
  enabled: boolean
  accessKey?: string
  cookie?: string
  userAgent?: string
  parserType: string
  freeTorrentUrl: string
  profileUrl?: string
  proxyMode: 'NONE' | 'GLOBAL' | 'CUSTOM'
  proxyId?: string
  checkIntervalMinutes: number
}
```

校验规则：

- 站点名称必填
- 站点地址必填，必须是 URL
- 站点密钥和 Cookie 至少填写一个
- 代理模式为 `CUSTOM` 时必须选择代理
- 检查间隔最小 5 分钟

### 5.3 保存并测试

流程：

```text
点击保存并测试
  |
保存站点配置
  |
调用 /api/sites/:id/test-connectivity
  |
优先使用密钥测试
  |
密钥失败则使用 Cookie 兜底
  |
展示最终结果
```

结果提示：

```text
连接成功，当前使用密钥访问
连接成功，密钥失败，已使用 Cookie 访问
连接失败，代理不可用
认证失败，密钥和 Cookie 都不可用
```

## 6. 站点状态样式

### 6.1 状态 Chip

```text
ONLINE       在线       绿色实心
OFFLINE      离线       红色浅底
AUTH_FAILED  认证失败   橙色浅底
UNKNOWN      未检测     灰色浅底
```

### 6.2 当前凭证 Chip

```text
ACCESS_KEY  密钥
COOKIE      Cookie
NONE        无可用凭证
```

### 6.3 代理模式 Chip

```text
NONE    不代理
GLOBAL  全局代理
CUSTOM  自定义代理
```

## 7. 页面数据接口

### 7.1 获取站点列表

```text
GET /api/sites?keyword=&connectivityStatus=&proxyMode=&enabled=&page=&pageSize=
```

响应示例：

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

### 7.2 测试站点连通性

```text
POST /api/sites/:id/test-connectivity
```

### 7.3 新增站点

```text
POST /api/sites
```

### 7.4 编辑站点

```text
PUT /api/sites/:id
```

### 7.5 删除站点

```text
DELETE /api/sites/:id
```

删除前需要二次确认。

## 8. 空状态与异常状态

### 8.1 无站点

```text
还没有配置 PT 站点
添加第一个站点后，系统会开始检查免费种子和上传下载统计。
[新增站点]
```

### 8.2 全部离线

```text
所有站点当前不可连接
请检查 NAS 网络、代理配置或站点 Cookie。
[测试全部站点]
```

### 8.3 认证失败

```text
站点认证失败
密钥和 Cookie 均不可用，请更新访问凭证。
[编辑凭证]
```

## 9. 路由守卫

规则：

- 未登录访问业务页面时跳转 `/login`
- 已登录访问 `/login` 时跳转 `/dashboard`
- 登录态过期时清理前端状态并跳转 `/login`
- 修改密码成功后建议重新登录

## 10. 响应式断点

```text
mobile   < 768px
tablet   768px - 1199px
desktop  >= 1200px
```

布局规则：

- `desktop` 使用侧边栏和表格
- `tablet` 保留侧边栏，表格减少字段
- `mobile` 使用顶部栏和卡片列表
