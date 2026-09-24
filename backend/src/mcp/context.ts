import type { ApiTokenRecord } from '../storage.js'

/**
 * 每次 Tool / Resource / Prompt 调用携带的上下文。
 * - token 是 ApiTokenRecord（已校验 enabled + 未过期）
 * - requestId 用于日志串联
 * - caller 区分 stdio / http / inproc
 */
export type McpCaller = 'http' | 'stdio' | 'inproc'

export type McpContext = {
  token: ApiTokenRecord
  requestId: string
  caller: McpCaller
  remoteAddress?: string
}

/** 工具描述（来自 registry，便于工具元信息聚合） */
export type McpToolKind = 'read' | 'write'

export type McpToolMeta = {
  name: string
  description: string
  kind: McpToolKind
  module: string
}

/** 当前已注册的工具列表，方便未来加 ACL / 文档导出 */
export const MCP_TOOL_REGISTRY: McpToolMeta[] = [
  { name: 'list_sites', description: '列出所有 PT 站点（去除敏感字段）', kind: 'read', module: 'sites' },
  { name: 'get_site', description: '查看单个站点详情', kind: 'read', module: 'sites' },
  { name: 'test_site_connectivity', description: '测试单个站点连通性', kind: 'read', module: 'sites' },
  { name: 'signin_site', description: '对单个站点手动签到', kind: 'write', module: 'sites' },
  { name: 'list_downloaders', description: '列出所有下载器（去除密码）', kind: 'read', module: 'downloaders' },
  { name: 'test_downloader', description: '测试单个下载器连通性', kind: 'read', module: 'downloaders' },
  { name: 'list_tasks', description: '列出所有任务', kind: 'read', module: 'tasks' },
  { name: 'get_task', description: '查看单个任务详情', kind: 'read', module: 'tasks' },
  { name: 'run_task', description: '立即运行指定任务', kind: 'write', module: 'tasks' },
  { name: 'list_torrents', description: '分页查询种子', kind: 'read', module: 'torrents' },
  { name: 'push_torrents', description: '批量推送种子到下载器', kind: 'write', module: 'torrents' },
  { name: 'delete_torrents', description: '批量删除种子记录', kind: 'write', module: 'torrents' },
  { name: 'query_logs', description: '查询操作/任务/调度/签到/种子日志', kind: 'read', module: 'logs' },
  { name: 'get_settings', description: '读取系统设置', kind: 'read', module: 'settings' },
  { name: 'get_system_info', description: '读取系统信息（版本、数据库、路径）', kind: 'read', module: 'system' },
  { name: 'get_scheduler_jobs', description: '读取调度器任务列表', kind: 'read', module: 'system' },
  { name: 'get_app_state', description: '读取应用启动状态机', kind: 'read', module: 'system' }
]

/** 用于工具 handler 内部判断是否为写操作 */
export function isWriteTool(name: string): boolean {
  return MCP_TOOL_REGISTRY.find((t) => t.name === name)?.kind === 'write'
}

/**
 * 把 MCP 调用写为 operation_log 的辅助。
 * - status: 'RUNNING' 映射为 'SUCCESS'（执行入队成功）
 * - 详情 / 错误信息追加到 message，不存到 details
 */
export function buildOperationLogPayload(args: {
  toolName: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  tokenName: string
  remoteAddress?: string
  message?: string
  errorMessage?: string
}) {
  const status: 'SUCCESS' | 'FAILED' = args.status === 'FAILED' ? 'FAILED' : 'SUCCESS'
  const prefix = `mcp tool: ${args.toolName}`
  let message = args.message ?? prefix
  if (args.errorMessage) message = `${message}（${args.errorMessage}）`
  return {
    action: prefix,
    message,
    actorId: 'mcp',
    actorName: `mcp:${args.tokenName}`,
    ip: args.remoteAddress,
    userAgent: 'mcp',
    status
  }
}