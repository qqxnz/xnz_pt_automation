import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState, type UserRecord, writeState } from '../storage.js'
import { clearSession, getSessionUserId, setSession } from '../utils/session.js'
import { recordOperationLog } from '../utils/logger.js'
import { createPasswordHash, verifyPassword } from '../utils/password.js'

export const authRouter = Router()

function toSafeUser(user: UserRecord) {
  return {
    id: user.id,
    username: user.username,
    passwordChangedAt: user.passwordChangedAt,
    lastLoginAt: user.lastLoginAt
  }
}

authRouter.post('/login', async (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')

  if (!username || !password) {
    res.status(400).json({ message: '用户名和密码不能为空' })
    return
  }

  const state = await readState()
  const user = state.users.find((item) => item.username === username)
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await recordOperationLog({
      action: 'AUTH_LOGIN',
      message: `用户 ${username || '未知用户'} 登录失败`,
      actorName: username || undefined,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      status: 'FAILED'
    })
    res.status(401).json({ message: '用户名或密码错误' })
    return
  }

  user.lastLoginAt = new Date().toISOString()
  await writeState(state)
  setSession(res, user.id)
  await recordOperationLog({
    action: 'AUTH_LOGIN',
    message: `用户 ${user.username} 登录成功`,
    actorId: user.id,
    actorName: user.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })
  res.json({ user: toSafeUser(user) })
})

authRouter.post('/logout', async (req, res) => {
  const userId = getSessionUserId(req)
  const state = userId ? await readState() : undefined
  const user = state?.users.find((item) => item.id === userId)
  clearSession(res)
  await recordOperationLog({
    action: 'AUTH_LOGOUT',
    message: `用户 ${user?.username ?? '未知用户'} 退出登录`,
    actorId: user?.id,
    actorName: user?.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })
  res.json({ ok: true })
})

authRouter.get('/me', async (req, res) => {
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

  res.json({ user: toSafeUser(user) })
})

authRouter.put('/password', requireAuth, async (req, res) => {
  const oldPassword = String(req.body?.oldPassword ?? '')
  const newPassword = String(req.body?.newPassword ?? '')
  if (!oldPassword || !newPassword) {
    res.status(400).json({ message: '原密码和新密码不能为空' })
    return
  }

  const state = await readState()
  const user = state.users.find((item) => item.id === res.locals.user.id)
  if (!user || !(await verifyPassword(oldPassword, user.passwordHash))) {
    res.status(400).json({ message: '原密码不正确' })
    return
  }

  user.passwordHash = await createPasswordHash(newPassword)
  user.passwordChangedAt = new Date().toISOString()
  await writeState(state)
  await recordOperationLog({
    action: 'AUTH_CHANGE_PASSWORD',
    message: `用户 ${user.username} 修改密码`,
    actorId: user.id,
    actorName: user.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })
  res.json({ user: toSafeUser(user) })
})
