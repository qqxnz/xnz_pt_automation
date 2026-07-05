import type { DownloaderRecord, SiteRecord } from '../storage.js'

export class QbittorrentError extends Error {
  constructor(
    message: string,
    public code: 'NETWORK_ERROR' | 'AUTH_FAILED' | 'TIMEOUT' | 'REJECTED' | 'NOT_CONFIRMED' = 'NETWORK_ERROR'
  ) {
    super(message)
  }
}

export type AddTorrentResult = {
  hash: string
  name: string
  state?: string
  alreadyAdded?: boolean
  unconfirmed?: boolean
}

export type QbAddOptions = {
  savePath?: string
  category?: string
  tags?: string[]
}

export type QbTransferInfo = {
  uploadSpeed: number
  downloadSpeed: number
  uploadedTotal: number
  downloadedTotal: number
  freeSpace?: number
}

export type QbTorrentItem = {
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
  savePath?: string
  addedAt?: string
}

export type QbTorrentPeersSnapshot = {
  rid: number
  fullUpdate: boolean
  ipv4PeerCount: number
  ipv6PeerCount: number
  totalPeerCount: number
}

type QbTransferResponse = {
  up_info_speed?: number
  dl_info_speed?: number
  up_info_data?: number
  dl_info_data?: number
  free_space_on_disk?: number
}

type QbTorrent = {
  hash?: string
  name?: string
  state?: string
  size?: number
  progress?: number
  ratio?: number
  category?: string
  tags?: string
  upspeed?: number
  dlspeed?: number
  uploaded?: number
  downloaded?: number
  save_path?: string
  added_on?: number
}

function cookieHeader(cookie?: string) {
  return cookie ? { Cookie: cookie } : undefined
}

function sameOriginHeaders(host: string, headers?: HeadersInit) {
  const requestHeaders = new Headers(headers)
  const origin = new URL(host).origin
  if (!requestHeaders.has('Accept')) requestHeaders.set('Accept', 'application/json,text/plain,*/*')
  if (!requestHeaders.has('Origin')) requestHeaders.set('Origin', origin)
  if (!requestHeaders.has('Referer')) requestHeaders.set('Referer', `${origin}/`)
  return requestHeaders
}

async function qbFetch(host: string, path: string, options: RequestInit = {}, timeoutMs = 15000) {
  const url = new URL(path, `${host}/`)
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
      headers: sameOriginHeaders(host, options.headers)
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new QbittorrentError('连接下载器超时', 'TIMEOUT')
    }
    throw new QbittorrentError('无法连接下载器，请检查地址和网络')
  }
}

function sessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = headers.getSetCookie?.() ?? []
  const setCookie = setCookies[0] ?? response.headers.get('set-cookie')
  return setCookie?.split(';')[0]
}

async function loginQb(downloader: Pick<DownloaderRecord, 'host' | 'username' | 'password'>) {
  if (!downloader.username && !downloader.password) return undefined
  const body = new URLSearchParams({ username: downloader.username ?? '', password: downloader.password ?? '' })
  const response = await qbFetch(downloader.host, '/api/v2/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const cookie = sessionCookie(response)
  if (response.status === 204 && cookie) return cookie
  const text = await response.text()
  if (!response.ok || text.trim().toLowerCase() !== 'ok.') throw new QbittorrentError('下载器认证失败', 'AUTH_FAILED')
  return cookie
}

async function listQbTorrents(downloader: Pick<DownloaderRecord, 'host' | 'username' | 'password'>, cookie?: string) {
  const response = await qbFetch(downloader.host, '/api/v2/torrents/info', { headers: cookieHeader(cookie) })
  if (response.status === 403) throw new QbittorrentError('下载器认证失败', 'AUTH_FAILED')
  if (!response.ok) throw new QbittorrentError(`下载器任务列表请求失败：HTTP ${response.status}`)
  return (await response.json()) as QbTorrent[]
}

export async function getQbTransferInfo(downloader: Pick<DownloaderRecord, 'host' | 'username' | 'password'>): Promise<QbTransferInfo> {
  const cookie = await loginQb(downloader)
  const response = await qbFetch(downloader.host, '/api/v2/transfer/info', { headers: cookieHeader(cookie) }, 10000)
  if (response.status === 403) throw new QbittorrentError('下载器认证失败', 'AUTH_FAILED')
  if (!response.ok) throw new QbittorrentError(`下载器传输状态请求失败：HTTP ${response.status}`)
  const transfer = (await response.json()) as QbTransferResponse
  return {
    uploadSpeed: transfer.up_info_speed ?? 0,
    downloadSpeed: transfer.dl_info_speed ?? 0,
    uploadedTotal: transfer.up_info_data ?? 0,
    downloadedTotal: transfer.dl_info_data ?? 0,
    freeSpace: transfer.free_space_on_disk
  }
}

function splitTags(value?: string) {
  return value
    ? value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : []
}

export async function testQbConnection(config: Pick<DownloaderRecord, 'host' | 'username' | 'password'>) {
  const cookie = await loginQb(config)
  const headers = cookieHeader(cookie)
  const versionResponse = await qbFetch(config.host, '/api/v2/app/version', { headers }, 8000)
  if (versionResponse.status === 403) throw new QbittorrentError('下载器认证失败', 'AUTH_FAILED')
  if (!versionResponse.ok) throw new QbittorrentError(`下载器返回 HTTP ${versionResponse.status}`)
  const version = (await versionResponse.text()).trim()
  const transferResponse = await qbFetch(config.host, '/api/v2/transfer/info', { headers }, 8000)
  const transfer = transferResponse.ok ? ((await transferResponse.json()) as QbTransferResponse) : {}
  return {
    success: true,
    status: 'ONLINE' as const,
    message: '连接测试成功',
    version,
    user: config.username,
    uploadSpeed: transfer.up_info_speed ?? 0,
    downloadSpeed: transfer.dl_info_speed ?? 0,
    testedAt: new Date().toISOString()
  }
}

export async function getQbTorrentItems(config: Pick<DownloaderRecord, 'host' | 'username' | 'password'>): Promise<QbTorrentItem[]> {
  const cookie = await loginQb(config)
  const items = await listQbTorrents(config, cookie)
  return items.map((item) => ({
    hash: item.hash ?? '',
    name: item.name ?? '-',
    size: item.size,
    progress: item.progress ?? 0,
    state: item.state ?? 'unknown',
    ratio: item.ratio,
    category: item.category,
    tags: splitTags(item.tags),
    uploadSpeed: item.upspeed,
    downloadSpeed: item.dlspeed,
    uploaded: item.uploaded,
    downloaded: item.downloaded,
    savePath: item.save_path,
    addedAt: item.added_on ? new Date(item.added_on * 1000).toISOString() : undefined
  }))
}

function isIpv6Address(value: string) {
  return value.includes(':')
}

export async function getQbTorrentPeers(
  config: Pick<DownloaderRecord, 'host' | 'username' | 'password'>,
  hash: string,
  lastRid = 0
): Promise<QbTorrentPeersSnapshot> {
  if (!hash.trim()) throw new QbittorrentError('缺少种子 Hash，无法查询 peer')
  const cookie = await loginQb(config)
  const response = await qbFetch(
    config.host,
    `/api/v2/sync/torrentPeers?hash=${encodeURIComponent(hash)}&rid=${encodeURIComponent(String(lastRid))}`,
    { headers: cookieHeader(cookie) },
    10000
  )
  if (response.status === 403) throw new QbittorrentError('下载器认证失败', 'AUTH_FAILED')
  if (!response.ok) throw new QbittorrentError(`下载器 peer 查询失败：HTTP ${response.status}`)
  const body = (await response.json()) as { rid?: number; full_update?: boolean; peers?: Record<string, unknown> }
  const peers = body.peers ?? {}
  let ipv4PeerCount = 0
  let ipv6PeerCount = 0
  for (const ip of Object.keys(peers)) {
    if (isIpv6Address(ip)) ipv6PeerCount += 1
    else ipv4PeerCount += 1
  }
  return {
    rid: Number(body.rid ?? lastRid),
    fullUpdate: Boolean(body.full_update),
    ipv4PeerCount,
    ipv6PeerCount,
    totalPeerCount: ipv4PeerCount + ipv6PeerCount
  }
}

function looksLikeTorrentFile(bytes: Uint8Array) {
  return bytes.length > 0 && bytes[0] === 100
}

function normalizeTorrentName(value?: string) {
  return (value ?? '')
    .replace(/\.torrent$/i, '')
    .replace(/[^a-z0-9]+/gi, '')
    .trim()
    .toLowerCase()
}

function isMTeamDownloadTokenUrl(value: string) {
  try {
    const url = new URL(value)
    return /(^|\.)m-team\.cc$/i.test(url.hostname) && url.pathname === '/api/torrent/genDlToken'
  } catch {
    return false
  }
}

async function resolveMTeamDownloadUrl(site: Pick<SiteRecord, 'apiKey' | 'userAgent'>, tokenUrl: string) {
  if (!site.apiKey?.trim()) throw new QbittorrentError('M-Team API Key 未配置，无法生成真实种子下载链接')
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'x-api-key': site.apiKey,
      'User-Agent': site.userAgent || 'Mozilla/5.0',
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new QbittorrentError(`M-Team 下载链接生成失败：HTTP ${response.status}`)
  const result = (await response.json()) as { code?: string | number; message?: string; data?: unknown }
  if (String(result.code) !== '0' || typeof result.data !== 'string' || !/^https?:\/\//i.test(result.data)) {
    throw new QbittorrentError(result.message || 'M-Team 下载链接生成失败')
  }
  return result.data
}

export async function fetchTorrentFile(site: Pick<SiteRecord, 'apiKey' | 'cookie' | 'userAgent'>, downloadUrl?: string) {
  if (!downloadUrl) throw new QbittorrentError('缺少真实种子下载链接')
  const isMTeamTokenUrl = isMTeamDownloadTokenUrl(downloadUrl)
  const resolvedDownloadUrl = isMTeamTokenUrl ? await resolveMTeamDownloadUrl(site, downloadUrl) : downloadUrl
  if (!isMTeamTokenUrl && !site.cookie?.trim()) throw new QbittorrentError('站点 Cookie 未配置，无法下载种子文件')
  const response = await fetch(resolvedDownloadUrl, {
    headers: {
      ...(site.cookie?.trim() ? { Cookie: site.cookie } : {}),
      ...(isMTeamTokenUrl && site.apiKey?.trim() ? { 'x-api-key': site.apiKey } : {}),
      'User-Agent': site.userAgent || 'Mozilla/5.0',
      Accept: 'application/x-bittorrent,application/octet-stream,*/*'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new QbittorrentError(`种子文件下载失败：HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!looksLikeTorrentFile(bytes)) throw new QbittorrentError('下载链接返回的不是种子文件，请检查站点 Cookie 是否有效')
  return bytes
}

function parseAddResponse(text: string): 'ok' | 'fail' | 'unknown' {
  const normalized = text.trim().replace(/\.+$/, '').toLowerCase()
  if (normalized === 'ok') return 'ok'
  if (normalized === 'fail' || normalized === 'failed') return 'fail'
  return 'unknown'
}

export async function addTorrentFileToQb(
  downloader: Pick<DownloaderRecord, 'host' | 'username' | 'password'>,
  torrentFile: Uint8Array,
  filename: string,
  options: QbAddOptions = {}
): Promise<AddTorrentResult> {
  const cookie = await loginQb(downloader)
  const before = await listQbTorrents(downloader, cookie)
  const beforeHashes = new Set(before.map((item) => item.hash).filter(Boolean))
  const form = new FormData()
  const fileBytes = torrentFile.buffer.slice(torrentFile.byteOffset, torrentFile.byteOffset + torrentFile.byteLength) as ArrayBuffer
  form.append('torrents', new Blob([fileBytes], { type: 'application/x-bittorrent' }), filename)
  form.append('paused', 'false')
  if (options.savePath) form.append('savepath', options.savePath)
  if (options.category) form.append('category', options.category)
  if (options.tags?.length) form.append('tags', options.tags.join(','))

  const response = await qbFetch(
    downloader.host,
    '/api/v2/torrents/add',
    {
      method: 'POST',
      headers: cookieHeader(cookie),
      body: form
    },
    30000
  )
  if (response.status === 403) throw new QbittorrentError('下载器认证失败', 'AUTH_FAILED')
  if (!response.ok && response.status !== 409) throw new QbittorrentError(`下载器添加任务失败：HTTP ${response.status}`)

  const responseText = await response.text()
  const verdict = parseAddResponse(responseText)

  if (verdict === 'fail') {
    throw new QbittorrentError('下载器拒绝接受种子，请检查种子文件是否损坏', 'REJECTED')
  }

  if (verdict === 'ok') {
    let added: QbTorrent | undefined
    let unconfirmed = false
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const after = await listQbTorrents(downloader, cookie)
      const filenameKey = normalizeTorrentName(filename)
      added =
        after.find((item) => item.hash && !beforeHashes.has(item.hash)) ??
        after.find((item) => {
          const itemKey = normalizeTorrentName(item.name)
          return itemKey && filenameKey && (filenameKey.includes(itemKey) || itemKey.includes(filenameKey))
        })
      if (!added) unconfirmed = true
    } catch (diffError) {
      unconfirmed = true
    }
    const preexisting = added
      ? undefined
      : before.find((item) => {
          const itemKey = normalizeTorrentName(item.name)
          const filenameKey = normalizeTorrentName(filename)
          return itemKey && filenameKey && (filenameKey.includes(itemKey) || itemKey.includes(filenameKey))
        })
    const alreadyAdded = Boolean(preexisting)
    if (added && added.state && /^paused/i.test(added.state)) {
      throw new QbittorrentError('种子已添加但处于暂停状态')
    }
    return {
      hash: added?.hash ?? preexisting?.hash ?? '',
      name: added?.name ?? preexisting?.name ?? filename,
      state: added?.state ?? preexisting?.state ?? 'added',
      alreadyAdded,
      unconfirmed: unconfirmed || alreadyAdded
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 1000))
  const after = await listQbTorrents(downloader, cookie)
  const filenameKey = normalizeTorrentName(filename)
  const preexisting =
    before.find((item) => {
      const itemKey = normalizeTorrentName(item.name)
      return itemKey && filenameKey && (filenameKey.includes(itemKey) || itemKey.includes(filenameKey))
    }) ?? null
  const added =
    after.find((item) => item.hash && !beforeHashes.has(item.hash)) ??
    preexisting ??
    after.find((item) => {
      const itemKey = normalizeTorrentName(item.name)
      return itemKey && (filenameKey.includes(itemKey) || itemKey.includes(filenameKey))
    })
  if (!added) throw new QbittorrentError('下载器未返回新增任务，请检查是否已存在相同种子', 'NOT_CONFIRMED')
  if (added.state && /^paused/i.test(added.state)) throw new QbittorrentError('种子已添加但处于暂停状态')
  const alreadyAdded = Boolean(preexisting) && !after.some((item) => item.hash && !beforeHashes.has(item.hash))
  return {
    hash: added.hash ?? preexisting?.hash ?? '',
    name: added.name ?? preexisting?.name ?? filename,
    state: added.state,
    alreadyAdded,
    unconfirmed: alreadyAdded
  }
}

export async function addTorrentUrlToQb(
  downloader: Pick<DownloaderRecord, 'host' | 'username' | 'password'>,
  site: Pick<SiteRecord, 'apiKey' | 'cookie' | 'userAgent'>,
  downloadUrl: string | undefined,
  filename: string,
  options: QbAddOptions = {}
): Promise<AddTorrentResult> {
  const torrentFile = await fetchTorrentFile(site, downloadUrl)
  return addTorrentFileToQb(downloader, torrentFile, filename, options)
}

export async function deleteTorrentFromQb(downloader: Pick<DownloaderRecord, 'host' | 'username' | 'password'>, hash: string, deleteFiles = true) {
  if (!hash.trim()) throw new QbittorrentError('缺少下载器任务 Hash')
  const cookie = await loginQb(downloader)
  const before = await listQbTorrents(downloader, cookie)
  if (!before.some((item) => item.hash?.toLowerCase() === hash.toLowerCase())) {
    return { deleted: false, alreadyMissing: true }
  }
  const body = new URLSearchParams({ hashes: hash, deleteFiles: String(deleteFiles) })
  const response = await qbFetch(downloader.host, '/api/v2/torrents/delete', {
    method: 'POST',
    headers: {
      ...cookieHeader(cookie),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  if (response.status === 403) throw new QbittorrentError('下载器认证失败', 'AUTH_FAILED')
  if (!response.ok) throw new QbittorrentError(`下载器删除任务失败：HTTP ${response.status}`)

  await new Promise((resolve) => setTimeout(resolve, 1000))
  const after = await listQbTorrents(downloader, cookie)
  if (after.some((item) => item.hash?.toLowerCase() === hash.toLowerCase())) {
    throw new QbittorrentError('下载器删除任务未生效')
  }
  return { deleted: true, alreadyMissing: false }
}
