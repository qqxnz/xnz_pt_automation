import type { NextFunction, Request, Response } from 'express'
import { appendOperationLog, appendTaskLog, type OperationLogRecord, type TaskLogRecord } from '../storage.js'

type ConsoleLogLevel = 'info' | 'warn' | 'error'

type ConsoleLogMeta = Record<string, unknown>

type OperationLogPayload = Omit<OperationLogRecord, 'id' | 'type' | 'createdAt'>

type TaskLogPayload = Omit<TaskLogRecord, 'id' | 'type' | 'createdAt'>

function timestamp() {
  return new Date().toISOString()
}

function writeConsole(level: ConsoleLogLevel, scope: string, message: string, meta?: ConsoleLogMeta) {
  const line = `[${timestamp()}] [${level.toUpperCase()}] [${scope}] ${message}`
  const args = meta ? [line, meta] : [line]
  if (level === 'error') {
    console.error(...args)
    return
  }
  if (level === 'warn') {
    console.warn(...args)
    return
  }
  console.log(...args)
}

export const logger = {
  info: (scope: string, message: string, meta?: ConsoleLogMeta) => writeConsole('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: ConsoleLogMeta) => writeConsole('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: ConsoleLogMeta) => writeConsole('error', scope, message, meta)
}

export async function recordOperationLog(payload: OperationLogPayload) {
  const log = await appendOperationLog(payload).catch((error) => {
    logger.error('operation', '操作日志写入失败', {
      action: payload.action,
      status: payload.status,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  })
  logger.info('operation', payload.message, {
    action: payload.action,
    status: payload.status,
    actorName: payload.actorName,
    ip: payload.ip
  })
  return log
}

export async function recordTaskLog(payload: TaskLogPayload) {
  const log = await appendTaskLog(payload).catch((error) => {
    logger.error('task', '任务日志写入失败', {
      taskId: payload.taskId,
      taskName: payload.taskName,
      status: payload.status,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  })
  const level: ConsoleLogLevel = payload.status === 'FAILED' ? 'error' : 'info'
  logger[level]('task', payload.message, {
    taskId: payload.taskId,
    taskName: payload.taskName,
    status: payload.status
  })
  return log
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now()
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt
    const level: ConsoleLogLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
    logger[level]('http', `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    })
  })
  next()
}
