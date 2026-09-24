import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  API_TOKEN_PREFIX_LENGTH,
  deleteApiTokenFromDb,
  generateApiTokenPlaintext,
  getApiTokenFromDb,
  insertApiTokenToDb,
  listApiTokensFromDb,
  updateApiTokenInDb,
  type ApiTokenRecord
} from '../storage.js'
import { createPasswordHash } from '../utils/password.js'
import { recordOperationLog } from '../utils/logger.js'

export const mcpTokensRouter = Router()

function operationActor(res: { locals: { user?: { id?: string; username?: string } } }, req: { ip?: string; get(name: string): string | undefined }) {
  return {
    actorId: res.locals.user?.id,
    actorName: res.locals.user?.username,
    ip: req.ip,
    userAgent: req.get('user-agent')
  }
}

function toPublicToken(token: ApiTokenRecord) {
  return {
    id: token.id,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    enabled: token.enabled,
    allowWrites: token.allowWrites,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    expiresAt: token.expiresAt,
    notes: token.notes
  }
}

function generateTokenId() {
  // 12位随机 id：tk_xxx 与 prefix 不会撞，且避免暴露计数
  return `tki_${Math.random().toString(36).slice(2, 6)}${Math.random().toString(36).slice(2, 10)}`
}

function isValidTokenName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length >= 1 && trimmed.length <= 64
}

mcpTokensRouter.get('/', requireAuth, async (_req, res) => {
  const tokens = await listApiTokensFromDb()
  res.json({ items: tokens.map(toPublicToken) })
})

mcpTokensRouter.post('/', requireAuth, async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const allowWrites = Boolean(req.body?.allowWrites)
  const expiresAt = req.body?.expiresAt ? String(req.body.expiresAt) : undefined
  const notes = req.body?.notes ? String(req.body.notes) : undefined

  if (!isValidTokenName(name)) {
    res.status(400).json({ message: 'Token 名称需为 1-64 字', code: 'INVALID_TOKEN_NAME' })
    return
  }
  if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
    res.status(400).json({ message: '过期时间格式不正确', code: 'INVALID_EXPIRES_AT' })
    return
  }

  const plaintext = generateApiTokenPlaintext()
  const tokenHash = await createPasswordHash(plaintext)
  const id = generateTokenId()
  const prefix = plaintext.slice(0, API_TOKEN_PREFIX_LENGTH)
  const createdAt = new Date().toISOString()
  const record: ApiTokenRecord = {
    id,
    name,
    tokenHash,
    tokenPrefix: prefix,
    enabled: true,
    allowWrites,
    createdAt,
    lastUsedAt: undefined,
    expiresAt,
    notes
  }
  await insertApiTokenToDb(record)

  await recordOperationLog({
    action: 'MCP_TOKEN_CREATE',
    message: `新建 MCP Token：${name}${allowWrites ? '（含写权限）' : '（只读）'}`,
    actorId: res.locals.user.id,
    actorName: res.locals.user.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })

  // plaintext 仅在创建时返回一次
  res.json({ token: toPublicToken(record), plaintext })
})

mcpTokensRouter.patch('/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id)
  const existing = await getApiTokenFromDb(id)
  if (!existing) {
    res.status(404).json({ message: 'Token 不存在', code: 'TOKEN_NOT_FOUND' })
    return
  }

  const patch: Partial<ApiTokenRecord> = {}
  if (req.body?.name !== undefined) {
    if (!isValidTokenName(req.body.name)) {
      res.status(400).json({ message: 'Token 名称需为 1-64 字', code: 'INVALID_TOKEN_NAME' })
      return
    }
    patch.name = String(req.body.name).trim()
  }
  if (req.body?.enabled !== undefined) {
    patch.enabled = Boolean(req.body.enabled)
  }
  if (req.body?.allowWrites !== undefined) {
    patch.allowWrites = Boolean(req.body.allowWrites)
  }
  if (req.body?.expiresAt !== undefined) {
    if (req.body.expiresAt === null) {
      patch.expiresAt = undefined
    } else {
      const value = String(req.body.expiresAt)
      if (Number.isNaN(new Date(value).getTime())) {
        res.status(400).json({ message: '过期时间格式不正确', code: 'INVALID_EXPIRES_AT' })
        return
      }
      patch.expiresAt = value
    }
  }
  if (req.body?.notes !== undefined) {
    patch.notes = req.body.notes === null ? undefined : String(req.body.notes)
  }

  const next: ApiTokenRecord = { ...existing, ...patch }
  await updateApiTokenInDb(next)

  await recordOperationLog({
    action: 'MCP_TOKEN_UPDATE',
    message: `更新 MCP Token：${next.name}`,
    actorId: res.locals.user.id,
    actorName: res.locals.user.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })

  res.json({ token: toPublicToken(next) })
})

mcpTokensRouter.delete('/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id)
  const existing = await getApiTokenFromDb(id)
  if (!existing) {
    res.status(404).json({ message: 'Token 不存在', code: 'TOKEN_NOT_FOUND' })
    return
  }
  await deleteApiTokenFromDb(id)

  await recordOperationLog({
    action: 'MCP_TOKEN_DELETE',
    message: `删除 MCP Token：${existing.name}`,
    actorId: res.locals.user.id,
    actorName: res.locals.user.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })

  res.json({ success: true })
})