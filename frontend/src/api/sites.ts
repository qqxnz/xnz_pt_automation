import { apiRequest } from './client'

export type ConnectivityStatus = 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'
export type Credential = 'API_KEY' | 'COOKIE'

export type SiteListItem = {
  id: string
  displayName: string
  domain: string
  baseUrl: string
  enabled: boolean
  connectivityStatus: ConnectivityStatus
  currentCredential?: Credential
  userLevel?: string
  ratio?: number
  ratioInfinite?: boolean
  uploaded?: number
  downloaded?: number
  trafficSyncedAt?: string
  lastConnectedAt?: string
  lastConnectError?: string
  hasApiKey: boolean
  hasCookie: boolean
}

export type SiteDetail = SiteListItem & {
  apiKey?: string
  cookie?: string
  userAgent?: string
}

export type SiteFormPayload = {
  domain: string
  enabled: boolean
  apiKey?: string
  cookie?: string
  userAgent?: string
}

export type SiteFilter = {
  keyword?: string
  connectivityStatus?: 'ALL' | ConnectivityStatus
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

export type TestSiteConnectivityResponse = {
  ok: boolean
  status: ConnectivityStatus
  credential?: Credential
  userLevel?: string
  ratio?: number
  ratioInfinite?: boolean
  uploaded?: number
  downloaded?: number
  errorMessage?: string
}

export type BrowseTorrentItem = {
  id: string
  title: string
  subtitle?: string
  createdAt?: string
  size?: number
  seeders?: number
  leechers?: number
  tags: string[]
}

export type BrowseTorrentsResponse = {
  ok: boolean
  displayName: string
  items: BrowseTorrentItem[]
  total: number
  page: number
  pageSize: number
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

export function browseSiteTorrents(id: string, payload: { keyword?: string; category?: string; page?: number; pageSize?: number }) {
  return apiRequest<BrowseTorrentsResponse>(`/api/sites/${id}/browse-torrents`, {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}
