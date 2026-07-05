import { apiRequest } from './client'

export type SchedulerJobStatus = {
  name: string
  readableName: string
  intervalMs: number
  nextRunAt: string
  running: boolean
  lastStatus?: string
  lastRunAt?: string
}

export type DashboardOverview = {
  sites: {
    total: number
    online: number
    offline: number
    authFailed: number
    unknown: number
    signinEnabled: number
    todaySigninSuccess: number
    todaySigninFailed: number
    todaySigninPending: number
  }
  downloaders: {
    total: number
    online: number
    offline: number
    authFailed: number
    unknown: number
    items: Array<{
      id: string
      name: string
      type: 'QBITTORRENT'
      status: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
      uploadSpeed: number
      downloadSpeed: number
    }>
  }
  tasks: {
    total: number
    autoRunEnabled: number
    running: number
    failed: number
    recent: Array<{
      id?: string
      name: string
      status: 'SUCCESS' | 'FAILED' | 'RUNNING'
      summary: string
      createdAt?: string
      runMode?: 'AUTO' | 'MANUAL_RUN'
      startedAt?: string
      finishedAt?: string
      fetchedCount?: number
      matchedCount?: number
      skippedExistingCount?: number
      pushedCount?: number
      pushFailedCount?: number
    }>
  }
  torrents: {
    total: number
    running: number
    notRunning: number
    totalUploaded: number
    totalDownloaded: number
  }
  traffic: {
    uploadedTotal: number
    downloadedTotal: number
    todayUploaded: number
    todayDownloaded: number
  }
  scheduler: {
    jobs: SchedulerJobStatus[]
  }
  risks: Array<{
    type: 'AUTH_FAILED' | 'ALL_OFFLINE' | 'DOWNLOADER_NOT_CONFIGURED'
    message: string
    actionText?: string
    actionPath?: string
  }>
  quickActions: Array<{ text: string; path: string }>
}

export function getDashboardOverview() {
  return apiRequest<DashboardOverview>('/api/stats/overview')
}
