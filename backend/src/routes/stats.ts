import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getLatestScheduleLogPerJob, listDownloadersFromDb, listLatestSigninLogBySiteAndDate, listSitesFromDb, listTasksFromDb, queryLogs, readSiteStatistics, readTorrentStats, refreshStoredTorrentFreeStates, type DownloaderRecord, type SigninLogRecord, type SiteRecord, type TaskLogRecord } from '../storage.js'
import { getQbTransferInfo, type QbTransferInfo } from '../utils/qbittorrent.js'
import { getSchedulerJobs } from '../utils/scheduler.js'
import { isoOnLocalDate, localDateKey } from '../utils/time.js'

export const statsRouter = Router()

type DashboardRisk = {
  type: 'AUTH_FAILED' | 'ALL_OFFLINE' | 'DOWNLOADER_NOT_CONFIGURED'
  message: string
  actionText: string
  actionPath: string
}

async function readTransferOverview(enabledDownloaders: DownloaderRecord[]) {
  const results = await Promise.allSettled(enabledDownloaders.map((downloader) => getQbTransferInfo(downloader)))
  const byDownloader = new Map<string, QbTransferInfo>()
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') byDownloader.set(enabledDownloaders[index].id, result.value)
  })

  const total = [...byDownloader.values()].reduce(
    (summary, transfer) => ({
      uploadSpeed: summary.uploadSpeed + transfer.uploadSpeed,
      downloadSpeed: summary.downloadSpeed + transfer.downloadSpeed
    }),
    { uploadSpeed: 0, downloadSpeed: 0 }
  )

  return { byDownloader, total }
}

statsRouter.get('/overview', requireAuth, async (_req, res) => {
  await refreshStoredTorrentFreeStates()

  const [sites, downloaders, tasks, recentLogs, torrentStats, latestScheduleLogs] = await Promise.all([
    listSitesFromDb(),
    listDownloadersFromDb(),
    listTasksFromDb(),
    queryLogs<TaskLogRecord>({ type: 'task', page: 1, pageSize: 5 }),
    readTorrentStats(),
    getLatestScheduleLogPerJob()
  ])

  const today = localDateKey()
  const todaySigninLogs = await Promise.all(sites.map((site) => listLatestSigninLogBySiteAndDate(site.id, today)))

  // 判定函数：当日是否已签到（日志缺失时回退到 sites.lastSigninAt + lastSigninStatus）
  const judgeSignedToday = (site: SiteRecord, log: SigninLogRecord | undefined): { signed: boolean; status?: string } => {
    if (log) return { signed: true, status: log.status }
    if (site.lastSigninStatus && isoOnLocalDate(site.lastSigninAt, today)) {
      return { signed: true, status: site.lastSigninStatus }
    }
    return { signed: false }
  }
  const signinJudgments = sites.map((site, index) => judgeSignedToday(site, todaySigninLogs[index]))

  const siteStats = {
    total: sites.length,
    online: sites.filter((site) => site.connectivityStatus === 'ONLINE').length,
    offline: sites.filter((site) => site.connectivityStatus === 'OFFLINE').length,
    authFailed: sites.filter((site) => site.connectivityStatus === 'AUTH_FAILED').length,
    unknown: sites.filter((site) => site.connectivityStatus === 'UNKNOWN').length,
    signinEnabled: sites.filter((site) => site.signinEnabled).length,
    todaySigninSuccess: signinJudgments.filter((judgment) => judgment.status === 'SUCCESS' || judgment.status === 'SKIPPED').length,
    todaySigninFailed: signinJudgments.filter((judgment) => judgment.status === 'FAILED').length,
    todaySigninPending: sites.filter((site, index) => site.signinEnabled && !signinJudgments[index].signed).length
  }
  const risks: DashboardRisk[] = []

  if (downloaders.length === 0) {
    risks.push({
      type: 'DOWNLOADER_NOT_CONFIGURED',
      message: '下载器尚未配置，种子无法自动推送',
      actionText: '新增下载器',
      actionPath: '/downloaders'
    })
  }

  if (siteStats.total > 0 && siteStats.authFailed > 0) {
    risks.unshift({
      type: 'AUTH_FAILED',
      message: '存在认证失败站点，请更新访问凭证',
      actionText: '查看站点',
      actionPath: '/sites?connectivityStatus=AUTH_FAILED'
    })
  }

  if (siteStats.total > 0 && siteStats.online === 0) {
    risks.unshift({
      type: 'ALL_OFFLINE',
      message: '所有站点当前不可连接，请检查网络或凭证',
      actionText: '测试站点',
      actionPath: '/sites'
    })
  }

  const transfer = await readTransferOverview(downloaders.filter((downloader) => downloader.enabled))
  const recentJobs = recentLogs.items
    .map((log) => ({
      id: log.id,
      name: log.taskName,
      status: log.status,
      summary: log.message,
      createdAt: log.createdAt,
      runMode: log.runMode,
      startedAt: log.startedAt,
      finishedAt: log.finishedAt ?? log.createdAt,
      fetchedCount: log.fetchedCount,
      matchedCount: log.matchedCount,
      pushedCount: log.pushedCount,
      pushFailedCount: log.pushFailedCount
    }))
  const allTimeTraffic = await readSiteStatistics({ startDate: '1970-01-01', endDate: '2999-12-31', page: 1, pageSize: 1 })
  const todayTraffic = await readSiteStatistics({ startDate: today, endDate: today, page: 1, pageSize: 1 })

  res.json({
    sites: siteStats,
    downloaders: {
      total: downloaders.length,
      online: downloaders.filter((downloader) => downloader.status === 'ONLINE').length,
      offline: downloaders.filter((downloader) => downloader.status === 'OFFLINE').length,
      authFailed: downloaders.filter((downloader) => downloader.status === 'AUTH_FAILED').length,
      unknown: downloaders.filter((downloader) => downloader.status === 'UNKNOWN').length,
      items: downloaders.map((downloader) => {
        const speed = transfer.byDownloader.get(downloader.id)
        return {
          id: downloader.id,
          name: downloader.name,
          type: downloader.type,
          status: speed ? 'ONLINE' : downloader.status,
          uploadSpeed: speed?.uploadSpeed ?? 0,
          downloadSpeed: speed?.downloadSpeed ?? 0
        }
      })
    },
    tasks: {
      total: tasks.length,
      autoRunEnabled: tasks.filter((task) => task.autoRunEnabled).length,
      running: tasks.filter((task) => task.running).length,
      failed: tasks.filter((task) => task.lastStatus === 'FAILED').length,
      recent: recentJobs
    },
    torrents: {
      total: torrentStats.total,
      running: torrentStats.running,
      notRunning: torrentStats.notRunning,
      totalUploaded: torrentStats.totalUploaded,
      totalDownloaded: torrentStats.totalDownloaded
    },
    traffic: {
      uploadedTotal: allTimeTraffic.allTimeUploaded,
      downloadedTotal: allTimeTraffic.allTimeDownloaded,
      todayUploaded: todayTraffic.totalUploaded,
      todayDownloaded: todayTraffic.totalDownloaded
    },
    scheduler: {
      jobs: getSchedulerJobs().map((job) => {
        const latest = latestScheduleLogs.get(job.name)
        return {
          ...job,
          lastStatus: latest?.status,
          lastRunAt: latest?.finishedAt
        }
      })
    },
    risks,
    quickActions: [
      { text: '新增站点', path: '/sites?action=create' },
      { text: '新增下载器', path: '/downloaders' },
      { text: '新建任务', path: '/tasks' },
      { text: '查看种子', path: '/torrents' }
    ]
  })
})
