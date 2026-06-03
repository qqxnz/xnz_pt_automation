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
        type: 'QB_NOT_CONFIGURED',
        message: 'qBittorrent 尚未配置，免费种子无法自动推送',
        actionText: '配置 qBittorrent',
        actionPath: '/qbittorrent'
      }
    ],
    recentJobs: [],
    quickActions: [
      { text: '新增站点', path: '/sites' },
      { text: '同步免费种子', path: '/free-torrents' },
      { text: '配置 qBittorrent', path: '/qbittorrent' }
    ]
  })
})
