import { syncSiteTrafficStats } from '../routes/sites.js'
import { runDueTasks } from '../routes/tasks.js'
import { cleanupExpiredFreeDownloads } from './freeDownloadGuard.js'
import { logger, recordScheduleLog } from './logger.js'
import { syncTorrentDownloadStats } from './torrentSync.js'

const SCHEDULER_TICK_INTERVAL_MS = 1000
const TASK_SCAN_INTERVAL_MS = 1000
const TORRENT_DOWNLOAD_STATS_SYNC_INTERVAL_MS = 3000
const EXPIRED_FREE_DOWNLOAD_CLEANUP_INTERVAL_MS = 60 * 1000
const SITE_TRAFFIC_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000

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
    'torrent-download-stats-sync': '种子下载器状态同步',
    'expired-free-download-cleanup': '仅免费下载过期清理',
    'site-traffic-sync': '站点流量统计同步'
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
