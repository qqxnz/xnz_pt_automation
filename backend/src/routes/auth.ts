import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readState, type UserRecord, writeState } from '../storage.js'
import { clearSession, getSessionUserId, setSession } from '../utils/session.js'
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
    res.status(401).json({ message: '用户名或密码错误' })
    return
  }

  user.lastLoginAt = new Date().toISOString()
  await writeState(state)
  setSession(res, user.id)
  res.json({ user: toSafeUser(user) })
})

authRouter.post('/logout', (_req, res) => {
  clearSession(res)
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
  res.json({ user: toSafeUser(user) })
})
