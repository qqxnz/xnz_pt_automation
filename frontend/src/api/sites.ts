import { apiRequest } from './client'

export type ConnectivityStatus = 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
export type AccessMethod = 'ACCESS_KEY' | 'COOKIE'

export type SiteListItem = {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  connectivityStatus: ConnectivityStatus
  currentAccessMethod?: AccessMethod
  proxyId?: string
  proxyName?: string
  lastConnectedAt?: string
  lastConnectError?: string
  hasAccessKey: boolean
  hasCookie: boolean
}

export type SiteDetail = SiteListItem & {
  parserType: 'NEXUSPHP'
  freeTorrentUrl: string
  profileUrl?: string
  userAgent?: string
  checkIntervalMinutes: number
}

export type SiteFormPayload = {
  name: string
  baseUrl: string
  enabled: boolean
  accessKey?: string
  cookie?: string
  userAgent?: string
  parserType: 'NEXUSPHP'
  freeTorrentUrl: string
  profileUrl?: string
  proxyId?: string
  checkIntervalMinutes: number
}

export type SiteFilter = {
  keyword?: string
  connectivityStatus?: 'ALL' | ConnectivityStatus
  proxyUsage?: 'ALL' | 'NONE' | 'ENABLED'
  enabled?: 'ALL' | 'ENABLED' | 'DISABLED'
  page?: number
  pageSize?: number
}

export type SiteStats = {
  total: number
  online: number
  authFailed: number
  offline: number
  unknown: number
}

export type ProxyOption = {
  id: string
  name: string
  enabled: boolean
  type: 'HTTP' | 'HTTPS' | 'SOCKS5'
  host: string
  port: number
}

export type TestSiteConnectivityResponse = {
  ok: boolean
  status: ConnectivityStatus
  accessMethod?: AccessMethod
  usedProxy: boolean
  proxyId?: string
  proxyName?: string
  errorMessage?: string
}

function toQuery(filters: SiteFilter) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value))
  })
  return params.toString()
}

export function getSites(filters: SiteFilter) {
  const query = toQuery(filters)
  return apiRequest<{ items: SiteListItem[]; total: number; stats: SiteStats }>(`/api/sites${query ? `?${query}` : ''}`)
}

export function getSite(id: string) {
  return apiRequest<SiteDetail>(`/api/sites/${id}`)
}

export function createSite(payload: SiteFormPayload) {
  return apiRequest<SiteDetail>('/api/sites', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export function updateSite(id: string, payload: SiteFormPayload) {
  return apiRequest<SiteDetail>(`/api/sites/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  })
}

export function deleteSite(id: string) {
  return apiRequest<void>(`/api/sites/${id}`, { method: 'DELETE' })
}

export function testSiteConnectivity(id: string) {
  return apiRequest<TestSiteConnectivityResponse>(`/api/sites/${id}/test-connectivity`, { method: 'POST' })
}

export function syncSiteTorrents(id: string) {
  return apiRequest<{ ok: boolean; message: string }>(`/api/sites/${id}/sync-torrents`, { method: 'POST' })
}

export function syncSiteTraffic(id: string) {
  return apiRequest<{ ok: boolean; message: string }>(`/api/sites/${id}/sync-traffic`, { method: 'POST' })
}

export function getProxies() {
  return apiRequest<{ items: ProxyOption[] }>('/api/proxies')
}
