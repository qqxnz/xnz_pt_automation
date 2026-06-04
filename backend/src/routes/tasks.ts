import { createHash, randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState, type SiteRecord, type TaskRecord, type TorrentRecord, writeState } from '../storage.js'
import { recordOperationLog, recordTaskLog } from '../utils/logger.js'
import { browseTorrents, resolveSiteUrl, siteDisplayName, type TorrentListItem } from './sites.js'

export const tasksRouter = Router()

type TaskPayload = {
  name?: string
  siteId?: string
  downloaderId?: string
  autoRunEnabled?: boolean
  intervalMinutes?: number
  freeOnly?: boolean
  autoPush?: boolean
  discountTypes?: Array<'FREE' | 'TWO_X_FREE' | 'HALF_FREE'>
  expiringSoonMinutes?: number
  savePathOverride?: string
  categoryOverride?: string
  tagsOverride?: string[]
}

type CandidateTorrent = {
  torrentId: string
  title: string
  size: number
  discountType: 'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'
  isFreeNow: boolean
  freeEndAt?: string
  seeders: number
  leechers: number
  linkStatus: 'SAVED' | 'MISSING' | 'INVALID'
  detailUrl?: string
  downloadUrl?: string
}

const DEFAULT_INTERVAL_MINUTES = 30
const MIN_INTERVAL_MINUTES = 30

function addMinutes(value: string | Date, minutes: number) {
  return new Date(new Date(value).getTime() + minutes * 60_000).toISOString()
}

function operationActor(res: { locals: { user?: { id?: string; username?: string } } }, req: { ip?: string; get(name: string): string | undefined }) {
  return {
    actorId: res.locals.user?.id,
    actorName: res.locals.user?.username,
    ip: req.ip,
    userAgent: req.get('user-agent')
  }
}

function siteName(site?: { domain: string }) {
  return site ? siteDisplayName(site as SiteRecord) : '未知站点'
}

function validatePayload(payload: TaskPayload, state: Awaited<ReturnType<typeof readState>>, existingId?: string) {
  const name = payload.name?.trim()
  if (!name) return '任务名称不能为空'
  if (name.length > 60) return '任务名称不能超过 60 个字符'
  if (state.tasks.some((task) => task.id !== existingId && task.name.toLowerCase() === name.toLowerCase())) return '任务名称已存在'
  if (!payload.siteId || !state.sites.some((site) => site.id === payload.siteId)) return '请选择站点'
  if (!payload.downloaderId || !state.downloaders.some((downloader) => downloader.id === payload.downloaderId)) return '请选择下载器'
  const interval = payload.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES
  if (!Number.isInteger(interval) || interval < MIN_INTERVAL_MINUTES) return '执行间隔不能小于 30 分钟'
  if (payload.discountTypes?.some((type) => !['FREE', 'TWO_X_FREE', 'HALF_FREE'].includes(type))) return '免费类型范围不合法'
  return undefined
}

function listItem(task: TaskRecord, state: Awaited<ReturnType<typeof readState>>) {
  const site = state.sites.find((item) => item.id === task.siteId)
  const downloader = state.downloaders.find((item) => item.id === task.downloaderId)
  return {
    ...task,
    siteName: siteName(site),
    downloaderName: downloader?.name ?? '未知下载器'
  }
}

function buildTask(payload: TaskPayload, state: Awaited<ReturnType<typeof readState>>, existing?: TaskRecord): TaskRecord {
  const now = new Date().toISOString()
  const intervalMinutes = payload.intervalMinutes ?? existing?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES
  const autoRunEnabled = payload.autoRunEnabled ?? existing?.autoRunEnabled ?? false
  const wasAutoRunEnabled = existing?.autoRunEnabled ?? false
  const autoRunStartedAt = autoRunEnabled ? (wasAutoRunEnabled ? existing?.autoRunStartedAt ?? now : now) : undefined
  return {
    id: existing?.id ?? randomUUID(),
    name: payload.name!.trim(),
    siteId: payload.siteId!,
    downloaderId: payload.downloaderId!,
    autoRunEnabled,
    autoRunStartedAt,
    nextRunAt: autoRunEnabled ? addMinutes(wasAutoRunEnabled ? existing?.autoRunStartedAt ?? now : now, intervalMinutes) : undefined,
    intervalMinutes,
    freeOnly: payload.freeOnly ?? existing?.freeOnly ?? true,
    autoPush: payload.autoPush ?? existing?.autoPush ?? true,
    discountTypes: payload.discountTypes?.length ? payload.discountTypes : existing?.discountTypes ?? ['FREE', 'TWO_X_FREE', 'HALF_FREE'],
    expiringSoonMinutes: payload.expiringSoonMinutes ?? existing?.expiringSoonMinutes ?? 120,
    savePathOverride: payload.savePathOverride?.trim() || undefined,
    categoryOverride: payload.categoryOverride?.trim() || undefined,
    tagsOverride: payload.tagsOverride?.map((tag) => tag.trim()).filter(Boolean) ?? existing?.tagsOverride,
    running: false,
    lastRunMode: existing?.lastRunMode,
    lastStartedAt: existing?.lastStartedAt,
    lastFinishedAt: existing?.lastFinishedAt,
    lastStatus: existing?.lastStatus,
    lastSummary: existing?.lastSummary,
    lastError: existing?.lastError,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
}

function discountTypeFromBrowseItem(item: TorrentListItem): CandidateTorrent['discountType'] {
  const marker = `${item.tags.join(' ')} ${item.subtitle ?? ''}`.toLowerCase()
  if (/(2x|2 x|two.?x|双倍|雙倍)/i.test(marker)) return 'TWO_X_FREE'
  if (/(half|50%|50％|半价|半價)/i.test(marker)) return 'HALF_FREE'
  if (/(free|免费|免費)/i.test(marker)) return 'FREE'
  return 'NORMAL'
}

function downloadUrlFromBrowseItem(site: SiteRecord, item: TorrentListItem) {
  if (!item.id || /m-team\.cc$/i.test(site.domain)) return undefined
  return resolveSiteUrl(site, `/download.php?id=${encodeURIComponent(item.id)}`)
}

async function candidatesForTask(site: Parameters<typeof resolveSiteUrl>[0]): Promise<CandidateTorrent[]> {
  const result = await browseTorrents(site, '', 1, 50)
  return result.items.map((item) => {
    const discountType = discountTypeFromBrowseItem(item)
    const downloadUrl = downloadUrlFromBrowseItem(site, item)
    return {
      torrentId: item.id,
      title: item.title,
      size: item.size ?? 0,
      discountType,
      isFreeNow: discountType !== 'NORMAL',
      seeders: item.seeders ?? 0,
      leechers: item.leechers ?? 0,
      linkStatus: downloadUrl ? 'SAVED' : 'MISSING',
      detailUrl: resolveSiteUrl(site, `/details.php?id=${encodeURIComponent(item.id)}`),
      downloadUrl
    }
  })
}

function matchedCandidates(task: TaskRecord, items: CandidateTorrent[]) {
  return items.filter((item) => {
    if (task.freeOnly && !item.isFreeNow) return false
    if (item.discountType !== 'NORMAL' && !task.discountTypes.includes(item.discountType)) return false
    return true
  })
}

function torrentHash(task: TaskRecord, item: CandidateTorrent) {
  return createHash('sha1').update(`${task.id}:${item.torrentId}`).digest('hex')
}

async function logOperation(req: Parameters<typeof operationActor>[1], res: Parameters<typeof operationActor>[0], action: string, message: string, status: 'SUCCESS' | 'FAILED' = 'SUCCESS') {
  await recordOperationLog({
    action,
    message,
    status,
    ...operationActor(res, req)
  })
}

tasksRouter.get('/', requireAuth, async (req, res) => {
  const state = await readState()
  const keyword = String(req.query.keyword ?? '').trim().toLowerCase()
  const autoRun = String(req.query.autoRun ?? 'ALL')
  const filtered = state.tasks.filter((task) => {
    const item = listItem(task, state)
    if (keyword && !`${item.name} ${item.siteName} ${item.downloaderName}`.toLowerCase().includes(keyword)) return false
    if (autoRun === 'ON' && !task.autoRunEnabled) return false
    if (autoRun === 'OFF' && task.autoRunEnabled) return false
    return true
  })
  res.json({
    items: filtered.map((task) => listItem(task, state)),
    total: filtered.length,
    stats: {
      total: state.tasks.length,
      autoRunEnabled: state.tasks.filter((task) => task.autoRunEnabled).length,
      running: state.tasks.filter((task) => task.running).length,
      failed: state.tasks.filter((task) => task.lastStatus === 'FAILED').length
    }
  })
})

tasksRouter.post('/', requireAuth, async (req, res) => {
  const state = await readState()
  const payload = req.body as TaskPayload
  const validation = validatePayload(payload, state)
  if (validation) return res.status(400).json({ message: validation })
  const task = buildTask(payload, state)
  state.tasks.unshift(task)
  await writeState(state)
  await logOperation(req, res, '新建任务', `新建任务「${task.name}」`)
  res.status(201).json(listItem(task, state))
})

tasksRouter.get('/:id', requireAuth, async (req, res) => {
  const state = await readState()
  const task = state.tasks.find((item) => item.id === String(req.params.id))
  if (!task) return res.status(404).json({ message: '任务不存在' })
  res.json(listItem(task, state))
})

tasksRouter.put('/:id', requireAuth, async (req, res) => {
  const state = await readState()
  const index = state.tasks.findIndex((item) => item.id === String(req.params.id))
  if (index < 0) return res.status(404).json({ message: '任务不存在' })
  const payload = req.body as TaskPayload
  const validation = validatePayload(payload, state, String(req.params.id))
  if (validation) return res.status(400).json({ message: validation })
  const task = buildTask(payload, state, state.tasks[index])
  state.tasks[index] = task
  await writeState(state)
  await logOperation(req, res, '编辑任务', `编辑任务「${task.name}」`)
  res.json(listItem(task, state))
})

tasksRouter.delete('/:id', requireAuth, async (req, res) => {
  const state = await readState()
  const task = state.tasks.find((item) => item.id === String(req.params.id))
  if (!task) return res.status(404).json({ message: '任务不存在' })
  state.tasks = state.tasks.filter((item) => item.id !== task.id)
  await writeState(state)
  await logOperation(req, res, '删除任务', `删除任务「${task.name}」`)
  res.status(204).send()
})

tasksRouter.post('/:id/auto-run', requireAuth, async (req, res) => {
  const state = await readState()
  const task = state.tasks.find((item) => item.id === String(req.params.id))
  if (!task) return res.status(404).json({ message: '任务不存在' })
  const autoRunEnabled = Boolean((req.body as { autoRunEnabled?: boolean }).autoRunEnabled)
  const now = new Date().toISOString()
  task.autoRunEnabled = autoRunEnabled
  task.autoRunStartedAt = autoRunEnabled ? now : undefined
  task.nextRunAt = autoRunEnabled ? addMinutes(now, task.intervalMinutes) : undefined
  task.updatedAt = now
  await writeState(state)
  await logOperation(req, res, autoRunEnabled ? '开启任务自动执行' : '关闭任务自动执行', `${autoRunEnabled ? '开启' : '关闭'}任务「${task.name}」自动执行`)
  res.json(listItem(task, state))
})

tasksRouter.post('/:id/test', requireAuth, async (req, res) => {
  const state = await readState()
  const task = state.tasks.find((item) => item.id === String(req.params.id))
  if (!task) return res.status(404).json({ message: '任务不存在' })
  const site = state.sites.find((item) => item.id === task.siteId)
  if (!site) return res.status(400).json({ message: '任务绑定站点不存在' })
  const fetched = await candidatesForTask(site)
  const matched = matchedCandidates(task, fetched)
  await logOperation(req, res, '测试任务', `测试任务「${task.name}」：抓取 ${fetched.length} 个，命中 ${matched.length} 个`)
  res.json({
    taskId: task.id,
    taskName: task.name,
    siteId: site.id,
    siteName: siteName(site),
    fetchedCount: fetched.length,
    matchedCount: matched.length,
    items: matched,
    total: matched.length
  })
})

tasksRouter.post('/:id/run', requireAuth, async (req, res) => {
  const state = await readState()
  const task = state.tasks.find((item) => item.id === String(req.params.id))
  if (!task) return res.status(404).json({ message: '任务不存在' })
  if (task.running) return res.status(409).json({ message: '任务正在运行' })
  const site = state.sites.find((item) => item.id === task.siteId)
  const downloader = state.downloaders.find((item) => item.id === task.downloaderId)
  const startedAt = new Date().toISOString()
  task.running = true
  task.lastStartedAt = startedAt
  task.lastRunMode = 'MANUAL_RUN'
  task.updatedAt = startedAt
  await writeState(state)

  try {
    if (!site || !site.enabled) throw new Error(!site ? '任务绑定站点不存在' : '站点已禁用')
    if (!downloader) throw new Error('任务绑定下载器不存在')
    if (task.autoPush && !downloader.enabled) throw new Error('下载器已禁用')
    const fetched = await candidatesForTask(site)
    const matched = matchedCandidates(task, fetched)
    const now = new Date().toISOString()
    let pushedCount = 0
    let pushFailedCount = 0
    matched.forEach((item) => {
      const existing = state.torrents.find((torrent) => torrent.siteId === site.id && torrent.torrentId === item.torrentId)
      const failedPush = task.autoPush
      if (failedPush) pushFailedCount += 1
      const record: TorrentRecord = {
        id: existing?.id ?? randomUUID(),
        siteId: site.id,
        siteName: siteName(site),
        torrentId: item.torrentId,
        title: item.title,
        size: item.size,
        discountType: item.discountType,
        isFreeNow: item.isFreeNow,
        currentState: failedPush ? 'PUSH_FAILED' : item.isFreeNow ? 'FREE_NOW' : 'NEW',
        freeEndAt: item.freeEndAt,
        seeders: item.seeders,
        leechers: item.leechers,
        pushStatus: failedPush ? 'PUSH_FAILED' : 'NEW',
        linkStatus: item.linkStatus,
        detailUrl: item.detailUrl,
        downloaderId: downloader.id,
        downloaderName: downloader.name,
        downloaderType: downloader.type,
        downloaderState: undefined,
        torrentHash: undefined,
        sourceTaskId: task.id,
        sourceTaskName: task.name,
        sourceRunMode: 'MANUAL_RUN',
        errorMessage: failedPush ? '没有真实种子下载链接，未推送到下载器' : undefined,
        firstSeenAt: existing?.firstSeenAt ?? now,
        lastSeenAt: now,
        pushedAt: existing?.pushedAt,
        downloadUrlHash: torrentHash(task, item),
        downloadUrl: item.downloadUrl
      }
      if (existing) Object.assign(existing, record)
      else state.torrents.unshift(record)
    })
    const finishedAt = new Date().toISOString()
    const summary = `抓取 ${fetched.length} 个，命中 ${matched.length} 个，推送 ${pushedCount} 个，失败 ${pushFailedCount} 个`
    task.running = false
    task.lastFinishedAt = finishedAt
    task.lastStatus = pushFailedCount > 0 ? 'FAILED' : 'SUCCESS'
    task.lastSummary = summary
    task.lastError = pushFailedCount > 0 ? `${pushFailedCount} 个种子推送失败` : undefined
    task.nextRunAt = task.autoRunEnabled ? addMinutes(finishedAt, task.intervalMinutes) : undefined
    task.updatedAt = finishedAt
    await writeState(state)
    await recordTaskLog({
      taskId: task.id,
      taskName: task.name,
      runMode: 'MANUAL_RUN',
      message: summary,
      status: task.lastStatus,
      startedAt,
      finishedAt,
      fetchedCount: fetched.length,
      matchedCount: matched.length,
      pushedCount,
      pushFailedCount,
      summary,
      errorMessage: task.lastError
    })
    await logOperation(req, res, '运行任务', `手动运行任务「${task.name}」：${summary}`, task.lastStatus)
    res.json({ task: listItem(task, state), fetchedCount: fetched.length, matchedCount: matched.length, pushedCount, pushFailedCount, summary })
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const message = error instanceof Error ? error.message : '任务执行失败'
    task.running = false
    task.lastFinishedAt = finishedAt
    task.lastStatus = 'FAILED'
    task.lastError = message
    task.lastSummary = message
    task.nextRunAt = task.autoRunEnabled ? addMinutes(finishedAt, task.intervalMinutes) : undefined
    task.updatedAt = finishedAt
    await writeState(state)
    await recordTaskLog({
      taskId: task.id,
      taskName: task.name,
      runMode: 'MANUAL_RUN',
      message,
      status: 'FAILED',
      startedAt,
      finishedAt,
      fetchedCount: 0,
      matchedCount: 0,
      pushedCount: 0,
      pushFailedCount: 0,
      summary: message,
      errorMessage: message
    })
    await logOperation(req, res, '运行任务', `手动运行任务「${task.name}」失败：${message}`, 'FAILED')
    res.status(400).json({ message, task: listItem(task, state) })
  }
})

tasksRouter.get('/:id/logs', requireAuth, async (req, res) => {
  const state = await readState()
  const taskId = String(req.params.id)
  const page = Math.max(Number(req.query.page ?? 1), 1)
  const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20), 1), 100)
  const items = state.taskLogs.filter((log) => log.taskId === taskId)
  const start = (page - 1) * pageSize
  res.json({ items: items.slice(start, start + pageSize), total: items.length, page, pageSize })
})
