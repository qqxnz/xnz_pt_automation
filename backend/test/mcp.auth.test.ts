import { strict as assert } from 'node:assert'
import { test, before, after, beforeEach } from 'node:test'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const tmpDir = path.join('/tmp', `xnz-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
process.env.DATA_DIR = tmpDir
process.env.NODE_ENV = 'test'

const storage = await import('../src/storage.js')
const auth = await import('../src/mcp/auth.js')
const errors = await import('../src/mcp/errors.js')

before(async () => {
  mkdirSync(tmpDir, { recursive: true })
  await storage.initializeStorage()
})

after(async () => {
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

beforeEach(async () => {
  await storage.resetForTest?.()
  // 清掉 api_tokens（如果存在）
  const items = await storage.listApiTokensFromDb()
  for (const item of items) {
    await storage.deleteApiTokenFromDb(item.id)
  }
})

async function makeToken(overrides: Partial<{ name: string; enabled: boolean; allowWrites: boolean; expiresAt: string; tokenValue: string }> = {}) {
  const plaintext = overrides.tokenValue ?? storage.generateApiTokenPlaintext()
  const { createPasswordHash } = await import('../src/utils/password.js')
  const tokenHash = await createPasswordHash(plaintext)
  const id = `tki_${Math.random().toString(36).slice(2, 14)}`
  const record = {
    id,
    name: overrides.name ?? 'test',
    tokenHash,
    tokenPrefix: plaintext.slice(0, storage.API_TOKEN_PREFIX_LENGTH),
    enabled: overrides.enabled ?? true,
    allowWrites: overrides.allowWrites ?? false,
    createdAt: new Date().toISOString(),
    lastUsedAt: undefined,
    expiresAt: overrides.expiresAt,
    notes: undefined
  }
  await storage.insertApiTokenToDb(record)
  return { record, plaintext }
}

test('generateApiTokenPlaintext produces tk_ prefixed strings of expected length', () => {
  const value = storage.generateApiTokenPlaintext()
  assert.ok(value.startsWith('tk_'), 'must start with tk_')
  assert.ok(value.length >= 32, 'should be at least 32 chars')
})

test('verifyApiToken returns ok:true for matching token', async () => {
  const { plaintext, record } = await makeToken({ allowWrites: false })
  const result = await storage.verifyApiToken(plaintext)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.token.id, record.id)
    assert.equal(result.token.tokenPrefix, plaintext.slice(0, storage.API_TOKEN_PREFIX_LENGTH))
  }
})

test('verifyApiToken returns NOT_FOUND for wrong plaintext', async () => {
  await makeToken({ name: 'other' })
  const result = await storage.verifyApiToken('tk_does-not-exist')
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'NOT_FOUND')
})

test('verifyApiToken returns DISABLED for disabled token', async () => {
  const { plaintext } = await makeToken({ enabled: false })
  const result = await storage.verifyApiToken(plaintext)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'DISABLED')
})

test('verifyApiToken returns EXPIRED for past expiresAt', async () => {
  const { plaintext } = await makeToken({ expiresAt: '2000-01-01T00:00:00.000Z' })
  const result = await storage.verifyApiToken(plaintext)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'EXPIRED')
})

test('assertWriteAllowed rejects read-only tokens', async () => {
  const { record } = await makeToken({ allowWrites: false })
  assert.throws(() => auth.assertWriteAllowed(record), (err) => {
    return err instanceof errors.McpForbiddenError && err.code === -32002
  })
})

test('assertWriteAllowed allows tokens with allowWrites=true', async () => {
  const { record } = await makeToken({ allowWrites: true })
  assert.doesNotThrow(() => auth.assertWriteAllowed(record))
})

test('assertWriteAllowed rejects disabled tokens even with allowWrites', async () => {
  const { record } = await makeToken({ allowWrites: true, enabled: false })
  assert.throws(() => auth.assertWriteAllowed(record), errors.McpForbiddenError)
})

test('updateApiTokenInDb persists allowWrites toggle', async () => {
  const { record, plaintext } = await makeToken({ allowWrites: false })
  const next = { ...record, allowWrites: true }
  await storage.updateApiTokenInDb(next)
  const result = await storage.verifyApiToken(plaintext)
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.token.allowWrites, true)
})

test('touchApiTokenLastUsed updates timestamp', async () => {
  const { record } = await makeToken()
  const ts = '2024-05-01T00:00:00.000Z'
  await storage.touchApiTokenLastUsed(record.id, ts)
  const items = await storage.listApiTokensFromDb()
  const found = items.find((t) => t.id === record.id)
  assert.ok(found)
  assert.equal(found?.lastUsedAt, ts)
})

test('deleteApiTokenFromDb removes record', async () => {
  const { record, plaintext } = await makeToken({ name: 'soon-gone' })
  const removed = await storage.deleteApiTokenFromDb(record.id)
  assert.equal(removed, true)
  const result = await storage.verifyApiToken(plaintext)
  assert.equal(result.ok, false)
})

test('errors: withTimeout rejects after ms', async () => {
  const start = Date.now()
  await assert.rejects(
    errors.withTimeout(new Promise((resolve) => setTimeout(resolve, 200)), 50, 'test'),
    (err) => err instanceof errors.McpTimeoutError
  )
  assert.ok(Date.now() - start < 200)
})

test('errors: withTimeout passes through fast result', async () => {
  const result = await errors.withTimeout(Promise.resolve('ok'), 1000)
  assert.equal(result, 'ok')
})