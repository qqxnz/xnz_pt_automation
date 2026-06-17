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
  yesterdayUploaded?: number
  todayUploaded?: number
  trafficSyncedAt?: string
  lastConnectedAt?: string
  lastConnectError?: string
  hasApiKey: boolean
  hasCookie: boolean
  signinEnabled: boolean
  signinTime: string
  todaySigninStatus?: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  lastSigninAt?: string
  lastSigninStatus?: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  lastSigninMessage?: string
  signinRunning: boolean
  updating: boolean
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
  signinEnabled?: boolean
  signinTime?: string
}

export type SiteFilter = {
  keyword?: string
  connectivityStatus?: 'ALL' | ConnectivityStatus
  enabled?: 'ALL' | 'ENABLED' | 'DISABLED'
  signinEnabled?: 'ALL' | 'ENABLED' | 'DISABLED'
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
  diagnostic?: {
    finalUrl?: string
    httpStatus?: number
    bodyExcerpt?: string
    matchedKeywords?: string[]
  }
}

export type BrowseTorrentItem = {
  id: string
  title: string
  subtitle?: string
  createdAt?: string
  freeEndAt?: string
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

export function updateSiteInfo(id: string) {
  return apiRequest<{ accepted: boolean; alreadyRunning: boolean }>(`/api/sites/${id}/update`, { method: 'POST' })
}

export function updateAllSites() {
  return apiRequest<{ acceptedCount: number; skippedCount: number; alreadyRunning: boolean }>('/api/sites/update-all', { method: 'POST' })
}

export function syncSiteTraffic() {
  return apiRequest<{ successCount: number; failedCount: number; syncedAt: string; errors: Array<{ siteId: string; siteName: string; message: string }> }>('/api/sites/sync-traffic', {
    method: 'POST'
  })
}

export type TriggerSigninResponse = {
  ok: boolean
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  message: string
  errorMessage?: string
  siteId: string
  siteName: string
  logId: string
  durationMs: number
}

export function triggerSiteSignin(id: string) {
  return apiRequest<TriggerSigninResponse>(`/api/sites/${id}/signin`, { method: 'POST' })
}

export function signinAllEnabledSites() {
  return apiRequest<{
    total: number
    results: Array<{ siteId: string; siteName: string; status: 'SUCCESS' | 'FAILED' | 'SKIPPED'; message: string; durationMs: number }>
  }>('/api/sites/signin-all', { method: 'POST' })
}

export function browseSiteTorrents(id: string, payload: { keyword?: string; category?: string; page?: number; pageSize?: number }) {
  return apiRequest<BrowseTorrentsResponse>(`/api/sites/${id}/browse-torrents`, {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}
