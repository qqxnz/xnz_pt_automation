# 登录模块方案

## 1. 文档依据

本方案基于以下本地文档整理：

- `README.md`
- `docs/pt-automation-technical-design.md`
- `docs/ui-design-login-sites.md`
- `designs/design-spec.md`

## 2. 模块目标

登录模块负责单用户认证、登录态维护和业务页面路由保护。

交付结果：

- `/login` 登录页面
- 单用户登录接口接入
- 登录成功跳转首页
- 登录失败明确提示
- 未登录访问业务页面时跳转登录页
- 已登录访问登录页时跳转首页

## 3. 功能方案

登录页路径为 `/login`。页面只处理单用户登录，不做注册和找回密码。

表单字段：

```ts
type LoginForm = {
  username: string
  password: string
}
```

字段规则：

- 用户名必填。
- 密码必填。
- 用户名默认填入 `admin`。
- 不展示默认密码。
- 密码框支持显示和隐藏。
- 登录按钮 loading 期间禁止重复提交。

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
登录态已过期，请重新登录
```

接口：

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
PUT  /api/auth/password
```

认证要求：

- 单用户模式，默认用户名为 `admin`。
- 默认密码 `123456` 只允许首次初始化写入，且必须哈希存储。
- 推荐使用 HTTP-only Cookie 保存登录态。
- 除 `/api/auth/login` 外，业务接口默认需要登录。
- 登录失败需要限频。
- 日志不能输出密码。

## 4. 设计稿

设计稿文件：`designs/login.svg`

桌面端：

- 页面背景为浅灰蓝 `#f6f8fb`。
- 中间放置登录卡片。
- 左上或卡片上方展示 `PT Automation` 品牌说明。
- 登录卡片包含标题、用户名、密码、登录按钮、默认账号提示。

移动端：

- 登录卡片占据主要宽度。
- 品牌说明上移。
- 表单字段单列排列。
- 按钮宽度铺满登录卡片。

## 5. 执行清单

- 创建 `/login` 路由。
- 创建 `LoginPage.vue`。
- 实现用户名和密码表单。
- 默认填入用户名 `admin`。
- 实现密码显示和隐藏。
- 实现表单必填校验。
- 实现登录按钮 loading 状态。
- 创建认证 API 客户端。
- 调用 `POST /api/auth/login`。
- 登录成功后请求 `GET /api/auth/me` 或写入当前用户状态。
- 登录成功后跳转 `/dashboard`。
- 登录失败时显示错误提示。
- 实现 `authStore` 当前用户状态。
- 实现路由守卫：未登录访问业务页跳转 `/login`。
- 实现路由守卫：已登录访问 `/login` 跳转 `/dashboard`。
- 实现 API `401` 统一处理。
- 后端实现登录接口。
- 后端实现登出接口。
- 后端实现当前用户接口。
- 后端实现修改密码接口。
- 后端实现密码哈希校验。
- 后端实现登录失败限频。

## 6. TODO

- [ ] 确认登录态采用 HTTP-only Cookie 还是 JWT 返回前端存储。
- [ ] 确认登录态默认过期时间，推荐 7 天。
- [ ] 确认首次登录后是否提示修改默认密码。
- [ ] 定义登录失败限频策略。
- [ ] 补充登录接口错误码约定。

## 7. 验收标准

- 默认密码不在页面展示。
- 用户名默认填入 `admin`。
- 用户名或密码为空时不发起登录请求。
- 登录成功后进入 `/dashboard`。
- 登录失败时显示明确错误。
- 未登录访问 `/dashboard`、`/sites` 会跳转 `/login`。
- 已登录访问 `/login` 会跳转 `/dashboard`。

## 8. 开发补充规范

页面入口和跳转：

- `/login` 不使用后台主布局，避免未登录状态加载业务导航。
- 登录成功默认跳转 `/dashboard`。
- 如果路由守卫携带 `redirect` 查询参数，登录成功后优先跳转原访问地址。
- 点击退出登录后调用 `POST /api/auth/logout`，成功后清空 `authStore` 并跳转 `/login`。

前端状态：

```ts
type AuthState = {
  user?: { id: string; username: string; passwordChangedAt?: string }
  initialized: boolean
  loading: boolean
}
```

异常和 loading：

- 首次进入业务页面时先调用 `GET /api/auth/me` 判断登录态。
- `GET /api/auth/me` 返回 `401` 时不显示错误 snackbar，直接跳转登录页。
- 登录提交中按钮显示 loading，并禁用用户名和密码输入框。
- 网络错误展示“登录失败，请稍后重试”。

后端处理：

- 用户不存在时初始化流程创建 `admin`，登录接口本身不创建用户。
- 密码校验使用 `bcrypt` 或 `argon2`。
- 登录成功后更新 `lastLoginAt`。
- 修改密码成功后更新 `passwordChangedAt`。
- 登录失败响应不区分用户名不存在和密码错误。

安全要求：

- Cookie 必须设置 `httpOnly`。
- 生产环境 Cookie 建议设置 `sameSite=lax`，HTTPS 下设置 `secure`。
- 日志不得记录密码、Cookie、Authorization 头。
- 登录失败限频维度至少包含 IP，推荐同时包含用户名。
