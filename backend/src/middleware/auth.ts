import type { Request, Response, NextFunction } from 'express'
import { readState } from '../storage.js'
import { getSessionUserId } from '../utils/session.js'

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = getSessionUserId(req)
  if (!userId) {
    res.status(401).json({ message: '登录态已过期，请重新登录' })
    return
  }

  const state = await readState()
  const user = state.users.find((item) => item.id === userId)
  if (!user) {
    res.status(401).json({ message: '登录态已过期，请重新登录' })
    return
  }

  res.locals.user = user
  next()
}
