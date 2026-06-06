import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState, writeState } from '../storage.js'
import type { TorrentRecord } from '../storage.js'
import { recordOperationLog } from '../utils/logger.js'
import { addTorrentUrlToQb, deleteTorrentFromQb } from '../utils/qbittorrent.js'
import { syncTorrentDownloadStats } from '../utils/torrentSync.js'

export const torrentsRouter = Router()

function safeTorrent(torrent: TorrentRecord) {
  const { downloadUrl: _downloadUrl, ...safe } = torrent
  if (safe.pushStatus === 'PUSHED' && !torrent.downloadUrl) {
    return {
      ...safe,
      pushStatus: 'PUSH_FAILED',
      currentState: 'PUSH_FAILED',
      downloaderState: undefined,
      torrentHash: undefined,
      errorMessage: safe.errorMessage ?? '缺少真实下载链接，无法确认已推送到下载器'
    }
  }
  return safe
}

function refreshTorrentFreeState(torrent: TorrentRecord, expiringSoonMinutes = 120) {
  if (!torrent.freeEndAt || torrent.pushStatus === 'DELETED') return false
  const previous = {
    isFreeNow: torrent.isFreeNow,
    currentState: torrent.currentState
  }
  const freeEndTime = new Date(torrent.freeEndAt).getTime()
  if (Number.isNaN(freeEndTime)) return false

  const now = Date.now()
  if (freeEndTime <= now) {
    torrent.isFreeNow = false
    torrent.currentState = 'EXPIRED'
  } else {
    torrent.isFreeNow = true
    if (freeEndTime - now <= expiringSoonMinutes * 60_000) {
      torrent.currentState = 'EXPIRING_SOON'
    } else if (torrent.pushStatus === 'PUSHED') {
      torrent.currentState = 'PUSHED'
    } else if (torrent.pushStatus === 'PUSH_FAILED') {
      torrent.currentState = 'PUSH_FAILED'
    } else {
      torrent.currentState = 'FREE_NOW'
    }
  }
  return previous.isFreeNow !== torrent.isFreeNow || previous.currentState !== torrent.currentState
}

function refreshTorrentFreeStates(state: Awaited<ReturnType<typeof readState>>) {
  let changed = false
  for (const torrent of state.torrents) {
    const task = state.tasks.find((item) => item.id === torrent.sourceTaskId)
    changed = refreshTorrentFreeState(torrent, task?.expiringSoonMinutes ?? 120) || changed
  }
  return changed
}

function operationActor(res: { locals: { user?: { id?: string; username?: string } } }, req: { ip?: string; get(name: string): string | undefined }) {
  return {
    actorId: res.locals.user?.id,
    actorName: res.locals.user?.username,
    ip: req.ip,
    userAgent: req.get('user-agent')
  }
}

function torrentFilename(title: string, fallback: string) {
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180).trim()
  return `${safeTitle || fallback}.torrent`
}

function requestIds(body: unknown) {
  const ids = Array.isArray((body as { ids?: unknown[] })?.ids) ? (body as { ids: unknown[] }).ids : []
  return [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))]
}

function torrentSortTime(torrent: TorrentRecord) {
  const value = torrent.firstSeenAt || torrent.lastSeenAt || torrent.pushedAt
  const time = value ? new Date(value).getTime() : 0
  return Number.isNaN(time) ? 0 : time
}

function resolvePushSavePath(torrent: TorrentRecord, downloader: { savePath?: string }) {
  return torrent.taskSavePath?.trim() || downloader.savePath?.trim() || undefined
}

function stats(items: Awaited<ReturnType<typeof readState>>['torrents']) {
  const now = Date.now()
  const safeItems = items.map(safeTorrent)
  const bySite = new Map<string, { siteId: string; siteName: string; uploaded: number; downloaded: number; torrentCount: number }>()
  for (const item of safeItems) {
    const site = bySite.get(item.siteId) ?? { siteId: item.siteId, siteName: item.siteName, uploaded: 0, downloaded: 0, torrentCount: 0 }
    site.uploaded += item.uploaded ?? 0
    site.downloaded += item.downloaded ?? 0
    site.torrentCount += 1
    bySite.set(item.siteId, site)
  }
  return {
    total: safeItems.length,
    running: safeItems.filter((item) => item.pushStatus === 'PUSHED').length,
    notRunning: safeItems.filter((item) => item.pushStatus === 'PUSH_FAILED' || item.pushStatus === 'DELETED').length,
    auto: safeItems.filter((item) => item.sourceRunMode === 'AUTO').length,
    manual: safeItems.filter((item) => item.sourceRunMode === 'MANUAL_RUN').length,
    pending: safeItems.filter((item) => item.pushStatus === 'NEW').length,
    failed: safeItems.filter((item) => item.pushStatus === 'PUSH_FAILED').length,
    expiringSoon: safeItems.filter((item) => item.freeEndAt && new Date(item.freeEndAt).getTime() > now && item.currentState === 'EXPIRING_SOON').length,
    totalUploaded: safeItems.reduce((total, item) => total + (item.uploaded ?? 0), 0),
    totalDownloaded: safeItems.reduce((total, item) => total + (item.downloaded ?? 0), 0),
    bySite: [...bySite.values()].sort((a, b) => b.uploaded + b.downloaded - (a.uploaded + a.downloaded))
  }
}

function matchesFreeStatus(torrent: ReturnType<typeof safeTorrent>, freeStatus: string) {
  if (freeStatus === 'ALL') return true

  const freeEndTime = torrent.freeEndAt ? new Date(torrent.freeEndAt).getTime() : undefined
  const hasValidFreeEndAt = freeEndTime !== undefined && !Number.isNaN(freeEndTime)
  const now = Date.now()
  const isFreeNow = Boolean((hasValidFreeEndAt && freeEndTime > now) || torrent.isFreeNow)

  if (freeStatus === 'FREE_NOW') return isFreeNow
  if (freeStatus === 'EXPIRING_SOON') return torrent.currentState === 'EXPIRING_SOON'
  if (freeStatus === 'EXPIRED') return torrent.currentState === 'EXPIRED' || Boolean(hasValidFreeEndAt && freeEndTime <= now)
  if (freeStatus === 'NORMAL') return torrent.discountType === 'NORMAL' && !isFreeNow
  if (freeStatus === 'FREE_NO_END') return torrent.isFreeNow && !torrent.freeEndAt
  return true
}

torrentsRouter.post('/sync', requireAuth, async (_req, res) => {
  const summary = await syncTorrentDownloadStats()
  res.json(summary)
})

torrentsRouter.get('/', requireAuth, async (req, res) => {
  const state = await readState()
  const changed = refreshTorrentFreeStates(state)
  if (changed) await writeState(state)
  const keyword = String(req.query.keyword ?? '').trim().toLowerCase()
  const siteId = String(req.query.siteId ?? '')
  const downloaderId = String(req.query.downloaderId ?? '')
  const taskId = String(req.query.taskId ?? '')
  const pushStatus = String(req.query.pushStatus ?? 'ALL')
  const status = String(req.query.status ?? 'ALL')
  const freeStatus = String(req.query.freeStatus ?? 'ALL')
  const sourceRunMode = String(req.query.sourceRunMode ?? 'ALL')
  const page = Math.max(Number(req.query.page ?? 1), 1)
  const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20), 1), 100)
  const filtered = state.torrents.filter((item) => {
    if (keyword && !`${item.title} ${item.siteName} ${item.sourceTaskName ?? ''}`.toLowerCase().includes(keyword)) return false
    if (siteId && item.siteId !== siteId) return false
    if (downloaderId && item.downloaderId !== downloaderId) return false
    if (taskId && item.sourceTaskId !== taskId) return false
    const safeItem = safeTorrent(item)
    if (pushStatus !== 'ALL' && safeItem.pushStatus !== pushStatus) return false
    if (status === 'RUNNING' && safeItem.pushStatus !== 'PUSHED') return false
    if (status === 'NOT_RUNNING' && safeItem.pushStatus !== 'PUSH_FAILED' && safeItem.pushStatus !== 'DELETED') return false
    if (status !== 'ALL' && status !== 'RUNNING' && status !== 'NOT_RUNNING' && safeItem.currentState !== status) return false
    if (!matchesFreeStatus(safeItem, freeStatus)) return false
    if (sourceRunMode !== 'ALL' && item.sourceRunMode !== sourceRunMode) return false
    return true
  })
  const sorted = [...filtered].sort((a, b) => torrentSortTime(b) - torrentSortTime(a) || b.id.localeCompare(a.id))
  const start = (page - 1) * pageSize
  res.json({ items: sorted.slice(start, start + pageSize).map(safeTorrent), total: filtered.length, page, pageSize, stats: stats(state.torrents) })
})

torrentsRouter.get('/:id', requireAuth, async (req, res) => {
  const state = await readState()
  const changed = refreshTorrentFreeStates(state)
  if (changed) await writeState(state)
  const torrent = state.torrents.find((item) => item.id === String(req.params.id))
  if (!torrent) return res.status(404).json({ message: '种子不存在' })
  res.json(safeTorrent(torrent))
})

torrentsRouter.post('/:id/push', requireAuth, async (req, res) => {
  const state = await readState()
  const torrent = state.torrents.find((item) => item.id === String(req.params.id))
  if (!torrent) return res.status(404).json({ message: '种子不存在' })
  const downloader = state.downloaders.find((item) => item.id === (String((req.body as { downloaderId?: string }).downloaderId ?? '') || torrent.downloaderId))
  const site = state.sites.find((item) => item.id === torrent.siteId)
  if (!downloader) return res.status(400).json({ message: '请选择下载器' })
  if (!downloader.enabled) return res.status(400).json({ message: '下载器已禁用' })
  if (!site) return res.status(400).json({ message: '种子来源站点不存在' })
  if (torrent.linkStatus !== 'SAVED' || !torrent.downloadUrl) {
    torrent.pushStatus = 'PUSH_FAILED'
    torrent.currentState = 'PUSH_FAILED'
    torrent.errorMessage = '缺少真实种子下载链接'
    torrent.torrentHash = undefined
    torrent.downloaderState = undefined
    await writeState(state)
    return res.status(400).json({ message: torrent.errorMessage })
  }
  try {
    const pushed = await addTorrentUrlToQb(downloader, site, torrent.downloadUrl, torrentFilename(torrent.title, torrent.torrentId ?? torrent.id), {
      savePath: resolvePushSavePath(torrent, downloader),
      category: torrent.sourceTaskName
    })
    torrent.torrentHash = pushed.hash
    torrent.downloaderState = pushed.state ?? 'added'
  } catch (error) {
    torrent.pushStatus = 'PUSH_FAILED'
    torrent.currentState = 'PUSH_FAILED'
    torrent.errorMessage = error instanceof Error ? error.message : '推送到下载器失败'
    torrent.torrentHash = undefined
    torrent.downloaderState = undefined
    await writeState(state)
    return res.status(400).json({ message: torrent.errorMessage })
  }
  const now = new Date().toISOString()
  torrent.downloaderId = downloader.id
  torrent.downloaderName = downloader.name
  torrent.downloaderType = downloader.type
  torrent.downloaderState = torrent.downloaderState ?? 'added'
  torrent.pushStatus = 'PUSHED'
  torrent.currentState = 'PUSHED'
  torrent.pushedAt = now
  torrent.errorMessage = undefined
  await writeState(state)
  await syncTorrentDownloadStats(downloader.id).catch(() => undefined)
  const syncedState = await readState()
  const syncedTorrent = syncedState.torrents.find((item) => item.id === torrent.id) ?? torrent
  await recordOperationLog({
    action: '推送种子',
    message: `推送种子「${torrent.title}」到「${downloader.name}」`,
    status: 'SUCCESS',
    ...operationActor(res, req)
  })
  res.json(safeTorrent(syncedTorrent))
})

torrentsRouter.post('/batch-push', requireAuth, async (req, res) => {
  const ids = requestIds(req.body)
  const state = await readState()
  let successCount = 0
  const failed: Array<{ id: string; message: string }> = []
  for (const id of ids) {
    const torrent = state.torrents.find((item) => item.id === id)
    if (!torrent) {
      failed.push({ id, message: '种子不存在' })
      continue
    }
    const downloader = state.downloaders.find((item) => item.id === torrent.downloaderId)
    const site = state.sites.find((item) => item.id === torrent.siteId)
    if (!downloader?.enabled || !site || torrent.linkStatus !== 'SAVED' || !torrent.downloadUrl) {
      torrent.pushStatus = 'PUSH_FAILED'
      torrent.currentState = 'PUSH_FAILED'
      torrent.errorMessage = !downloader?.enabled ? '下载器不可用' : !site ? '种子来源站点不存在' : '缺少真实种子下载链接'
      failed.push({ id, message: torrent.errorMessage })
      continue
    }
    try {
      const pushed = await addTorrentUrlToQb(downloader, site, torrent.downloadUrl, torrentFilename(torrent.title, torrent.torrentId ?? torrent.id), {
        savePath: resolvePushSavePath(torrent, downloader),
        category: torrent.sourceTaskName
      })
      torrent.torrentHash = pushed.hash
      torrent.downloaderState = pushed.state ?? 'added'
    } catch (error) {
      torrent.pushStatus = 'PUSH_FAILED'
      torrent.currentState = 'PUSH_FAILED'
      torrent.errorMessage = error instanceof Error ? error.message : '推送到下载器失败'
      failed.push({ id, message: torrent.errorMessage })
      continue
    }
    torrent.pushStatus = 'PUSHED'
    torrent.currentState = 'PUSHED'
    torrent.downloaderId = downloader.id
    torrent.downloaderName = downloader.name
    torrent.downloaderType = downloader.type
    torrent.downloaderState = torrent.downloaderState ?? 'added'
    torrent.pushedAt = new Date().toISOString()
    torrent.errorMessage = undefined
    successCount += 1
  }
  await writeState(state)
  for (const downloaderId of [...new Set(state.torrents.filter((torrent) => ids.includes(torrent.id) && torrent.pushStatus === 'PUSHED' && torrent.downloaderId).map((torrent) => torrent.downloaderId!))]) {
    await syncTorrentDownloadStats(downloaderId).catch(() => undefined)
  }
  await recordOperationLog({
    action: '批量推送种子',
    message: `批量推送 ${ids.length} 个种子，成功 ${successCount} 个，失败 ${failed.length} 个`,
    status: failed.length ? 'FAILED' : 'SUCCESS',
    ...operationActor(res, req)
  })
  res.json({ successCount, failedCount: failed.length, failed })
})

torrentsRouter.post('/batch-delete', requireAuth, async (req, res) => {
  const ids = requestIds(req.body)
  if (!ids.length) return res.status(400).json({ message: '请选择要删除的种子记录' })
  const state = await readState()
  const idSet = new Set(ids)
  const existingIds = new Set(state.torrents.map((torrent) => torrent.id))
  const beforeCount = state.torrents.length
  state.torrents = state.torrents.filter((torrent) => !idSet.has(torrent.id))
  const deletedCount = beforeCount - state.torrents.length
  const missingIds = ids.filter((id) => !existingIds.has(id))
  await writeState(state)
  await recordOperationLog({
    action: '删除种子记录',
    message: `删除 ${ids.length} 个种子记录，成功 ${deletedCount} 个，缺失 ${missingIds.length} 个`,
    status: missingIds.length ? 'FAILED' : 'SUCCESS',
    ...operationActor(res, req)
  })
  res.json({ deletedCount, missingIds })
})

torrentsRouter.post('/batch-delete-from-downloader', requireAuth, async (req, res) => {
  const ids = requestIds(req.body)
  if (!ids.length) return res.status(400).json({ message: '请选择要删除的下载器任务' })
  const state = await readState()
  let successCount = 0
  const failed: Array<{ id: string; message: string }> = []
  for (const id of ids) {
    const torrent = state.torrents.find((item) => item.id === id)
    if (!torrent) {
      failed.push({ id, message: '种子不存在' })
      continue
    }
    const downloader = state.downloaders.find((item) => item.id === torrent.downloaderId)
    if (!downloader) {
      failed.push({ id, message: '种子绑定下载器不存在' })
      continue
    }
    if (!downloader.enabled) {
      failed.push({ id, message: '下载器已禁用' })
      continue
    }
    if (!torrent.torrentHash) {
      failed.push({ id, message: '缺少下载器任务 Hash，无法删除' })
      continue
    }
    try {
      await deleteTorrentFromQb(downloader, torrent.torrentHash, true)
    } catch (error) {
      failed.push({ id, message: error instanceof Error ? error.message : '删除下载器任务失败' })
      continue
    }
    torrent.pushStatus = 'DELETED'
    torrent.currentState = 'DOWNLOADER_DELETED'
    torrent.downloaderState = 'deleted'
    torrent.errorMessage = undefined
    successCount += 1
  }
  await writeState(state)
  await recordOperationLog({
    action: '批量删除下载器任务',
    message: `批量删除 ${ids.length} 个下载器任务，成功 ${successCount} 个，失败 ${failed.length} 个`,
    status: failed.length ? 'FAILED' : 'SUCCESS',
    ...operationActor(res, req)
  })
  res.json({ successCount, failedCount: failed.length, failed })
})

torrentsRouter.post('/:id/delete-from-downloader', requireAuth, async (req, res) => {
  const state = await readState()
  const torrent = state.torrents.find((item) => item.id === String(req.params.id))
  if (!torrent) return res.status(404).json({ message: '种子不存在' })
  const downloader = state.downloaders.find((item) => item.id === torrent.downloaderId)
  if (!downloader) return res.status(400).json({ message: '种子绑定下载器不存在' })
  if (!downloader.enabled) return res.status(400).json({ message: '下载器已禁用' })
  if (!torrent.torrentHash) return res.status(400).json({ message: '缺少下载器任务 Hash，无法删除' })
  let deleteResult: Awaited<ReturnType<typeof deleteTorrentFromQb>>
  try {
    deleteResult = await deleteTorrentFromQb(downloader, torrent.torrentHash, true)
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除下载器任务失败'
    await recordOperationLog({
      action: '删除下载器任务',
      message: `删除下载器任务「${torrent.title}」失败：${message}`,
      status: 'FAILED',
      ...operationActor(res, req)
    })
    return res.status(400).json({ message })
  }
  torrent.pushStatus = 'DELETED'
  torrent.currentState = 'DOWNLOADER_DELETED'
  torrent.downloaderState = 'deleted'
  torrent.errorMessage = undefined
  await writeState(state)
  await recordOperationLog({
    action: '删除下载器任务',
    message: deleteResult.alreadyMissing ? `下载器任务「${torrent.title}」已不存在，已同步本地状态` : `删除下载器任务「${torrent.title}」`,
    status: 'SUCCESS',
    ...operationActor(res, req)
  })
  res.json(safeTorrent(torrent))
})
