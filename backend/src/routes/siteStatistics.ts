import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readSiteStatistics } from '../storage.js'

export const siteStatisticsRouter = Router()

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime())
}

siteStatisticsRouter.get('/', requireAuth, async (req, res) => {
  const startDate = String(req.query.startDate ?? '')
  const endDate = String(req.query.endDate ?? '')
  if (!validDate(startDate) || !validDate(endDate)) {
    return res.status(400).json({ message: '请选择有效的开始和结束日期' })
  }
  if (startDate > endDate) {
    return res.status(400).json({ message: '开始日期不能晚于结束日期' })
  }

  const page = Math.max(Number(req.query.page ?? 1), 1)
  const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20), 1), 100)
  const siteId = String(req.query.siteId ?? '').trim() || undefined
  res.json(await readSiteStatistics({ startDate, endDate, siteId, page, pageSize }))
})
