import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { findUserById, findUserByUsername, readSystemSettings, updateUserLastLoginAt, updateUserPassword, type UserRecord } from '../storage.js'
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

authRouter.get('/setup-status', async (_req, res) => {
  const admin = await findUserByUsername('admin')
  if (!admin) {
    res.json({ setupRequired: false })
    return
  }
  res.json({ setupRequired: !admin.passwordChangedAt })
})

authRouter.post('/setup', async (req, res) => {
  const admin = await findUserByUsername('admin')
  if (!admin) {
    res.status(500).json({ message: '管理员账号不存在', code: 'ADMIN_NOT_FOUND' })
    return
  }
  if (admin.passwordChangedAt) {
    res.status(400).json({ message: '密码已设置，请使用登录接口', code: 'ALREADY_SETUP' })
    return
  }

  const password = String(req.body?.password ?? '')
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(password)) {
    res.status(400).json({ message: '密码需为 8-64 位，且至少包含字母和数字', code: 'PASSWORD_WEAK' })
    return
  }

  const passwordHash = await createPasswordHash(password)
  const passwordChangedAt = new Date().toISOString()
  await updateUserPassword(admin.id, passwordHash, passwordChangedAt)
  admin.passwordHash = passwordHash
  admin.passwordChangedAt = passwordChangedAt

  await recordOperationLog({
    action: 'AUTH_SETUP_PASSWORD',
    message: '管理员首次设置密码',
    actorId: admin.id,
    actorName: admin.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })

  res.json({ success: true })
})

authRouter.post('/login', async (req, res) => {
  const admin = await findUserByUsername('admin')
  if (admin && !admin.passwordChangedAt) {
    res.status(403).json({ message: '请先设置管理员密码', setupRequired: true })
    return
  }

  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')

  if (!username || !password) {
    res.status(400).json({ message: '用户名和密码不能为空' })
    return
  }

  const user = await findUserByUsername(username)
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

  const lastLoginAt = new Date().toISOString()
  await updateUserLastLoginAt(user.id, lastLoginAt)
  user.lastLoginAt = lastLoginAt
  const settings = await readSystemSettings()
  const sessionToken = setSession(req, res, user.id, settings.sessionTtlHours)
  await recordOperationLog({
    action: 'AUTH_LOGIN',
    message: `用户 ${user.username} 登录成功`,
    actorId: user.id,
    actorName: user.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })
  res.json({ user: toSafeUser(user), sessionToken })
})

authRouter.post('/logout', async (req, res) => {
  const userId = getSessionUserId(req)
  const user = userId ? await findUserById(userId) : undefined
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

  const user = await findUserById(userId)
  if (!user) {
    res.status(401).json({ message: '登录态已过期，请重新登录' })
    return
  }

  res.json({ user: toSafeUser(user) })
})

authRouter.put('/password', requireAuth, async (req, res) => {
  const oldPassword = String(req.body?.oldPassword ?? '')
  const newPassword = String(req.body?.newPassword ?? '')
  if (!oldPassword) {
    res.status(400).json({ message: '旧密码必填', code: 'OLD_PASSWORD_REQUIRED' })
    return
  }
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(newPassword)) {
    res.status(400).json({ message: '新密码需为 8-64 位，且至少包含字母和数字', code: 'NEW_PASSWORD_WEAK' })
    return
  }
  if (oldPassword === newPassword) {
    res.status(400).json({ message: '新密码不能与旧密码相同', code: 'PASSWORD_REUSED' })
    return
  }

  const user = await findUserById(res.locals.user.id)
  if (!user || !(await verifyPassword(oldPassword, user.passwordHash))) {
    res.status(400).json({ message: '旧密码不正确', code: 'OLD_PASSWORD_INVALID' })
    return
  }

  const passwordHash = await createPasswordHash(newPassword)
  const passwordChangedAt = new Date().toISOString()
  await updateUserPassword(user.id, passwordHash, passwordChangedAt)
  user.passwordHash = passwordHash
  user.passwordChangedAt = passwordChangedAt
  await recordOperationLog({
    action: 'AUTH_CHANGE_PASSWORD',
    message: `用户 ${user.username} 修改密码`,
    actorId: user.id,
    actorName: user.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })
  res.json({ success: true, otherSessionsRevoked: true, user: toSafeUser(user) })
})
