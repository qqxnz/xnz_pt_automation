import { createHmac } from 'node:crypto'
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Request, Response } from 'express'

import { getSessionUserId, setSession } from '../src/utils/session.js'

const sessionSecret = process.env.SESSION_SECRET ?? 'dev-session-secret-change-me'

function requestWithToken(token?: string, source: 'cookie' | 'bearer' = 'bearer') {
  return {
    cookies: source === 'cookie' && token ? { pt_session: token } : {},
    get(name: string) {
      if (name.toLowerCase() === 'authorization' && source === 'bearer' && token) return `Bearer ${token}`
      return undefined
    },
    secure: false
  } as unknown as Request
}

function signedToken(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', sessionSecret).update(encoded).digest('hex')
  return `${encoded}.${signature}`
}

test('setSession creates a token without expiry and a session cookie without maxAge', () => {
  let cookieValue = ''
  let cookieOptions: Record<string, unknown> = {}
  const response = {
    cookie(_name: string, value: string, options: Record<string, unknown>) {
      cookieValue = value
      cookieOptions = options
    }
  } as unknown as Response

  const token = setSession(requestWithToken(), response, 'admin')
  const [payload] = token.split('.')
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>

  assert.equal(cookieValue, token)
  assert.equal(decoded.userId, 'admin')
  assert.equal('expiresAt' in decoded, false)
  assert.equal('maxAge' in cookieOptions, false)
  assert.equal(getSessionUserId(requestWithToken(token, 'cookie')), 'admin')
  assert.equal(getSessionUserId(requestWithToken(token, 'bearer')), 'admin')
})

test('legacy signed tokens remain valid after their historical expiresAt', () => {
  const token = signedToken({ userId: 'admin', nonce: 'legacy', expiresAt: 0 })
  assert.equal(getSessionUserId(requestWithToken(token)), 'admin')
})

test('invalid or malformed tokens are rejected', () => {
  const token = signedToken({ userId: 'admin', nonce: 'valid' })
  assert.equal(getSessionUserId(requestWithToken(`${token}broken`)), undefined)
  assert.equal(getSessionUserId(requestWithToken('not-a-session-token')), undefined)
})
