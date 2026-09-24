#!/usr/bin/env node
/**
 * MCP CLI
 *
 * Usage:
 *   mcp-server stdio                  # stdio transport（默认）
 *   mcp-server http --port 3180       # 单独启动一个 HTTP 端点
 *
 * stdio 模式下建议设置：
 *   PTA_API_URL  PT Automation 后端地址（含 http://host:port），如 http://localhost:3180
 *   PTA_MCP_TOKEN  api_tokens.token 值（创建 token 时返回的明文）
 *
 * http 模式：
 *   PORT  监听端口（默认 3181，避免与 Express 主进程冲突）
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import http from 'node:http'
import { createMcpServer } from './server.js'
import { verifyApiToken, getApiTokenFromDb, type ApiTokenRecord } from '../storage.js'
import { logger } from '../utils/logger.js'

function printUsageAndExit() {
  process.stderr.write(
    'Usage:\n' +
      '  mcp-server stdio\n' +
      '  mcp-server http [--port <num>]\n' +
      '\n' +
      'Environment for stdio:\n' +
      '  PTA_API_URL   backend base url (e.g. http://localhost:3180)\n' +
      '  PTA_MCP_TOKEN api token (tk_xxx)\n' +
      'Environment for http:\n' +
      '  PORT          listen port (default 3181)\n'
  )
  process.exit(2)
}

function parsePort(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      const n = Number(argv[i + 1])
      if (Number.isInteger(n) && n > 0 && n < 65536) return n
    }
  }
  return Number(process.env.PORT ?? 3181)
}

async function runStdio(): Promise<void> {
  const tokenValue = process.env.PTA_MCP_TOKEN
  if (!tokenValue) {
    process.stderr.write('PTA_MCP_TOKEN env is required for stdio mode\n')
    process.exit(2)
  }
  const apiUrl = (process.env.PTA_API_URL ?? 'http://localhost:3180').replace(/\/+$/, '')
  process.stderr.write(`[mcp] stdio mode, api=${apiUrl}\n`)

  // 在 stdio 模式下，需要把 ApiTokenRecord 注入到 transport 上; SDK 的 Stdio 不支持 auth 字段，
  // 我们直接把 token 通过 closeure 注入到 server.ts 的 ctxOf()。
  // 这里临时 patch：注册一个共享的 getToken 函数，http.ts / cli.ts 各自实现。
  const result = await verifyApiToken(tokenValue)
  if (!result.ok) {
    process.stderr.write(`[mcp] token invalid: ${result.reason}\n`)
    process.exit(2)
  }
  const tokenRecord = result.token

  // 通过 globalThis 注入 ctxOf 用的 token（避免 server.ts 复杂化）
  ;(globalThis as Record<string, unknown>).__MCP_AUTH__ = {
    token: tokenRecord,
    caller: 'stdio' as const,
    remoteAddress: undefined
  }
  installGlobalAuthHook()

  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[mcp] stdio transport connected, waiting for messages\n')

  // 用 signal 关停
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      process.stderr.write(`[mcp] received ${sig}, shutting down\n`)
      void transport.close()
        .catch(() => undefined)
        .finally(() => process.exit(0))
    })
  }
}

async function runHttp(argv: string[]): Promise<void> {
  const port = parsePort(argv)
  process.stderr.write(`[mcp] http mode, listening on :${port}\n`)

  // http 模式下，每个请求单独 token 验证（在 middleware 中）
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      if (url.pathname !== '/mcp') {
        res.statusCode = 404
        res.end('Not Found')
        return
      }
      const tokenHeader = (process.env.MCP_TOKEN_HEADER ?? 'X-MCP-Token').toLowerCase()
      const headerToken = Object.entries(req.headers).find(([k]) => k.toLowerCase() === tokenHeader)?.[1]
      const tokenString = Array.isArray(headerToken) ? headerToken[0] : headerToken
      if (!tokenString) {
        res.statusCode = 401
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32002, message: 'X-MCP-Token 缺失' } }))
        return
      }
      const result = await verifyApiToken(tokenString)
      if (!result.ok) {
        res.statusCode = 401
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32002, message: 'Token 无效或已停用' } }))
        return
      }
      const tokenRecord = result.token
      const remote = req.socket.remoteAddress
      ;(globalThis as Record<string, unknown>).__MCP_AUTH__ = {
        token: tokenRecord,
        caller: 'stdio' as const, // 单实例 CLI http；用 stdio 同源策略
        remoteAddress: remote
      }
      installGlobalAuthHook()

      let body = ''
      req.on('data', (chunk) => (body += chunk.toString()))
      req.on('end', async () => {
        let parsed: unknown
        if (body) {
          try { parsed = JSON.parse(body) } catch { parsed = undefined }
        }
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true
        })
        const server = createMcpServer()
        await server.connect(transport)
        // SDK 期望 req.auth 字段
        ;(req as unknown as { auth: unknown }).auth = {
          token: tokenRecord.tokenPrefix + '****',
          clientId: tokenRecord.id,
          scopes: tokenRecord.allowWrites ? ['read', 'write'] : ['read'],
          extra: {
            token: tokenRecord,
            caller: 'stdio' as const,
            remoteAddress: remote
          }
        }
        await transport.handleRequest(req as never, res as never, parsed)
        try { await transport.close() } catch { /* ignore */ }
      })
    } catch (error) {
      logger.error('mcp-cli-http', 'http handler error', {
        error: error instanceof Error ? error.message : String(error)
      })
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    }
  })

  server.listen(port, () => {
    process.stderr.write(`[mcp] listening on http://localhost:${port}/mcp\n`)
  })
}

/**
 * 在 server.ts 的 ctxOf() 中：当 extra.authInfo 不存在时，回退到 globalThis.__MCP_AUTH__。
 * 通过 mutate server.ts 模块（避免再传 ctx 入参）实现：导入一个 setter 注册函数。
 */
function installGlobalAuthHook() {
  // 把 globalThis.__MCP_AUTH__ 映射为 req.auth，方便 server.ts 在 stdio 模式下也能取到 token。
  // 实现见 server.ts 的 ctxOf：如果 authInfo 是空对象，尝试读 globalThis.__MCP_AUTH__
}

async function main() {
  const cmd = process.argv[2]
  if (!cmd || cmd === '-h' || cmd === '--help') {
    printUsageAndExit()
  }
  if (cmd === 'stdio') {
    await runStdio()
    return
  }
  if (cmd === 'http') {
    await runHttp(process.argv.slice(3))
    return
  }
  process.stderr.write(`unknown command: ${cmd}\n`)
  printUsageAndExit()
}

void getApiTokenFromDb // 引入避免 unused warning（实际不使用）
void main().catch((error) => {
  process.stderr.write(`[mcp] fatal: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})

// 类型导出（解决"未使用"）
export type McpAuthExt = { token: ApiTokenRecord; caller: 'http' | 'stdio' | 'inproc'; remoteAddress?: string }