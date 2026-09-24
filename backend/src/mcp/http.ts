import type { Request, RequestHandler, Response } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from './server.js'
import { authenticateHttpRequest } from './auth.js'
import { readSystemSettings } from '../storage.js'
import { logger } from '../utils/logger.js'
import type { ApiTokenRecord } from '../storage.js'

/**
 * 在 /mcp 路由上挂的中间件：
 *  1) 校验 mcp_enabled
 *  3) 校验 mcp_require_loopback（HTTP 入口的默认安全策略）
 *  4) 校验 token，把 ApiTokenRecord 注入到 req.auth.extra
 *  5) 用 StreamableHTTPServerTransport 处理 JSON-RPC
 *
 * 注意：单实例下使用 stateless mode（每个请求独立 transport）；多实例需要 sticky session 才能用 stateful。
 */
export function createMcpHttpHandler(): RequestHandler {
  const transports = new Map<string, StreamableHTTPServerTransport>()

  return async (req: Request, res: Response) => {
    try {
      const settings = await readSystemSettings()
      if (!settings.mcpEnabled) {
        res.status(403).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32002, message: 'MCP 入口未启用（请在【系统设置】中开启 mcp_enabled）' }
        })
        return
      }
      if (settings.mcpRequireLoopback) {
        const remote = (req.ip ?? '').toString()
        const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
        if (!loopback) {
          res.status(403).json({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32002, message: 'MCP 入口仅允许本机访问；远程访问需关闭 mcp_require_loopback' }
          })
          return
        }
      }

      const auth = await authenticateHttpRequest(req)
      if (!auth.ok) {
        const reason = auth.reason
        res.status(401).json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32002,
            message:
              reason === 'DISABLED'
                ? 'Token 已被禁用'
                : reason === 'EXPIRED'
                  ? 'Token 已过期'
                  : reason === 'GLOBAL_DISABLED'
                    ? 'MCP 入口未启用'
                    : 'X-MCP-Token 缺失或无效'
          }
        })
        return
      }

      const tokenRecord = auth.token
      // 注入 AuthInfo（SDK 通过 req.auth 读取）
      ;(req as Request & { auth?: unknown }).auth = {
        token: tokenRecord.tokenPrefix + '****',
        clientId: tokenRecord.id,
        scopes: tokenRecord.allowWrites ? ['read', 'write'] : ['read'],
        extra: {
          token: tokenRecord,
          caller: 'http',
          remoteAddress: req.ip
        } as { token: ApiTokenRecord; caller: 'http'; remoteAddress: string | undefined }
      }

      // StreamableHTTP transport: stateless（每次请求新 transport）— 简单可靠
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      })
      // sessionIdGenerator 为 undefined ⇒ stateless 模式；不需要存到 Map
      transports.set(transport.sessionId ?? '__stateless__', transport)

      const server = createMcpServer()
      await server.connect(transport)
      try {
        await transport.handleRequest(
          req as unknown as Parameters<typeof transport.handleRequest>[0],
          res,
          parsedBodyOf(req)
        )
      } finally {
        try {
          await transport.close()
        } catch {
          // ignore
        }
        transports.delete(transport.sessionId ?? '__stateless__')
      }
    } catch (error) {
      logger.error('mcp-http', 'MCP HTTP 处理异常', {
        path: req.path,
        method: req.method,
        error: error instanceof Error ? error.message : String(error)
      })
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'MCP 入口内部错误' }
        })
      }
    }
  }
}

function parsedBodyOf(req: Request): unknown {
  // express.json() 中间件已经把 body 解析到 req.body
  if (req.body && Object.keys(req.body).length > 0) return req.body
  return undefined
}