import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { clearLogsByType, readState, type OperationLogRecord, type TaskLogRecord } from '../storage.js'
import { logger, recordOperationLog } from '../utils/logger.js'

export const logsRouter = Router()

type LogType = 'operation' | 'task'

function requestedLogType(value: unknown): LogType {
  return String(value ?? 'operation') === 'task' ? 'task' : 'operation'
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
  const state = await readState()
  const source =
    type === 'task'
      ? state.taskLogs.filter((item) => {
          if (status !== 'ALL' && item.status !== status) return false
          if (taskId && item.taskId !== taskId) return false
          if (runMode !== 'ALL' && item.runMode !== runMode) return false
          if (keyword && !`${item.taskName} ${item.message} ${item.summary ?? ''} ${item.errorMessage ?? ''} ${item.fetchErrorMessage ?? ''} ${(item.pushErrorMessages ?? []).join(' ')} ${(item.failureDetails ?? []).join(' ')}`.toLowerCase().includes(keyword)) return false
          return true
        })
      : state.operationLogs.filter((item) => {
          if (status !== 'ALL' && item.status !== status) return false
          if (keyword && !`${item.action} ${item.message} ${item.actorName ?? ''}`.toLowerCase().includes(keyword)) return false
          return true
        })
  const start = (page - 1) * pageSize
  const items = source.slice(start, start + pageSize)

  logger.info('logs', '查询日志列表', {
    type,
    page,
    pageSize,
    total: source.length,
    actorName: res.locals.user?.username
  })

  res.json({
    type,
    page,
    pageSize,
    total: source.length,
    items
  })
})

logsRouter.get('/export', requireAuth, async (req, res) => {
  const type = requestedLogType(req.query.type)
  const state = await readState()
  const source = type === 'task' ? taskRows(state.taskLogs) : operationRows(state.operationLogs)
  const csv = `\uFEFF${toCsv(source.headers, source.rows)}\n`
  const date = new Date().toISOString().slice(0, 10)
  const filename = `${type === 'task' ? 'task-logs' : 'operation-logs'}-${date}.csv`

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
  await recordOperationLog({
    action: type === 'task' ? '清空任务日志' : '清空操作日志',
    message: `清空${type === 'task' ? '任务日志' : '操作日志'}，共 ${clearedCount} 条`,
    status: 'SUCCESS',
    actorId: actor?.id,
    actorName: actor?.username,
    ip: req.ip,
    userAgent: req.get('user-agent')
  })
  res.json({ type, clearedCount })
})
