import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState } from '../storage.js'
import { logger } from '../utils/logger.js'

export const logsRouter = Router()

logsRouter.get('/', requireAuth, async (req, res) => {
  const requestedType = String(req.query.type ?? 'operation')
  const type = requestedType === 'task' ? 'task' : 'operation'
  const rawPage = Number(req.query.page ?? 1)
  const rawPageSize = Number(req.query.pageSize ?? 20)
  const page = Number.isFinite(rawPage) ? Math.max(Math.floor(rawPage), 1) : 1
  const pageSize = Number.isFinite(rawPageSize) ? Math.min(Math.max(Math.floor(rawPageSize), 1), 100) : 20
  const state = await readState()
  const source = type === 'task' ? state.taskLogs : state.operationLogs
  const start = (page - 1) * pageSize
  const items = source.slice(start, start + pageSize)

  logger.info('logs', '查询日志列表', {
    type,
    page,
    pageSize,
    total: source.length,
    actorName: res.locals.user?.username
  })

  res.json({
    type,
    page,
    pageSize,
    total: source.length,
    items
  })
})
