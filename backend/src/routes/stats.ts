import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState, type TorrentRecord, writeState } from '../storage.js'
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

function validTime(value?: string) {
  if (!value) return undefined
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? undefined : time
}

function refreshTorrentFreeState(torrent: TorrentRecord, expiringSoonMinutes = 120) {
  if (!torrent.freeEndAt || torrent.pushStatus === 'DELETED') return false
  const freeEndTime = validTime(torrent.freeEndAt)
  if (freeEndTime === undefined) return false

  const previousState = torrent.currentState
  const previousFreeNow = torrent.isFreeNow
  const now = Date.now()
  if (freeEndTime <= now) {
    torrent.isFreeNow = false
    torrent.currentState = 'EXPIRED'
  } else {
    torrent.isFreeNow = true
    if (freeEndTime - now <= expiringSoonMinutes * 60_000) {
      torrent.currentState = 'EXPIRING_SOON'
    } else if (torrent.pushStatus === 'PUSHED') {
      torrent.currentState = 'PUSHED'
    } else if (torrent.pushStatus === 'PUSH_FAILED') {
      torrent.currentState = 'PUSH_FAILED'
    } else {
      torrent.currentState = 'FREE_NOW'
    }
  }
  return previousState !== torrent.currentState || previousFreeNow !== torrent.isFreeNow
}

function refreshTorrentFreeStates(state: Awaited<ReturnType<typeof readState>>) {
  let changed = false
  for (const torrent of state.torrents) {
    const task = state.tasks.find((item) => item.id === torrent.sourceTaskId)
    changed = refreshTorrentFreeState(torrent, task?.expiringSoonMinutes ?? 120) || changed
  }
  return changed
}

async function readTransferOverview(state: Awaited<ReturnType<typeof readState>>) {
  const enabledDownloaders = state.downloaders.filter((downloader) => downloader.enabled)
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
  const state = await readState()
  const torrentStateChanged = refreshTorrentFreeStates(state)
  if (torrentStateChanged) await writeState(state)

  const siteStats = {
    total: state.sites.length,
    online: state.sites.filter((site) => site.connectivityStatus === 'ONLINE').length,
    offline: state.sites.filter((site) => site.connectivityStatus === 'OFFLINE').length,
    authFailed: state.sites.filter((site) => site.connectivityStatus === 'AUTH_FAILED').length,
    unknown: state.sites.filter((site) => site.connectivityStatus === 'UNKNOWN').length
  }
  const risks: DashboardRisk[] = []
  const admin = state.users.find((user) => user.username === 'admin')
  const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD ?? '123456'

  if (admin && await verifyPassword(defaultPassword, admin.passwordHash)) {
    risks.push({
      type: 'DEFAULT_PASSWORD',
      message: '首次部署后建议尽快修改默认密码',
      actionText: '前往设置',
      actionPath: '/settings'
    })
  }

  if (state.downloaders.length === 0) {
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
  const transfer = await readTransferOverview(state)
  const recentJobs = [...state.taskLogs]
    .sort((a, b) => (validTime(b.finishedAt ?? b.createdAt) ?? 0) - (validTime(a.finishedAt ?? a.createdAt) ?? 0))
    .slice(0, 5)
    .map((log) => ({
      id: log.id,
      name: log.taskName,
      status: log.status,
      summary: log.message,
      finishedAt: log.finishedAt ?? log.createdAt
    }))

  res.json({
    sites: siteStats,
    torrents: {
      todayNew: state.torrents.filter((torrent) => (validTime(torrent.firstSeenAt) ?? 0) >= todayStartTime).length,
      pushed: state.torrents.filter((torrent) => torrent.pushStatus === 'PUSHED').length,
      expiringSoon: state.torrents.filter((torrent) => {
        const freeEndTime = validTime(torrent.freeEndAt)
        return freeEndTime !== undefined && freeEndTime > now && torrent.currentState === 'EXPIRING_SOON'
      }).length
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
