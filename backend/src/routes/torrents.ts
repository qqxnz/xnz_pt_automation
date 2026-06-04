import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState, writeState } from '../storage.js'
import type { TorrentRecord } from '../storage.js'
import { recordOperationLog } from '../utils/logger.js'
import { addTorrentUrlToQb } from '../utils/qbittorrent.js'

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

function stats(items: Awaited<ReturnType<typeof readState>>['torrents']) {
  const now = Date.now()
  const safeItems = items.map(safeTorrent)
  return {
    total: safeItems.length,
    auto: safeItems.filter((item) => item.sourceRunMode === 'AUTO').length,
    manual: safeItems.filter((item) => item.sourceRunMode === 'MANUAL_RUN').length,
    pending: safeItems.filter((item) => item.pushStatus === 'NEW').length,
    failed: safeItems.filter((item) => item.pushStatus === 'PUSH_FAILED').length,
    expiringSoon: safeItems.filter((item) => item.freeEndAt && new Date(item.freeEndAt).getTime() - now <= 2 * 60 * 60_000).length
  }
}

torrentsRouter.get('/', requireAuth, async (req, res) => {
  const state = await readState()
  const keyword = String(req.query.keyword ?? '').trim().toLowerCase()
  const siteId = String(req.query.siteId ?? '')
  const downloaderId = String(req.query.downloaderId ?? '')
  const taskId = String(req.query.taskId ?? '')
  const pushStatus = String(req.query.pushStatus ?? 'ALL')
  const sourceRunMode = String(req.query.sourceRunMode ?? 'ALL')
  const page = Math.max(Number(req.query.page ?? 1), 1)
  const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20), 1), 100)
  const filtered = state.torrents.filter((item) => {
    if (keyword && !`${item.title} ${item.siteName} ${item.sourceTaskName ?? ''}`.toLowerCase().includes(keyword)) return false
    if (siteId && item.siteId !== siteId) return false
    if (downloaderId && item.downloaderId !== downloaderId) return false
    if (taskId && item.sourceTaskId !== taskId) return false
    if (pushStatus !== 'ALL' && item.pushStatus !== pushStatus) return false
    if (sourceRunMode !== 'ALL' && item.sourceRunMode !== sourceRunMode) return false
    return true
  })
  const start = (page - 1) * pageSize
  res.json({ items: filtered.slice(start, start + pageSize).map(safeTorrent), total: filtered.length, page, pageSize, stats: stats(state.torrents) })
})

torrentsRouter.get('/:id', requireAuth, async (req, res) => {
  const state = await readState()
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
    const pushed = await addTorrentUrlToQb(downloader, site, torrent.downloadUrl, torrentFilename(torrent.title, torrent.torrentId ?? torrent.id))
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
  await recordOperationLog({
    action: '推送种子',
    message: `推送种子「${torrent.title}」到「${downloader.name}」`,
    status: 'SUCCESS',
    ...operationActor(res, req)
  })
  res.json(safeTorrent(torrent))
})

torrentsRouter.post('/batch-push', requireAuth, async (req, res) => {
  const ids = Array.isArray((req.body as { ids?: string[] }).ids) ? (req.body as { ids: string[] }).ids : []
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
      const pushed = await addTorrentUrlToQb(downloader, site, torrent.downloadUrl, torrentFilename(torrent.title, torrent.torrentId ?? torrent.id))
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
    torrent.downloaderState = torrent.downloaderState ?? 'added'
    torrent.pushedAt = new Date().toISOString()
    torrent.errorMessage = undefined
    successCount += 1
  }
  await writeState(state)
  await recordOperationLog({
    action: '批量推送种子',
    message: `批量推送 ${ids.length} 个种子，成功 ${successCount} 个，失败 ${failed.length} 个`,
    status: failed.length ? 'FAILED' : 'SUCCESS',
    ...operationActor(res, req)
  })
  res.json({ successCount, failedCount: failed.length, failed })
})

torrentsRouter.post('/:id/delete-from-downloader', requireAuth, async (req, res) => {
  const state = await readState()
  const torrent = state.torrents.find((item) => item.id === String(req.params.id))
  if (!torrent) return res.status(404).json({ message: '种子不存在' })
  torrent.pushStatus = 'DELETED'
  torrent.currentState = 'DOWNLOADER_DELETED'
  torrent.downloaderState = 'deleted'
  await writeState(state)
  await recordOperationLog({
    action: '删除下载器任务',
    message: `删除下载器任务「${torrent.title}」`,
    status: 'SUCCESS',
    ...operationActor(res, req)
  })
  res.json(safeTorrent(torrent))
})
