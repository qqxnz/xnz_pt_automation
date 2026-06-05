import { apiRequest, handleUnauthorized } from './client'

export type OperationLog = {
  id: string
  type: 'OPERATION'
  action: string
  message: string
  actorId?: string
  actorName?: string
  ip?: string
  userAgent?: string
  status: 'SUCCESS' | 'FAILED'
  createdAt: string
}

export type TaskLog = {
  id: string
  type: 'TASK'
  taskId?: string
  taskName: string
  runMode?: 'AUTO' | 'MANUAL_RUN'
  message: string
  status: 'SUCCESS' | 'FAILED' | 'RUNNING'
  startedAt?: string
  finishedAt?: string
  fetchedCount?: number
  matchedCount?: number
  pushedCount?: number
  pushFailedCount?: number
  summary?: string
  errorMessage?: string
  fetchErrorMessage?: string
  pushErrorMessages?: string[]
  failureDetails?: string[]
  createdAt: string
}

export type LogType = 'operation' | 'task'

export type LogsResponse<T extends LogType> = {
  type: T
  page: number
  pageSize: number
  total: number
  items: T extends 'task' ? TaskLog[] : OperationLog[]
}

export function getLogs<T extends LogType>(type: T, page = 1, pageSize = 20) {
  const params = new URLSearchParams({
    type,
    page: String(page),
    pageSize: String(pageSize)
  })
  return apiRequest<LogsResponse<T>>(`/api/logs?${params.toString()}`)
}

export function clearLogs(type: LogType) {
  return apiRequest<{ type: LogType; clearedCount: number }>(`/api/logs?type=${type}`, {
    method: 'DELETE'
  })
}

export async function exportLogs(type: LogType) {
  const response = await fetch(`/api/logs/export?type=${type}`, {
    credentials: 'include'
  })

  if (response.status === 401) {
    await handleUnauthorized()
    throw new Error('登录态已过期，请重新登录')
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(data.message ?? '日志导出失败')
  }

  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `${type}-logs.csv`
  return { blob, filename }
}
