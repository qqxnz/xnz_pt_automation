import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState } from '../storage.js'

export const proxiesRouter = Router()

proxiesRouter.get('/', requireAuth, async (_req, res) => {
  const state = await readState()
  res.json({
    items: state.proxies.map(({ password: _password, ...proxy }) => proxy)
  })
})
