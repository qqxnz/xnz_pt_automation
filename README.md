# PT 自动化系统

面向个人或家庭 NAS 的 PT 自动化系统，用于抓取 PT 站点免费种子、推送到 qBittorrent、检查免费时间过期并按规则删除，同时统计各 PT 站点上传量、下载量和分享率等数据。

## 文档结构

```text
README.md
项目汇总、说明、文档索引和当前进度。

docs/
项目涉及的总览文档，以及具体模块的设计和执行清单。

designs/
设计规范文档和设计稿。后续设计稿仅输出 SVG。
```

## 文档索引

| 文档 | 说明 |
| --- | --- |
| [docs/pt-automation-technical-design.md](docs/pt-automation-technical-design.md) | 项目技术方案总览，包含架构、技术选型、核心功能、API、数据库、部署和实施顺序。 |
| [docs/ui-design-login-sites.md](docs/ui-design-login-sites.md) | 登录与站点管理模块设计，以及对应执行清单。 |
| [designs/design-spec.md](designs/design-spec.md) | 设计规范、设计稿产出规则和文件命名约定。 |
| [designs/login.svg](designs/login.svg) | 登录页设计稿。 |
| [designs/dashboard.svg](designs/dashboard.svg) | Dashboard 设计稿。 |
| [designs/sites.svg](designs/sites.svg) | 站点管理页设计稿。 |

## 当前进度

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 项目技术方案 | 已完成 | 已整理整体架构、MVP 范围和推荐开发顺序。 |
| 登录与站点管理设计 | 已完成 | 已整理页面结构、交互、接口和响应式规则。 |
| 设计稿 | 已完成部分 | 已有登录页、Dashboard、站点管理页 SVG 设计稿。 |
| 工程实现 | 未开始 | 待初始化前后端、数据库、Docker 和业务模块。 |

## 设计稿产出规则

后续新增或调整设计稿时，只输出 `.svg` 文件，不再额外生成 PNG 或其他扁平化预览文件。详细规则见 [designs/design-spec.md](designs/design-spec.md)。
