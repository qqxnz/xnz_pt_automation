import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  clearLogsByType,
  queryAllLogs,
  queryLogs,
  type OperationLogRecord,
  type ScheduleLogRecord,
  type SigninLogRecord,
  type TaskLogRecord,
  type TorrentLogRecord
} from '../storage.js'
import { logger, recordOperationLog } from '../utils/logger.js'
import { localDateKey } from '../utils/time.js'

export const logsRouter = Router()

type LogType = 'operation' | 'task' | 'schedule' | 'signin' | 'torrent'

function requestedLogType(value: unknown): LogType {
  const type = String(value ?? 'operation')
  if (type === 'task' || type === 'schedule' || type === 'signin' || type === 'torrent') return type
  return 'operation'
}

function sanitizeLogText(value: unknown) {
  return String(value ?? '')
    .replace(/(cookie|api[-_ ]?key|password|passkey|authorization)(\s*[:=]\s*)[^\s;,&]+/gi, '$1$2[已脱敏]')
    .replace(/([?&](?:passkey|apikey|api_key|token|auth|password)=)[^&\s]+/gi, '$1[已脱敏]')
    .replace(/https?:\/\/\S+/gi, '[链接已脱敏]')
}

function csvValue(value: unknown) {
  const text = sanitizeLogText(Array.isArray(value) ? value.join('；') : value)
  return `"${text.replace(/"/g, '""')}"`
}

function toCsv(headers: string[], rows: unknown[][]) {
  return [headers.map(csvValue).join(','), ...rows.map((row) => row.map(csvValue).join(','))].join('\n')
}

function taskFailureDetails(item: TaskLogRecord) {
  return [...new Set([...(item.failureDetails ?? []), item.fetchErrorMessage ?? '', ...(item.pushErrorMessages ?? [])].filter(Boolean))]
}

function operationRows(items: OperationLogRecord[]) {
  const headers = ['ID', '时间', '状态', '动作', '消息', '操作者', 'IP', 'User-Agent']
  const rows = items.map((item) => [item.id, item.createdAt, item.status, item.action, item.message, item.actorName ?? '', item.ip ?? '', item.userAgent ?? ''])
  return { headers, rows }
}

function taskRows(items: TaskLogRecord[]) {
  const headers = ['ID', '时间', '任务', '任务ID', '来源', '状态', '消息', '摘要', '错误', '抓取失败原因', '推送失败原因', '失败明细', '开始时间', '结束时间', '抓取数', '命中数', '跳过已存在', '推送成功', '推送失败']
  const rows = items.map((item) => [
    item.id,
    item.createdAt,
    item.taskName,
    item.taskId ?? '',
    item.runMode ?? '',
    item.status,
    item.message,
    item.summary ?? '',
    item.errorMessage ?? '',
    item.fetchErrorMessage ?? '',
    item.pushErrorMessages ?? [],
    taskFailureDetails(item),
    item.startedAt ?? '',
    item.finishedAt ?? '',
    item.fetchedCount ?? '',
    item.matchedCount ?? '',
    item.skippedExistingCount ?? '',
    item.pushedCount ?? '',
    item.pushFailedCount ?? ''
  ])
  return { headers, rows }
}

function scheduleRows(items: ScheduleLogRecord[]) {
  const headers = ['ID', '时间', '定时任务', '状态', '消息', '摘要', '错误', '计划时间', '触发时间', '开始时间', '结束时间', '耗时ms', '详情']
  const rows = items.map((item) => [
    item.id,
    item.createdAt,
    item.jobName,
    item.status,
    item.message,
    item.summary ?? '',
    item.errorMessage ?? '',
    item.scheduledAt ?? '',
    item.triggeredAt ?? '',
    item.startedAt ?? '',
    item.finishedAt ?? '',
    item.durationMs ?? '',
    item.details ? JSON.stringify(item.details) : ''
  ])
  return { headers, rows }
}

function signinRows(items: SigninLogRecord[]) {
  const headers = ['ID', '时间', '站点', '站点ID', '状态', '来源', '触发方式', '消息', '错误', '开始时间', '结束时间', '耗时ms']
  const rows = items.map((item) => [
    item.id,
    item.createdAt,
    item.siteName,
    item.siteId,
    item.status,
    item.runMode,
    item.triggerSource,
    item.message,
    item.errorMessage ?? '',
    item.startedAt,
    item.finishedAt ?? '',
    item.durationMs ?? ''
  ])
  return { headers, rows }
}

function torrentRows(items: TorrentLogRecord[]) {
  const headers = ['ID', '时间', '事件', '状态', '种子标题', '种子ID', '站点', '原因', '来源', '操作者', '消息']
  const rows = items.map((item) => [
    item.id,
    item.createdAt,
    item.event,
    item.status,
    item.torrentTitle,
    item.torrentId ?? '',
    item.siteName ?? '',
    item.reason ?? '',
    item.source ?? '',
    item.actorName ?? '',
    item.message
  ])
  return { headers, rows }
}

logsRouter.get('/', requireAuth, async (req, res) => {
  const type = requestedLogType(req.query.type)
  const rawPage = Number(req.query.page ?? 1)
  const rawPageSize = Number(req.query.pageSize ?? 20)
  const page = Number.isFinite(rawPage) ? Math.max(Math.floor(rawPage), 1) : 1
  const pageSize = Number.isFinite(rawPageSize) ? Math.min(Math.max(Math.floor(rawPageSize), 1), 100) : 20
  const keyword = String(req.query.keyword ?? '').trim().toLowerCase()
  const status = String(req.query.status ?? 'ALL')
  const taskId = String(req.query.taskId ?? '')
  const runMode = String(req.query.runMode ?? 'ALL')
  const result = await queryLogs({ type, page, pageSize, keyword, status, taskId, runMode })

  logger.info('logs', '查询日志列表', {
    type,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    actorName: res.locals.user?.username
  })

  res.json({
    type,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    items: result.items
  })
})

logsRouter.get('/export', requireAuth, async (req, res) => {
  const type = requestedLogType(req.query.type)
  const items = await queryAllLogs(type)
  const source =
    type === 'task'
      ? taskRows(items as TaskLogRecord[])
      : type === 'schedule'
        ? scheduleRows(items as ScheduleLogRecord[])
        : type === 'signin'
          ? signinRows(items as SigninLogRecord[])
          : type === 'torrent'
            ? torrentRows(items as TorrentLogRecord[])
            : operationRows(items as OperationLogRecord[])
  const csv = `\uFEFF${toCsv(source.headers, source.rows)}\n`
  const date = localDateKey()
  const filename = `${type === 'task' ? 'task-logs' : type === 'schedule' ? 'schedule-logs' : type === 'signin' ? 'signin-logs' : type === 'torrent' ? 'torrent-logs' : 'operation-logs'}-${date}.csv`

  logger.info('logs', '导出日志', {
    type,
    total: source.rows.length,
    actorName: res.locals.user?.username
  })

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(csv)
})

logsRouter.delete('/', requireAuth, async (req, res) => {
  const type = requestedLogType(req.query.type)
  const { clearedCount } = await clearLogsByType(type)
  const actor = res.locals.user as { id?: string; username?: string } | undefined
  const logName = type === 'task' ? '任务日志' : type === 'schedule' ? '定时日志' : type === 'signin' ? '签到日志' : type === 'torrent' ? '种子日志' : '操作日志'
  await recordOperationLog({
    action: `清空${logName}`,
    message: `清空${logName}，共 ${clearedCount} 条`,
    status: 'SUCCESS',
    actorId: actor?.id,
    actorName: actor?.username,
    ip: req.ip,
    userAgent: req.get('user-agent')
  })
  res.json({ type, clearedCount })
})
