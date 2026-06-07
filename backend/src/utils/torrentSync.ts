import { readState, type DownloaderRecord, type TorrentRecord, writeState } from '../storage.js'
import { getQbTorrentItems, QbittorrentError, type QbTorrentItem } from './qbittorrent.js'

let syncRunning = false

export type TorrentSyncSummary = {
  successfulDownloaders: number
  failedDownloaders: number
  updatedTorrents: number
  syncedAt: string
  errors: Array<{ downloaderId: string; downloaderName: string; message: string }>
}

function statusFromError(error: unknown): DownloaderRecord['status'] {
  return error instanceof QbittorrentError && error.code === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'OFFLINE'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '下载器任务同步失败'
}

function assignIfChanged<T extends keyof TorrentRecord>(torrent: TorrentRecord, key: T, value: TorrentRecord[T]) {
  if (torrent[key] === value) return false
  torrent[key] = value
  return true
}

function applySnapshot(torrent: TorrentRecord, item: QbTorrentItem, syncedAt: string) {
  let changed = false
  changed = assignIfChanged(torrent, 'downloadProgress', item.progress) || changed
  changed = assignIfChanged(torrent, 'downloadState', item.state) || changed
  changed = assignIfChanged(torrent, 'downloaderState', item.state) || changed
  changed = assignIfChanged(torrent, 'ratio', item.ratio) || changed
  changed = assignIfChanged(torrent, 'uploadSpeed', item.uploadSpeed ?? 0) || changed
  changed = assignIfChanged(torrent, 'downloadSpeed', item.downloadSpeed ?? 0) || changed
  changed = assignIfChanged(torrent, 'uploaded', item.uploaded ?? 0) || changed
  changed = assignIfChanged(torrent, 'downloaded', item.downloaded ?? 0) || changed
  changed = assignIfChanged(torrent, 'downloaderSavePath', item.savePath?.trim() || undefined) || changed
  changed = assignIfChanged(torrent, 'downloadStatsSyncedAt', syncedAt) || changed
  return changed
}

function markMissing(torrent: TorrentRecord, syncedAt: string) {
  let changed = false
  changed = assignIfChanged(torrent, 'downloadState', 'missing') || changed
  changed = assignIfChanged(torrent, 'downloaderState', 'missing') || changed
  changed = assignIfChanged(torrent, 'uploadSpeed', 0) || changed
  changed = assignIfChanged(torrent, 'downloadSpeed', 0) || changed
  changed = assignIfChanged(torrent, 'downloadStatsSyncedAt', syncedAt) || changed
  return changed
}

export async function syncTorrentDownloadStats(downloaderId?: string): Promise<TorrentSyncSummary> {
  if (syncRunning) {
    return {
      successfulDownloaders: 0,
      failedDownloaders: 0,
      updatedTorrents: 0,
      syncedAt: new Date().toISOString(),
      errors: [{ downloaderId: downloaderId ?? 'ALL', downloaderName: '同步任务', message: '下载状态同步正在运行' }]
    }
  }

  syncRunning = true
  const state = await readState()
  const syncedAt = new Date().toISOString()
  const enabledDownloaders = state.downloaders.filter((downloader) => downloader.enabled && (!downloaderId || downloader.id === downloaderId))
  const summary: TorrentSyncSummary = {
    successfulDownloaders: 0,
    failedDownloaders: 0,
    updatedTorrents: 0,
    syncedAt,
    errors: []
  }
  let changed = false

  try {
    for (const downloader of enabledDownloaders) {
      const pushedTorrents = state.torrents.filter((torrent) => torrent.pushStatus === 'PUSHED' && torrent.downloaderId === downloader.id && torrent.torrentHash)
      if (!pushedTorrents.length) continue

      try {
        const items = await getQbTorrentItems(downloader)
        const byHash = new Map(items.filter((item) => item.hash).map((item) => [item.hash.toLowerCase(), item]))
        for (const torrent of pushedTorrents) {
          const item = torrent.torrentHash ? byHash.get(torrent.torrentHash.toLowerCase()) : undefined
          const itemChanged = item ? applySnapshot(torrent, item, syncedAt) : markMissing(torrent, syncedAt)
          if (itemChanged) {
            summary.updatedTorrents += 1
            changed = true
          }
        }
        downloader.status = 'ONLINE'
        downloader.statusMessage = undefined
        downloader.lastSyncedAt = syncedAt
        downloader.updatedAt = syncedAt
        summary.successfulDownloaders += 1
        changed = true
      } catch (error) {
        downloader.status = statusFromError(error)
        downloader.statusMessage = errorMessage(error)
        downloader.updatedAt = syncedAt
        summary.failedDownloaders += 1
        summary.errors.push({ downloaderId: downloader.id, downloaderName: downloader.name, message: downloader.statusMessage })
        changed = true
      }
    }

    if (changed) await writeState(state)
    return summary
  } finally {
    syncRunning = false
  }
}
