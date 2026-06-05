import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState } from '../storage.js'

export const statsRouter = Router()

statsRouter.get('/overview', requireAuth, async (_req, res) => {
  const state = await readState()
  const siteStats = {
    total: state.sites.length,
    online: state.sites.filter((site) => site.connectivityStatus === 'ONLINE').length,
    offline: state.sites.filter((site) => site.connectivityStatus === 'OFFLINE').length,
    authFailed: state.sites.filter((site) => site.connectivityStatus === 'AUTH_FAILED').length,
    unknown: state.sites.filter((site) => site.connectivityStatus === 'UNKNOWN').length
  }
  const risks = [
    {
      type: 'DEFAULT_PASSWORD',
      message: '首次部署后建议尽快修改默认密码',
      actionText: '前往设置',
      actionPath: '/settings'
    },
    {
      type: 'DOWNLOADER_NOT_CONFIGURED',
      message: '下载器尚未配置，种子无法自动推送',
      actionText: '新增下载器',
      actionPath: '/downloaders'
    }
  ]

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

  res.json({
    sites: siteStats,
    torrents: {
      todayNew: 0,
      pushed: 0,
      expiringSoon: 0
    },
    transfer: null,
    risks,
    recentJobs: state.taskLogs.slice(0, 5).map((log) => ({
      name: log.taskName,
      status: log.status,
      summary: log.message,
      finishedAt: log.finishedAt ?? log.createdAt
    })),
    quickActions: [
      { text: '新增站点', path: '/sites?action=create' },
      { text: '新增下载器', path: '/downloaders' },
      { text: '新建任务', path: '/tasks' },
      { text: '查看种子', path: '/torrents' }
    ]
  })
})
