import { createHash, randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState, type SiteRecord, type TaskRecord, type TorrentRecord, writeState } from '../storage.js'
import { recordOperationLog, recordTaskLog } from '../utils/logger.js'
import { addTorrentUrlToQb } from '../utils/qbittorrent.js'
import { browseTorrents, resolveSiteUrl, siteDisplayName, type TorrentListItem } from './sites.js'

export const tasksRouter = Router()

const runningTaskIds = new Set<string>()
let schedulerTimer: NodeJS.Timeout | undefined

type TaskPayload = {
  name?: string
  siteId?: string
  downloaderId?: string
  autoRunEnabled?: boolean
  intervalMinutes?: number
  freeOnly?: boolean
  autoPush?: boolean
  discountTypes?: Array<'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'>
  seederCondition?: 'GT' | 'EQ' | 'LT' | ''
  seederCount?: number
  sizeCondition?: 'GT' | 'EQ' | 'LT' | ''
  sizeMb?: number
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
const MIN_INTERVAL_MINUTES = 10
const TASK_SCHEDULER_INTERVAL_MS = 60_000
const MB_BYTES = 1024 * 1024

type TaskRunMode = 'AUTO' | 'MANUAL_RUN'

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
  if (!Number.isInteger(interval) || interval < MIN_INTERVAL_MINUTES) return '执行间隔不能小于 10 分钟'
  if (payload.discountTypes?.some((type) => !['FREE', 'TWO_X_FREE', 'HALF_FREE', 'NORMAL'].includes(type))) return '优惠类型范围不合法'
  if (payload.seederCondition && !['GT', 'EQ', 'LT'].includes(payload.seederCondition)) return '做种人数条件不合法'
  const seederCount = payload.seederCount
  if (payload.seederCondition && (!Number.isInteger(seederCount) || Number(seederCount) < 0)) return '做种人数必须是大于等于 0 的整数'
  if (payload.sizeCondition && !['GT', 'EQ', 'LT'].includes(payload.sizeCondition)) return '种子大小条件不合法'
  const sizeMb = Number(payload.sizeMb)
  if (payload.sizeCondition && (!Number.isFinite(sizeMb) || sizeMb < 0)) return '种子大小必须是大于等于 0 的数字'
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
  const autoRunStartedAt = autoRunEnabled ? now : undefined
  const hasSeederCondition = Object.hasOwn(payload, 'seederCondition')
  const seederCondition = hasSeederCondition ? payload.seederCondition || undefined : existing?.seederCondition
  const hasSizeCondition = Object.hasOwn(payload, 'sizeCondition')
  const sizeCondition = hasSizeCondition ? payload.sizeCondition || undefined : existing?.sizeCondition
  return {
    id: existing?.id ?? randomUUID(),
    name: payload.name!.trim(),
    siteId: payload.siteId!,
    downloaderId: payload.downloaderId!,
    autoRunEnabled,
    autoRunStartedAt,
    nextRunAt: autoRunEnabled ? addMinutes(now, intervalMinutes) : undefined,
    intervalMinutes,
    freeOnly: payload.freeOnly ?? existing?.freeOnly ?? true,
    autoPush: payload.autoPush ?? existing?.autoPush ?? true,
    discountTypes: payload.discountTypes?.length ? payload.discountTypes : existing?.discountTypes ?? ['FREE', 'TWO_X_FREE'],
    seederCondition,
    seederCount: seederCondition ? payload.seederCount ?? existing?.seederCount ?? 0 : undefined,
    sizeCondition,
    sizeMb: sizeCondition ? Number(payload.sizeMb ?? existing?.sizeMb ?? 0) : undefined,
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
  if (/(50\s*%|half.?free|half.?off|半价|半價)/i.test(marker)) return 'HALF_FREE'
  if (/(free|免费|免費)/i.test(marker)) return 'FREE'
  return 'NORMAL'
}

function downloadUrlFromBrowseItem(site: SiteRecord, item: TorrentListItem) {
  if (!item.id) return undefined
  if (/m-team\.cc$/i.test(site.domain) && site.apiKey?.trim()) {
    const url = new URL('https://api.m-team.cc/api/torrent/genDlToken')
    url.searchParams.set('id', item.id)
    return url.toString()
  }
  return resolveSiteUrl(site, `/download.php?id=${encodeURIComponent(item.id)}`)
}

async function candidatesForTask(site: Parameters<typeof resolveSiteUrl>[0], options: { includeDownloadUrl: boolean }): Promise<CandidateTorrent[]> {
  const result = await browseTorrents(site, '', 1, 50)
  return result.items.map((item) => {
    const discountType = discountTypeFromBrowseItem(item)
    const downloadUrl = options.includeDownloadUrl ? downloadUrlFromBrowseItem(site, item) : undefined
    return {
      torrentId: item.id,
      title: item.title,
      size: item.size ?? 0,
      discountType,
      isFreeNow: discountType !== 'NORMAL',
      freeEndAt: item.freeEndAt,
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
    if (!task.discountTypes.includes(item.discountType)) return false
    if (task.seederCondition) {
      const target = task.seederCount ?? 0
      if (task.seederCondition === 'GT' && item.seeders <= target) return false
      if (task.seederCondition === 'EQ' && item.seeders !== target) return false
      if (task.seederCondition === 'LT' && item.seeders >= target) return false
    }
    if (task.sizeCondition) {
      const target = (task.sizeMb ?? 0) * MB_BYTES
      if (task.sizeCondition === 'GT' && item.size <= target) return false
      if (task.sizeCondition === 'EQ' && item.size !== target) return false
      if (task.sizeCondition === 'LT' && item.size >= target) return false
    }
    return true
  })
}

function torrentHash(site: SiteRecord, item: CandidateTorrent) {
  return createHash('sha1').update(`${site.id}:${item.torrentId}`).digest('hex')
}

function knownTorrentKeys(torrents: TorrentRecord[]) {
  return new Set(torrents.map((torrent) => `${torrent.siteId}:${torrent.torrentId ?? ''}`).filter((key) => !key.endsWith(':')))
}

function newCandidatesForSite(site: SiteRecord, items: CandidateTorrent[], torrents: TorrentRecord[]) {
  const existingKeys = knownTorrentKeys(torrents)
  return items.filter((item) => !existingKeys.has(`${site.id}:${item.torrentId}`))
}

function torrentFilename(title: string, fallback: string) {
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180).trim()
  return `${safeTitle || fallback}.torrent`
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function readableTorrentTitle(title: string) {
  const normalized = title.replace(/\s+/g, ' ').trim()
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized || '未知种子'
}

type TaskRunResult = {
  task: TaskRecord
  fetchedCount: number
  matchedCount: number
  skippedExistingCount: number
  pushedCount: number
  pushFailedCount: number
  summary: string
}

async function logOperation(req: Parameters<typeof operationActor>[1], res: Parameters<typeof operationActor>[0], action: string, message: string, status: 'SUCCESS' | 'FAILED' = 'SUCCESS') {
  await recordOperationLog({
    action,
    message,
    status,
    ...operationActor(res, req)
  })
}

async function runTaskById(taskId: string, runMode: TaskRunMode): Promise<TaskRunResult> {
  if (runningTaskIds.has(taskId)) throw new Error('任务正在运行')
  runningTaskIds.add(taskId)

  const state = await readState()
  const task = state.tasks.find((item) => item.id === taskId)
  if (!task) {
    runningTaskIds.delete(taskId)
    throw new Error('任务不存在')
  }
  if (task.running) {
    runningTaskIds.delete(taskId)
    throw new Error('任务正在运行')
  }

  const site = state.sites.find((item) => item.id === task.siteId)
  const downloader = state.downloaders.find((item) => item.id === task.downloaderId)
  const startedAt = new Date().toISOString()
  task.running = true
  task.lastStartedAt = startedAt
  task.lastRunMode = runMode
  task.lastStatus = undefined
  task.lastError = undefined
  task.lastSummary = '运行中'
  task.updatedAt = startedAt
  await writeState(state)

  try {
    if (!site || !site.enabled) throw new Error(!site ? '任务绑定站点不存在' : '站点已禁用')
    let fetched: CandidateTorrent[]
    try {
      fetched = await candidatesForTask(site, { includeDownloadUrl: true })
    } catch (error) {
      throw new Error(`抓取失败：${errorMessage(error, '种子列表获取失败')}`)
    }
    const ruleMatched = matchedCandidates(task, fetched)
    const matched = newCandidatesForSite(site, ruleMatched, state.torrents)
    const skippedExistingCount = ruleMatched.length - matched.length
    const now = new Date().toISOString()
    let pushedCount = 0
    let pushFailedCount = 0
    const pushErrorMessages: string[] = []
    for (const item of matched) {
      let pushed: Awaited<ReturnType<typeof addTorrentUrlToQb>> | undefined
      let pushError: string | undefined
      if (task.autoPush) {
        if (!downloader) {
          pushError = '任务绑定下载器不存在'
        } else if (!downloader.enabled) {
          pushError = '下载器已禁用'
        } else {
          try {
            pushed = await addTorrentUrlToQb(downloader, site, item.downloadUrl, torrentFilename(item.title, item.torrentId), {
              savePath: task.savePathOverride || downloader.savePath,
              category: task.name,
              tags: task.tagsOverride
            })
            pushedCount += 1
          } catch (error) {
            pushError = errorMessage(error, '推送到下载器失败')
          }
        }
        if (pushError) {
          pushErrorMessages.push(`《${readableTorrentTitle(item.title)}》：${pushError}`)
          pushFailedCount += 1
        }
      }
      const failedPush = Boolean(pushError)
      const record: TorrentRecord = {
        id: randomUUID(),
        siteId: site.id,
        siteName: siteName(site),
        torrentId: item.torrentId,
        title: item.title,
        size: item.size,
        discountType: item.discountType,
        isFreeNow: item.isFreeNow,
        currentState: pushed ? 'PUSHED' : failedPush ? 'PUSH_FAILED' : item.isFreeNow ? 'FREE_NOW' : 'NEW',
        freeEndAt: item.freeEndAt,
        seeders: item.seeders,
        leechers: item.leechers,
        pushStatus: pushed ? 'PUSHED' : failedPush ? 'PUSH_FAILED' : 'NEW',
        linkStatus: item.linkStatus,
        detailUrl: item.detailUrl,
        downloaderId: downloader?.id,
        downloaderName: downloader?.name,
        downloaderType: downloader?.type,
        downloaderState: pushed?.state ?? undefined,
        torrentHash: pushed?.hash,
        sourceTaskId: task.id,
        sourceTaskName: task.name,
        sourceRunMode: runMode,
        errorMessage: pushError,
        firstSeenAt: now,
        lastSeenAt: now,
        pushedAt: pushed ? now : undefined,
        downloadUrlHash: torrentHash(site, item),
        downloadUrl: item.downloadUrl
      }
      state.torrents.unshift(record)
    }
    const finishedAt = new Date().toISOString()
    const baseSummary = `抓取 ${fetched.length} 个，命中 ${matched.length} 个，跳过已存在 ${skippedExistingCount} 个，推送 ${pushedCount} 个，失败 ${pushFailedCount} 个`
    const failureSummary = pushErrorMessages.length ? `；失败原因：${pushErrorMessages.slice(0, 3).join('；')}${pushErrorMessages.length > 3 ? `；另有 ${pushErrorMessages.length - 3} 条失败` : ''}` : ''
    const summary = `${baseSummary}${failureSummary}`
    task.running = false
    task.lastFinishedAt = finishedAt
    task.lastStatus = 'SUCCESS'
    task.lastSummary = summary
    task.lastError = undefined
    task.nextRunAt = task.autoRunEnabled ? addMinutes(finishedAt, task.intervalMinutes) : undefined
    task.updatedAt = finishedAt
    await writeState(state)
    await recordTaskLog({
      taskId: task.id,
      taskName: task.name,
      runMode,
      message: summary,
      status: task.lastStatus,
      startedAt,
      finishedAt,
      fetchedCount: fetched.length,
      matchedCount: matched.length,
      skippedExistingCount,
      pushedCount,
      pushFailedCount,
      summary,
      errorMessage: task.lastError,
      pushErrorMessages,
      failureDetails: pushErrorMessages
    })
    return { task, fetchedCount: fetched.length, matchedCount: matched.length, skippedExistingCount, pushedCount, pushFailedCount, summary }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const message = errorMessage(error, '任务执行失败')
    const fetchErrorMessage = message.startsWith('抓取失败：') ? message.replace(/^抓取失败：/, '') : undefined
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
      runMode,
      message,
      status: 'FAILED',
      startedAt,
      finishedAt,
      fetchedCount: 0,
      matchedCount: 0,
      skippedExistingCount: 0,
      pushedCount: 0,
      pushFailedCount: 0,
      summary: message,
      errorMessage: message,
      fetchErrorMessage,
      failureDetails: [message]
    })
    throw error
  } finally {
    runningTaskIds.delete(taskId)
  }
}

export async function runDueTasks() {
  const state = await readState()
  const now = Date.now()
  const dueTasks = state.tasks.filter((task) => task.autoRunEnabled && !task.running && task.nextRunAt && new Date(task.nextRunAt).getTime() <= now)
  for (const task of dueTasks) {
    runTaskById(task.id, 'AUTO').catch((error) => {
      console.error(`[task-scheduler] ${task.name}:`, error instanceof Error ? error.message : error)
    })
  }
}

export function startTaskScheduler() {
  if (schedulerTimer) return
  schedulerTimer = setInterval(() => {
    runDueTasks().catch((error) => {
      console.error('[task-scheduler]', error instanceof Error ? error.message : error)
    })
  }, TASK_SCHEDULER_INTERVAL_MS)
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
  const fetched = await candidatesForTask(site, { includeDownloadUrl: false })
  const ruleMatched = matchedCandidates(task, fetched)
  const matched = newCandidatesForSite(site, ruleMatched, state.torrents)
  const skippedExistingCount = ruleMatched.length - matched.length
  await logOperation(req, res, '测试任务', `测试任务「${task.name}」：抓取 ${fetched.length} 个，命中 ${matched.length} 个，跳过已存在 ${skippedExistingCount} 个`)
  res.json({
    taskId: task.id,
    taskName: task.name,
    siteId: site.id,
    siteName: siteName(site),
    fetchedCount: fetched.length,
    matchedCount: matched.length,
    skippedExistingCount,
    items: matched,
    total: matched.length
  })
})

tasksRouter.post('/:id/run', requireAuth, async (req, res) => {
  try {
    const result = await runTaskById(String(req.params.id), 'MANUAL_RUN')
    const state = await readState()
    await logOperation(req, res, '运行任务', `手动运行任务「${result.task.name}」：${result.summary}`, result.task.lastStatus)
    res.json({ task: listItem(result.task, state), fetchedCount: result.fetchedCount, matchedCount: result.matchedCount, skippedExistingCount: result.skippedExistingCount, pushedCount: result.pushedCount, pushFailedCount: result.pushFailedCount, summary: result.summary })
  } catch (error) {
    const message = error instanceof Error ? error.message : '任务执行失败'
    const state = await readState()
    const task = state.tasks.find((item) => item.id === String(req.params.id))
    await logOperation(req, res, '运行任务', `手动运行任务「${task?.name ?? '未知任务'}」失败：${message}`, 'FAILED')
    res.status(message === '任务正在运行' ? 409 : task ? 400 : 404).json({ message, task: task ? listItem(task, state) : undefined })
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
