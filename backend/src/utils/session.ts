import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'

const cookieName = 'pt_session'
const secret = process.env.SESSION_SECRET ?? 'dev-session-secret-change-me'
const cookieSecureMode = (process.env.SESSION_COOKIE_SECURE ?? 'auto').toLowerCase()

function sign(value: string) {
  return createHmac('sha256', secret).update(value).digest('hex')
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function shouldUseSecureCookie(req: Request) {
  if (cookieSecureMode === 'true') return true
  if (cookieSecureMode === 'false') return false

  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  return req.secure || forwardedProto === 'https'
}

function createSessionToken(userId: string, ttlHours: number) {
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      nonce: randomBytes(8).toString('hex'),
      expiresAt: Date.now() + ttlHours * 60 * 60 * 1000
    })
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

function readSessionToken(token: unknown) {
  if (typeof token !== 'string') return undefined

  const [payload, signature] = token.split('.')
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return undefined

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      userId?: string
      expiresAt?: number
    }
    if (typeof parsed.expiresAt === 'number' && parsed.expiresAt < Date.now()) return undefined
    return parsed.userId
  } catch {
    return undefined
  }
}

function getBearerToken(req: Request) {
  const authorization = req.get('authorization')
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

export function setSession(req: Request, res: Response, userId: string, ttlHours = 168) {
  const token = createSessionToken(userId, ttlHours)
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(req),
    maxAge: ttlHours * 60 * 60 * 1000,
    path: '/'
  })
  return token
}

export function clearSession(res: Response) {
  res.clearCookie(cookieName, { path: '/' })
}

export function getSessionUserId(req: Request) {
  return readSessionToken(req.cookies?.[cookieName]) ?? readSessionToken(getBearerToken(req))
}
