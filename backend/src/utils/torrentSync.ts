import { listAllTorrents, listDownloadersFromDb, recordTorrentTraffic, updateDownloaderInDb, updateTorrents, type DownloaderRecord, type TorrentRecord, type TorrentTrafficSample } from '../storage.js'
import { getQbTorrentItems, QbittorrentError, type QbTorrentItem } from './qbittorrent.js'
import { syncTorrentIpv6Peers } from './peerSync.js'

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

  const prevSyncedAt = torrent.downloadStatsSyncedAt ? new Date(torrent.downloadStatsSyncedAt).getTime() : 0
  const nowMs = new Date(syncedAt).getTime()
  const elapsedSeconds = prevSyncedAt > 0 ? Math.max((nowMs - prevSyncedAt) / 1000, 1) : 0

  const newUploaded = item.uploaded ?? 0
  const prevUploaded = torrent.uploaded ?? 0
  const newDownloaded = item.downloaded ?? 0
  const prevDownloaded = torrent.downloaded ?? 0

  const avgUploadSpeed = prevSyncedAt > 0
    ? Math.max(0, Math.round((newUploaded - prevUploaded) / elapsedSeconds))
    : (item.uploadSpeed ?? 0)
  const avgDownloadSpeed = prevSyncedAt > 0
    ? Math.max(0, Math.round((newDownloaded - prevDownloaded) / elapsedSeconds))
    : (item.downloadSpeed ?? 0)

  changed = assignIfChanged(torrent, 'uploadSpeed', avgUploadSpeed) || changed
  changed = assignIfChanged(torrent, 'downloadSpeed', avgDownloadSpeed) || changed
  changed = assignIfChanged(torrent, 'uploaded', newUploaded) || changed
  changed = assignIfChanged(torrent, 'downloaded', newDownloaded) || changed
  changed = assignIfChanged(torrent, 'downloaderSavePath', item.savePath?.trim() || undefined) || changed
  changed = assignIfChanged(torrent, 'downloadStatsSyncedAt', syncedAt) || changed

  const kbps = torrent.lowUploadKbps
  const minutes = torrent.lowUploadMinutes
  if (kbps && kbps > 0 && minutes && minutes >= 1) {
    const threshold = kbps * 1024
    if (avgUploadSpeed < threshold) {
      if (!torrent.lowUploadSince) {
        changed = assignIfChanged(torrent, 'lowUploadSince', syncedAt) || changed
      }
    } else if (torrent.lowUploadSince) {
      changed = assignIfChanged(torrent, 'lowUploadSince', undefined) || changed
    }
  } else if (torrent.lowUploadSince) {
    changed = assignIfChanged(torrent, 'lowUploadSince', undefined) || changed
  }
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
  const syncedAt = new Date().toISOString()
  const allDownloaders = await listDownloadersFromDb()
  const enabledDownloaders = allDownloaders.filter((downloader) => downloader.enabled && (!downloaderId || downloader.id === downloaderId))
  const summary: TorrentSyncSummary = {
    successfulDownloaders: 0,
    failedDownloaders: 0,
    updatedTorrents: 0,
    syncedAt,
    errors: []
  }
  const updatedDownloaders: DownloaderRecord[] = []
  const updatedTorrents: TorrentRecord[] = []
  const recoveredDownloaderIds: string[] = []
  const trafficSamples: TorrentTrafficSample[] = []

  try {
    for (const downloader of enabledDownloaders) {
      const previousStatus = downloader.status
      const pushedTorrents = (await listAllTorrents({ pushStatus: 'PUSHED', downloaderId: downloader.id })).filter((torrent) => torrent.torrentHash)
      if (!pushedTorrents.length) continue

      try {
        const items = await getQbTorrentItems(downloader)
        const byHash = new Map(items.filter((item) => item.hash).map((item) => [item.hash.toLowerCase(), item]))
        for (const torrent of pushedTorrents) {
          const item = torrent.torrentHash ? byHash.get(torrent.torrentHash.toLowerCase()) : undefined
          const itemChanged = item ? applySnapshot(torrent, item, syncedAt) : markMissing(torrent, syncedAt)
          if (item) {
            trafficSamples.push({
              torrentId: torrent.id,
              siteId: torrent.siteId,
              siteName: torrent.siteName,
              uploaded: item.uploaded ?? 0,
              downloaded: item.downloaded ?? 0
            })
          }
          if (itemChanged) {
            summary.updatedTorrents += 1
            updatedTorrents.push(torrent)
          }
        }
        downloader.status = 'ONLINE'
        downloader.statusMessage = undefined
        downloader.lastSyncedAt = syncedAt
        downloader.updatedAt = syncedAt
        summary.successfulDownloaders += 1
        updatedDownloaders.push(downloader)
        if (previousStatus !== 'ONLINE') recoveredDownloaderIds.push(downloader.id)
      } catch (error) {
        downloader.status = statusFromError(error)
        downloader.statusMessage = errorMessage(error)
        downloader.updatedAt = syncedAt
        summary.failedDownloaders += 1
        summary.errors.push({ downloaderId: downloader.id, downloaderName: downloader.name, message: downloader.statusMessage })
        updatedDownloaders.push(downloader)
      }
    }

    if (updatedTorrents.length) await updateTorrents(updatedTorrents)
    for (const downloader of updatedDownloaders) {
      await updateDownloaderInDb(downloader)
    }
    await recordTorrentTraffic(trafficSamples, syncedAt)
    return summary
  } finally {
    syncRunning = false
    for (const id of recoveredDownloaderIds) {
      void syncTorrentIpv6Peers(id).catch((err) => {
        // 静默失败：定时任务每 30 秒会兜底
        // eslint-disable-next-line no-console
        console.warn('[torrentSync] 恢复下载器的 IPv6 peer 同步失败', id, err)
      })
    }
  }
}
