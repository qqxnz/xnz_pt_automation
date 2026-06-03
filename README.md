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
| [docs/login-plan.md](docs/login-plan.md) | 登录模块方案、设计稿说明、执行清单和 TODO。 |
| [docs/dashboard-plan.md](docs/dashboard-plan.md) | 首页模块方案、设计稿说明、执行清单和 TODO。 |
| [docs/sites-plan.md](docs/sites-plan.md) | 站点模块方案、设计稿说明、执行清单和 TODO。 |
| [docs/free-torrents-plan.md](docs/free-torrents-plan.md) | 免费种子模块方案、执行清单和 TODO。 |
| [docs/qbittorrent-plan.md](docs/qbittorrent-plan.md) | qBittorrent 模块方案、执行清单和 TODO。 |
| [docs/proxies-plan.md](docs/proxies-plan.md) | 代理管理模块方案、执行清单和 TODO。 |
| [docs/statistics-plan.md](docs/statistics-plan.md) | 数据统计模块方案、执行清单和 TODO。 |
| [docs/jobs-plan.md](docs/jobs-plan.md) | 定时任务模块方案、执行清单和 TODO。 |
| [docs/settings-plan.md](docs/settings-plan.md) | 系统设置模块方案、执行清单和 TODO。 |
| [designs/design-spec.md](designs/design-spec.md) | 设计规范、设计稿产出规则和文件命名约定。 |
| [designs/login.svg](designs/login.svg) | 登录页设计稿。 |
| [designs/dashboard.svg](designs/dashboard.svg) | Dashboard 设计稿。 |
| [designs/sites.svg](designs/sites.svg) | 站点管理页设计稿。 |
| [designs/sites-form.svg](designs/sites-form.svg) | 站点新增与编辑弹窗设计稿。 |

## 当前进度

| 模块 | 设计稿 | 方案&执行清单 | 开发完成 | 说明 |
| --- | --- | --- | --- | --- |
| 登录 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/login.svg`，`docs/login-plan.md`。 |
| 首页 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/dashboard.svg`，`docs/dashboard-plan.md`。 |
| 站点 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/sites.svg`、`designs/sites-form.svg`，`docs/sites-plan.md`。 |
| 免费种子 | ⬜ 未开始 | ✅ 已完成 | ⬜ 未开始 | 待生成 `designs/free-torrents.svg`，已完成 `docs/free-torrents-plan.md`。 |
| qBittorrent | ⬜ 未开始 | ✅ 已完成 | ⬜ 未开始 | 待生成 `designs/qbittorrent.svg`，已完成 `docs/qbittorrent-plan.md`。 |
| 代理管理 | ⬜ 未开始 | ✅ 已完成 | ⬜ 未开始 | 待生成 `designs/proxies.svg`，已完成 `docs/proxies-plan.md`。 |
| 数据统计 | ⬜ 未开始 | ✅ 已完成 | ⬜ 未开始 | 待生成 `designs/statistics.svg`，已完成 `docs/statistics-plan.md`。 |
| 定时任务 | ⬜ 未开始 | ✅ 已完成 | ⬜ 未开始 | 待生成 `designs/jobs.svg`，已完成 `docs/jobs-plan.md`。 |
| 系统设置 | ⬜ 未开始 | ✅ 已完成 | ⬜ 未开始 | 待生成 `designs/settings.svg`，已完成 `docs/settings-plan.md`。 |

## 设计稿产出规则

后续新增或调整设计稿时，只输出 `.svg` 文件，不再额外生成 PNG 或其他扁平化预览文件。详细规则见 [designs/design-spec.md](designs/design-spec.md)。

## 模块方案规范

每个模块的【方案&执行清单】必须达到 AI 读取后即可完成该模块所有功能开发的粒度，包含业务边界、页面状态、接口、数据结构、交互、异常、安全、执行清单、TODO 和验收标准。
