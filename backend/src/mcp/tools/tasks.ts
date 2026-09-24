import { z } from 'zod'
import { getTaskFromDb, listTasksFromDb } from '../../storage.js'
import { runTaskById } from '../../routes/tasks.js'
import { recordOperationLog } from '../../utils/logger.js'
import { McpBusinessError } from '../errors.js'
import type { McpContext } from '../context.js'
import { buildOperationLogPayload } from '../context.js'

export const taskToolDefs = {
  list_tasks: {
    input: z.object({
      enabled: z.boolean().optional(),
      siteId: z.string().optional(),
      downloaderId: z.string().optional()
    })
  },
  get_task: { input: z.object({ id: z.string().min(1) }) },
  run_task: { input: z.object({ id: z.string().min(1) }) }
}

export async function listTasks(input: { enabled?: boolean; siteId?: string; downloaderId?: string }) {
  const items = await listTasksFromDb()
  let filtered = items
  if (typeof input.enabled === 'boolean') {
    filtered = filtered.filter((t) => t.autoRunEnabled === input.enabled)
  }
  if (input.siteId) {
    filtered = filtered.filter((t) => t.siteId === input.siteId)
  }
  if (input.downloaderId) {
    filtered = filtered.filter((t) => t.downloaderId === input.downloaderId)
  }
  return { items: filtered, total: filtered.length }
}

export async function getTask(input: { id: string }) {
  const task = await getTaskFromDb(input.id)
  if (!task) throw new McpBusinessError('任务不存在', { id: input.id })
  return task
}

export async function runTask(input: { id: string }, ctx: McpContext) {
  const existing = await getTaskFromDb(input.id)
  if (!existing) throw new McpBusinessError('任务不存在', { id: input.id })
  await recordOperationLog({
    ...buildOperationLogPayload({
      toolName: 'run_task',
      status: 'SUCCESS',
      tokenName: ctx.token.name,
      remoteAddress: ctx.remoteAddress,
      message: `mcp tool: run_task 入队（${existing.name}）`
    })
  })
  // runTaskById 会完整跑完任务；调用方采用 fire-and-forget，避免 MCP 30s 超时
  const promise = runTaskById(input.id, 'MANUAL_RUN').catch((error) => {
    void recordOperationLog({
      ...buildOperationLogPayload({
        toolName: 'run_task',
        status: 'FAILED',
        tokenName: ctx.token.name,
        remoteAddress: ctx.remoteAddress,
        message: `mcp tool: run_task 失败（${existing.name}）`,
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    })
  })
  promise.catch(() => undefined)
  return { taskId: input.id, queued: true }
}