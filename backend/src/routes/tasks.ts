import { createHash, randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  deleteTaskFromDb,
  getTaskFromDb,
  insertTaskToDb,
  insertTorrents,
  listAllTorrents,
  listDownloadersFromDb,
  listSitesFromDb,
  listTasksFromDb,
  queryLogs,
  type SiteRecord,
  type TaskRecord,
  type TaskSortRule,
  type TorrentRecord,
  updateTaskFieldsInDb
} from '../storage.js'
import { logger, recordOperationLog, recordScheduleLog, recordTaskLog, recordTorrentLog } from '../utils/logger.js'
import { addTorrentUrlToQb } from '../utils/qbittorrent.js'
import { browseTorrents, normalizeSiteDomain, resolveSiteUrl, siteDisplayName, type TorrentListItem } from './sites/index.js'

export const tasksRouter = Router()

const runningTaskIds = new Set<string>()

type TaskPayload = {
  name?: string
  siteId?: string
  downloaderId?: string
  autoRunEnabled?: boolean
  intervalMinutes?: number
  onlyFreeDownload?: boolean
  deleteOnFreeExpire?: boolean
  lowUploadKbps?: number | null
  sortRule?: TaskSortRule | ''
  lowUploadMinutes?: number | null
  autoPush?: boolean
  discountTypes?: Array<'FREE' | 'TWO_X_FREE' | 'HALF_FREE' | 'NORMAL'>
  seederMin?: number
  seederMax?: number
  sizeMinGb?: number
  sizeMaxGb?: number
  torrentCountCondition?: 'GT' | 'EQ' | 'LT' | ''
  torrentCount?: number
  fetchLimit?: number
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
  createdAt?: string
}

const DEFAULT_INTERVAL_MINUTES = 30
const MIN_INTERVAL_MINUTES = 10
const GB_BYTES = 1024 * 1024 * 1024
const STUCK_TASK_THRESHOLD_MS = 10 * 60 * 1000
const DEFAULT_FETCH_LIMIT = 100
const MIN_FETCH_LIMIT = 1
const MAX_FETCH_LIMIT = 1000

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

function validatePayload(
  payload: TaskPayload,
  context: { existingTasks: TaskRecord[]; sites: SiteRecord[]; downloaders: { id: string }[] },
  existingId?: string
) {
  const name = payload.name?.trim()
  if (!name) return '任务名称不能为空'
  if (name.length > 60) return '任务名称不能超过 60 个字符'
  if (context.existingTasks.some((task) => task.id !== existingId && task.name.toLowerCase() === name.toLowerCase())) return '任务名称已存在'
  if (!payload.siteId || !context.sites.some((site) => site.id === payload.siteId)) return '请选择站点'
  if (!payload.downloaderId || !context.downloaders.some((downloader) => downloader.id === payload.downloaderId)) return '请选择下载器'
  const interval = payload.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES
  if (!Number.isInteger(interval) || interval < MIN_INTERVAL_MINUTES) return '执行间隔不能小于 10 分钟'
  if (payload.discountTypes?.some((type) => !['FREE', 'TWO_X_FREE', 'HALF_FREE', 'NORMAL'].includes(type))) return '优惠类型范围不合法'
  if (payload.seederMin !== undefined && (!Number.isInteger(Number(payload.seederMin)) || Number(payload.seederMin) < 0)) return '最小做种人数必须是大于等于 0 的整数'
  if (payload.seederMax !== undefined && (!Number.isInteger(Number(payload.seederMax)) || Number(payload.seederMax) < 0)) return '最大做种人数必须是大于等于 0 的整数'
  const seederMin = Number(payload.seederMin ?? 0)
  const seederMax = Number(payload.seederMax ?? 0)
  if (seederMin > 0 && seederMax > 0 && seederMin > seederMax) return '最小做种人数不能大于最大做种人数'
  const sizeMinGb = Number(payload.sizeMinGb)
  const sizeMaxGb = Number(payload.sizeMaxGb)
  if (!Number.isFinite(sizeMinGb) || !Number.isInteger(sizeMinGb) || sizeMinGb < 0) return '种子最小体积必须是大于等于 0 的整数'
  if (!Number.isFinite(sizeMaxGb) || !Number.isInteger(sizeMaxGb) || sizeMaxGb < 0) return '种子最大体积必须是大于等于 0 的整数'
  if (sizeMinGb > 0 && sizeMaxGb > 0 && sizeMinGb > sizeMaxGb) return '种子最小体积不能大于种子最大体积'
  if (payload.torrentCountCondition && !['GT', 'EQ', 'LT'].includes(payload.torrentCountCondition)) return '种子个数条件不合法'
  const torrentCount = Number(payload.torrentCount)
  if (payload.torrentCountCondition && (!Number.isInteger(torrentCount) || torrentCount < 1)) return '种子个数必须是大于等于 1 的整数'
  if (payload.fetchLimit !== undefined) {
    const fetchLimit = Number(payload.fetchLimit)
    if (!Number.isInteger(fetchLimit) || fetchLimit < MIN_FETCH_LIMIT || fetchLimit > MAX_FETCH_LIMIT) {
      return `抓取数量必须是 ${MIN_FETCH_LIMIT} 到 ${MAX_FETCH_LIMIT} 之间的整数`
    }
  }
  const lowUploadKbpsRaw = payload.lowUploadKbps
  const lowUploadMinutesRaw = payload.lowUploadMinutes
  const lowUploadKbpsEnabled = lowUploadKbpsRaw !== undefined && lowUploadKbpsRaw !== null && Number(lowUploadKbpsRaw) > 0
  const lowUploadMinutesEnabled = lowUploadMinutesRaw !== undefined && lowUploadMinutesRaw !== null && Number(lowUploadMinutesRaw) > 0
  if (lowUploadKbpsEnabled !== lowUploadMinutesEnabled) return '低速删除的速度阈值和持续时间需同时填写'
  if (lowUploadKbpsEnabled) {
    if (!Number.isFinite(Number(lowUploadKbpsRaw)) || !Number.isInteger(Number(lowUploadKbpsRaw)) || Number(lowUploadKbpsRaw) < 1) return '低速删除的速度阈值必须是大于等于 1 的整数'
    if (!Number.isFinite(Number(lowUploadMinutesRaw)) || !Number.isInteger(Number(lowUploadMinutesRaw)) || Number(lowUploadMinutesRaw) < 1) return '低速删除的持续时间必须是大于等于 1 的整数'
  }
  const validSortRules: TaskSortRule[] = ['SEEDERS_ASC', 'SEEDERS_DESC', 'CREATED_DESC', 'CREATED_ASC', 'SIZE_DESC', 'SIZE_ASC']
  if (payload.sortRule && !validSortRules.includes(payload.sortRule)) return '排序规则不合法'
  return undefined
}

function listItem(task: TaskRecord, context: { sites: SiteRecord[]; downloaders: { id: string; name: string }[] }) {
  const site = context.sites.find((item) => item.id === task.siteId)
  const downloader = context.downloaders.find((item) => item.id === task.downloaderId)
  return {
    ...task,
    siteName: siteName(site),
    downloaderName: downloader?.name ?? '未知下载器'
  }
}

function buildTask(payload: TaskPayload, existing?: TaskRecord): TaskRecord {
  const now = new Date().toISOString()
  const intervalMinutes = payload.intervalMinutes ?? existing?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES
  const autoRunEnabled = payload.autoRunEnabled ?? existing?.autoRunEnabled ?? false
  const autoRunStartedAt = autoRunEnabled ? now : undefined
  const hasSeederMin = Object.hasOwn(payload, 'seederMin')
  const hasSeederMax = Object.hasOwn(payload, 'seederMax')
  const seederMin = hasSeederMin ? Number(payload.seederMin ?? 0) : existing?.seederMin ?? 0
  const seederMax = hasSeederMax ? Number(payload.seederMax ?? 0) : existing?.seederMax ?? 0
  const hasSizeMinGb = Object.hasOwn(payload, 'sizeMinGb')
  const hasSizeMaxGb = Object.hasOwn(payload, 'sizeMaxGb')
  const sizeMinGb = hasSizeMinGb ? Number(payload.sizeMinGb ?? 0) : existing?.sizeMinGb ?? 0
  const sizeMaxGb = hasSizeMaxGb ? Number(payload.sizeMaxGb ?? 0) : existing?.sizeMaxGb ?? 0
  const hasTorrentCountCondition = Object.hasOwn(payload, 'torrentCountCondition')
  const torrentCountCondition = hasTorrentCountCondition ? payload.torrentCountCondition || undefined : existing?.torrentCountCondition
  const hasLowUploadKbps = Object.hasOwn(payload, 'lowUploadKbps')
  const hasLowUploadMinutes = Object.hasOwn(payload, 'lowUploadMinutes')
  const rawKbps = hasLowUploadKbps ? payload.lowUploadKbps : existing?.lowUploadKbps
  const rawMinutes = hasLowUploadMinutes ? payload.lowUploadMinutes : existing?.lowUploadMinutes
  const lowUploadKbps = rawKbps !== undefined && rawKbps !== null && Number(rawKbps) > 0 ? Number(rawKbps) : undefined
  const lowUploadMinutes = rawMinutes !== undefined && rawMinutes !== null && Number(rawMinutes) > 0 ? Number(rawMinutes) : undefined
  const bothLow = lowUploadKbps !== undefined && lowUploadMinutes !== undefined
  return {
    id: existing?.id ?? randomUUID(),
    name: payload.name!.trim(),
    siteId: payload.siteId!,
    downloaderId: payload.downloaderId!,
    autoRunEnabled,
    autoRunStartedAt,
    nextRunAt: autoRunEnabled ? addMinutes(now, intervalMinutes) : undefined,
    intervalMinutes,
    onlyFreeDownload: payload.onlyFreeDownload ?? existing?.onlyFreeDownload ?? true,
    deleteOnFreeExpire: payload.deleteOnFreeExpire ?? existing?.deleteOnFreeExpire ?? false,
    lowUploadKbps: bothLow ? lowUploadKbps : undefined,
    lowUploadMinutes: bothLow ? lowUploadMinutes : undefined,
    autoPush: payload.autoPush ?? existing?.autoPush ?? true,
    discountTypes: payload.discountTypes?.length ? payload.discountTypes : existing?.discountTypes ?? ['FREE', 'TWO_X_FREE'],
    seederMin,
    seederMax,
    sizeMinGb,
    sizeMaxGb,
    torrentCountCondition,
    torrentCount: torrentCountCondition ? Number(payload.torrentCount ?? existing?.torrentCount ?? 1) : undefined,
    sortRule: Object.hasOwn(payload, 'sortRule') ? payload.sortRule || undefined : existing?.sortRule,
    fetchLimit: Object.hasOwn(payload, 'fetchLimit') && payload.fetchLimit !== undefined
      ? Number(payload.fetchLimit)
      : existing?.fetchLimit ?? DEFAULT_FETCH_LIMIT,
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
  if (item.downloadUrl) return resolveSiteUrl(site, item.downloadUrl)
  if (['m-team.cc', 'pt.m-team.cc', 'api.m-team.cc'].map(normalizeSiteDomain).includes(normalizeSiteDomain(site.domain)) && site.apiKey?.trim()) {
    const url = new URL('https://api.m-team.cc/api/torrent/genDlToken')
    url.searchParams.set('id', item.id)
    return url.toString()
  }
  return resolveSiteUrl(site, `/download.php?id=${encodeURIComponent(item.id)}`)
}

async function candidatesForTask(site: Parameters<typeof resolveSiteUrl>[0], options: { includeDownloadUrl: boolean; fetchLimit: number }): Promise<CandidateTorrent[]> {
  const result = await browseTorrents(site, '', 1, options.fetchLimit)
  return result.items.map((item) => {
    const discountType = discountTypeFromBrowseItem(item)
    const downloadUrl = options.includeDownloadUrl ? downloadUrlFromBrowseItem(site, item) : undefined
    // TTG 等站点使用 /t/{id}/ 格式的详情页
    const detailUrl = resolveSiteUrl(site, item.downloadUrl ? `/t/${encodeURIComponent(item.id)}/` : `/details.php?id=${encodeURIComponent(item.id)}`)
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
      detailUrl,
      downloadUrl,
      createdAt: item.createdAt
    }
  })
}

function matchedCandidates(task: TaskRecord, items: CandidateTorrent[]) {
  return items.filter((item) => {
    if (!task.discountTypes.includes(item.discountType)) return false
    const minBytes = (task.sizeMinGb ?? 0) * GB_BYTES
    const maxBytes = (task.sizeMaxGb ?? 0) * GB_BYTES
    if (minBytes > 0 && item.size < minBytes) return false
    if (maxBytes > 0 && item.size > maxBytes) return false
    if ((task.seederMin ?? 0) > 0 && item.seeders < (task.seederMin ?? 0)) return false
    if ((task.seederMax ?? 0) > 0 && item.seeders > (task.seederMax ?? 0)) return false
    return true
  })
}

function torrentHash(site: SiteRecord, item: CandidateTorrent) {
  return createHash('sha1').update(`${site.id}:${item.torrentId}`).digest('hex')
}

function applyTorrentCountCondition(task: TaskRecord, items: CandidateTorrent[]) {
  if (!task.torrentCountCondition) return items
  const target = Math.max(0, task.torrentCount ?? 0)
  if (target <= 0) return []
  return items.slice(0, Math.min(items.length, target))
}

function sortCandidatesByRule(rule: TaskSortRule | undefined, items: CandidateTorrent[]) {
  if (!rule) return items
  const sorted = [...items]
  switch (rule) {
    case 'SEEDERS_ASC':
      sorted.sort((a, b) => a.seeders - b.seeders)
      break
    case 'SEEDERS_DESC':
      sorted.sort((a, b) => b.seeders - a.seeders)
      break
    case 'CREATED_DESC':
      sorted.sort((a, b) => parseCreatedAt(b.createdAt) - parseCreatedAt(a.createdAt))
      break
    case 'CREATED_ASC':
      sorted.sort((a, b) => parseCreatedAt(a.createdAt) - parseCreatedAt(b.createdAt))
      break
    case 'SIZE_DESC':
      sorted.sort((a, b) => b.size - a.size)
      break
    case 'SIZE_ASC':
      sorted.sort((a, b) => a.size - b.size)
      break
  }
  return sorted
}

function parseCreatedAt(value?: string) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
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

async function persistTaskUpdate(task: TaskRecord) {
  try {
    await updateTaskFieldsInDb(task.id, {
      running: task.running,
      lastRunMode: task.lastRunMode,
      lastStartedAt: task.lastStartedAt,
      lastFinishedAt: task.lastFinishedAt,
      lastStatus: task.lastStatus,
      lastSummary: task.lastSummary,
      lastError: task.lastError,
      nextRunAt: task.nextRunAt,
      updatedAt: task.updatedAt
    })
  } catch (error) {
    logger.error('task', `任务状态写盘失败，尝试仅复位 running 字段`, {
      taskId: task.id,
      taskName: task.name,
      error: errorMessage(error, '写盘失败')
    })
    try {
      const finishedAt = new Date().toISOString()
      await updateTaskFieldsInDb(task.id, {
        running: false,
        lastFinishedAt: finishedAt,
        lastStatus: 'FAILED',
        lastError: '任务状态写盘失败，已回退为失败状态',
        lastSummary: '任务状态写盘失败',
        updatedAt: finishedAt
      })
    } catch (fallbackError) {
      logger.error('task', `任务状态写盘二次回退失败`, {
        taskId: task.id,
        taskName: task.name,
        error: errorMessage(fallbackError, '写盘失败')
      })
    }
  }
}

async function runTaskById(taskId: string, runMode: TaskRunMode): Promise<TaskRunResult> {
  if (runningTaskIds.has(taskId)) throw new Error('任务正在运行')
  runningTaskIds.add(taskId)

  const task = await getTaskFromDb(taskId)
  if (!task) {
    runningTaskIds.delete(taskId)
    throw new Error('任务不存在')
  }
  if (task.running) {
    runningTaskIds.delete(taskId)
    throw new Error('任务正在运行')
  }

  const [sites, downloaders] = await Promise.all([listSitesFromDb(), listDownloadersFromDb()])
  const site = sites.find((item) => item.id === task.siteId)
  const downloader = downloaders.find((item) => item.id === task.downloaderId)
  const startedAt = new Date().toISOString()
  task.running = true
  task.lastStartedAt = startedAt
  task.lastRunMode = runMode
  task.lastStatus = undefined
  task.lastError = undefined
  task.lastSummary = '运行中'
  task.updatedAt = startedAt
  await updateTaskFieldsInDb(task.id, {
    running: true,
    lastStartedAt: startedAt,
    lastRunMode: runMode,
    lastStatus: undefined,
    lastError: undefined,
    lastSummary: '运行中',
    updatedAt: startedAt
  })
  logger.info('task', `任务【${task.name}】开始执行`, {
    taskId: task.id,
    taskName: task.name,
    runMode,
    startedAt
  })
  if (runMode === 'AUTO') {
    await recordScheduleLog({
      jobName: 'task-auto-run',
      message: `任务【${task.name}】开始执行`,
      status: 'RUNNING',
      startedAt,
      triggeredAt: startedAt,
      details: {
        taskId: task.id,
        taskName: task.name,
        runMode
      }
    })
  }

  let pushedTorrentRecords: TorrentRecord[] = []
  try {
    if (!site || !site.enabled) throw new Error(!site ? '任务绑定站点不存在' : '站点已禁用')
    let fetched: CandidateTorrent[]
    try {
      fetched = await candidatesForTask(site, { includeDownloadUrl: true, fetchLimit: task.fetchLimit ?? DEFAULT_FETCH_LIMIT })
    } catch (error) {
      throw new Error(`抓取失败：${errorMessage(error, '种子列表获取失败')}`)
    }
    fetched = sortCandidatesByRule(task.sortRule, fetched)
    const existingTorrents = await listAllTorrents({ siteId: site.id })
    const existingKeys = new Set(existingTorrents.map((torrent) => `${torrent.siteId}:${torrent.torrentId ?? ''}`).filter((key) => !key.endsWith(':')))
    const deduped = fetched.filter((item) => !existingKeys.has(`${site.id}:${item.torrentId}`))
    const dedupedCount = fetched.length - deduped.length
    const matched = matchedCandidates(task, deduped)
    const pushable = applyTorrentCountCondition(task, matched)
    const now = new Date().toISOString()
    let pushedCount = 0
    let pushFailedCount = 0
    const pushErrorMessages: string[] = []
    for (const item of pushable) {
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
        onlyFreeDownload: task.onlyFreeDownload ?? false,
        deleteOnFreeExpire: task.deleteOnFreeExpire ?? false,
        lowUploadKbps: task.lowUploadKbps,
        lowUploadMinutes: task.lowUploadMinutes,
        detailUrl: item.detailUrl,
        downloaderId: downloader?.id,
        downloaderName: downloader?.name,
        downloaderType: downloader?.type,
        downloaderState: pushed?.state ?? undefined,
        torrentHash: pushed?.hash,
        taskSavePath: task.savePathOverride,
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
      pushedTorrentRecords.push(record)
      await recordTorrentLog({
        torrentId: record.id,
        siteId: record.siteId,
        siteName: record.siteName,
        torrentTitle: record.title,
        event: 'INSERTED',
        status: 'SUCCESS',
        source: 'TASK',
        message: `任务【${task.name}】入库种子「${readableTorrentTitle(record.title)}」`
      })
      if (task.autoPush) {
        if (pushed) {
          await recordTorrentLog({
            torrentId: record.id,
            siteId: record.siteId,
            siteName: record.siteName,
            torrentTitle: record.title,
            event: 'PUSHED',
            status: 'SUCCESS',
            source: 'TASK',
            message: `任务自动推送种子「${readableTorrentTitle(record.title)}」到「${downloader?.name ?? '下载器'}」`
          })
        } else if (failedPush) {
          await recordTorrentLog({
            torrentId: record.id,
            siteId: record.siteId,
            siteName: record.siteName,
            torrentTitle: record.title,
            event: 'PUSH_FAILED',
            status: 'FAILED',
            source: 'TASK',
            message: `任务自动推送种子「${readableTorrentTitle(record.title)}」失败：${pushError ?? '未知原因'}`
          })
        }
      }
    }
    if (pushedTorrentRecords.length) {
      await insertTorrents(pushedTorrentRecords)
    }
    const finishedAt = new Date().toISOString()
    const baseSummary = `抓取 ${fetched.length} 个，去重 ${dedupedCount} 个，命中 ${matched.length} 个，待入库 ${pushable.length} 个，推送 ${pushedCount} 个，失败 ${pushFailedCount} 个`
    const failureSummary = pushErrorMessages.length ? `；失败原因：${pushErrorMessages.slice(0, 3).join('；')}${pushErrorMessages.length > 3 ? `；另有 ${pushErrorMessages.length - 3} 条失败` : ''}` : ''
    const summary = `${baseSummary}${failureSummary}`
    task.running = false
    task.lastFinishedAt = finishedAt
    task.lastStatus = 'SUCCESS'
    task.lastSummary = summary
    task.lastError = undefined
    task.nextRunAt = task.autoRunEnabled ? addMinutes(finishedAt, task.intervalMinutes) : undefined
    task.updatedAt = finishedAt
    await persistTaskUpdate(task)
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
      skippedExistingCount: dedupedCount,
      pushedCount,
      pushFailedCount,
      summary,
      errorMessage: task.lastError,
      pushErrorMessages,
      failureDetails: pushErrorMessages
    })
    logger.info('task', `任务【${task.name}】执行成功`, {
      taskId: task.id,
      taskName: task.name,
      runMode,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      result: {
        fetchedCount: fetched.length,
        matchedCount: matched.length,
        skippedExistingCount: dedupedCount,
        pushedCount,
        pushFailedCount
      }
    })
    if (runMode === 'AUTO') {
      await recordScheduleLog({
        jobName: 'task-auto-run',
        message: `任务【${task.name}】执行成功`,
        status: 'SUCCESS',
        startedAt,
        finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
        summary,
        details: {
          taskId: task.id,
          taskName: task.name,
          runMode,
          fetchedCount: fetched.length,
          matchedCount: matched.length,
          skippedExistingCount: dedupedCount,
          pushedCount,
          pushFailedCount
        }
      })
    }
    return { task, fetchedCount: fetched.length, matchedCount: matched.length, skippedExistingCount: dedupedCount, pushedCount, pushFailedCount, summary }
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
    await persistTaskUpdate(task)
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
    logger.error('task', `任务【${task.name}】执行失败`, {
      taskId: task.id,
      taskName: task.name,
      runMode,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      error: message
    })
    if (runMode === 'AUTO') {
      await recordScheduleLog({
        jobName: 'task-auto-run',
        message: `任务【${task.name}】执行失败`,
        status: 'FAILED',
        startedAt,
        finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
        summary: message,
        errorMessage: message,
        details: {
          taskId: task.id,
          taskName: task.name,
          runMode
        }
      })
    }
    throw error
  } finally {
    runningTaskIds.delete(taskId)
  }
}

export type StuckTaskResetSummary = {
  resetCount: number
  resetTaskIds: string[]
}

export type ResetStuckTasksOptions = {
  thresholdMs?: number
  source: 'startup' | 'scheduler'
}

export async function resetStuckRunningTasks(options: ResetStuckTasksOptions): Promise<StuckTaskResetSummary> {
  const thresholdMs = options.thresholdMs ?? STUCK_TASK_THRESHOLD_MS
  const nowMs = Date.now()
  const tasks = await listTasksFromDb()
  const stuck: TaskRecord[] = []
  for (const task of tasks) {
    if (!task.running) continue
    const startedMs = task.lastStartedAt ? new Date(task.lastStartedAt).getTime() : 0
    const isStuck = !startedMs || Number.isNaN(startedMs) || nowMs - startedMs >= thresholdMs
    if (!isStuck) continue
    if (runningTaskIds.has(task.id)) continue
    stuck.push(task)
  }
  if (!stuck.length) {
    return { resetCount: 0, resetTaskIds: [] }
  }
  const finishedAt = new Date().toISOString()
  const resetTaskIds: string[] = []
  for (const task of stuck) {
    const wasAutoEnabled = task.autoRunEnabled
    const reason = options.source === 'startup'
      ? '进程启动时检测到运行中状态残留，已自动重置'
      : '运行时间超过阈值未结束，已自动重置为失败'
    const nextRunAt = wasAutoEnabled ? addMinutes(finishedAt, task.intervalMinutes) : undefined
    await updateTaskFieldsInDb(task.id, {
      running: false,
      lastFinishedAt: finishedAt,
      lastStatus: 'FAILED',
      lastError: reason,
      lastSummary: reason,
      nextRunAt,
      updatedAt: finishedAt
    })
    resetTaskIds.push(task.id)
    await recordTaskLog({
      taskId: task.id,
      taskName: task.name,
      runMode: task.lastRunMode,
      message: reason,
      status: 'FAILED',
      startedAt: task.lastStartedAt,
      finishedAt,
      fetchedCount: 0,
      matchedCount: 0,
      skippedExistingCount: 0,
      pushedCount: 0,
      pushFailedCount: 0,
      summary: reason,
      errorMessage: reason,
      failureDetails: [reason]
    })
    logger.warn('task', `任务【${task.name}】运行状态已重置`, {
      taskId: task.id,
      taskName: task.name,
      source: options.source,
      lastStartedAt: task.lastStartedAt,
      thresholdMs
    })
  }
  return { resetCount: resetTaskIds.length, resetTaskIds }
}

export type DueTaskRunSummary = {
  dueCount: number
  triggeredCount: number
  skippedRunningCount: number
}

export async function runDueTasks(): Promise<DueTaskRunSummary> {
  const tasks = await listTasksFromDb()
  const now = Date.now()
  const dueTasks = tasks.filter((task) => task.autoRunEnabled && task.nextRunAt && new Date(task.nextRunAt).getTime() <= now)
  const runnableTasks = dueTasks.filter((task) => !task.running)
  for (const task of dueTasks) {
    if (task.running) continue
    runTaskById(task.id, 'AUTO').catch(() => undefined)
  }
  return {
    dueCount: dueTasks.length,
    triggeredCount: runnableTasks.length,
    skippedRunningCount: dueTasks.length - runnableTasks.length
  }
}

tasksRouter.get('/', requireAuth, async (req, res) => {
  const [tasks, sites, downloaders] = await Promise.all([listTasksFromDb(), listSitesFromDb(), listDownloadersFromDb()])
  const context = { sites, downloaders }
  const keyword = String(req.query.keyword ?? '').trim().toLowerCase()
  const autoRun = String(req.query.autoRun ?? 'ALL')
  const filtered = tasks.filter((task) => {
    const item = listItem(task, context)
    if (keyword && !`${item.name} ${item.siteName} ${item.downloaderName}`.toLowerCase().includes(keyword)) return false
    if (autoRun === 'ON' && !task.autoRunEnabled) return false
    if (autoRun === 'OFF' && task.autoRunEnabled) return false
    return true
  })
  res.json({
    items: filtered.map((task) => listItem(task, context)),
    total: filtered.length,
    stats: {
      total: tasks.length,
      autoRunEnabled: tasks.filter((task) => task.autoRunEnabled).length,
      running: tasks.filter((task) => task.running).length,
      failed: tasks.filter((task) => task.lastStatus === 'FAILED').length
    }
  })
})

tasksRouter.post('/', requireAuth, async (req, res) => {
  const [tasks, sites, downloaders] = await Promise.all([listTasksFromDb(), listSitesFromDb(), listDownloadersFromDb()])
  const payload = req.body as TaskPayload
  const validation = validatePayload(payload, { existingTasks: tasks, sites, downloaders })
  if (validation) return res.status(400).json({ message: validation })
  const task = buildTask(payload)
  await insertTaskToDb(task)
  await logOperation(req, res, '新建任务', `新建任务「${task.name}」`)
  res.status(201).json(listItem(task, { sites, downloaders }))
})

tasksRouter.get('/:id', requireAuth, async (req, res) => {
  const [task, sites, downloaders] = await Promise.all([
    getTaskFromDb(String(req.params.id)),
    listSitesFromDb(),
    listDownloadersFromDb()
  ])
  if (!task) return res.status(404).json({ message: '任务不存在' })
  res.json(listItem(task, { sites, downloaders }))
})

tasksRouter.put('/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id)
  const [existing, tasks, sites, downloaders] = await Promise.all([
    getTaskFromDb(id),
    listTasksFromDb(),
    listSitesFromDb(),
    listDownloadersFromDb()
  ])
  if (!existing) return res.status(404).json({ message: '任务不存在' })
  const payload = req.body as TaskPayload
  const validation = validatePayload(payload, { existingTasks: tasks, sites, downloaders }, id)
  if (validation) return res.status(400).json({ message: validation })
  const task = buildTask(payload, existing)
  await insertTaskToDb(task)
  await logOperation(req, res, '编辑任务', `编辑任务「${task.name}」`)
  res.json(listItem(task, { sites, downloaders }))
})

tasksRouter.delete('/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id)
  const task = await getTaskFromDb(id)
  if (!task) return res.status(404).json({ message: '任务不存在' })
  await deleteTaskFromDb(id)
  await logOperation(req, res, '删除任务', `删除任务「${task.name}」`)
  res.status(204).send()
})

tasksRouter.post('/:id/auto-run', requireAuth, async (req, res) => {
  const id = String(req.params.id)
  const [task, sites, downloaders] = await Promise.all([
    getTaskFromDb(id),
    listSitesFromDb(),
    listDownloadersFromDb()
  ])
  if (!task) return res.status(404).json({ message: '任务不存在' })
  const autoRunEnabled = Boolean((req.body as { autoRunEnabled?: boolean }).autoRunEnabled)
  const now = new Date().toISOString()
  const nextRunAt = autoRunEnabled ? addMinutes(now, task.intervalMinutes) : undefined
  await updateTaskFieldsInDb(id, {
    autoRunEnabled,
    autoRunStartedAt: autoRunEnabled ? now : undefined,
    nextRunAt,
    updatedAt: now
  })
  const updated: TaskRecord = { ...task, autoRunEnabled, autoRunStartedAt: autoRunEnabled ? now : undefined, nextRunAt, updatedAt: now }
  await logOperation(req, res, autoRunEnabled ? '开启任务自动执行' : '关闭任务自动执行', `${autoRunEnabled ? '开启' : '关闭'}任务「${task.name}」自动执行`)
  res.json(listItem(updated, { sites, downloaders }))
})

tasksRouter.post('/:id/test', requireAuth, async (req, res) => {
  const id = String(req.params.id)
  const task = await getTaskFromDb(id)
  if (!task) return res.status(404).json({ message: '任务不存在' })
  const sites = await listSitesFromDb()
  const site = sites.find((item) => item.id === task.siteId)
  if (!site) return res.status(400).json({ message: '任务绑定站点不存在' })
  try {
    const fetched = sortCandidatesByRule(task.sortRule, await candidatesForTask(site, { includeDownloadUrl: false, fetchLimit: task.fetchLimit ?? DEFAULT_FETCH_LIMIT }))
    const existingTorrents = await listAllTorrents({ siteId: site.id })
    const existingKeys = new Set(existingTorrents.map((torrent) => `${torrent.siteId}:${torrent.torrentId ?? ''}`).filter((key) => !key.endsWith(':')))
    const deduped = fetched.filter((item) => !existingKeys.has(`${site.id}:${item.torrentId}`))
    const dedupedCount = fetched.length - deduped.length
    const matched = matchedCandidates(task, deduped)
    const pushable = applyTorrentCountCondition(task, matched)
    const pushableCount = pushable.length
    const dedupedIds = new Set(deduped.map((item) => item.torrentId))
    const matchedIds = new Set(matched.map((item) => item.torrentId))
    const pushableIds = new Set(pushable.map((item) => item.torrentId))
    const items = fetched.map((item) => ({
      ...item,
      skippedExisting: !dedupedIds.has(item.torrentId),
      matched: matchedIds.has(item.torrentId),
      pushable: pushableIds.has(item.torrentId)
    }))
    await logOperation(req, res, '测试任务', `测试任务「${task.name}」：抓取 ${fetched.length} 个，去重 ${dedupedCount} 个，命中 ${matched.length} 个，待入库 ${pushableCount} 个，测试列表展示全部抓取种子`)
    return res.json({
      taskId: task.id,
      taskName: task.name,
      siteId: site.id,
      siteName: siteName(site),
      fetchedCount: fetched.length,
      skippedExistingCount: dedupedCount,
      matchedCount: matched.length,
      pushableCount,
      items,
      total: fetched.length
    })
  } catch (error) {
    const message = errorMessage(error, '任务测试失败')
    await logOperation(req, res, '测试任务', `测试任务「${task.name}」失败：${message}`, 'FAILED')
    return res.status(400).json({ message })
  }
})

tasksRouter.post('/:id/run', requireAuth, async (req, res) => {
  try {
    const result = await runTaskById(String(req.params.id), 'MANUAL_RUN')
    const [sites, downloaders] = await Promise.all([listSitesFromDb(), listDownloadersFromDb()])
    await logOperation(req, res, '运行任务', `手动运行任务「${result.task.name}」：${result.summary}`, result.task.lastStatus)
    res.json({ task: listItem(result.task, { sites, downloaders }), fetchedCount: result.fetchedCount, matchedCount: result.matchedCount, skippedExistingCount: result.skippedExistingCount, pushedCount: result.pushedCount, pushFailedCount: result.pushFailedCount, summary: result.summary })
  } catch (error) {
    const message = error instanceof Error ? error.message : '任务执行失败'
    const id = String(req.params.id)
    const [task, sites, downloaders] = await Promise.all([getTaskFromDb(id), listSitesFromDb(), listDownloadersFromDb()])
    await logOperation(req, res, '运行任务', `手动运行任务「${task?.name ?? '未知任务'}」失败：${message}`, 'FAILED')
    res.status(message === '任务正在运行' ? 409 : task ? 400 : 404).json({ message, task: task ? listItem(task, { sites, downloaders }) : undefined })
  }
})

tasksRouter.get('/:id/logs', requireAuth, async (req, res) => {
  const taskId = String(req.params.id)
  const page = Math.max(Number(req.query.page ?? 1), 1)
  const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20), 1), 100)
  const result = await queryLogs({ type: 'task', page, pageSize, taskId })
  res.json(result)
})
