import type { Request, Response, NextFunction } from 'express'
import { findUserById, findUserByUsername } from '../storage.js'
import { getSessionUserId } from '../utils/session.js'

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = getSessionUserId(req)
  if (!userId) {
    res.status(401).json({ message: '未登录或登录凭据无效，请重新登录' })
    return
  }

  const user = await findUserById(userId)
  if (!user) {
    res.status(401).json({ message: '未登录或登录凭据无效，请重新登录' })
    return
  }

  res.locals.user = user
  next()
}

const SETUP_ALLOWED = ['/api/auth/setup-status', '/api/auth/setup', '/api/health']

export async function requireSetup(req: Request, res: Response, next: NextFunction) {
  if (SETUP_ALLOWED.includes(req.path)) return next()

  if (req.path.startsWith('/api/')) {
    const admin = await findUserByUsername('admin')
    if (admin && !admin.passwordChangedAt) {
      res.status(403).json({ message: '请先设置管理员密码', setupRequired: true })
      return
    }
  }

  next()
}
