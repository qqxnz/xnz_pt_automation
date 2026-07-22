import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  deleteNotificationConfigFromDb,
  getNotificationConfigFromDb,
  listLatestNotificationLogsByConfig,
  listNotificationConfigsFromDb,
  saveNotificationConfigInDb,
  type NotificationConfigRecord,
  type NotificationEvent
} from '../storage.js'
import { recordOperationLog } from '../utils/logger.js'
import { sendNotificationToConfig } from '../utils/notifications.js'

export const notificationsRouter = Router()

const notificationEvents: NotificationEvent[] = ['SITE_SIGNIN', 'TASK_TRIGGERED', 'TORRENT_ADDED', 'TORRENT_DELETED']

type NotificationPayload = {
  name?: unknown
  provider?: unknown
  enabled?: unknown
  token?: unknown
  tokenAction?: unknown
  events?: unknown
}

function validateToken(value: string) {
  return /^[A-Za-z0-9]{20,100}$/.test(value)
}

function parsePayload(body: NotificationPayload, existing?: NotificationConfigRecord) {
  const name = String(body.name ?? '').trim()
  if (!name) throw new Error('配置名称不能为空')
  if (name.length > 50) throw new Error('配置名称不能超过 50 个字符')
  const provider = String(body.provider ?? 'IYUU')
  if (provider !== 'IYUU') throw new Error('暂不支持此通知渠道')
  if (typeof body.enabled !== 'boolean') throw new Error('启用状态格式不正确')
  if (!Array.isArray(body.events)) throw new Error('通知事件格式不正确')
  const events = [...new Set(body.events.map(String))] as NotificationEvent[]
  if (!events.length || events.some((event) => !notificationEvents.includes(event))) {
    throw new Error('请至少选择一个有效的通知事件')
  }
  const rawToken = typeof body.token === 'string' ? body.token.trim() : ''
  const keepToken = existing && body.tokenAction !== 'UPDATE'
  const token = keepToken ? existing.token : rawToken
  if (!token) throw new Error('IYUU Token 不能为空')
  if (!validateToken(token)) throw new Error('IYUU Token 格式不正确')
  return { name, provider: 'IYUU' as const, enabled: body.enabled, token, events }
}

function safeConfig(config: NotificationConfigRecord, lastLog?: Awaited<ReturnType<typeof sendNotificationToConfig>>) {
  return {
    id: config.id,
    name: config.name,
    provider: config.provider,
    enabled: config.enabled,
    events: config.events,
    hasToken: Boolean(config.token),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    lastResult: lastLog ? {
      status: lastLog.status,
      event: lastLog.event,
      title: lastLog.title,
      errorMessage: lastLog.errorMessage,
      createdAt: lastLog.createdAt
    } : undefined
  }
}

function actor(req: any, res: any) {
  return { actorId: res.locals.user?.id, actorName: res.locals.user?.username, ip: req.ip, userAgent: req.get('user-agent') }
}

notificationsRouter.get('/', requireAuth, async (_req, res) => {
  const [configs, latest] = await Promise.all([listNotificationConfigsFromDb(), listLatestNotificationLogsByConfig()])
  const items = configs.map((config) => safeConfig(config, latest.get(config.id)))
  res.json({
    items,
    total: items.length,
    stats: {
      total: items.length,
      enabled: items.filter((item) => item.enabled).length,
      failed: items.filter((item) => item.lastResult?.status === 'FAILED').length
    }
  })
})

notificationsRouter.post('/', requireAuth, async (req, res) => {
  try {
    const parsed = parsePayload(req.body ?? {})
    const now = new Date().toISOString()
    const config: NotificationConfigRecord = { id: randomUUID(), ...parsed, createdAt: now, updatedAt: now }
    await saveNotificationConfigInDb(config)
    await recordOperationLog({ action: '新增通知配置', message: `新增通知配置「${config.name}」`, status: 'SUCCESS', ...actor(req, res) })
    res.status(201).json(safeConfig(config))
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : '保存通知配置失败' })
  }
})

notificationsRouter.post('/test-draft', requireAuth, async (req, res) => {
  const existingId = typeof req.body?.id === 'string' ? req.body.id : ''
  const existing = existingId ? await getNotificationConfigFromDb(existingId) : undefined
  if (existingId && !existing) return res.status(404).json({ message: '通知配置不存在' })
  try {
    const parsed = parsePayload(req.body ?? {}, existing)
    const now = new Date().toISOString()
    const config: NotificationConfigRecord = {
      id: existing?.id ?? randomUUID(),
      ...parsed,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    const log = await sendNotificationToConfig(config, {
      event: 'TEST',
      title: 'PT Automation 测试通知',
      message: '这是一条来自 PT Automation 的测试通知。'
    }, { includeConfigId: Boolean(existing) })
    if (log.status === 'FAILED') return res.status(400).json({ success: false, message: log.errorMessage ?? '测试通知发送失败', log })
    res.json({ success: true, message: '测试通知发送成功', log })
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : '测试通知发送失败' })
  }
})

notificationsRouter.put('/:id', requireAuth, async (req, res) => {
  const existing = await getNotificationConfigFromDb(String(req.params.id))
  if (!existing) return res.status(404).json({ message: '通知配置不存在' })
  try {
    const parsed = parsePayload(req.body ?? {}, existing)
    const config: NotificationConfigRecord = { ...existing, ...parsed, updatedAt: new Date().toISOString() }
    await saveNotificationConfigInDb(config)
    await recordOperationLog({ action: '修改通知配置', message: `修改通知配置「${config.name}」`, status: 'SUCCESS', ...actor(req, res) })
    res.json(safeConfig(config))
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : '保存通知配置失败' })
  }
})

notificationsRouter.delete('/:id', requireAuth, async (req, res) => {
  const existing = await getNotificationConfigFromDb(String(req.params.id))
  if (!existing) return res.status(404).json({ message: '通知配置不存在' })
  await deleteNotificationConfigFromDb(existing.id)
  await recordOperationLog({ action: '删除通知配置', message: `删除通知配置「${existing.name}」`, status: 'SUCCESS', ...actor(req, res) })
  res.status(204).send()
})

notificationsRouter.post('/:id/test', requireAuth, async (req, res) => {
  const config = await getNotificationConfigFromDb(String(req.params.id))
  if (!config) return res.status(404).json({ message: '通知配置不存在' })
  const log = await sendNotificationToConfig(config, {
    event: 'TEST',
    title: 'PT Automation 测试通知',
    message: '这是一条来自 PT Automation 的测试通知。'
  })
  if (log.status === 'FAILED') return res.status(400).json({ success: false, message: log.errorMessage ?? '测试通知发送失败', log })
  res.json({ success: true, message: '测试通知发送成功', log })
})
