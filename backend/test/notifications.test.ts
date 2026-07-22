import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { formatNotificationTorrentName, formatNotificationTorrentNames, sendIyuuNotification } from '../src/utils/notifications.js'

test('formatNotificationTorrentName normalizes and truncates torrent names', () => {
  assert.equal(formatNotificationTorrentName('  测试   种子  '), '种子名称：测试 种子')
  assert.equal(formatNotificationTorrentName('   '), '种子名称：未知种子')
  assert.equal(formatNotificationTorrentName('a'.repeat(81)), `种子名称：${'a'.repeat(80)}...`)
})

test('formatNotificationTorrentNames lists at most three names and reports the remainder', () => {
  assert.equal(formatNotificationTorrentNames(['A']), '种子名称：\n1. A')
  assert.equal(formatNotificationTorrentNames(['A', 'B', 'C']), '种子名称：\n1. A\n2. B\n3. C')
  assert.equal(formatNotificationTorrentNames(['A', 'B', 'C', 'D', 'E']), '种子名称：\n1. A\n2. B\n3. C\n另有 2 个')
})

test('sendIyuuNotification sends official JSON payload and accepts errcode 0', async () => {
  let requestUrl = ''
  let requestBody = ''
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input)
    requestBody = String(init?.body ?? '')
    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok', data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  const result = await sendIyuuNotification('TESTTOKEN12345678901234567890', '测试标题', '测试内容', { fetchImpl: fetchImpl as typeof fetch })
  assert.equal(result.success, true)
  assert.equal(result.httpStatus, 200)
  assert.equal(result.providerCode, 0)
  assert.equal(requestUrl, 'https://iyuu.cn/TESTTOKEN12345678901234567890.send')
  assert.deepEqual(JSON.parse(requestBody), { text: '测试标题', desp: '测试内容' })
})

test('sendIyuuNotification records provider business failure', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ errcode: 1, errmsg: 'token error' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
  const result = await sendIyuuNotification('TESTTOKEN12345678901234567890', '测试', '内容', { fetchImpl: fetchImpl as typeof fetch })
  assert.equal(result.success, false)
  assert.equal(result.providerCode, 1)
  assert.equal(result.errorMessage, 'token error')
})

test('sendIyuuNotification hides network details from returned errors', async () => {
  const fetchImpl = async () => { throw new Error('request to https://iyuu.cn/SECRET_TOKEN.send failed') }
  const result = await sendIyuuNotification('SECRET_TOKEN', '测试', '内容', { fetchImpl: fetchImpl as typeof fetch })
  assert.equal(result.success, false)
  assert.equal(result.errorMessage, '通知发送失败，请检查网络或渠道配置')
  assert.equal(result.errorMessage?.includes('SECRET_TOKEN'), false)
})
