import type { DownloaderRecord, SiteRecord } from '../storage.js'

export class QbittorrentError extends Error {}

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
}

function cookieHeader(cookie?: string) {
  return cookie ? { Cookie: cookie } : undefined
}

async function qbFetch(host: string, path: string, options: RequestInit = {}, timeoutMs = 15000) {
  return fetch(new URL(path, `${host}/`), {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json,text/plain,*/*',
      ...(options.headers ?? {})
    }
  })
}

async function loginQb(downloader: Pick<DownloaderRecord, 'host' | 'username' | 'password'>) {
  if (!downloader.username && !downloader.password) return undefined
  const body = new URLSearchParams({ username: downloader.username ?? '', password: downloader.password ?? '' })
  const response = await qbFetch(downloader.host, '/api/v2/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const text = await response.text()
  if (!response.ok || text.trim().toLowerCase() !== 'ok.') throw new QbittorrentError('下载器认证失败')
  return response.headers.get('set-cookie')?.split(';')[0]
}

async function listQbTorrents(downloader: Pick<DownloaderRecord, 'host' | 'username' | 'password'>, cookie?: string) {
  const response = await qbFetch(downloader.host, '/api/v2/torrents/info', { headers: cookieHeader(cookie) })
  if (response.status === 403) throw new QbittorrentError('下载器认证失败')
  if (!response.ok) throw new QbittorrentError(`下载器任务列表请求失败：HTTP ${response.status}`)
  return (await response.json()) as QbTorrent[]
}

export async function getQbTransferInfo(downloader: Pick<DownloaderRecord, 'host' | 'username' | 'password'>): Promise<QbTransferInfo> {
  const cookie = await loginQb(downloader)
  const response = await qbFetch(downloader.host, '/api/v2/transfer/info', { headers: cookieHeader(cookie) }, 10000)
  if (response.status === 403) throw new QbittorrentError('下载器认证失败')
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

export async function addTorrentFileToQb(
  downloader: Pick<DownloaderRecord, 'host' | 'username' | 'password'>,
  torrentFile: Uint8Array,
  filename: string,
  options: QbAddOptions = {}
) {
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
  if (response.status === 403) throw new QbittorrentError('下载器认证失败')
  if (!response.ok) throw new QbittorrentError(`下载器添加任务失败：HTTP ${response.status}`)

  await new Promise((resolve) => setTimeout(resolve, 1000))
  const after = await listQbTorrents(downloader, cookie)
  const filenameKey = normalizeTorrentName(filename)
  const added =
    after.find((item) => item.hash && !beforeHashes.has(item.hash)) ??
    after.find((item) => {
      const itemKey = normalizeTorrentName(item.name)
      return itemKey && (filenameKey.includes(itemKey) || itemKey.includes(filenameKey))
    })
  if (!added) throw new QbittorrentError('下载器未返回新增任务，请检查是否已存在相同种子')
  if (added.state && /^paused/i.test(added.state)) throw new QbittorrentError('种子已添加但处于暂停状态')
  return {
    hash: added.hash,
    name: added.name,
    state: added.state
  }
}

export async function addTorrentUrlToQb(
  downloader: Pick<DownloaderRecord, 'host' | 'username' | 'password'>,
  site: Pick<SiteRecord, 'apiKey' | 'cookie' | 'userAgent'>,
  downloadUrl: string | undefined,
  filename: string,
  options: QbAddOptions = {}
) {
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
  if (response.status === 403) throw new QbittorrentError('下载器认证失败')
  if (!response.ok) throw new QbittorrentError(`下载器删除任务失败：HTTP ${response.status}`)

  await new Promise((resolve) => setTimeout(resolve, 1000))
  const after = await listQbTorrents(downloader, cookie)
  if (after.some((item) => item.hash?.toLowerCase() === hash.toLowerCase())) {
    throw new QbittorrentError('下载器删除任务未生效')
  }
  return { deleted: true, alreadyMissing: false }
}
