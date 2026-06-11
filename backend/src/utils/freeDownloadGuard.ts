import { listDownloadersFromDb, listTorrents, updateTorrents, type TorrentRecord } from '../storage.js'
import { deleteTorrentFromQb } from './qbittorrent.js'

export type FreeDownloadGuardSummary = {
  checkedCount: number
  expiredIncompleteCount: number
  deletedCount: number
  failedCount: number
  skippedCount: number
  details: Array<{ torrentId: string; title: string; downloaderName?: string; message: string; status: 'DELETED' | 'FAILED' | 'SKIPPED' }>
}

let guardRunning = false

function validTime(value?: string) {
  if (!value) return undefined
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? undefined : time
}

function isDownloadIncomplete(progress?: number) {
  return progress === undefined || progress < 1
}

function shortTitle(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized || '未知种子'
}

export async function cleanupExpiredFreeDownloads(): Promise<FreeDownloadGuardSummary> {
  if (guardRunning) {
    return {
      checkedCount: 0,
      expiredIncompleteCount: 0,
      deletedCount: 0,
      failedCount: 0,
      skippedCount: 1,
      details: [{ torrentId: 'ALL', title: '仅免费下载扫描', message: '上一次扫描仍在运行', status: 'SKIPPED' }]
    }
  }

  guardRunning = true
  const now = Date.now()
  const summary: FreeDownloadGuardSummary = {
    checkedCount: 0,
    expiredIncompleteCount: 0,
    deletedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    details: []
  }
  const updatedTorrents: TorrentRecord[] = []

  try {
    const candidateList = await listTorrents({ page: 1, pageSize: 1, pushStatus: 'PUSHED' })
    const candidates = candidateList.items.filter((torrent) => torrent.onlyFreeDownload && torrent.torrentHash)
    summary.checkedCount = candidates.length

    const downloaders = await listDownloadersFromDb()
    const downloaderById = new Map(downloaders.map((downloader) => [downloader.id, downloader]))

    for (const torrent of candidates) {
      const freeEndTime = validTime(torrent.freeEndAt)
      if (freeEndTime === undefined || freeEndTime > now || !isDownloadIncomplete(torrent.downloadProgress)) continue

      summary.expiredIncompleteCount += 1
      const downloader = downloaderById.get(torrent.downloaderId ?? '')
      if (!downloader) {
        const message = '种子绑定下载器不存在，无法删除下载器任务'
        torrent.errorMessage = message
        updatedTorrents.push(torrent)
        summary.failedCount += 1
        summary.details.push({ torrentId: torrent.id, title: torrent.title, downloaderName: torrent.downloaderName, message, status: 'FAILED' })
        continue
      }
      if (!downloader.enabled) {
        const message = '下载器已禁用，无法删除下载器任务'
        torrent.errorMessage = message
        updatedTorrents.push(torrent)
        summary.failedCount += 1
        summary.details.push({ torrentId: torrent.id, title: torrent.title, downloaderName: downloader.name, message, status: 'FAILED' })
        continue
      }

      const hash = torrent.torrentHash
      if (!hash) {
        const message = '缺少下载器任务 Hash，无法删除下载器任务'
        torrent.errorMessage = message
        updatedTorrents.push(torrent)
        summary.failedCount += 1
        summary.details.push({ torrentId: torrent.id, title: torrent.title, downloaderName: downloader.name, message, status: 'FAILED' })
        continue
      }

      try {
        const result = await deleteTorrentFromQb(downloader, hash, true)
        torrent.pushStatus = 'DELETED'
        torrent.currentState = 'DOWNLOADER_DELETED'
        torrent.downloaderState = 'deleted'
        torrent.errorMessage = undefined
        updatedTorrents.push(torrent)
        summary.deletedCount += 1
        summary.details.push({
          torrentId: torrent.id,
          title: torrent.title,
          downloaderName: downloader.name,
          message: result.alreadyMissing
            ? `免费期已过且未下载完成，下载器任务已不存在，已同步本地状态：${shortTitle(torrent.title)}`
            : `免费期已过且未下载完成，已删除下载器任务及文件：${shortTitle(torrent.title)}`,
          status: 'DELETED'
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : '删除下载器任务失败'
        torrent.errorMessage = `仅免费下载删除失败：${message}`
        updatedTorrents.push(torrent)
        summary.failedCount += 1
        summary.details.push({ torrentId: torrent.id, title: torrent.title, downloaderName: downloader.name, message, status: 'FAILED' })
      }
    }

    if (updatedTorrents.length) await updateTorrents(updatedTorrents)

    return summary
  } finally {
    guardRunning = false
  }
}
