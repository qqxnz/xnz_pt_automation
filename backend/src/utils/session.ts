import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'

const cookieName = 'pt_session'
const secret = process.env.SESSION_SECRET ?? 'dev-session-secret-change-me'

function sign(value: string) {
  return createHmac('sha256', secret).update(value).digest('hex')
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function setSession(res: Response, userId: string, ttlHours = 168) {
  const payload = Buffer.from(JSON.stringify({ userId, nonce: randomBytes(8).toString('hex') })).toString('base64url')
  res.cookie(cookieName, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ttlHours * 60 * 60 * 1000,
    path: '/'
  })
}

export function clearSession(res: Response) {
  res.clearCookie(cookieName, { path: '/' })
}

export function getSessionUserId(req: Request) {
  const token = req.cookies?.[cookieName]
  if (typeof token !== 'string') return undefined

  const [payload, signature] = token.split('.')
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return undefined

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { userId?: string }
    return parsed.userId
  } catch {
    return undefined
  }
}
