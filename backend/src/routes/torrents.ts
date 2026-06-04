import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState, writeState } from '../storage.js'
import { recordOperationLog } from '../utils/logger.js'

export const torrentsRouter = Router()

function operationActor(res: { locals: { user?: { id?: string; username?: string } } }, req: { ip?: string; get(name: string): string | undefined }) {
  return {
    actorId: res.locals.user?.id,
    actorName: res.locals.user?.username,
    ip: req.ip,
    userAgent: req.get('user-agent')
  }
}

function stats(items: Awaited<ReturnType<typeof readState>>['torrents']) {
  const now = Date.now()
  return {
    total: items.length,
    auto: items.filter((item) => item.sourceRunMode === 'AUTO').length,
    manual: items.filter((item) => item.sourceRunMode === 'MANUAL_RUN').length,
    pending: items.filter((item) => item.pushStatus === 'NEW').length,
    failed: items.filter((item) => item.pushStatus === 'PUSH_FAILED').length,
    expiringSoon: items.filter((item) => item.freeEndAt && new Date(item.freeEndAt).getTime() - now <= 2 * 60 * 60_000).length
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
  res.json({ items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize, stats: stats(state.torrents) })
})

torrentsRouter.get('/:id', requireAuth, async (req, res) => {
  const state = await readState()
  const torrent = state.torrents.find((item) => item.id === String(req.params.id))
  if (!torrent) return res.status(404).json({ message: '种子不存在' })
  res.json(torrent)
})

torrentsRouter.post('/:id/push', requireAuth, async (req, res) => {
  const state = await readState()
  const torrent = state.torrents.find((item) => item.id === String(req.params.id))
  if (!torrent) return res.status(404).json({ message: '种子不存在' })
  const downloader = state.downloaders.find((item) => item.id === (String((req.body as { downloaderId?: string }).downloaderId ?? '') || torrent.downloaderId))
  if (!downloader) return res.status(400).json({ message: '请选择下载器' })
  if (!downloader.enabled) return res.status(400).json({ message: '下载器已禁用' })
  if (torrent.linkStatus !== 'SAVED') return res.status(400).json({ message: '种链接缺失，无法推送' })
  const now = new Date().toISOString()
  torrent.downloaderId = downloader.id
  torrent.downloaderName = downloader.name
  torrent.downloaderType = downloader.type
  torrent.downloaderState = 'added'
  torrent.pushStatus = 'PUSHED'
  torrent.currentState = 'PUSHED'
  torrent.pushedAt = now
  torrent.errorMessage = undefined
  torrent.torrentHash = torrent.torrentHash ?? torrent.downloadUrlHash
  await writeState(state)
  await recordOperationLog({
    action: '推送种子',
    message: `推送种子「${torrent.title}」到「${downloader.name}」`,
    status: 'SUCCESS',
    ...operationActor(res, req)
  })
  res.json(torrent)
})

torrentsRouter.post('/batch-push', requireAuth, async (req, res) => {
  const ids = Array.isArray((req.body as { ids?: string[] }).ids) ? (req.body as { ids: string[] }).ids : []
  const state = await readState()
  let successCount = 0
  const failed: Array<{ id: string; message: string }> = []
  ids.forEach((id) => {
    const torrent = state.torrents.find((item) => item.id === id)
    if (!torrent) {
      failed.push({ id, message: '种子不存在' })
      return
    }
    const downloader = state.downloaders.find((item) => item.id === torrent.downloaderId)
    if (!downloader?.enabled || torrent.linkStatus !== 'SAVED') {
      failed.push({ id, message: !downloader?.enabled ? '下载器不可用' : '种链接缺失' })
      return
    }
    torrent.pushStatus = 'PUSHED'
    torrent.currentState = 'PUSHED'
    torrent.downloaderState = 'added'
    torrent.pushedAt = new Date().toISOString()
    successCount += 1
  })
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
  res.json(torrent)
})
