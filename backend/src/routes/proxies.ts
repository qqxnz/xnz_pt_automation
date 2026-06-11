import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listProxiesFromDb } from '../storage.js'

export const proxiesRouter = Router()

proxiesRouter.get('/', requireAuth, async (_req, res) => {
  const items = await listProxiesFromDb()
  res.json({
    items: items.map(({ password: _password, ...proxy }) => proxy)
  })
})
