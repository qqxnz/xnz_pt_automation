# 站点模块方案

## 1. 模块目标

站点模块负责维护 PT 站点域名、API Key、Cookie、User-Agent、可选代理，并完成站点测试、用户统计获取和种子列表浏览。

第一版不兼容旧字段和旧数据结构：不再使用站点名称、解析类型、个人信息地址、种子地址、检查间隔。

## 2. 站点映射表

后端维护站点映射表 `SITE_DEFINITIONS`：

```text
m-team.cc      馒头   MTEAM_API
hhanclub.net   憨憨   NEXUSPHP
hdhome.org     家园   NEXUSPHP
hdkyl.in       麒麟   NEXUSPHP
```

规则：

- 用户只填写站点域名，显示名称由映射表决定。
- 支持同站多个域名，域名归一化后匹配映射表。
- 未知域名允许保存，显示域名本身，并默认按 NexusPHP 站点处理。
- M-Team 使用 API 特殊策略；普通站点和未知站点默认使用 Cookie 抓取 `/userdetails.php` 和 `/torrents.php`。

## 3. 表单

字段：

```ts
type SiteForm = {
  domain: string
  enabled: boolean
  apiKey?: string
  cookie?: string
  userAgent?: string
  proxyId?: string
}
```

校验：

- 站点域名必填，支持 `pt.m-team.cc` 或完整 URL。
- API Key 和 Cookie 至少填写一个。
- User-Agent 新增时默认使用当前浏览器。
- 代理默认不使用，只能选择已启用代理。

## 4. 列表

列表字段：

```text
站点
连通状态
用户等级
分享率
上传量
下载量
当前凭证
操作
```

当前凭证：

```text
API_KEY
COOKIE
NONE
```

操作：

```text
测试
浏览
编辑
删除
```

## 5. 测试和用户统计

测试接口：

```text
POST /api/sites/:id/test-connectivity
```

测试行为：

- API Key 优先。
- API Key 不可用时回退 Cookie。
- 成功后更新 `currentCredential`、连通状态、用户等级、分享率、上传量、下载量。
- 两种凭证都失败时标记认证失败，并保留错误原因。

M-Team：

- API：`POST https://api.m-team.cc/api/member/profile`
- Header：`x-api-key`
- 上传量：`data.memberCount.uploaded`
- 下载量：`data.memberCount.downloaded`
- 分享率：`data.memberCount.shareRate`
- 用户等级：按 API `data.role` 代码映射为中文显示名。

M-Team 等级映射：

```text
0 平民
1 用户
2 侠客
3 骑士
4 捕头
5 知县
6 通判
7 知州
8 总督
9 大臣
```

普通 NexusPHP 站点：

- 使用 Cookie 访问 `/userdetails.php`。
- 从 HTML 文本和图片 `title/alt` 中解析用户等级。
- 从页面文本解析分享率、上传量、下载量。

## 6. 浏览种子

接口：

```text
POST /api/sites/:id/browse-torrents
```

请求：

```ts
type BrowseTorrentsRequest = {
  keyword?: string
  category?: string
  page?: number
  pageSize?: number
}
```

响应：

```ts
type BrowseTorrentItem = {
  id: string
  title: string
  subtitle?: string
  createdAt?: string
  size?: number
  seeders?: number
  leechers?: number
  tags: string[]
}
```

浏览弹窗：

- 标题为 `浏览 - 站点显示名`。
- 展示关键词、资源分类、搜索按钮、结果数量和每页数量。
- 表格列为标题、时间、大小、做种、下载。
- 第一版不实现详情或下载动作。

## 7. 接口

```text
GET    /api/sites?keyword=&connectivityStatus=&proxyUsage=&enabled=&page=&pageSize=
POST   /api/sites
GET    /api/sites/:id
PUT    /api/sites/:id
DELETE /api/sites/:id
POST   /api/sites/:id/test-connectivity
POST   /api/sites/:id/browse-torrents
```

## 8. 执行清单

- 替换站点数据模型为新字段。
- 移除旧表单字段和旧接口入参。
- 实现站点映射表和域名归一化。
- 实现 API Key 优先、Cookie 回退的测试流程。
- 实现 M-Team API 用户统计和种子浏览。
- 实现 NexusPHP Cookie 用户统计和种子浏览。
- 实现浏览弹窗。
- 更新设计稿和 UI 文档。
- 通过后端、前端类型检查和完整构建。
