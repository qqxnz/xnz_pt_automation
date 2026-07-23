import { appendSigninLog, getCurrentDatabase, listLatestSigninLogBySiteAndDate, listSitesFromDb, readDailyTrafficByDate, storagePaths, type SiteRecord } from '../storage.js'
import { performSiteSignin } from '../routes/signin/index.js'
import { isSiteSigninSupported, siteDisplayName, syncSiteTrafficStats } from '../routes/sites/index.js'
import { resetStuckRunningTasks, runDueTasks } from '../routes/tasks.js'
import { cleanupExpiredFreeDownloads } from './freeDownloadGuard.js'
import { logger, recordScheduleLog } from './logger.js'
import { buildDailyTrafficMessage, dispatchNotification } from './notifications.js'
import { syncTorrentIpv6Peers } from './peerSync.js'
import { syncTorrentDownloadStats } from './torrentSync.js'
import { localDateKey } from './time.js'
import { createManualBackup } from '../storage/backup.js'
import { getMeta, setMeta } from '../storage/_meta.js'
import path from 'node:path'

const SCHEDULER_TICK_INTERVAL_MS = 1000
const TASK_SCAN_INTERVAL_MS = 60 * 1000
const TASK_STUCK_CHECK_INTERVAL_MS = 60 * 1000
const TORRENT_DOWNLOAD_STATS_SYNC_INTERVAL_MS = 60 * 1000
const TORRENT_IPV6_PEER_SYNC_INTERVAL_MS = 60 * 1000
const EXPIRED_FREE_DOWNLOAD_CLEANUP_INTERVAL_MS = 60 * 1000
const SITE_TRAFFIC_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
const SITE_AUTO_SIGNIN_SCAN_INTERVAL_MS = 10 * 60 * 1000
const AUTO_BACKUP_SCAN_INTERVAL_MS = 60 * 1000

const DAILY_TRAFFIC_NOTIFY_TARGET_HOUR = 0
const DAILY_TRAFFIC_NOTIFY_TARGET_MINUTE = 5
const DAILY_TRAFFIC_NOTIFY_INTERVAL_MS = 60 * 1000
const DAILY_TRAFFIC_NOTIFY_META_KEY = 'last_daily_traffic_notify_date'

type SchedulerJob = {
  name: string
  intervalMs: number
  nextRunAt: number
  running: boolean
  logStart?: boolean
  shouldLogSuccess?: (result: Record<string, unknown>) => boolean
  resultStatus?: (result: Record<string, unknown>) => 'SUCCESS' | 'FAILED'
  run: () => Promise<Record<string, unknown>>
}

let schedulerTimer: NodeJS.Timeout | undefined
let siteAutoSigninHeartbeatDate = ''

function iso(value: number) {
  return new Date(value).toISOString()
}

function readableJobName(name: string) {
  const map: Record<string, string> = {
    'task-auto-run-scan': '自动任务扫描',
    'task-stuck-check': '卡死任务巡检',
    'torrent-download-stats-sync': '种子下载器状态同步',
    'torrent-ipv6-peer-sync': '种子 IPV6 peer 同步',
    'expired-free-download-cleanup': '下载器自动清理',
    'site-traffic-sync': '站点流量统计同步',
    'site-auto-signin': '站点自动签到',
    'auto-backup': '数据库自动备份',
    'daily-traffic-notify': '每日流量通知'
  }
  return map[name] ?? name
}

const jobs: SchedulerJob[] = [
  {
    name: 'task-auto-run-scan',
    intervalMs: TASK_SCAN_INTERVAL_MS,
    nextRunAt: Date.now() + TASK_SCAN_INTERVAL_MS,
    running: false,
    logStart: false,
    shouldLogSuccess: (result) => Number(result.dueCount ?? 0) > 0 || Number(result.triggeredCount ?? 0) > 0 || Number(result.skippedRunningCount ?? 0) > 0,
    run: async () => runDueTasks()
  },
  {
    name: 'task-stuck-check',
    intervalMs: TASK_STUCK_CHECK_INTERVAL_MS,
    nextRunAt: Date.now() + TASK_STUCK_CHECK_INTERVAL_MS,
    running: false,
    logStart: false,
    shouldLogSuccess: (result) => Number(result.resetCount ?? 0) > 0,
    run: async () => {
      const summary = await resetStuckRunningTasks({ source: 'scheduler' })
      return { resetCount: summary.resetCount, resetTaskIds: summary.resetTaskIds }
    }
  },
  {
    name: 'torrent-download-stats-sync',
    intervalMs: TORRENT_DOWNLOAD_STATS_SYNC_INTERVAL_MS,
    nextRunAt: Date.now() + TORRENT_DOWNLOAD_STATS_SYNC_INTERVAL_MS,
    running: false,
    run: async () => {
      const summary = await syncTorrentDownloadStats()
      return {
        successfulDownloaders: summary.successfulDownloaders,
        failedDownloaders: summary.failedDownloaders,
        updatedTorrents: summary.updatedTorrents,
        errorCount: summary.errors.length
      }
    }
  },
  {
    name: 'torrent-ipv6-peer-sync',
    intervalMs: TORRENT_IPV6_PEER_SYNC_INTERVAL_MS,
    nextRunAt: Date.now() + TORRENT_IPV6_PEER_SYNC_INTERVAL_MS,
    running: false,
    logStart: false,
    shouldLogSuccess: (result) => Number(result.scannedTorrents ?? 0) > 0 || Number(result.ipv6TorrentCount ?? 0) > 0 || Number(result.clearedDownloaders ?? 0) > 0 || Number(result.errorCount ?? 0) > 0,
    run: async () => {
      const summary = await syncTorrentIpv6Peers()
      return {
        scannedDownloaders: summary.scannedDownloaders,
        scannedTorrents: summary.scannedTorrents,
        ipv6TorrentCount: summary.ipv6TorrentCount,
        clearedDownloaders: summary.clearedDownloaders,
        errorCount: summary.errors.length
      }
    }
  },
  {
    name: 'expired-free-download-cleanup',
    intervalMs: EXPIRED_FREE_DOWNLOAD_CLEANUP_INTERVAL_MS,
    nextRunAt: Date.now() + EXPIRED_FREE_DOWNLOAD_CLEANUP_INTERVAL_MS,
    running: false,
    logStart: false,
    shouldLogSuccess: (result) => Number(result.expiredIncompleteCount ?? 0) > 0 || Number(result.failedCount ?? 0) > 0 || Number(result.skippedCount ?? 0) > 0,
    resultStatus: (result) => (Number(result.failedCount ?? 0) > 0 ? 'FAILED' : 'SUCCESS'),
    run: async () => {
      const summary = await cleanupExpiredFreeDownloads()
      return {
        checkedCount: summary.checkedCount,
        expiredIncompleteCount: summary.expiredIncompleteCount,
        deletedCount: summary.deletedCount,
        failedCount: summary.failedCount,
        skippedCount: summary.skippedCount,
        details: summary.details
      }
    }
  },
  {
    name: 'site-traffic-sync',
    intervalMs: SITE_TRAFFIC_SYNC_INTERVAL_MS,
    nextRunAt: Date.now() + SITE_TRAFFIC_SYNC_INTERVAL_MS,
    running: false,
    run: async () => {
      const summary = await syncSiteTrafficStats({ staleOnly: true })
      return {
        successCount: summary.successCount,
        failedCount: summary.failedCount,
        errorCount: summary.errors.length
      }
    }
  },
  {
    name: 'site-auto-signin',
    intervalMs: SITE_AUTO_SIGNIN_SCAN_INTERVAL_MS,
    nextRunAt: Date.now() + SITE_AUTO_SIGNIN_SCAN_INTERVAL_MS,
    running: false,
    logStart: false,
    shouldLogSuccess: (result) => {
      if (Number(result.scheduledCount ?? 0) > 0) return true
      if (Number(result.backfilledCount ?? 0) > 0) return true
      const today = localDateKey()
      if (siteAutoSigninHeartbeatDate !== today) {
        siteAutoSigninHeartbeatDate = today
        return true
      }
      return false
    },
    run: async () => runDueSignins()
  },
  {
    name: 'auto-backup',
    intervalMs: AUTO_BACKUP_SCAN_INTERVAL_MS,
    nextRunAt: Date.now() + AUTO_BACKUP_SCAN_INTERVAL_MS,
    running: false,
    logStart: false,
    shouldLogSuccess: (result) => result.backupCreated === true,
    run: async () => {
      const now = new Date()
      if (now.getHours() !== 3) {
        return { skipped: true }
      }
      const db = getCurrentDatabase()
      const lastBackupAt = getMeta(db, 'last_backup_at')
      if (lastBackupAt) {
        const lastDate = new Date(lastBackupAt)
        if (lastDate.toDateString() === now.toDateString()) {
          return { skipped: true, reason: 'already backed up today' }
        }
      }
      const result = createManualBackup(db, storagePaths.dataDir)
      return { backupCreated: true, name: path.basename(result.path), sizeBytes: result.sizeBytes }
    }
  },
  {
    name: 'daily-traffic-notify',
    intervalMs: DAILY_TRAFFIC_NOTIFY_INTERVAL_MS,
    nextRunAt: Date.now() + DAILY_TRAFFIC_NOTIFY_INTERVAL_MS,
    running: false,
    logStart: false,
    shouldLogSuccess: (result) => result.pushed === true || result.reason === 'outside-trigger-window' || result.reason === 'already-sent-today',
    run: async () => runDailyTrafficNotify()
  }
]


async function runJob(job: SchedulerJob, scheduledAt: number) {
  const startedAt = Date.now()
  job.running = true
  if (job.logStart !== false) {
    const message = `定时任务【${readableJobName(job.name)}】开始执行`
    logger.info('scheduler', `定时任务【${readableJobName(job.name)}】开始执行`, {
      job: job.name,
      scheduledAt: iso(scheduledAt),
      triggeredAt: iso(startedAt)
    })
    await recordScheduleLog({
      jobName: job.name,
      message,
      status: 'RUNNING',
      scheduledAt: iso(scheduledAt),
      triggeredAt: iso(startedAt),
      startedAt: iso(startedAt)
    })
  }

  try {
    const result = await job.run()
    const finishedAt = Date.now()
    job.nextRunAt = finishedAt + job.intervalMs
    if (job.shouldLogSuccess?.(result) ?? true) {
      const status = job.resultStatus?.(result) ?? 'SUCCESS'
      const message = `定时任务【${readableJobName(job.name)}】${status === 'SUCCESS' ? '执行成功' : '执行失败'}`
      logger[status === 'SUCCESS' ? 'info' : 'error']('scheduler', `定时任务【${readableJobName(job.name)}】${status === 'SUCCESS' ? '执行成功' : '执行失败'}`, {
        job: job.name,
        durationMs: finishedAt - startedAt,
        nextRunAt: iso(job.nextRunAt),
        result
      })
      await recordScheduleLog({
        jobName: job.name,
        message,
        status,
        scheduledAt: iso(scheduledAt),
        triggeredAt: iso(startedAt),
        startedAt: iso(startedAt),
        finishedAt: iso(finishedAt),
        durationMs: finishedAt - startedAt,
        summary: JSON.stringify(result),
        details: result
      })
    }
  } catch (error) {
    const finishedAt = Date.now()
    job.nextRunAt = finishedAt + job.intervalMs
    const message = `定时任务【${readableJobName(job.name)}】执行失败`
    logger.error('scheduler', `定时任务【${readableJobName(job.name)}】执行失败`, {
      job: job.name,
      durationMs: finishedAt - startedAt,
      nextRunAt: iso(job.nextRunAt),
      error: error instanceof Error ? error.message : String(error)
    })
    await recordScheduleLog({
      jobName: job.name,
      message,
      status: 'FAILED',
      scheduledAt: iso(scheduledAt),
      triggeredAt: iso(startedAt),
      startedAt: iso(startedAt),
      finishedAt: iso(finishedAt),
      durationMs: finishedAt - startedAt,
      errorMessage: error instanceof Error ? error.message : String(error)
    })
  } finally {
    job.running = false
  }
}

function tick() {
  const now = Date.now()
  for (const job of jobs) {
    if (job.running || now < job.nextRunAt) continue
    void runJob(job, job.nextRunAt)
  }
}

function shiftLocalDateKey(dateKey: string, offsetDays: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) throw new Error(`日期键无效（应为 YYYY-MM-DD）：${dateKey}`)
  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  target.setDate(target.getDate() + offsetDays)
  return localDateKey(target)
}

export async function runDailyTrafficNotify(now: Date = new Date()) {
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  if (currentHour !== DAILY_TRAFFIC_NOTIFY_TARGET_HOUR || currentMinute !== DAILY_TRAFFIC_NOTIFY_TARGET_MINUTE) {
    return { pushed: false, reason: 'outside-trigger-window' }
  }

  const todayKey = localDateKey(now)
  const yesterdayKey = shiftLocalDateKey(todayKey, -1)
  const db = getCurrentDatabase()
  const lastSentDate = getMeta(db, DAILY_TRAFFIC_NOTIFY_META_KEY)
  if (lastSentDate === todayKey) {
    return { pushed: false, reason: 'already-sent-today', date: todayKey }
  }

  const items = await readDailyTrafficByDate(yesterdayKey)
  if (!items.length) {
    setMeta(db, DAILY_TRAFFIC_NOTIFY_META_KEY, todayKey)
    logger.info('scheduler', '每日流量通知跳过（昨日无流量数据）', { date: yesterdayKey })
    return { pushed: false, reason: 'no-data', date: yesterdayKey }
  }

  const message = buildDailyTrafficMessage(items, yesterdayKey) ?? ''
  if (!message) {
    setMeta(db, DAILY_TRAFFIC_NOTIFY_META_KEY, todayKey)
    return { pushed: false, reason: 'empty-message', date: yesterdayKey }
  }

  const logs = await dispatchNotification({
    event: 'DAILY_TRAFFIC',
    title: `${yesterdayKey} 每日流量汇总`,
    message
  })
  setMeta(db, DAILY_TRAFFIC_NOTIFY_META_KEY, todayKey)
  const siteCount = items.length
  const totalUploaded = items.reduce((sum, item) => sum + item.uploaded, 0)
  const totalDownloaded = items.reduce((sum, item) => sum + item.downloaded, 0)
  logger.info('scheduler', '每日流量通知已发送', {
    date: yesterdayKey,
    siteCount,
    totalUploaded,
    totalDownloaded,
    configCount: logs.length
  })
  return { pushed: true, date: yesterdayKey, siteCount, totalUploaded, totalDownloaded, configCount: logs.length }
}

export async function runDueSignins() {
  const sites = (await listSitesFromDb()).filter((site) => site.enabled && site.signinEnabled && isSiteSigninSupported(site.domain))
  const now = new Date()
  const todayKey = localDateKey(now)
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  const due: SiteRecord[] = []
  const backfillNeeded: SiteRecord[] = []

  for (const site of sites) {
    const match = /^(2[0-3]|[01]\d):([0-5]\d)$/.exec(site.signinTime)
    if (!match) continue
    const targetMinutes = Number(match[1]) * 60 + Number(match[2])
    if (currentMinutes < targetMinutes) continue

    const lastSigninLocalKey = site.lastSigninAt ? localDateKey(new Date(site.lastSigninAt)) : undefined
    if (lastSigninLocalKey === todayKey) {
      // 站点表已记录今日签到，但 site_signin_logs 可能缺失 → 检查并回填
      const existingLog = await listLatestSigninLogBySiteAndDate(site.id, todayKey)
      if (!existingLog) backfillNeeded.push(site)
      continue
    }
    due.push(site)
  }

  let backfilledCount = 0
  for (const site of backfillNeeded) {
    try {
      await appendSigninLog({
        siteId: site.id,
        siteName: siteDisplayName(site),
        runMode: 'AUTO',
        triggerSource: 'scheduler-backfill',
        status: site.lastSigninStatus ?? 'SUCCESS',
        message: site.lastSigninMessage ?? '签到状态回填（原始日志缺失）',
        errorMessage: undefined,
        startedAt: site.lastSigninAt!,
        finishedAt: site.lastSigninAt!,
        durationMs: 0
      })
      backfilledCount += 1
    } catch (error) {
      logger.warn('scheduler', '签到日志补写失败', {
        siteId: site.id,
        siteName: siteDisplayName(site),
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  if (!due.length) {
    return { scheduledCount: 0, successCount: 0, failedCount: 0, skippedCount: 0, backfilledCount, details: [] }
  }

  let successCount = 0
  let failedCount = 0
  let skippedCount = 0
  const details: Array<{ siteId: string; siteName: string; status: string; message: string; durationMs: number }> = []

  for (const site of due) {
    try {
      const result = await performSiteSignin(site, {
        runMode: 'AUTO',
        triggerSource: 'scheduler',
        now
      })
      details.push({
        siteId: result.siteId,
        siteName: result.siteName,
        status: result.status,
        message: result.message,
        durationMs: result.durationMs
      })
      if (result.status === 'SUCCESS') successCount += 1
      else if (result.status === 'SKIPPED') skippedCount += 1
      else failedCount += 1
    } catch (error) {
      failedCount += 1
      details.push({
        siteId: site.id,
        siteName: siteDisplayName(site),
        status: 'FAILED',
        message: error instanceof Error ? error.message : '签到失败',
        durationMs: 0
      })
    }
  }

  const detail = details.slice(0, 5).map((item) => `${item.siteName}：${item.message}`).join('\n')
  await dispatchNotification({
    event: 'SITE_SIGNIN',
    title: failedCount ? '自动站点签到完成（含失败）' : '自动站点签到完成',
    message: `共 ${due.length} 个站点，成功 ${successCount}，失败 ${failedCount}，跳过 ${skippedCount}${detail ? `\n${detail}` : ''}${details.length > 5 ? `\n另有 ${details.length - 5} 个站点` : ''}`
  })
  return { scheduledCount: due.length, successCount, failedCount, skippedCount, backfilledCount, details }
}

export type SchedulerJobStatus = {
  name: string
  readableName: string
  intervalMs: number
  nextRunAt: string
  running: boolean
}

export function getSchedulerJobs(): SchedulerJobStatus[] {
  return jobs.map((job) => ({
    name: job.name,
    readableName: readableJobName(job.name),
    intervalMs: job.intervalMs,
    nextRunAt: iso(job.nextRunAt),
    running: job.running
  }))
}

export function startScheduler() {
  if (schedulerTimer) return
  schedulerTimer = setInterval(tick, SCHEDULER_TICK_INTERVAL_MS)
  logger.info('scheduler', '中央调度器已启动', {
    tickIntervalMs: SCHEDULER_TICK_INTERVAL_MS,
    jobs: jobs.map((job) => ({
      name: job.name,
      intervalMs: job.intervalMs,
      nextRunAt: iso(job.nextRunAt)
    }))
  })
}
