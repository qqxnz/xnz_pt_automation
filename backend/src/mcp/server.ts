import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  listTorrentsTool,
  pushTorrents,
  deleteTorrentsTool
} from './tools/torrents.js'
import {
  listSites,
  getSite,
  testSiteConnectivity,
  signinSite
} from './tools/sites.js'
import { listDownloaders, testDownloader } from './tools/downloaders.js'
import { listTasks, getTask, runTask } from './tools/tasks.js'
import { queryLogsTool } from './tools/logs.js'
import {
  getSettingsTool,
  getSystemInfo,
  getSchedulerJobsTool,
  getAppStateTool
} from './tools/system.js'
import { assertWriteAllowed, touchTokenAsync } from './auth.js'
import { withTimeout, McpToolError } from './errors.js'
import type { McpContext } from './context.js'
import { isWriteTool } from './context.js'
import type { ApiTokenRecord } from '../storage.js'

type McpAuthExtra = {
  token: ApiTokenRecord
  caller?: McpContext['caller']
  remoteAddress?: string
}

export function createMcpServer() {
  const server = new McpServer(
    {
      name: 'xnz-pt-automation',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      instructions:
        'PT 自动化系统的 MCP 控制台。可查询站点/下载器/任务/种子/调度等只读数据；启用 allow_writes 后可签到站点、运行任务、推送与删除种子。Token 在 HTTP Header X-MCP-Token 中携带。'
    }
  )

  // ---- 工具：sites ----
  server.registerTool(
    'list_sites',
    {
      description: '列出所有 PT 站点（去除 apiKey/cookie 等敏感字段）',
      inputSchema: { keyword: z.string().optional(), enabled: z.boolean().optional() }
    },
    async (input: { keyword?: string; enabled?: boolean }, extra) =>
      runReadTool(extra, 'list_sites', async () => listSites(input))
  )

  server.registerTool(
    'get_site',
    {
      description: '获取单个 PT 站点的完整配置（去除敏感字段）',
      inputSchema: { id: z.string().min(1) }
    },
    async (input: { id: string }, extra) =>
      runReadTool(extra, 'get_site', async () => getSite(input))
  )

  server.registerTool(
    'test_site_connectivity',
    {
      description: '测试单个 PT 站点连通性',
      inputSchema: { id: z.string().min(1) }
    },
    async (input: { id: string }, extra) =>
      runReadTool(extra, 'test_site_connectivity', async () =>
        testSiteConnectivity(input, ctxOf(extra))
      )
  )

  server.registerTool(
    'signin_site',
    {
      description: '对单个 PT 站点手动签到（写操作）',
      inputSchema: { id: z.string().min(1) }
    },
    async (input: { id: string }, extra) =>
      runWriteTool(extra, 'signin_site', async () => signinSite(input, ctxOf(extra)))
  )

  // ---- 工具：downloaders ----
  server.registerTool(
    'list_downloaders',
    {
      description: '列出所有下载器（去除 password 字段）',
      inputSchema: {
        keyword: z.string().optional(),
        status: z.enum(['UNKNOWN', 'ONLINE', 'OFFLINE', 'AUTH_FAILED']).optional()
      }
    },
    async (
      input: { keyword?: string; status?: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED' },
      extra
    ) => runReadTool(extra, 'list_downloaders', async () => listDownloaders(input))
  )

  server.registerTool(
    'test_downloader',
    {
      description: '测试单个下载器连通性',
      inputSchema: { id: z.string().min(1) }
    },
    async (input: { id: string }, extra) =>
      runReadTool(extra, 'test_downloader', async () => testDownloader(input, ctxOf(extra)))
  )

  // ---- 工具：tasks ----
  server.registerTool(
    'list_tasks',
    {
      description: '列出所有任务',
      inputSchema: {
        enabled: z.boolean().optional(),
        siteId: z.string().optional(),
        downloaderId: z.string().optional()
      }
    },
    async (
      input: { enabled?: boolean; siteId?: string; downloaderId?: string },
      extra
    ) => runReadTool(extra, 'list_tasks', async () => listTasks(input))
  )

  server.registerTool(
    'get_task',
    {
      description: '查看单个任务详情',
      inputSchema: { id: z.string().min(1) }
    },
    async (input: { id: string }, extra) =>
      runReadTool(extra, 'get_task', async () => getTask(input))
  )

  server.registerTool(
    'run_task',
    {
      description: '立即运行指定任务（写操作）',
      inputSchema: { id: z.string().min(1) }
    },
    async (input: { id: string }, extra) =>
      runWriteTool(extra, 'run_task', async () => runTask(input, ctxOf(extra)))
  )

  // ---- 工具：torrents ----
  server.registerTool(
    'list_torrents',
    {
      description: '分页查询种子（去除 downloadUrl 明文）',
      inputSchema: {
        keyword: z.string().optional(),
        siteId: z.string().optional(),
        downloaderId: z.string().optional(),
        taskId: z.string().optional(),
        pushStatus: z.enum(['ALL', 'NEW', 'PUSHED', 'PUSH_FAILED', 'DELETED']).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional()
      }
    },
    async (
      input: {
        keyword?: string
        siteId?: string
        downloaderId?: string
        taskId?: string
        pushStatus?: 'ALL' | 'NEW' | 'PUSHED' | 'PUSH_FAILED' | 'DELETED'
        page?: number
        pageSize?: number
      },
      extra
    ) => runReadTool(extra, 'list_torrents', async () => listTorrentsTool(input))
  )

  server.registerTool(
    'push_torrents',
    {
      description: '批量推送种子到下载器（写操作）',
      inputSchema: { ids: z.array(z.string().min(1)).min(1) }
    },
    async (input: { ids: string[] }, extra) =>
      runWriteTool(extra, 'push_torrents', async () => pushTorrents(input, ctxOf(extra)))
  )

  server.registerTool(
    'delete_torrents',
    {
      description: '批量删除种子记录（写操作）',
      inputSchema: { ids: z.array(z.string().min(1)).min(1) }
    },
    async (input: { ids: string[] }, extra) =>
      runWriteTool(extra, 'delete_torrents', async () => deleteTorrentsTool(input, ctxOf(extra)))
  )

  // ---- 工具：logs ----
  server.registerTool(
    'query_logs',
    {
      description: '查询操作/任务/调度/签到/种子/通知日志',
      inputSchema: {
        type: z.enum(['operation', 'task', 'schedule', 'signin', 'torrent', 'notification']),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
        keyword: z.string().optional(),
        status: z.string().optional(),
        taskId: z.string().optional(),
        runMode: z.string().optional(),
        siteId: z.string().optional()
      }
    },
    async (
      input: {
        type: 'operation' | 'task' | 'schedule' | 'signin' | 'torrent' | 'notification'
        page?: number
        pageSize?: number
        keyword?: string
        status?: string
        taskId?: string
        runMode?: string
        siteId?: string
      },
      extra
    ) => runReadTool(extra, 'query_logs', async () => queryLogsTool(input))
  )

  // ---- 工具：system ----
  server.registerTool(
    'get_settings',
    { description: '读取系统设置（隐藏 proxyTestUrl）' },
    async (extra) => runReadTool(extra, 'get_settings', async () => getSettingsTool())
  )

  server.registerTool(
    'get_system_info',
    { description: '读取系统信息（版本、数据库、路径）' },
    async (extra) => runReadTool(extra, 'get_system_info', async () => getSystemInfo())
  )

  server.registerTool(
    'get_scheduler_jobs',
    { description: '读取调度器任务列表' },
    async (extra) =>
      runReadTool(extra, 'get_scheduler_jobs', async () => getSchedulerJobsTool())
  )

  server.registerTool(
    'get_app_state',
    { description: '读取应用启动状态机' },
    async (extra) => runReadTool(extra, 'get_app_state', async () => getAppStateTool())
  )

  // ---- 资源 ----
  server.registerResource(
    'system-info',
    'pt://system/info',
    { description: '系统信息快照', mimeType: 'application/json' },
    async (uri) => {
      const data = await getSystemInfo()
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }]
      }
    }
  )

  server.registerResource(
    'scheduler-jobs',
    'pt://system/scheduler',
    { description: '调度器任务列表快照', mimeType: 'application/json' },
    async (uri) => {
      const data = await getSchedulerJobsTool()
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }]
      }
    }
  )

  // ---- Prompts ----
  server.registerPrompt(
    'daily-checkup',
    { description: '每日例行检查（连通性 + 任务状态 + 调度日志）' },
    async () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: '请按以下步骤执行 PT 自动化系统的每日检查：\n1) 调用 get_system_info、get_scheduler_jobs 了解当前系统状态；\n2) 调用 list_sites、list_downloaders 检查所有已启用站点的连通性和下载器状态；\n3) 调用 query_logs(type="schedule", pageSize=10) 检查最近一次定时任务执行结果；\n4) 调用 query_logs(type="operation", pageSize=20) 查找最近 24 小时内的失败操作；\n5) 总结发现并给出建议（如站点 OFFLINE、下载器异常、任务失败等）。'
          }
        }
      ]
    })
  )

  server.registerPrompt(
    'cleanup-low-speeds',
    { description: '协助识别与处理低速种子' },
    async () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: '请协助我处理低速种子：\n1) 调用 list_torrents(pushStatus="PUSHED") 找出已推送但有上传速度问题的种子；\n2) 优先关注最近 push_torrents 推送的、新鲜度高的种子；\n3) 对候选种子给出清理建议（保留 / 删除 / 调整限速规则）；\n4) 调用 delete_torrents 或 push_torrents 等写工具前必须由人工确认。'
          }
        }
      ]
    })
  )

  return server
}

// ===== helper =====

type McpExtraLike = {
  sessionId?: string
  authInfo?: { token?: string; clientId?: string; scopes?: string[]; extra?: Record<string, unknown> }
}

function ctxOf(extra: McpExtraLike): McpContext {
  const extraData = extra.authInfo?.extra as McpAuthExtra | undefined
  // stdio / 单实例 http 模式：cli.ts 把 token 放到 globalThis.__MCP_AUTH__
  const fallback = (globalThis as Record<string, unknown>).__MCP_AUTH__ as McpAuthExtra | undefined
  const data: McpAuthExtra | undefined = extraData?.token ? extraData : fallback?.token ? fallback : undefined
  if (!data?.token) {
    throw new McpToolError(-32002, 'MCP 上下文缺失 Token（authInfo 与 globalThis.__MCP_AUTH__ 都为空）')
  }
  return {
    token: data.token,
    requestId: extra.sessionId ?? 'inproc',
    caller: data.caller ?? 'inproc',
    remoteAddress: data.remoteAddress
  }
}

async function runReadTool(extra: McpExtraLike, name: string, fn: () => Promise<unknown>) {
  const ctx = ctxOf(extra)
  touchTokenAsync(ctx.token.id)
  const data = await withTimeout(Promise.resolve().then(fn), 30_000, name)
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
}

async function runWriteTool(extra: McpExtraLike, name: string, fn: () => Promise<unknown>) {
  if (!isWriteTool(name)) {
    throw new McpToolError(-32002, `工具 ${name} 未注册为写操作`)
  }
  const ctx = ctxOf(extra)
  assertWriteAllowed(ctx.token)
  touchTokenAsync(ctx.token.id)
  const data = await withTimeout(Promise.resolve().then(fn), 30_000, name)
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
}