import { apiRequest } from './client'

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
  message: string
  status: 'SUCCESS' | 'FAILED' | 'RUNNING'
  startedAt?: string
  finishedAt?: string
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
