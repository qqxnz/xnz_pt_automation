import { apiRequest, handleUnauthorized } from './client'

export type DiscountType = 'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'
export type TorrentCountCondition = 'GT' | 'EQ' | 'LT'
export type TaskRunMode = 'AUTO' | 'MANUAL_RUN'
export type TaskSortRule =
  | 'SEEDERS_ASC'
  | 'SEEDERS_DESC'
  | 'CREATED_DESC'
  | 'CREATED_ASC'
  | 'SIZE_DESC'
  | 'SIZE_ASC'

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
  onlyFreeDownload?: boolean
  deleteOnFreeExpire?: boolean
  skipHitAndRun?: boolean
  lowUploadKbps?: number
  lowUploadMinutes?: number
  autoPush: boolean
  discountTypes: DiscountType[]
  seederMin?: number
  seederMax?: number
  sizeMinGb?: number
  sizeMaxGb?: number
  torrentCountCondition?: TorrentCountCondition
  torrentCount?: number
  sortRule?: TaskSortRule
  fetchLimit?: number
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
  onlyFreeDownload?: boolean
  deleteOnFreeExpire?: boolean
  skipHitAndRun?: boolean
  lowUploadKbps?: number | null
  lowUploadMinutes?: number | null
  autoPush: boolean
  discountTypes: DiscountType[]
  seederMin?: number
  seederMax?: number
  sizeMinGb?: number
  sizeMaxGb?: number
  torrentCountCondition?: TorrentCountCondition | ''
  torrentCount?: number
  sortRule?: TaskSortRule | ''
  fetchLimit?: number
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
  excludedByHitAndRunCount?: number
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
    skippedExisting: boolean
    matched: boolean
    pushable: boolean
    excludedBy?: 'HIT_AND_RUN'
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

export async function exportTasks() {
  const response = await fetch('/api/tasks/export', { credentials: 'include' })
  if (response.status === 401) {
    await handleUnauthorized()
    throw new Error('登录态已过期，请重新登录')
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(data.message ?? '任务导出失败')
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'tasks.json'
  return { blob, filename }
}

export async function importTasks(file: File) {
  const text = await file.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('文件格式不正确，请上传 JSON 文件')
  }
  return apiRequest<{ imported: number; failed: number; errors: string[] }>('/api/tasks/import', {
    method: 'POST',
    body: JSON.stringify(data)
  })
}
