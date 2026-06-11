import { listSitesFromDb } from '../storage.js'
import { performSiteSignin } from '../routes/signin/index.js'
import { siteDisplayName, syncSiteTrafficStats } from '../routes/sites.js'
import { resetStuckRunningTasks, runDueTasks } from '../routes/tasks.js'
import { cleanupExpiredFreeDownloads } from './freeDownloadGuard.js'
import { logger, recordScheduleLog } from './logger.js'
import { syncTorrentIpv6Peers } from './peerSync.js'
import { syncTorrentDownloadStats } from './torrentSync.js'

const SCHEDULER_TICK_INTERVAL_MS = 1000
const TASK_SCAN_INTERVAL_MS = 1000
const TASK_STUCK_CHECK_INTERVAL_MS = 60 * 1000
const TORRENT_DOWNLOAD_STATS_SYNC_INTERVAL_MS = 3000
const TORRENT_IPV6_PEER_SYNC_INTERVAL_MS = 30 * 1000
const EXPIRED_FREE_DOWNLOAD_CLEANUP_INTERVAL_MS = 60 * 1000
const SITE_TRAFFIC_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
const SITE_AUTO_SIGNIN_SCAN_INTERVAL_MS = 60 * 1000

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

function iso(value: number) {
  return new Date(value).toISOString()
}

function readableJobName(name: string) {
  const map: Record<string, string> = {
    'task-auto-run-scan': '自动任务扫描',
    'task-stuck-check': '卡死任务巡检',
    'torrent-download-stats-sync': '种子下载器状态同步',
    'torrent-ipv6-peer-sync': '种子 IPV6 peer 同步',
    'expired-free-download-cleanup': '仅免费下载过期清理',
    'site-traffic-sync': '站点流量统计同步',
    'site-auto-signin': '站点自动签到'
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
      const summary = await syncSiteTrafficStats()
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
    shouldLogSuccess: (result) => Number(result.scheduledCount ?? 0) > 0,
    run: async () => runDueSignins()
  }
]

async function runJob(job: SchedulerJob, scheduledAt: number) {
  const startedAt = Date.now()
  job.running = true
  if (job.logStart !== false) {
    const message = `定时任务【${readableJobName(job.name)}】开始执行`
    logger.info('scheduler', `${job.name} started`, {
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
      logger[status === 'SUCCESS' ? 'info' : 'error']('scheduler', `${job.name} ${status === 'SUCCESS' ? 'succeeded' : 'failed'}`, {
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
    logger.error('scheduler', `${job.name} failed`, {
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

export async function runDueSignins() {
  const sites = (await listSitesFromDb()).filter((site) => site.enabled && site.signinEnabled)
  const now = new Date()
  const todayKey = now.toISOString().slice(0, 10)
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  const due = sites.filter((site) => {
    const match = /^(2[0-3]|[01]\d):([0-5]\d)$/.exec(site.signinTime)
    if (!match) return false
    const targetMinutes = Number(match[1]) * 60 + Number(match[2])
    if (currentMinutes < targetMinutes) return false
    if (site.lastSigninAt && site.lastSigninAt.slice(0, 10) === todayKey) return false
    return true
  })

  if (!due.length) {
    return { scheduledCount: 0, successCount: 0, failedCount: 0, skippedCount: 0, details: [] }
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

  return { scheduledCount: due.length, successCount, failedCount, skippedCount, details }
}

export function startScheduler() {
  if (schedulerTimer) return
  schedulerTimer = setInterval(tick, SCHEDULER_TICK_INTERVAL_MS)
  logger.info('scheduler', 'central scheduler started', {
    tickIntervalMs: SCHEDULER_TICK_INTERVAL_MS,
    jobs: jobs.map((job) => ({
      name: job.name,
      intervalMs: job.intervalMs,
      nextRunAt: iso(job.nextRunAt)
    }))
  })
}
