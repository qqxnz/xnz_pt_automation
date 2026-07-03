import { apiRequest, handleUnauthorized } from './client'

export type DownloaderStatusValue = 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'

export type DownloaderListItem = {
  id: string
  name: string
  type: 'QBITTORRENT'
  enabled: boolean
  host: string
  username?: string
  hasPassword: boolean
  savePath?: string
  status: DownloaderStatusValue
  statusMessage?: string
  lastTestedAt?: string
  lastSyncedAt?: string
  hasIpv6Peers?: boolean
  ipv6TorrentCount?: number
  ipv6SyncedAt?: string
  createdAt: string
  updatedAt: string
}

export type DownloaderDetailItem = DownloaderListItem & {
  password?: string
}

export type DownloaderFormPayload = {
  name: string
  type: 'QBITTORRENT'
  enabled: boolean
  host: string
  username?: string
  password?: string
  passwordAction?: 'KEEP' | 'UPDATE' | 'CLEAR'
  savePath?: string
}

export type DownloaderFilter = {
  keyword?: string
  status?: 'ALL' | DownloaderStatusValue
  enabled?: 'ALL' | 'ENABLED' | 'DISABLED'
}

export type DownloaderStats = {
  total: number
  online: number
  authFailed: number
  offline: number
  unknown: number
}

export type DownloaderTestResult = {
  success: boolean
  status: DownloaderStatusValue
  message: string
  version?: string
  user?: string
  uploadSpeed?: number
  downloadSpeed?: number
  testedAt: string
}

export type DownloaderStatus = {
  downloaderId: string
  uploadSpeed: number
  downloadSpeed: number
  totalUploaded?: number
  totalDownloaded?: number
  freeSpace?: number
  status: DownloaderStatusValue
  message?: string
  lastSyncedAt?: string
}

export type DownloaderTorrentItem = {
  hash: string
  name: string
  size?: number
  progress: number
  state: string
  ratio?: number
  category?: string
  tags: string[]
  uploadSpeed?: number
  downloadSpeed?: number
  uploaded?: number
  downloaded?: number
  addedAt?: string
}

function toQuery(filters: DownloaderFilter) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value))
  })
  return params.toString()
}

export function getDownloaders(filters: DownloaderFilter) {
  const query = toQuery(filters)
  return apiRequest<{ items: DownloaderListItem[]; total: number; stats: DownloaderStats }>(`/api/downloaders${query ? `?${query}` : ''}`)
}

export function getDownloader(id: string) {
  return apiRequest<DownloaderDetailItem>(`/api/downloaders/${id}`)
}

export function createDownloader(payload: DownloaderFormPayload) {
  return apiRequest<DownloaderListItem>('/api/downloaders', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export function updateDownloader(id: string, payload: DownloaderFormPayload) {
  return apiRequest<DownloaderListItem>(`/api/downloaders/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  })
}

export function deleteDownloader(id: string) {
  return apiRequest<void>(`/api/downloaders/${id}`, { method: 'DELETE' })
}

export function testDownloaderDraft(payload: DownloaderFormPayload) {
  return apiRequest<DownloaderTestResult>('/api/downloaders/test', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export function testDownloader(id: string) {
  return apiRequest<DownloaderTestResult>(`/api/downloaders/${id}/test`, { method: 'POST' })
}

export function getDownloaderStatus(id: string) {
  return apiRequest<DownloaderStatus>(`/api/downloaders/${id}/status`)
}

export function getDownloaderTorrents(id: string) {
  return apiRequest<{ items: DownloaderTorrentItem[]; total: number }>(`/api/downloaders/${id}/torrents`)
}

export async function exportDownloaders() {
  const response = await fetch('/api/downloaders/export', { credentials: 'include' })
  if (response.status === 401) {
    await handleUnauthorized()
    throw new Error('登录态已过期，请重新登录')
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(data.message ?? '下载器导出失败')
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'downloaders.json'
  return { blob, filename }
}

export async function importDownloaders(file: File) {
  const text = await file.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('文件格式不正确，请上传 JSON 文件')
  }
  return apiRequest<{ imported: number; failed: number; errors: string[] }>('/api/downloaders/import', {
    method: 'POST',
    body: JSON.stringify(data)
  })
}
