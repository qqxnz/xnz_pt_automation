import type { Request, Response, NextFunction } from 'express'
import { findUserById } from '../storage.js'
import { getSessionUserId } from '../utils/session.js'

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = getSessionUserId(req)
  if (!userId) {
    res.status(401).json({ message: '登录态已过期，请重新登录' })
    return
  }

  const user = await findUserById(userId)
  if (!user) {
    res.status(401).json({ message: '登录态已过期，请重新登录' })
    return
  }

  res.locals.user = user
  next()
}
