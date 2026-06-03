import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

export const statsRouter = Router()

statsRouter.get('/overview', requireAuth, (_req, res) => {
  res.json({
    sites: {
      total: 0,
      online: 0,
      offline: 0,
      authFailed: 0,
      unknown: 0
    },
    torrents: {
      todayNew: 0,
      pushed: 0,
      expiringSoon: 0
    },
    transfer: null,
    risks: [
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
    ],
    recentJobs: [],
    quickActions: [
      { text: '新增站点', path: '/sites' },
      { text: '新增下载器', path: '/downloaders' },
      { text: '新建任务', path: '/tasks' },
      { text: '查看种子', path: '/torrents' }
    ]
  })
})
