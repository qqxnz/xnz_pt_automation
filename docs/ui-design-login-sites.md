# 登录与站点设计稿

## 1. 设计定位

前端使用 `Vue 3 + Vite + Varlet UI`。系统主要部署在 NAS 上，访问场景包括桌面浏览器、平板和手机，因此页面采用响应式布局。

## 2. 视觉规范

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

## 3. 登录页

路径：`/login`

登录表单：

```ts
type LoginForm = {
  username: string
  password: string
}
```

交互：

```text
输入账号密码
点击登录
POST /api/auth/login
成功跳转 /dashboard
失败显示 snackbar
```

## 4. 站点页

路径：`/sites`

顶部：

- 标题：站点。
- 说明：管理 PT 站点域名、API Key、Cookie、代理、连通状态和用户统计。
- 主操作：新增站点。

统计卡片：

```text
全部站点
在线站点
认证失败
离线站点
未知状态
```

筛选：

```text
关键词搜索
连通状态
代理状态
启用状态
刷新
```

表格字段：

```text
站点
连通状态
用户等级
分享率
上传量
下载量
凭证
操作
```

操作按钮：

```text
测试
浏览
编辑
删除
```

移动端使用卡片展示同样字段，用户等级、分享率、上传量、下载量组成两列指标区。

## 5. 站点表单

新增和编辑共用弹窗。

字段：

```text
基础信息
  站点域名
  启用站点

访问凭证
  API Key
  Cookie
  User-Agent
  恢复当前浏览器 User-Agent

代理配置
  使用代理
```

移除字段：

```text
站点名称
解析类型
种子地址
个人信息地址
检查间隔
```

校验：

- 站点域名必填且合法。
- API Key 和 Cookie 至少填写一个。
- 敏感字段编辑时留空表示不修改。

## 6. 浏览弹窗

标题：`浏览 - 站点显示名`

顶部控件：

```text
搜索关键字
资源分类
搜索按钮
结果数量
每页数量
```

表格字段：

```text
标题
时间
大小
做种
下载
```

第一版不展示右侧菜单，不实现查看详情或下载种子文件。

## 7. 站点映射和特殊规则

```text
m-team.cc      馒头
hhanclub.net   憨憨
hdhome.org     家园
hdkyl.in       麒麟
```

- 未知域名允许保存，显示域名本身，并默认按 NexusPHP 处理。
- M-Team 使用 API Key 调用 M-Team API。
- 普通站点使用 Cookie 访问 NexusPHP 页面。
- API Key 优先，失败后回退 Cookie。

## 8. v0.5.0 实际实现差异

> 本节记录前端实际 UI 与上文的差异。

### 8.1 站点表单

- 实际"访问凭证"分组包含：`apiKey`（带显示/隐藏切换 + "已保存留空不修改"提示）/ `cookie`（同上）/ `userAgent`（含"恢复当前浏览器"按钮）
- **新增**"签到设置"分组：`signinEnabled` 开关 + `signinTime`（HTML5 pattern `^([01]\d|2[0-3]):[0-5]\d$`）
- 移除"代理配置"分组；改由"代理管理"模块维护，站点表单通过 `proxyId` 引用（**v0.5.0 代理 CRUD 未实现，proxyId 当前仅作为字段存在**）
- `enabled` 默认 `true`

### 8.2 站点列表

- 工具栏：keyword / `connectivityStatus` / `enabled` / `signinEnabled` 4 个过滤项
- 表格列：站点 / 连通 / 等级 / 分享率 / 上传 / 下载 / **昨日上传 / 今日上传** / 凭证 / **签到** / 操作
- 移动端：卡片布局，相同字段
- 行操作：**签到** / **更新** / 浏览 / 编辑 / 删除
- 进入页面自动调用 `POST /api/sites/update-all` 触发 6h 周期同步；3s 轮询 `loadSites` 仅在存在 `updating` 时执行

### 8.3 浏览弹窗

- 实际字段：keyword 输入 + 类别下拉（可空）+ 搜索按钮 + 表格（标题 / 剩余免费 / 大小 / 做种 / 下载）
- 请求 `POST /api/sites/:id/browse-torrents` body `{ keyword, page, pageSize, category? }`

### 8.4 登录页

- 实际为两栏布局：左侧 hero（PT Automation + tagline）+ 右侧登录卡片
- 用户名默认填 `admin`，密码带显示/隐藏切换
- 提交后跳 `route.query.redirect` 或 `/dashboard`
- 失败由 `apiRequest` 统一 snackbar
- **不展示默认密码**

### 8.5 站点映射

实际 `SITE_METADATA` 包含 12 个站点（按 lower(domain) 匹配）：

- `m-team.cc` / `pt.m-team.cc` / `api.m-team.cc` → 馒头
- `hhanclub.net` / `www.hhanclub.net` → 憨憨
- `hdhome.org` / `www.hdhome.org` → 家园
- `hdkyl.in` / `www.hdkyl.in` → 麒麟
- `totheglory.im` / `www.totheglory.im` → 听听歌（`/browse.php?c=M`）
- `pt.keepfrds.com` / `keepfrds.com` → 朋友
- `ptchdbits.co` / `www.ptchdbits.co` → 彩虹岛
- `pterclub.net` / `pterclub.com` / `www.pterclub.com` → 猫站（`/attendance-ajax.php` JSON 响应）
- `ourbits.club` / `www.ourbits.club` → 我堡
- `pthome.net` / `www.pthome.net` → 铂金家
- `ubits.club` / `www.ubits.club` → 优堡
- `pttime.org` / `www.pttime.org` → 时间

### 8.6 站点名映射与 `name` 字段

- v10 迁移：按 `lower(domain)` 映射写入 `sites.name`；未知域名 `name = domain`
- 站点表单**不展示** name 字段（用户不可改），但 `GET /api/sites/:id` 仍返回

### 8.7 站点连通性测试诊断

- 失败响应 `lastConnectError` 包含 `finalUrl` / `httpStatus` / `bodyExcerpt` 三个诊断字段（`testSite` 抛出 `诊断信息: <json>` 形式）
- 前端详情页可见
