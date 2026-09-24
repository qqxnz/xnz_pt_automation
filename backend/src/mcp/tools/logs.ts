import { z } from 'zod'
import { queryLogs } from '../../storage.js'

const QueryLogsInput = z.object({
  type: z.enum(['operation', 'task', 'schedule', 'signin', 'torrent', 'notification']),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  keyword: z.string().optional(),
  status: z.string().optional(),
  taskId: z.string().optional(),
  runMode: z.string().optional(),
  siteId: z.string().optional()
})

export type LogsToolInput = z.infer<typeof QueryLogsInput>

export async function queryLogsTool(input: LogsToolInput) {
  const result = await queryLogs({
    type: input.type,
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 20,
    keyword: input.keyword,
    status: input.status,
    taskId: input.taskId,
    runMode: input.runMode,
    siteId: input.siteId
  })
  return result
}

export const logsToolDefs = {
  query_logs: { input: QueryLogsInput, kind: 'read' as const }
}