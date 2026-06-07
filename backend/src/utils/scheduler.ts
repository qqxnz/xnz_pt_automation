import { syncSiteTrafficStats } from '../routes/sites.js'
import { runDueTasks } from '../routes/tasks.js'
import { logger } from './logger.js'
import { syncTorrentDownloadStats } from './torrentSync.js'

const SCHEDULER_TICK_INTERVAL_MS = 1000
const TASK_SCAN_INTERVAL_MS = 1000
const TORRENT_DOWNLOAD_STATS_SYNC_INTERVAL_MS = 3000
const SITE_TRAFFIC_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000

type SchedulerJob = {
  name: string
  intervalMs: number
  nextRunAt: number
  running: boolean
  run: () => Promise<Record<string, unknown>>
}

let schedulerTimer: NodeJS.Timeout | undefined

function iso(value: number) {
  return new Date(value).toISOString()
}

const jobs: SchedulerJob[] = [
  {
    name: 'task-auto-run-scan',
    intervalMs: TASK_SCAN_INTERVAL_MS,
    nextRunAt: Date.now() + TASK_SCAN_INTERVAL_MS,
    running: false,
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
  logger.info('scheduler', `${job.name} started`, {
    job: job.name,
    scheduledAt: iso(scheduledAt),
    triggeredAt: iso(startedAt)
  })

  try {
    const result = await job.run()
    const finishedAt = Date.now()
    job.nextRunAt = finishedAt + job.intervalMs
    logger.info('scheduler', `${job.name} succeeded`, {
      job: job.name,
      durationMs: finishedAt - startedAt,
      nextRunAt: iso(job.nextRunAt),
      result
    })
  } catch (error) {
    const finishedAt = Date.now()
    job.nextRunAt = finishedAt + job.intervalMs
    logger.error('scheduler', `${job.name} failed`, {
      job: job.name,
      durationMs: finishedAt - startedAt,
      nextRunAt: iso(job.nextRunAt),
      error: error instanceof Error ? error.message : String(error)
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
