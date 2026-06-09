import { readState, type DownloaderRecord, type TorrentRecord, writeState } from '../storage.js'
import { getQbTorrentPeers, QbittorrentError } from './qbittorrent.js'

let ipv6SyncRunning = false

export type Ipv6PeerSyncSummary = {
  scannedDownloaders: number
  scannedTorrents: number
  ipv6TorrentCount: number
  clearedDownloaders: number
  errors: Array<{ downloaderId: string; downloaderName: string; message: string }>
  syncedAt: string
}

function assignIfChanged<T extends keyof TorrentRecord>(torrent: TorrentRecord, key: T, value: TorrentRecord[T] | undefined) {
  if (value === undefined) return false
  if (torrent[key] === value) return false
  torrent[key] = value
  return true
}

function assignBoolIfChanged(torrent: TorrentRecord, key: 'hasIpv6Peers', value: boolean | undefined) {
  if (value === undefined) return false
  if (Boolean(torrent[key]) === value) return false
  torrent[key] = value
  return true
}

function clearTorrentIpv6(torrent: TorrentRecord, syncedAt: string) {
  let changed = false
  changed = assignBoolIfChanged(torrent, 'hasIpv6Peers', false) || changed
  changed = assignIfChanged(torrent, 'ipv6PeerCount', 0) || changed
  changed = assignIfChanged(torrent, 'totalPeerCount', 0) || changed
  changed = assignIfChanged(torrent, 'peerSyncRid', undefined) || changed
  changed = assignIfChanged(torrent, 'peerSyncedAt', syncedAt) || changed
  return changed
}

function applyPeerSnapshot(
  torrent: TorrentRecord,
  snapshot: { rid: number; ipv4PeerCount: number; ipv6PeerCount: number; totalPeerCount: number; fullUpdate: boolean },
  syncedAt: string
) {
  let changed = false
  changed = assignBoolIfChanged(torrent, 'hasIpv6Peers', snapshot.ipv6PeerCount > 0) || changed
  changed = assignIfChanged(torrent, 'ipv6PeerCount', snapshot.ipv6PeerCount) || changed
  changed = assignIfChanged(torrent, 'totalPeerCount', snapshot.totalPeerCount) || changed
  if (snapshot.fullUpdate || !torrent.peerSyncRid) {
    changed = assignIfChanged(torrent, 'peerSyncRid', snapshot.rid) || changed
  } else {
    changed = assignIfChanged(torrent, 'peerSyncRid', snapshot.rid) || changed
  }
  changed = assignIfChanged(torrent, 'peerSyncedAt', syncedAt) || changed
  return changed
}

export function aggregateDownloaderIpv6(torrents: TorrentRecord[]) {
  let ipv6TorrentCount = 0
  for (const torrent of torrents) {
    if (torrent.pushStatus !== 'PUSHED') continue
    if (torrent.hasIpv6Peers) ipv6TorrentCount += 1
  }
  return { hasIpv6Peers: ipv6TorrentCount > 0, ipv6TorrentCount }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'IPV6 peer 同步失败'
}

export async function syncTorrentIpv6Peers(downloaderId?: string): Promise<Ipv6PeerSyncSummary> {
  if (ipv6SyncRunning) {
    return {
      scannedDownloaders: 0,
      scannedTorrents: 0,
      ipv6TorrentCount: 0,
      clearedDownloaders: 0,
      errors: [],
      syncedAt: new Date().toISOString()
    }
  }

  ipv6SyncRunning = true
  const state = await readState()
  const syncedAt = new Date().toISOString()
  const enabledDownloaders = state.downloaders.filter((downloader) => downloader.enabled && (!downloaderId || downloader.id === downloaderId))
  const summary: Ipv6PeerSyncSummary = {
    scannedDownloaders: 0,
    scannedTorrents: 0,
    ipv6TorrentCount: 0,
    clearedDownloaders: 0,
    errors: [],
    syncedAt
  }
  let changed = false

  try {
    for (const downloader of enabledDownloaders) {
      summary.scannedDownloaders += 1
      const downloaderTorrents = state.torrents.filter((torrent) => torrent.pushStatus === 'PUSHED' && torrent.downloaderId === downloader.id && torrent.torrentHash)
      if (!downloaderTorrents.length) {
        const prev = downloader.hasIpv6Peers
        const cleared = clearDownloaderIpv6(downloader, syncedAt)
        if (cleared || prev) {
          summary.clearedDownloaders += 1
          changed = true
        }
        continue
      }

      summary.scannedTorrents += downloaderTorrents.length
      const isOnline = downloader.status === 'ONLINE'
      if (!isOnline) {
        for (const torrent of downloaderTorrents) {
          if (clearTorrentIpv6(torrent, syncedAt)) changed = true
        }
        const prev = downloader.hasIpv6Peers
        if (clearDownloaderIpv6(downloader, syncedAt) || prev) {
          summary.clearedDownloaders += 1
          changed = true
        }
        continue
      }

      let hadError = false
      for (const torrent of downloaderTorrents) {
        try {
          const snapshot = await getQbTorrentPeers(downloader, torrent.torrentHash!, torrent.peerSyncRid)
          if (applyPeerSnapshot(torrent, snapshot, syncedAt)) changed = true
        } catch (error) {
          if (error instanceof QbittorrentError && error.code === 'AUTH_FAILED') {
            downloader.status = 'AUTH_FAILED'
            downloader.statusMessage = errorMessage(error)
            downloader.updatedAt = syncedAt
            hadError = true
            summary.errors.push({ downloaderId: downloader.id, downloaderName: downloader.name, message: errorMessage(error) })
            for (const t of downloaderTorrents) {
              if (clearTorrentIpv6(t, syncedAt)) changed = true
            }
            if (clearDownloaderIpv6(downloader, syncedAt)) {
              summary.clearedDownloaders += 1
              changed = true
            }
            break
          }
          summary.errors.push({ downloaderId: downloader.id, downloaderName: downloader.name, message: errorMessage(error) })
        }
      }

      if (!hadError) {
        const agg = aggregateDownloaderIpv6(downloaderTorrents)
        if (downloader.hasIpv6Peers !== agg.hasIpv6Peers) {
          downloader.hasIpv6Peers = agg.hasIpv6Peers
          changed = true
        }
        if (downloader.ipv6TorrentCount !== agg.ipv6TorrentCount) {
          downloader.ipv6TorrentCount = agg.ipv6TorrentCount
          changed = true
        }
        downloader.ipv6SyncedAt = syncedAt
        changed = true
        summary.ipv6TorrentCount += agg.ipv6TorrentCount
      }
    }

    if (changed) await writeState(state)
    return summary
  } finally {
    ipv6SyncRunning = false
  }
}

function clearDownloaderIpv6(downloader: DownloaderRecord, syncedAt: string) {
  let changed = false
  if (downloader.hasIpv6Peers) {
    downloader.hasIpv6Peers = false
    changed = true
  }
  if (downloader.ipv6TorrentCount) {
    downloader.ipv6TorrentCount = 0
    changed = true
  }
  if (downloader.ipv6SyncedAt !== syncedAt) {
    downloader.ipv6SyncedAt = syncedAt
    changed = true
  }
  return changed
}
