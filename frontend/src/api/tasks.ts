import { apiRequest } from './client'

export type DiscountType = 'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'
export type SeederCondition = 'GT' | 'EQ' | 'LT'
export type TorrentCountCondition = 'GT' | 'EQ' | 'LT'
export type TaskRunMode = 'AUTO' | 'MANUAL_RUN'

export type TaskItem = {
  id: string
  name: string
  siteId: string
  siteName: string
  downloaderId: string
  downloaderName: string
  autoRunEnabled: boolean
  autoRunStartedAt?: string
  nextRunAt?: string
  intervalMinutes: number
  freeOnly: boolean
  onlyFreeDownload?: boolean
  autoPush: boolean
  discountTypes: DiscountType[]
  seederCondition?: SeederCondition
  seederCount?: number
  sizeMinGb?: number
  sizeMaxGb?: number
  torrentCountCondition?: TorrentCountCondition
  torrentCount?: number
  expiringSoonMinutes?: number
  savePathOverride?: string
  categoryOverride?: string
  tagsOverride?: string[]
  running: boolean
  lastRunMode?: TaskRunMode
  lastStartedAt?: string
  lastFinishedAt?: string
  lastStatus?: 'SUCCESS' | 'FAILED'
  lastSummary?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

export type TaskPayload = {
  name: string
  siteId: string
  downloaderId: string
  autoRunEnabled: boolean
  intervalMinutes: number
  freeOnly: boolean
  onlyFreeDownload?: boolean
  autoPush: boolean
  discountTypes: DiscountType[]
  seederCondition?: SeederCondition | ''
  seederCount?: number
  sizeMinGb?: number
  sizeMaxGb?: number
  torrentCountCondition?: TorrentCountCondition | ''
  torrentCount?: number
  expiringSoonMinutes?: number
  savePathOverride?: string
  categoryOverride?: string
  tagsOverride?: string[]
}

export type TaskStats = {
  total: number
  autoRunEnabled: number
  running: number
  failed: number
}

export type TaskFilter = {
  keyword?: string
  autoRun?: 'ALL' | 'ON' | 'OFF'
}

export type TaskTestResult = {
  taskId: string
  taskName: string
  siteId: string
  siteName: string
  fetchedCount: number
  matchedCount: number
  skippedExistingCount?: number
  pushableCount: number
  total: number
  items: Array<{
    torrentId: string
    title: string
    size: number
    discountType: DiscountType | 'NORMAL'
    isFreeNow: boolean
    freeEndAt?: string
    seeders?: number
    leechers?: number
    linkStatus: 'SAVED' | 'MISSING' | 'INVALID'
    matched: boolean
  }>
}

function toQuery(filters: TaskFilter) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value))
  })
  return params.toString()
}

export function getTasks(filters: TaskFilter) {
  const query = toQuery(filters)
  return apiRequest<{ items: TaskItem[]; total: number; stats: TaskStats }>(`/api/tasks${query ? `?${query}` : ''}`)
}

export function createTask(payload: TaskPayload) {
  return apiRequest<TaskItem>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export function updateTask(id: string, payload: TaskPayload) {
  return apiRequest<TaskItem>(`/api/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  })
}

export function deleteTask(id: string) {
  return apiRequest<void>(`/api/tasks/${id}`, { method: 'DELETE' })
}

export function updateTaskAutoRun(id: string, autoRunEnabled: boolean) {
  return apiRequest<TaskItem>(`/api/tasks/${id}/auto-run`, {
    method: 'POST',
    body: JSON.stringify({ autoRunEnabled })
  })
}

export function testTask(id: string) {
  return apiRequest<TaskTestResult>(`/api/tasks/${id}/test`, { method: 'POST' })
}

export function runTask(id: string) {
  return apiRequest<{ task: TaskItem; fetchedCount: number; matchedCount: number; skippedExistingCount: number; pushedCount: number; pushFailedCount: number; summary: string }>(`/api/tasks/${id}/run`, {
    method: 'POST'
  })
}
