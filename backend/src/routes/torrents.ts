import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  deleteTorrents,
  getTorrentById,
  listDownloadersFromDb,
  listSitesFromDb,
  listTorrents,
  readTorrentStats,
  refreshStoredTorrentFreeStates,
  updateTorrent,
  updateTorrents
} from '../storage.js'
import type { DownloaderRecord, SiteRecord, TorrentRecord } from '../storage.js'
import { recordOperationLog, recordTorrentLog } from '../utils/logger.js'
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

function resolvePushSavePath(torrent: TorrentRecord, downloader: { savePath?: string }) {
  return torrent.taskSavePath?.trim() || downloader.savePath?.trim() || undefined
}

torrentsRouter.get('/', requireAuth, async (req, res) => {
  await refreshStoredTorrentFreeStates()
  const keyword = String(req.query.keyword ?? '').trim().toLowerCase()
  const siteId = String(req.query.siteId ?? '')
  const downloaderId = String(req.query.downloaderId ?? '')
  const taskId = String(req.query.taskId ?? '')
  const pushStatus = String(req.query.pushStatus ?? 'ALL')
  const sourceRunMode = String(req.query.sourceRunMode ?? 'ALL')
  const page = Math.max(Number(req.query.page ?? 1), 1)
  const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20), 1), 100)
  const result = await listTorrents({ keyword, siteId, downloaderId, taskId, pushStatus, sourceRunMode, page, pageSize })
  res.json({ items: result.items.map(safeTorrent), total: result.total, page: result.page, pageSize: result.pageSize, stats: await readTorrentStats() })
})

torrentsRouter.get('/:id', requireAuth, async (req, res) => {
  await refreshStoredTorrentFreeStates()
  const torrent = await getTorrentById(String(req.params.id))
  if (!torrent) return res.status(404).json({ message: '种子不存在' })
  res.json(safeTorrent(torrent))
})

torrentsRouter.patch('/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id)
  const torrent = await getTorrentById(id)
  if (!torrent) return res.status(404).json({ message: '种子不存在' })
  const body = (req.body ?? {}) as {
    downloaderId?: string | null
    taskSavePath?: string | null
    onlyFreeDownload?: boolean
    deleteOnFreeExpire?: boolean
    lowUploadKbps?: number | null
    lowUploadMinutes?: number | null
  }
  const isInDownloader = torrent.pushStatus === 'PUSHED' && Boolean(torrent.torrentHash)
  if (isInDownloader) {
    if (Object.prototype.hasOwnProperty.call(body, 'taskSavePath')) {
      return res.status(400).json({ message: '种子已在下载器中运行，无法修改保存位置' })
    }
    if (Object.prototype.hasOwnProperty.call(body, 'downloaderId')) {
      return res.status(400).json({ message: '种子已在下载器中运行，无法切换下载器' })
    }
  }
  const updates: Partial<TorrentRecord> = {}
  let downloaderNameSnapshot: string | undefined
  let savePathSnapshot: string | undefined
  if (Object.prototype.hasOwnProperty.call(body, 'taskSavePath')) {
    if (body.taskSavePath !== null && typeof body.taskSavePath !== 'string') {
      return res.status(400).json({ message: '保存位置格式不正确' })
    }
    const next = body.taskSavePath === null ? '' : (body.taskSavePath as string).trim()
    const current = torrent.taskSavePath ?? ''
    if (next !== current) {
      updates.taskSavePath = next || undefined
      savePathSnapshot = updates.taskSavePath
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'downloaderId')) {
    if (body.downloaderId === null || body.downloaderId === '') {
      return res.status(400).json({ message: '请选择下载器' })
    }
    if (typeof body.downloaderId !== 'string') {
      return res.status(400).json({ message: '下载器 ID 格式不正确' })
    }
    const downloader = (await listDownloadersFromDb()).find((item) => item.id === body.downloaderId)
    if (!downloader) return res.status(400).json({ message: '下载器不存在' })
    if (!downloader.enabled) return res.status(400).json({ message: '下载器已禁用' })
    if (torrent.downloaderId !== downloader.id || torrent.downloaderName !== downloader.name) {
      updates.downloaderId = downloader.id
      updates.downloaderName = downloader.name
      updates.downloaderType = downloader.type
      downloaderNameSnapshot = downloader.name
    }
  }
  const ruleSummary: string[] = []
  if (Object.prototype.hasOwnProperty.call(body, 'onlyFreeDownload')) {
    if (typeof body.onlyFreeDownload !== 'boolean') return res.status(400).json({ message: '仅免费下载格式不正确' })
    if (Boolean(torrent.onlyFreeDownload) !== body.onlyFreeDownload) {
      updates.onlyFreeDownload = body.onlyFreeDownload
      ruleSummary.push(`仅免费下载${body.onlyFreeDownload ? '已开启' : '已关闭'}`)
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'deleteOnFreeExpire')) {
    if (typeof body.deleteOnFreeExpire !== 'boolean') return res.status(400).json({ message: '免费到期删除格式不正确' })
    if (Boolean(torrent.deleteOnFreeExpire) !== body.deleteOnFreeExpire) {
      updates.deleteOnFreeExpire = body.deleteOnFreeExpire
      ruleSummary.push(`免费到期删除${body.deleteOnFreeExpire ? '已开启' : '已关闭'}`)
    }
  }
  const hasKbps = Object.prototype.hasOwnProperty.call(body, 'lowUploadKbps')
  const hasMinutes = Object.prototype.hasOwnProperty.call(body, 'lowUploadMinutes')
  if (hasKbps || hasMinutes) {
    const rawKbps = hasKbps ? body.lowUploadKbps : torrent.lowUploadKbps
    const rawMinutes = hasMinutes ? body.lowUploadMinutes : torrent.lowUploadMinutes
    const enabledKbps = rawKbps !== undefined && rawKbps !== null && Number(rawKbps) > 0
    const enabledMinutes = rawMinutes !== undefined && rawMinutes !== null && Number(rawMinutes) > 0
    if (enabledKbps !== enabledMinutes) return res.status(400).json({ message: '低速删除的速度阈值和持续时间需同时填写' })
    if (enabledKbps) {
      const k = Number(rawKbps)
      const m = Number(rawMinutes)
      if (!Number.isInteger(k) || k < 1) return res.status(400).json({ message: '低速删除的速度阈值必须是大于等于 1 的整数' })
      if (!Number.isInteger(m) || m < 1) return res.status(400).json({ message: '低速删除的持续时间必须是大于等于 1 的整数' })
      if (torrent.lowUploadKbps !== k || torrent.lowUploadMinutes !== m) {
        updates.lowUploadKbps = k
        updates.lowUploadMinutes = m
        updates.lowUploadSince = undefined
        ruleSummary.push(`低速删除：${k} KB/秒 持续 ${m} 分钟`)
      }
    } else if (torrent.lowUploadKbps || torrent.lowUploadMinutes) {
      updates.lowUploadKbps = undefined
      updates.lowUploadMinutes = undefined
      updates.lowUploadSince = undefined
      ruleSummary.push('低速删除已关闭')
    }
  }
  if (!Object.keys(updates).length) return res.json(safeTorrent(torrent))
  await updateTorrent({ ...torrent, ...updates })
  const summary: string[] = []
  if (downloaderNameSnapshot) summary.push(`下载器改为「${downloaderNameSnapshot}」`)
  if (Object.prototype.hasOwnProperty.call(body, 'taskSavePath')) {
    summary.push(savePathSnapshot ? `保存位置改为「${savePathSnapshot}」` : '保存位置已清空')
  }
  summary.push(...ruleSummary)
  await recordOperationLog({
    action: '修改种子设置',
    message: `修改种子「${torrent.title}」${summary.join('，')}`,
    status: 'SUCCESS',
    ...operationActor(res, req)
  })
  await recordTorrentLog({
    torrentId: torrent.id,
    siteId: torrent.siteId,
    siteName: torrent.siteName,
    torrentTitle: torrent.title,
    event: 'UPDATE_SETTINGS',
    status: 'SUCCESS',
    source: 'MANUAL',
    actorId: res.locals.user?.id,
    actorName: res.locals.user?.username,
    message: `修改种子设置：${summary.join('，')}`
  })
  res.json(safeTorrent({ ...torrent, ...updates }))
})

torrentsRouter.post('/:id/push', requireAuth, async (req, res) => {
  const id = String(req.params.id)
  const torrent = await getTorrentById(id)
  if (!torrent) return res.status(404).json({ message: '种子不存在' })
  const body = (req.body ?? {}) as { downloaderId?: string | null; taskSavePath?: string | null }
  const requestedDownloaderId = typeof body.downloaderId === 'string' ? body.downloaderId.trim() : ''
  if (Object.prototype.hasOwnProperty.call(body, 'taskSavePath') && body.taskSavePath !== null && typeof body.taskSavePath !== 'string') {
    return res.status(400).json({ message: '保存位置格式不正确' })
  }
  const hasSavePathOverride = Object.prototype.hasOwnProperty.call(body, 'taskSavePath') && body.taskSavePath !== null
  const savePathOverride = hasSavePathOverride ? (body.taskSavePath as string).trim() : undefined
  const [downloaders, sites] = await Promise.all([listDownloadersFromDb(), listSitesFromDb()])
  const downloader = downloaders.find((item) => item.id === (requestedDownloaderId || torrent.downloaderId))
  const site = sites.find((item) => item.id === torrent.siteId)
  if (!downloader) return res.status(400).json({ message: '请选择下载器' })
  if (!downloader.enabled) return res.status(400).json({ message: '下载器已禁用' })
  if (!site) return res.status(400).json({ message: '种子来源站点不存在' })
  if (hasSavePathOverride) torrent.taskSavePath = savePathOverride
  if (torrent.linkStatus !== 'SAVED' || !torrent.downloadUrl) {
    torrent.pushStatus = 'PUSH_FAILED'
    torrent.currentState = 'PUSH_FAILED'
    torrent.errorMessage = '缺少真实种子下载链接'
    torrent.torrentHash = undefined
    torrent.downloaderState = undefined
    await updateTorrent(torrent)
    await recordTorrentLog({
      torrentId: torrent.id,
      siteId: torrent.siteId,
      siteName: torrent.siteName,
      torrentTitle: torrent.title,
      event: 'PUSH_FAILED',
      status: 'FAILED',
      source: 'MANUAL',
      actorId: res.locals.user?.id,
      actorName: res.locals.user?.username,
      message: `推送种子「${torrent.title}」失败：${torrent.errorMessage}`
    })
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
    await updateTorrent(torrent)
    await recordTorrentLog({
      torrentId: torrent.id,
      siteId: torrent.siteId,
      siteName: torrent.siteName,
      torrentTitle: torrent.title,
      event: 'PUSH_FAILED',
      status: 'FAILED',
      source: 'MANUAL',
      actorId: res.locals.user?.id,
      actorName: res.locals.user?.username,
      message: `推送种子「${torrent.title}」失败：${torrent.errorMessage}`
    })
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
  await updateTorrent(torrent)
  await syncTorrentDownloadStats(downloader.id).catch(() => undefined)
  const syncedTorrent = (await getTorrentById(id)) ?? torrent
  await recordOperationLog({
    action: '推送种子',
    message: `推送种子「${torrent.title}」到「${downloader.name}」${torrent.taskSavePath ? `，保存位置：${torrent.taskSavePath}` : ''}`,
    status: 'SUCCESS',
    ...operationActor(res, req)
  })
  await recordTorrentLog({
    torrentId: torrent.id,
    siteId: torrent.siteId,
    siteName: torrent.siteName,
    torrentTitle: torrent.title,
    event: 'PUSHED',
    status: 'SUCCESS',
    source: 'MANUAL',
    actorId: res.locals.user?.id,
    actorName: res.locals.user?.username,
    message: `推送种子「${torrent.title}」到「${downloader.name}」${torrent.taskSavePath ? `，保存位置：${torrent.taskSavePath}` : ''}`
  })
  res.json(safeTorrent(syncedTorrent))
})

torrentsRouter.post('/batch-push', requireAuth, async (req, res) => {
  const ids = requestIds(req.body)
  if (!ids.length) return res.status(400).json({ message: '请选择要推送的种子' })
  const [downloaders, sites, pageOne] = await Promise.all([listDownloadersFromDb(), listSitesFromDb(), listTorrents({ page: 1, pageSize: 1 })])
  void pageOne
  const siteById = new Map(sites.map((site: SiteRecord) => [site.id, site]))
  const downloaderById = new Map(downloaders.map((downloader: DownloaderRecord) => [downloader.id, downloader]))
  const torrents: TorrentRecord[] = []
  for (const id of ids) {
    const torrent = await getTorrentById(id)
    if (!torrent) continue
    torrents.push(torrent)
  }
  const updateBuffer: TorrentRecord[] = []
  let successCount = 0
  const failed: Array<{ id: string; message: string }> = []
  for (const torrent of torrents) {
    const downloader = downloaderById.get(torrent.downloaderId ?? '')
    const site = siteById.get(torrent.siteId)
    if (!downloader?.enabled || !site || torrent.linkStatus !== 'SAVED' || !torrent.downloadUrl) {
      torrent.pushStatus = 'PUSH_FAILED'
      torrent.currentState = 'PUSH_FAILED'
      torrent.errorMessage = !downloader?.enabled ? '下载器不可用' : !site ? '种子来源站点不存在' : '缺少真实种子下载链接'
      updateBuffer.push(torrent)
      failed.push({ id: torrent.id, message: torrent.errorMessage })
      await recordTorrentLog({
        torrentId: torrent.id,
        siteId: torrent.siteId,
        siteName: torrent.siteName,
        torrentTitle: torrent.title,
        event: 'PUSH_FAILED',
        status: 'FAILED',
        source: 'MANUAL',
        actorId: res.locals.user?.id,
        actorName: res.locals.user?.username,
        message: `批量推送种子「${torrent.title}」失败：${torrent.errorMessage}`
      })
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
      updateBuffer.push(torrent)
      failed.push({ id: torrent.id, message: torrent.errorMessage })
      await recordTorrentLog({
        torrentId: torrent.id,
        siteId: torrent.siteId,
        siteName: torrent.siteName,
        torrentTitle: torrent.title,
        event: 'PUSH_FAILED',
        status: 'FAILED',
        source: 'MANUAL',
        actorId: res.locals.user?.id,
        actorName: res.locals.user?.username,
        message: `批量推送种子「${torrent.title}」失败：${torrent.errorMessage}`
      })
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
    updateBuffer.push(torrent)
    successCount += 1
    await recordTorrentLog({
      torrentId: torrent.id,
      siteId: torrent.siteId,
      siteName: torrent.siteName,
      torrentTitle: torrent.title,
      event: 'PUSHED',
      status: 'SUCCESS',
      source: 'MANUAL',
      actorId: res.locals.user?.id,
      actorName: res.locals.user?.username,
      message: `批量推送种子「${torrent.title}」到「${downloader.name}」`
    })
  }
  if (updateBuffer.length) await updateTorrents(updateBuffer)
  for (const downloaderId of [...new Set(updateBuffer.filter((torrent) => torrent.pushStatus === 'PUSHED' && torrent.downloaderId).map((torrent) => torrent.downloaderId!))]) {
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
  const snapshots: TorrentRecord[] = []
  for (const id of ids) {
    const t = await getTorrentById(id)
    if (t) snapshots.push(t)
  }
  const { deletedCount, missingIds } = await deleteTorrents(ids)
  await recordOperationLog({
    action: '删除种子记录',
    message: `删除 ${ids.length} 个种子记录，成功 ${deletedCount} 个，缺失 ${missingIds.length} 个`,
    status: missingIds.length ? 'FAILED' : 'SUCCESS',
    ...operationActor(res, req)
  })
  for (const t of snapshots) {
    await recordTorrentLog({
      torrentId: t.id,
      siteId: t.siteId,
      siteName: t.siteName,
      torrentTitle: t.title,
      event: 'DELETE_RECORD',
      status: 'SUCCESS',
      source: 'MANUAL',
      actorId: res.locals.user?.id,
      actorName: res.locals.user?.username,
      message: `删除种子记录「${t.title}」`
    })
  }
  res.json({ deletedCount, missingIds })
})

torrentsRouter.post('/batch-delete-from-downloader', requireAuth, async (req, res) => {
  const ids = requestIds(req.body)
  if (!ids.length) return res.status(400).json({ message: '请选择要删除的下载器任务' })
  const downloaders = await listDownloadersFromDb()
  const downloaderById = new Map(downloaders.map((downloader) => [downloader.id, downloader]))
  const updateBuffer: TorrentRecord[] = []
  let successCount = 0
  const failed: Array<{ id: string; message: string }> = []

  const affectedDownloaderIds = new Set<string>()
  for (const id of ids) {
    const t = await getTorrentById(id)
    if (t?.downloaderId && downloaderById.has(t.downloaderId)) {
      affectedDownloaderIds.add(t.downloaderId)
    }
  }
  for (const did of affectedDownloaderIds) {
    await syncTorrentDownloadStats(did).catch(() => undefined)
  }

  for (const id of ids) {
    const torrent = await getTorrentById(id)
    if (!torrent) {
      failed.push({ id, message: '种子不存在' })
      continue
    }
    const downloader = downloaderById.get(torrent.downloaderId ?? '')
    if (!downloader) {
      failed.push({ id, message: '种子绑定下载器不存在' })
      await recordTorrentLog({
        torrentId: torrent.id,
        siteId: torrent.siteId,
        siteName: torrent.siteName,
        torrentTitle: torrent.title,
        event: 'MANUAL_DELETE_TASK',
        status: 'FAILED',
        source: 'MANUAL',
        actorId: res.locals.user?.id,
        actorName: res.locals.user?.username,
        message: `批量删除下载器任务「${torrent.title}」失败：种子绑定下载器不存在`
      })
      continue
    }
    if (!downloader.enabled) {
      failed.push({ id, message: '下载器已禁用' })
      await recordTorrentLog({
        torrentId: torrent.id,
        siteId: torrent.siteId,
        siteName: torrent.siteName,
        torrentTitle: torrent.title,
        event: 'MANUAL_DELETE_TASK',
        status: 'FAILED',
        source: 'MANUAL',
        actorId: res.locals.user?.id,
        actorName: res.locals.user?.username,
        message: `批量删除下载器任务「${torrent.title}」失败：下载器已禁用`
      })
      continue
    }
    if (!torrent.torrentHash) {
      failed.push({ id, message: '缺少下载器任务 Hash，无法删除' })
      await recordTorrentLog({
        torrentId: torrent.id,
        siteId: torrent.siteId,
        siteName: torrent.siteName,
        torrentTitle: torrent.title,
        event: 'MANUAL_DELETE_TASK',
        status: 'FAILED',
        source: 'MANUAL',
        actorId: res.locals.user?.id,
        actorName: res.locals.user?.username,
        message: `批量删除下载器任务「${torrent.title}」失败：缺少下载器任务 Hash`
      })
      continue
    }
    try {
      await deleteTorrentFromQb(downloader, torrent.torrentHash, true)
    } catch (error) {
      const msg = error instanceof Error ? error.message : '删除下载器任务失败'
      failed.push({ id, message: msg })
      await recordTorrentLog({
        torrentId: torrent.id,
        siteId: torrent.siteId,
        siteName: torrent.siteName,
        torrentTitle: torrent.title,
        event: 'MANUAL_DELETE_TASK',
        status: 'FAILED',
        source: 'MANUAL',
        actorId: res.locals.user?.id,
        actorName: res.locals.user?.username,
        message: `批量删除下载器任务「${torrent.title}」失败：${msg}`
      })
      continue
    }
    torrent.pushStatus = 'DELETED'
    torrent.currentState = 'DOWNLOADER_DELETED'
    torrent.downloaderState = 'deleted'
    torrent.errorMessage = undefined
    torrent.lowUploadSince = undefined
    updateBuffer.push(torrent)
    successCount += 1
    await recordTorrentLog({
      torrentId: torrent.id,
      siteId: torrent.siteId,
      siteName: torrent.siteName,
      torrentTitle: torrent.title,
      event: 'MANUAL_DELETE_TASK',
      status: 'SUCCESS',
      source: 'MANUAL',
      actorId: res.locals.user?.id,
      actorName: res.locals.user?.username,
      message: `批量删除下载器任务「${torrent.title}」`
    })
  }
  if (updateBuffer.length) await updateTorrents(updateBuffer)
  await recordOperationLog({
    action: '批量删除下载器任务',
    message: `批量删除 ${ids.length} 个下载器任务，成功 ${successCount} 个，失败 ${failed.length} 个`,
    status: failed.length ? 'FAILED' : 'SUCCESS',
    ...operationActor(res, req)
  })
  res.json({ successCount, failedCount: failed.length, failed })
})

torrentsRouter.post('/batch-reset-task', requireAuth, async (req, res) => {
  const ids = requestIds(req.body)
  if (!ids.length) return res.status(400).json({ message: '请选择要重置的种子' })
  const torrents: TorrentRecord[] = []
  for (const id of ids) {
    const t = await getTorrentById(id)
    if (t) torrents.push(t)
  }
  const updateBuffer: TorrentRecord[] = []
  let successCount = 0
  const failed: Array<{ id: string; message: string }> = []
  for (const torrent of torrents) {
    if (torrent.pushStatus !== 'PUSHED') {
      failed.push({ id: torrent.id, message: '仅可重置已推送的种子' })
      await recordTorrentLog({
        torrentId: torrent.id,
        siteId: torrent.siteId,
        siteName: torrent.siteName,
        torrentTitle: torrent.title,
        event: 'MANUAL_RESET_TASK',
        status: 'FAILED',
        source: 'MANUAL',
        actorId: res.locals.user?.id,
        actorName: res.locals.user?.username,
        message: `重置种子「${torrent.title}」失败：仅可重置已推送的种子`
      })
      continue
    }
    torrent.pushStatus = 'DELETED'
    torrent.currentState = 'DOWNLOADER_DELETED'
    torrent.downloaderState = 'deleted'
    torrent.errorMessage = undefined
    torrent.lowUploadSince = undefined
    updateBuffer.push(torrent)
    successCount += 1
    await recordTorrentLog({
      torrentId: torrent.id,
      siteId: torrent.siteId,
      siteName: torrent.siteName,
      torrentTitle: torrent.title,
      event: 'MANUAL_RESET_TASK',
      status: 'SUCCESS',
      source: 'MANUAL',
      actorId: res.locals.user?.id,
      actorName: res.locals.user?.username,
      message: `重置种子「${torrent.title}」本地任务状态（未联系下载器）`
    })
  }
  if (updateBuffer.length) await updateTorrents(updateBuffer)
  await recordOperationLog({
    action: '批量重置任务',
    message: `批量重置 ${ids.length} 个种子任务，成功 ${successCount} 个，失败 ${failed.length} 个`,
    status: failed.length ? 'FAILED' : 'SUCCESS',
    ...operationActor(res, req)
  })
  res.json({ successCount, failedCount: failed.length, failed })
})

torrentsRouter.post('/:id/delete-from-downloader', requireAuth, async (req, res) => {
  const id = String(req.params.id)
  const torrent = await getTorrentById(id)
  if (!torrent) return res.status(404).json({ message: '种子不存在' })
  const downloaders = await listDownloadersFromDb()
  const downloader = downloaders.find((item) => item.id === torrent.downloaderId)
  if (!downloader) return res.status(400).json({ message: '种子绑定下载器不存在' })
  if (!downloader.enabled) return res.status(400).json({ message: '下载器已禁用' })
  if (!torrent.torrentHash) return res.status(400).json({ message: '缺少下载器任务 Hash，无法删除' })
  await syncTorrentDownloadStats(downloader.id).catch(() => undefined)
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
    await recordTorrentLog({
      torrentId: torrent.id,
      siteId: torrent.siteId,
      siteName: torrent.siteName,
      torrentTitle: torrent.title,
      event: 'MANUAL_DELETE_TASK',
      status: 'FAILED',
      source: 'MANUAL',
      actorId: res.locals.user?.id,
      actorName: res.locals.user?.username,
      message: `删除下载器任务「${torrent.title}」失败：${message}`
    })
    return res.status(400).json({ message })
  }
  torrent.pushStatus = 'DELETED'
  torrent.currentState = 'DOWNLOADER_DELETED'
  torrent.downloaderState = 'deleted'
  torrent.errorMessage = undefined
  torrent.lowUploadSince = undefined
  await updateTorrent(torrent)
  await recordOperationLog({
    action: '删除下载器任务',
    message: deleteResult.alreadyMissing ? `下载器任务「${torrent.title}」已不存在，已同步本地状态` : `删除下载器任务「${torrent.title}」`,
    status: 'SUCCESS',
    ...operationActor(res, req)
  })
  await recordTorrentLog({
    torrentId: torrent.id,
    siteId: torrent.siteId,
    siteName: torrent.siteName,
    torrentTitle: torrent.title,
    event: 'MANUAL_DELETE_TASK',
    status: 'SUCCESS',
    source: 'MANUAL',
    actorId: res.locals.user?.id,
    actorName: res.locals.user?.username,
    message: deleteResult.alreadyMissing ? `下载器任务「${torrent.title}」已不存在，已同步本地状态` : `删除下载器任务「${torrent.title}」`
  })
  res.json(safeTorrent(torrent))
})
