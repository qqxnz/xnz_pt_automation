import { apiRequest } from './client'

export type DashboardOverview = {
  sites: {
    total: number
    online: number
    offline: number
    authFailed: number
    unknown: number
  }
  torrents: {
    todayNew: number
    pushed: number
    expiringSoon: number
  }
  transfer: {
    uploadSpeed: number
    downloadSpeed: number
    uploadedTotal: number
    downloadedTotal: number
  } | null
  risks: Array<{
    type: 'AUTH_FAILED' | 'ALL_OFFLINE' | 'DEFAULT_PASSWORD' | 'DOWNLOADER_NOT_CONFIGURED'
    message: string
    actionText?: string
    actionPath?: string
  }>
  recentJobs: Array<{
    id?: string
    name: string
    status: 'SUCCESS' | 'FAILED' | 'RUNNING'
    summary: string
    finishedAt?: string
  }>
  quickActions: Array<{ text: string; path: string }>
}

export function getDashboardOverview() {
  return apiRequest<DashboardOverview>('/api/stats/overview')
}
