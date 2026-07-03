# PT 自动化系统

面向个人或家庭 NAS 的 PT 自动化系统，用于按任务规则抓取 PT 站点种子、推送到下载器、检查免费时间过期并按规则删除，同时统计各 PT 站点上传量、下载量和分享率等数据。当前下载器类型优先支持 qBittorrent/QB，后续可扩展到其他种子下载工具。

## Docker 部署

当前镜像发布在 Docker Hub：

```bash
docker pull qqxnz/xnz-pt-automation:0.5.0
```

推荐使用 `docker compose` 启动：

```yaml
services:
  xnz-pt-automation:
    image: qqxnz/xnz-pt-automation:0.5.0
    container_name: xnz-pt-automation
    restart: unless-stopped
    ports:
      - "3180:3180"
    environment:
      PORT: "3180"
      DATA_DIR: /data
      DEFAULT_ADMIN_PASSWORD: "123456"
      TZ: Asia/Shanghai
    volumes:
      - ./data:/data
```

启动后访问：

```text
http://localhost:3180
```

默认账号：

```text
用户名：admin
密码：123456
```

也可以直接用 `docker run`：

```bash
docker run -d \
  --name xnz-pt-automation \
  --restart unless-stopped \
  -p 3180:3180 \
  -e DEFAULT_ADMIN_PASSWORD=123456 \
  -v "$(pwd)/data:/data" \
  qqxnz/xnz-pt-automation:0.5.0
```

### 镜像版本

- `qqxnz/xnz-pt-automation:0.5.0`：当前稳定版本，推荐部署时使用固定版本。
- `qqxnz/xnz-pt-automation:latest`：指向最新发布版本，适合测试或快速体验。

升级到新版本时，先拉取新镜像，再重建容器：

```bash
docker compose pull
docker compose up -d
```

升级时数据库结构会自动迁移。详细日志会输出到 `docker logs`（看到 `⏳ DATABASE UPGRADE IN PROGRESS` 即表示正在升级）。如果升级失败，docker 会自动从备份恢复并重试。详见 [docs/docker-upgrade.md](docs/docker-upgrade.md) 与 [docs/database-migration.md](docs/database-migration.md)。

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
| [docs/database-migration.md](docs/database-migration.md) | 数据库迁移规范、新增字段/表 checklist、升级失败恢复。 |
| [docs/docker-upgrade.md](docs/docker-upgrade.md) | Docker 升级排错指南、备份恢复、`/api/health` 状态对照表。 |
| [docs/ui-design-login-sites.md](docs/ui-design-login-sites.md) | 登录与站点模块设计，以及对应执行清单。 |
| [docs/login-plan.md](docs/login-plan.md) | 登录模块方案、设计稿说明、执行清单和 TODO。 |
| [docs/dashboard-plan.md](docs/dashboard-plan.md) | 首页模块方案、设计稿说明、执行清单和 TODO。 |
| [docs/sites-plan.md](docs/sites-plan.md) | 站点模块方案、设计稿说明、执行清单和 TODO。 |
| [docs/torrents-plan.md](docs/torrents-plan.md) | 种子模块方案、执行清单和 TODO。 |
| [docs/downloaders-plan.md](docs/downloaders-plan.md) | 下载器模块方案、执行清单和 TODO。 |
| [docs/proxies-plan.md](docs/proxies-plan.md) | 代理管理模块方案、执行清单和 TODO。 |
| [docs/statistics-plan.md](docs/statistics-plan.md) | 数据统计模块方案、执行清单和 TODO。 |
| [docs/tasks-plan.md](docs/tasks-plan.md) | 任务模块方案、执行清单和 TODO。 |
| [docs/logs-plan.md](docs/logs-plan.md) | 日志模块方案、执行清单和 TODO。 |
| [docs/settings-plan.md](docs/settings-plan.md) | 系统设置模块方案、执行清单和 TODO。 |
| [designs/design-spec.md](designs/design-spec.md) | 设计规范、设计稿产出规则和文件命名约定。 |
| [designs/login.svg](designs/login.svg) | 登录页设计稿。 |
| [designs/dashboard.svg](designs/dashboard.svg) | Dashboard 设计稿。 |
| [designs/sites.svg](designs/sites.svg) | 站点页设计稿。 |
| [designs/sites-form.svg](designs/sites-form.svg) | 站点新增与编辑弹窗设计稿。 |
| [designs/downloaders.svg](designs/downloaders.svg) | 下载器页设计稿。 |
| [designs/downloaders-form.svg](designs/downloaders-form.svg) | 下载器新增与编辑弹窗设计稿。 |

## 当前进度

| 模块 | 设计稿 | 方案&执行清单 | 开发完成 | 说明 |
| --- | --- | --- | --- | --- |
| 登录 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/login.svg`，`docs/login-plan.md`。 |
| 首页 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/dashboard.svg`，`docs/dashboard-plan.md`。 |
| 站点 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/sites.svg`、`designs/sites-form.svg`，`docs/sites-plan.md`。 |
| 种子 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/torrents.svg`，`docs/torrents-plan.md`。 |
| 下载器 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/downloaders.svg`、`designs/downloaders-form.svg`，`docs/downloaders-plan.md`。 |
| 代理管理 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/proxies.svg`，`docs/proxies-plan.md`。 |
| 数据统计 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/statistics.svg`，`docs/statistics-plan.md`。 |
| 任务 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/tasks.svg`，`docs/tasks-plan.md`。 |
| 日志 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/logs.svg`，`docs/logs-plan.md`。 |
| 系统设置 | ✅ 已完成 | ✅ 已完成 | ⬜ 未开始 | `designs/settings.svg`，`docs/settings-plan.md`。 |

## 开发前限制规则

每个功能模块开发前，必须先检查本文件【当前进度】表中该模块的【设计稿】和【方案&执行清单】状态。

- 两项都为 `✅ 已完成` 时，才能进入该模块功能开发。
- 任意一项不是 `✅ 已完成` 时，必须先提示缺失项，并暂停该模块功能开发。
- 缺失设计稿时，先补齐 `designs/` 下对应 SVG 设计稿。
- 缺失方案&执行清单时，先补齐 `docs/` 下对应模块方案文档和可执行开发清单。
- 补齐后同步更新【当前进度】表，再继续开发。

## 设计稿产出规则

后续新增或调整设计稿时，只输出 `.svg` 文件，不再额外生成 PNG 或其他扁平化预览文件。详细规则见 [designs/design-spec.md](designs/design-spec.md)。

## 当前设计决策

- 站点 User-Agent 新增时默认取当前浏览器 `navigator.userAgent`，也可以手动自定义。
- 站点代理默认不使用；需要代理时从【代理管理】模块选择一个已启用代理，不设计全局默认代理。

## 模块方案规范

每个模块的【方案&执行清单】必须达到 AI 读取后即可完成该模块所有功能开发的粒度，包含业务边界、页面状态、接口、数据结构、交互、异常、安全、执行清单、TODO 和验收标准。
