import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { findUserByUsername, listDownloadersFromDb, listSitesFromDb, listTorrents, queryLogs, readTorrentStats, refreshStoredTorrentFreeStates, type DownloaderRecord, type TaskLogRecord } from '../storage.js'
import { getQbTransferInfo, type QbTransferInfo } from '../utils/qbittorrent.js'
import { verifyPassword } from '../utils/password.js'

export const statsRouter = Router()

type DashboardRisk = {
  type: 'AUTH_FAILED' | 'ALL_OFFLINE' | 'DEFAULT_PASSWORD' | 'DOWNLOADER_NOT_CONFIGURED'
  message: string
  actionText: string
  actionPath: string
}

function localDayStartTime() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return start.getTime()
}

async function readTransferOverview(enabledDownloaders: DownloaderRecord[]) {
  if (!enabledDownloaders.length) return null

  const results = await Promise.allSettled(enabledDownloaders.map((downloader) => getQbTransferInfo(downloader)))
  const transfers = results
    .filter((result): result is PromiseFulfilledResult<QbTransferInfo> => result.status === 'fulfilled')
    .map((result) => result.value)
  if (!transfers.length) return null

  return transfers.reduce(
    (total, transfer) => ({
      uploadSpeed: total.uploadSpeed + transfer.uploadSpeed,
      downloadSpeed: total.downloadSpeed + transfer.downloadSpeed,
      uploadedTotal: total.uploadedTotal + transfer.uploadedTotal,
      downloadedTotal: total.downloadedTotal + transfer.downloadedTotal
    }),
    { uploadSpeed: 0, downloadSpeed: 0, uploadedTotal: 0, downloadedTotal: 0 }
  )
}

statsRouter.get('/overview', requireAuth, async (_req, res) => {
  await refreshStoredTorrentFreeStates()

  const [sites, downloaders, recentLogs] = await Promise.all([
    listSitesFromDb(),
    listDownloadersFromDb(),
    queryLogs<TaskLogRecord>({ type: 'task', page: 1, pageSize: 5 })
  ])

  const siteStats = {
    total: sites.length,
    online: sites.filter((site) => site.connectivityStatus === 'ONLINE').length,
    offline: sites.filter((site) => site.connectivityStatus === 'OFFLINE').length,
    authFailed: sites.filter((site) => site.connectivityStatus === 'AUTH_FAILED').length,
    unknown: sites.filter((site) => site.connectivityStatus === 'UNKNOWN').length
  }
  const risks: DashboardRisk[] = []
  const admin = await findUserByUsername('admin')
  const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD ?? '123456'

  if (admin && await verifyPassword(defaultPassword, admin.passwordHash)) {
    risks.push({
      type: 'DEFAULT_PASSWORD',
      message: '首次部署后建议尽快修改默认密码',
      actionText: '前往设置',
      actionPath: '/settings'
    })
  }

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

  const todayStartTime = localDayStartTime()
  const now = Date.now()
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

  const [todayNew, pushedCount, torrentStats] = await Promise.all([
    listTorrents({ page: 1, pageSize: 1 }),
    listTorrents({ page: 1, pageSize: 1, pushStatus: 'PUSHED' }),
    readTorrentStats()
  ])

  res.json({
    sites: siteStats,
    torrents: {
      todayNew: todayNew.total,
      pushed: pushedCount.total,
      expiringSoon: torrentStats.expiringSoon
    },
    transfer,
    risks,
    recentJobs,
    quickActions: [
      { text: '新增站点', path: '/sites?action=create' },
      { text: '新增下载器', path: '/downloaders' },
      { text: '新建任务', path: '/tasks' },
      { text: '查看种子', path: '/torrents' }
    ]
  })
})
