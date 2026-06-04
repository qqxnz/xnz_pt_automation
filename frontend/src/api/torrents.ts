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
  detailUrl?: string
  downloaderId?: string
  downloaderName?: string
  downloaderType?: 'QBITTORRENT'
  downloaderState?: string
  torrentHash?: string
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
  auto: number
  manual: number
  pending: number
  failed: number
  expiringSoon: number
}

export type TorrentFilter = {
  keyword?: string
  siteId?: string
  downloaderId?: string
  taskId?: string
  pushStatus?: 'ALL' | 'NEW' | 'PUSHED' | 'PUSH_FAILED' | 'DELETED'
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

export function pushTorrent(id: string, downloaderId?: string) {
  return apiRequest<TorrentItem>(`/api/torrents/${id}/push`, {
    method: 'POST',
    body: JSON.stringify({ downloaderId })
  })
}

export function batchPushTorrents(ids: string[]) {
  return apiRequest<{ successCount: number; failedCount: number; failed: Array<{ id: string; message: string }> }>('/api/torrents/batch-push', {
    method: 'POST',
    body: JSON.stringify({ ids })
  })
}

export function deleteTorrentFromDownloader(id: string) {
  return apiRequest<TorrentItem>(`/api/torrents/${id}/delete-from-downloader`, { method: 'POST' })
}
