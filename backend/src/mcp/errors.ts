/**
 * MCP 工具错误 → JSON-RPC error 映射
 *
 * JSON-RPC 2.0 保留错误码：
 *   -32700  Parse error
 *   -32600  Invalid Request
 *   -32601  Method not found
 *   -32602  Invalid params
 *   -32603  Internal error
 * 服务端自定义从 -32000 起：
 *   -32001  BUSINESS_ERROR（业务校验失败 / 资源不存在）
 *   -32002  FORBIDDEN（鉴权或权限不足）
 *   -32003  TIMEOUT
 */

export const MCP_ERROR_CODES = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  BUSINESS_ERROR: -32001,
  FORBIDDEN: -32002,
  TIMEOUT: -32003
} as const

export class McpToolError extends Error {
  readonly code: number
  readonly data?: Record<string, unknown>
  constructor(code: number, message: string, data?: Record<string, unknown>) {
    super(message)
    this.name = 'McpToolError'
    this.code = code
    this.data = data
  }
}

export class McpBusinessError extends McpToolError {
  constructor(message: string, data?: Record<string, unknown>) {
    super(MCP_ERROR_CODES.BUSINESS_ERROR, message, data)
    this.name = 'McpBusinessError'
  }
}

export class McpForbiddenError extends McpToolError {
  constructor(message: string, data?: Record<string, unknown>) {
    super(MCP_ERROR_CODES.FORBIDDEN, message, data)
    this.name = 'McpForbiddenError'
  }
}

export class McpTimeoutError extends McpToolError {
  constructor(message = '工具调用超时', data?: Record<string, unknown>) {
    super(MCP_ERROR_CODES.TIMEOUT, message, data)
    this.name = 'McpTimeoutError'
  }
}

export function toJsonRpcError(error: unknown): { code: number; message: string; data?: unknown } {
  if (error instanceof McpToolError) {
    return { code: error.code, message: error.message, data: error.data }
  }
  return {
    code: MCP_ERROR_CODES.INTERNAL,
    message: error instanceof Error ? error.message : '内部错误'
  }
}

/**
 * 把任意 Promise 包成 30s 超时；超时抛出 McpTimeoutError。
 * 注意：原 Promise 仍可能稍后 resolve/reject，由调用方用 AbortController 协同取消。
 */
export function withTimeout<T>(promise: Promise<T>, ms = 30_000, label = 'tool'): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new McpTimeoutError(`${label} 调用超过 ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/** 截断字符串，用于 operation_log request 字段 */
export function truncate(value: string, max = 1024): string {
  return value.length > max ? `${value.slice(0, max)}…(+${value.length - max})` : value
}