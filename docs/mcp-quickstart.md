# MCP 接入快速上手

> PT Automation v0.6.45 起内置 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 接入，让 Claude / Cursor / 自定义 Agent 通过自然语言完成「查站点、看任务、推送种子、跑签到」等操作。

## 1. 在 Web 端生成 Token

1. 登录系统 → **系统设置** → 顶部点击 **MCP 接入**。
2. 点击右上角 **生成新 Token**。
3. 填写名称（建议备注「绑哪个客户端 / 哪台机器」），勾选 **允许写入**（如果 Agent 需要推送/删除/签到）。
4. 点击 **生成** → 复制弹窗中的 `tk_xxxxxxxx` 明文（**仅显示一次**）→ 保存到密码管理器。

> **重要**：Token 是 Agent 访问系统的唯一凭据，等同于管理员账号。生成后请勿在聊天截图、公开仓库或论坛上贴出。

## 2. HTTP 模式（推荐用于本地/同网段 Agent）

### 端点

```text
POST http://<nas-ip>:3180/mcp
GET  http://<nas-ip>:3180/mcp
Content-Type: application/json
X-MCP-Token: tk_xxxxxxxxxxxxxxxx
```

### 默认安全策略

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `mcp_enabled` | `false` | 必须在【系统设置】中开启（也可改 `mcp_enabled` 字段） |
| `mcp_require_loopback` | `true` | 默认仅 `127.0.0.1`/`::1` 可访问；远程 Agent 需关闭此开关 |

如需远程 Agent 接入 NAS：

1. 进入**系统设置**→ 高级 → 关闭 `mcp_require_loopback`。
2. 在 NAS 上启用 HTTPS 反代（强烈建议，避免 Token 明文在网络上传输）。
3. 在反代上设置访问控制（IP 白名单或 basic auth 二选一）。

### Claude Desktop 配置示例

> `~/.config/Claude/claude_desktop_config.json`（macOS）或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows）。

```jsonc
{
  "mcpServers": {
    "xnz-pt": {
      "type": "streamableHttp",
      "url": "https://your-nas.example.com/mcp",
      "headers": {
        "X-MCP-Token": "tk_xxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## 3. stdio 模式（容器内/本机直连）

如果你的 Agent 跑在容器内或同一台机器，可以用 stdio 模式直接拉起：

```bash
PTA_API_URL=http://localhost:3180 \
PTA_MCP_TOKEN=tk_xxxxxxxxxxxxxxxx \
node backend/dist/mcp/cli.js stdio
```

或通过 npm bin（在装了所有/已编译后）：

```bash
PTA_API_URL=http://localhost:3180 PTA_MCP_TOKEN=tk_xxx npx mcp-server stdio
```

Claude Desktop 的 stdio 配置：

```jsonc
{
  "mcpServers": {
    "xnz-pt": {
      "command": "node",
      "args": ["/path/to/xnz_pt_automation/backend/dist/mcp/cli.js", "stdio"],
      "env": {
        "PTA_API_URL": "http://localhost:3180",
        "PTA_MCP_TOKEN": "tk_xxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

> stdio 模式下 backend 与 Agent 是两个独立进程，stdio 仅做协议转换。HTTP 入口仍需 `mcp_enabled=true`，且本机/同机部署可绕过 `mcp_require_loopback`。

## 4. 自带的工具一览

| 工具 | 读/写 | 说明 |
| --- | --- | --- |
| `list_sites` | R | 列出 PT 站点（**去除** apiKey/cookie 明文） |
| `get_site` | R | 查看单个站点详情 |
| `test_site_connectivity` | R | 测试站点连通性（取缓存状态） |
| `signin_site` | **W** | 手动签到指定站点 |
| `list_downloaders` | R | 列出下载器（去除 password） |
| `test_downloader` | R | 测试下载器连通性（实际握手 + 落库） |
| `list_tasks` | R | 列出任务（支持按 enabled/siteId 下载器筛选） |
| `get_task` | R | 查看单个任务 |
| `run_task` | **W** | 立即运行任务（异步入队） |
| `list_torrents` | R | 分页查询种子（去除 downloadUrl 明文） |
| `push_torrents` | **W** | 批量推送种子到下载器 |
| `delete_torrents` | **W** | 批量删除种子记录 |
| `query_logs` | R | 查询 5 类日志（operation/task/schedule/signin/torrent/notification） |
| `get_settings` | R | 读取系统设置（隐藏 proxyTestUrl） |
| `get_system_info` | R | 读取版本、数据库、路径 |
| `get_scheduler_jobs` | R | 读取调度器任务列表 |
| `get_app_state` | R | 读取应用启动状态机 |

> 标 **W** 的工具需要 Token 在生成时勾选「允许写入」，否则会返回 `-32002 FORBIDDEN`。

## 5. 自带的 Resources / Prompts

- **Resources**
  - `pt://system/info` — 系统信息快照
  - `pt://system/scheduler` — 调度器任务列表
- **Prompts**
  - `daily-checkup` — 让 Agent 帮你做每日例行检查
  - `cleanup-low-speeds` — 让 Agent 协助识别低速种子

## 6. 烟雾测试

确认服务起来后，跑：

```bash
MCP_URL=http://localhost:3180/mcp \
MCP_TOKEN=tk_xxxxxxxx \
bash scripts/mcp-smoke.sh
```

成功时会输出 `smoke test passed` 和 `tool count: 17`。

## 7. 常见问题

**Q：401 / Token invalid**
A：检查 `X-MCP-Token` 是否与【系统设置 → MCP 接入】里的 Token 完全一致；确认 Token 没被禁用 / 过期。

**Q：-32002 FORBIDDEN**
A：写工具被拒绝。需要在生成 Token 时勾选「允许写入」，或重新生成一个 allow_writes=1 的 Token。

**Q：远程 Agent 连不上**
A：默认 `mcp_require_loopback=true`，需要在【系统设置】中关闭；并确保反代暴露 `/mcp` 路径（注意：`/api/*` 与 `/mcp` 是不同前缀）。

**Q：Agent 调用写操作后我没看到日志**
A：所有 MCP 写操作都会在【日志 → 操作日志】中记录，actor 字段为 `mcp:<token 名称>`，可按此过滤。