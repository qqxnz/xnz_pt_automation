import type { Request } from 'express'
import { readSystemSettings, touchApiTokenLastUsed, verifyApiToken, type ApiTokenRecord } from '../storage.js'
import { McpForbiddenError } from './errors.js'

export const MCP_TOKEN_HEADER_DEFAULT = 'X-MCP-Token'

export function resolveMcpTokenHeaderName(): string {
  return (process.env.MCP_TOKEN_HEADER ?? MCP_TOKEN_HEADER_DEFAULT).trim() || MCP_TOKEN_HEADER_DEFAULT
}

export function extractMcpTokenFromRequest(req: Request): string | undefined {
  const headerName = resolveMcpTokenHeaderName().toLowerCase()
  const loweredHeaders: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    loweredHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v
  }
  return loweredHeaders[headerName] ?? undefined
}

export type McpAuthResult =
  | { ok: true; token: ApiTokenRecord }
  | { ok: false; reason: 'DISABLED' | 'NOT_FOUND' | 'EXPIRED' | 'GLOBAL_DISABLED' }

/**
 * HTTP 入口鉴权：校验 token + 校验 system_settings.mcp_enabled
 * 不校验 loopback；由 app.ts 中间件统一处理。
 */
export async function authenticateHttpRequest(req: Request): Promise<McpAuthResult> {
  const plaintext = extractMcpTokenFromRequest(req)
  if (!plaintext) return { ok: false, reason: 'NOT_FOUND' }

  const settings = await readSystemSettings()
  if (!settings.mcpEnabled) return { ok: false, reason: 'GLOBAL_DISABLED' }

  const result = await verifyApiToken(plaintext)
  if (!result.ok) {
    return { ok: false, reason: result.reason }
  }
  return { ok: true, token: result.token }
}

/**
 * 异步调用时把 token.lastUsedAt 更新一次（不阻塞响应）。
 */
export function touchTokenAsync(tokenId: string, at = new Date().toISOString()): void {
  void touchApiTokenLastUsed(tokenId, at).catch(() => undefined)
}

/** 写操作前置校验 */
export function assertWriteAllowed(token: ApiTokenRecord): void {
  if (!token.enabled) throw new McpForbiddenError('Token 已被禁用', { tokenId: token.id })
  if (!token.allowWrites) {
    throw new McpForbiddenError('当前 Token 没有写权限（创建 Token 时请勾选「允许写入」）', { tokenId: token.id })
  }
}