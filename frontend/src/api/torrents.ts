import { apiRequest } from './client'

export type TorrentItem = {
  id: string
  siteId: string
  siteName: string
  torrentId?: string
  title: string
  size: number
  discountType: 'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'
  isFreeNow: boolean
  currentState: 'NEW' | 'FREE_NOW' | 'EXPIRING_SOON' | 'EXPIRED' | 'PUSHED' | 'PUSH_FAILED' | 'DOWNLOADER_DELETED'
  freeEndAt?: string
  seeders?: number
  leechers?: number
  pushStatus: 'NEW' | 'PUSHED' | 'PUSH_FAILED' | 'DELETED'
  linkStatus: 'SAVED' | 'MISSING' | 'INVALID'
  onlyFreeDownload?: boolean
  detailUrl?: string
  downloaderId?: string
  downloaderName?: string
  downloaderType?: 'QBITTORRENT'
  downloaderState?: string
  torrentHash?: string
  downloadProgress?: number
  downloadState?: string
  ratio?: number
  uploadSpeed?: number
  downloadSpeed?: number
  uploaded?: number
  downloaded?: number
  taskSavePath?: string
  downloaderSavePath?: string
  downloadStatsSyncedAt?: string
  sourceTaskId?: string
  sourceTaskName?: string
  sourceRunMode: 'AUTO' | 'MANUAL_RUN'
  errorMessage?: string
  firstSeenAt: string
  lastSeenAt: string
  pushedAt?: string
}

export type TorrentStats = {
  total: number
  running: number
  notRunning: number
  auto: number
  manual: number
  pending: number
  failed: number
  expiringSoon: number
  totalUploaded: number
  totalDownloaded: number
  bySite: Array<{ siteId: string; siteName: string; uploaded: number; downloaded: number; torrentCount: number }>
}

export type TorrentFilter = {
  keyword?: string
  siteId?: string
  downloaderId?: string
  taskId?: string
  pushStatus?: 'ALL' | 'NEW' | 'PUSHED' | 'PUSH_FAILED' | 'DELETED'
  status?: 'ALL' | 'RUNNING' | 'NOT_RUNNING'
  freeStatus?: 'ALL' | 'FREE_NOW' | 'EXPIRING_SOON' | 'EXPIRED' | 'NORMAL' | 'FREE_NO_END'
  sourceRunMode?: 'ALL' | 'AUTO' | 'MANUAL_RUN'
  page?: number
  pageSize?: number
}

function toQuery(filters: TorrentFilter) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value))
  })
  return params.toString()
}

export function getTorrents(filters: TorrentFilter) {
  const query = toQuery(filters)
  return apiRequest<{ items: TorrentItem[]; total: number; page: number; pageSize: number; stats: TorrentStats }>(`/api/torrents${query ? `?${query}` : ''}`)
}

export function pushTorrent(id: string, options?: { downloaderId?: string; taskSavePath?: string }) {
  const body: { downloaderId?: string; taskSavePath?: string } = {}
  if (options?.downloaderId !== undefined) body.downloaderId = options.downloaderId
  if (options?.taskSavePath !== undefined) body.taskSavePath = options.taskSavePath
  return apiRequest<TorrentItem>(`/api/torrents/${id}/push`, {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export function updateTorrentSettings(id: string, options: { downloaderId?: string; taskSavePath?: string }) {
  const body: { downloaderId?: string; taskSavePath?: string } = {}
  if (options.downloaderId !== undefined) body.downloaderId = options.downloaderId
  if (options.taskSavePath !== undefined) body.taskSavePath = options.taskSavePath
  return apiRequest<TorrentItem>(`/api/torrents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  })
}

export function batchPushTorrents(ids: string[]) {
  return apiRequest<{ successCount: number; failedCount: number; failed: Array<{ id: string; message: string }> }>('/api/torrents/batch-push', {
    method: 'POST',
    body: JSON.stringify({ ids })
  })
}

export function deleteTorrentRecords(ids: string[]) {
  return apiRequest<{ deletedCount: number; missingIds: string[] }>('/api/torrents/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ ids })
  })
}

export function batchDeleteTorrentsFromDownloader(ids: string[]) {
  return apiRequest<{ successCount: number; failedCount: number; failed: Array<{ id: string; message: string }> }>('/api/torrents/batch-delete-from-downloader', {
    method: 'POST',
    body: JSON.stringify({ ids })
  })
}

export function deleteTorrentFromDownloader(id: string) {
  return apiRequest<TorrentItem>(`/api/torrents/${id}/delete-from-downloader`, { method: 'POST' })
}
