import { listAllTorrents, listDownloadersFromDb, updateTorrents, type TorrentRecord } from '../storage.js'
import { deleteTorrentFromQb } from './qbittorrent.js'
import { recordTorrentLog } from './logger.js'

export type FreeDownloadGuardSummary = {
  checkedCount: number
  expiredIncompleteCount: number
  deletedCount: number
  failedCount: number
  skippedCount: number
  details: Array<{ torrentId: string; title: string; downloaderName?: string; message: string; reason?: string; status: 'DELETED' | 'FAILED' | 'SKIPPED' }>
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

function evaluateReason(torrent: TorrentRecord, now: number): string | undefined {
  const freeEndTime = validTime(torrent.freeEndAt)
  // 条件①：仅免费下载（已过免费期且未下载完成）
  if (torrent.onlyFreeDownload && freeEndTime !== undefined && freeEndTime <= now && isDownloadIncomplete(torrent.downloadProgress)) {
    return '仅免费下载：已过免费期且未下载完成'
  }
  // 条件②：免费到期（无视下载进度）
  if (torrent.deleteOnFreeExpire && freeEndTime !== undefined && freeEndTime <= now) {
    return '免费已到期'
  }
  // 条件③：低速持续（lowUploadSince 由 torrentSync 每 3s 维护）
  const kbps = torrent.lowUploadKbps
  const minutes = torrent.lowUploadMinutes
  if (kbps && kbps > 0 && minutes && minutes >= 1) {
    const since = validTime(torrent.lowUploadSince)
    if (since !== undefined && now - since >= minutes * 60_000) {
      return `上传速度低于 ${kbps} KB/秒 持续 ${minutes} 分钟`
    }
  }
  return undefined
}

export async function cleanupExpiredFreeDownloads(): Promise<FreeDownloadGuardSummary> {
  if (guardRunning) {
    return {
      checkedCount: 0,
      expiredIncompleteCount: 0,
      deletedCount: 0,
      failedCount: 0,
      skippedCount: 1,
      details: [{ torrentId: 'ALL', title: '下载器自动清理扫描', message: '上一次扫描仍在运行', status: 'SKIPPED' }]
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
    const candidates = (await listAllTorrents({ pushStatus: 'PUSHED' })).filter((torrent) => {
      if (!torrent.torrentHash) return false
      return Boolean(
        torrent.onlyFreeDownload ||
          torrent.deleteOnFreeExpire ||
          (torrent.lowUploadKbps && torrent.lowUploadKbps > 0 && torrent.lowUploadMinutes && torrent.lowUploadMinutes >= 1)
      )
    })
    summary.checkedCount = candidates.length

    const downloaders = await listDownloadersFromDb()
    const downloaderById = new Map(downloaders.map((downloader) => [downloader.id, downloader]))

    for (const torrent of candidates) {
      const reason = evaluateReason(torrent, now)
      if (!reason) continue

      summary.expiredIncompleteCount += 1
      const downloader = downloaderById.get(torrent.downloaderId ?? '')
      if (!downloader) {
        const message = '种子绑定下载器不存在，无法删除下载器任务'
        torrent.errorMessage = message
        updatedTorrents.push(torrent)
        summary.failedCount += 1
        summary.details.push({ torrentId: torrent.id, title: torrent.title, downloaderName: torrent.downloaderName, message, reason, status: 'FAILED' })
        await recordTorrentLog({
          torrentId: torrent.id,
          siteId: torrent.siteId,
          siteName: torrent.siteName,
          torrentTitle: torrent.title,
          event: 'AUTO_DELETE_TASK',
          status: 'FAILED',
          source: 'SCHEDULER',
          reason,
          message: `自动删除下载器任务失败：${message}`
        })
        continue
      }
      if (!downloader.enabled) {
        const message = '下载器已禁用，无法删除下载器任务'
        torrent.errorMessage = message
        updatedTorrents.push(torrent)
        summary.failedCount += 1
        summary.details.push({ torrentId: torrent.id, title: torrent.title, downloaderName: downloader.name, message, reason, status: 'FAILED' })
        await recordTorrentLog({
          torrentId: torrent.id,
          siteId: torrent.siteId,
          siteName: torrent.siteName,
          torrentTitle: torrent.title,
          event: 'AUTO_DELETE_TASK',
          status: 'FAILED',
          source: 'SCHEDULER',
          reason,
          message: `自动删除下载器任务失败：${message}`
        })
        continue
      }

      const hash = torrent.torrentHash
      if (!hash) {
        const message = '缺少下载器任务 Hash，无法删除下载器任务'
        torrent.errorMessage = message
        updatedTorrents.push(torrent)
        summary.failedCount += 1
        summary.details.push({ torrentId: torrent.id, title: torrent.title, downloaderName: downloader.name, message, reason, status: 'FAILED' })
        await recordTorrentLog({
          torrentId: torrent.id,
          siteId: torrent.siteId,
          siteName: torrent.siteName,
          torrentTitle: torrent.title,
          event: 'AUTO_DELETE_TASK',
          status: 'FAILED',
          source: 'SCHEDULER',
          reason,
          message: `自动删除下载器任务失败：${message}`
        })
        continue
      }

      try {
        const result = await deleteTorrentFromQb(downloader, hash, true)
        torrent.pushStatus = 'DELETED'
        torrent.currentState = 'DOWNLOADER_DELETED'
        torrent.downloaderState = 'deleted'
        torrent.errorMessage = reason
        torrent.lowUploadSince = undefined
        updatedTorrents.push(torrent)
        summary.deletedCount += 1
        const message = result.alreadyMissing
          ? `${reason}，下载器任务已不存在，已同步本地状态：${shortTitle(torrent.title)}`
          : `${reason}，已删除下载器任务及文件：${shortTitle(torrent.title)}`
        summary.details.push({
          torrentId: torrent.id,
          title: torrent.title,
          downloaderName: downloader.name,
          message,
          reason,
          status: 'DELETED'
        })
        await recordTorrentLog({
          torrentId: torrent.id,
          siteId: torrent.siteId,
          siteName: torrent.siteName,
          torrentTitle: torrent.title,
          event: 'AUTO_DELETE_TASK',
          status: 'SUCCESS',
          source: 'SCHEDULER',
          reason,
          message
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : '删除下载器任务失败'
        torrent.errorMessage = `${reason}，删除失败：${message}`
        updatedTorrents.push(torrent)
        summary.failedCount += 1
        summary.details.push({ torrentId: torrent.id, title: torrent.title, downloaderName: downloader.name, message, reason, status: 'FAILED' })
        await recordTorrentLog({
          torrentId: torrent.id,
          siteId: torrent.siteId,
          siteName: torrent.siteName,
          torrentTitle: torrent.title,
          event: 'AUTO_DELETE_TASK',
          status: 'FAILED',
          source: 'SCHEDULER',
          reason,
          message: `自动删除下载器任务失败：${message}`
        })
      }
    }

    if (updatedTorrents.length) await updateTorrents(updatedTorrents)

    return summary
  } finally {
    guardRunning = false
  }
}
