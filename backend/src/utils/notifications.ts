import {
  appendNotificationLog,
  listNotificationConfigsFromDb,
  type NotificationConfigRecord,
  type NotificationEvent,
  type NotificationLogRecord
} from '../storage.js'
import { logger } from './logger.js'

type IyuuResponse = {
  errcode?: number
  errmsg?: string
}

export type NotificationMessage = {
  event: NotificationEvent
  title: string
  message: string
}

export type NotificationSendResult = {
  success: boolean
  httpStatus?: number
  providerCode?: number
  providerMessage?: string
  errorMessage?: string
  durationMs: number
}

function readableNotificationTorrentName(title: string) {
  const normalized = title.replace(/\s+/g, ' ').trim()
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized || '未知种子'
}

export function formatNotificationTorrentName(title: string) {
  return `种子名称：${readableNotificationTorrentName(title)}`
}

export function formatNotificationTorrentNames(titles: string[], limit = 3) {
  const safeLimit = Math.max(1, Math.floor(limit))
  const readableTitles = titles.map(readableNotificationTorrentName)
  const lines = readableTitles.slice(0, safeLimit).map((title, index) => `${index + 1}. ${title}`)
  const remaining = readableTitles.length - lines.length
  return `种子名称：\n${lines.join('\n')}${remaining > 0 ? `\n另有 ${remaining} 个` : ''}`
}

export type DailyTrafficSiteItem = {
  siteName: string
  uploaded: number
  downloaded: number
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index > 2 ? 2 : 1)} ${units[index]}`
}

export function buildDailyTrafficMessage(items: DailyTrafficSiteItem[], dateKey: string) {
  if (!items.length) return ''
  const lines = items.map((item, index) => {
    const uploaded = formatBytes(item.uploaded)
    const downloaded = formatBytes(item.downloaded)
    const name = item.siteName?.trim() || '未知站点'
    return `${index + 1}. ${name}：↑ ${uploaded} / ↓ ${downloaded}`
  })
  const totalUploaded = items.reduce((sum, item) => sum + (Number(item.uploaded) || 0), 0)
  const totalDownloaded = items.reduce((sum, item) => sum + (Number(item.downloaded) || 0), 0)
  const summary = `汇总：↑ ${formatBytes(totalUploaded)} / ↓ ${formatBytes(totalDownloaded)}`
  return `数据日期：${dateKey}\n${lines.join('\n')}\n${summary}`
}

function safeErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return '通知请求超时'
  if (error instanceof Error && error.name === 'AbortError') return '通知请求超时'
  return '通知发送失败，请检查网络或渠道配置'
}

export async function sendIyuuNotification(
  token: string,
  title: string,
  message: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<NotificationSendResult> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)
  try {
    const response = await (options.fetchImpl ?? fetch)(`https://iyuu.cn/${token}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ text: title, desp: message }),
      signal: controller.signal
    })
    const data = await response.json().catch(() => undefined) as IyuuResponse | undefined
    const providerCode = typeof data?.errcode === 'number' ? data.errcode : undefined
    const providerMessage = typeof data?.errmsg === 'string' ? data.errmsg.replaceAll(token, '[已脱敏]') : undefined
    const success = response.ok && providerCode === 0
    return {
      success,
      httpStatus: response.status,
      providerCode,
      providerMessage,
      errorMessage: success
        ? undefined
        : !response.ok
          ? `爱语飞飞请求失败（HTTP ${response.status}）`
          : providerMessage || '爱语飞飞返回了未知结果',
      durationMs: Date.now() - startedAt
    }
  } catch (error) {
    return { success: false, errorMessage: safeErrorMessage(error), durationMs: Date.now() - startedAt }
  } finally {
    clearTimeout(timeout)
  }
}

export async function sendNotificationToConfig(
  config: NotificationConfigRecord,
  message: { event: NotificationEvent | 'TEST'; title: string; message: string },
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; includeConfigId?: boolean } = {}
): Promise<NotificationLogRecord> {
  const result = await sendIyuuNotification(config.token, message.title, message.message, options)
  const log = await appendNotificationLog({
    configId: options.includeConfigId === false ? undefined : config.id,
    configName: config.name,
    provider: config.provider,
    event: message.event,
    title: message.title,
    message: message.message,
    status: result.success ? 'SUCCESS' : 'FAILED',
    httpStatus: result.httpStatus,
    providerCode: result.providerCode,
    providerMessage: result.providerMessage,
    errorMessage: result.errorMessage,
    durationMs: result.durationMs
  })
  const level = result.success ? 'info' : 'warn'
  logger[level]('notification', result.success ? '通知发送成功' : '通知发送失败', {
    configId: config.id,
    configName: config.name,
    event: message.event,
    status: log.status,
    httpStatus: result.httpStatus,
    providerCode: result.providerCode,
    errorMessage: result.errorMessage
  })
  return log
}

export async function dispatchNotification(message: NotificationMessage): Promise<NotificationLogRecord[]> {
  try {
    const configs = (await listNotificationConfigsFromDb()).filter(
      (config) => config.enabled && config.events.includes(message.event)
    )
    if (!configs.length) return []
    const results = await Promise.allSettled(configs.map((config) => sendNotificationToConfig(config, message)))
    return results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  } catch (error) {
    logger.error('notification', '通知分发失败', {
      event: message.event,
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}
