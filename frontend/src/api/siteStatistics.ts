import { apiRequest } from './client'

export type SiteStatisticsDaily = {
  date: string
  uploaded: number
  downloaded: number
}

export type SiteStatisticsItem = {
  siteId: string
  siteName: string
  siteDeleted: boolean
  uploaded: number
  downloaded: number
  daily: SiteStatisticsDaily[]
}

export type SiteStatisticsResponse = {
  startDate: string
  endDate: string
  totalUploaded: number
  totalDownloaded: number
  siteCount: number
  total: number
  page: number
  pageSize: number
  siteOptions: Array<{ siteId: string; siteName: string; siteDeleted: boolean }>
  items: SiteStatisticsItem[]
}

export function getSiteStatistics(query: { startDate: string; endDate: string; siteId?: string; page: number; pageSize: number }) {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value))
  })
  return apiRequest<SiteStatisticsResponse>(`/api/site-statistics?${params.toString()}`)
}
