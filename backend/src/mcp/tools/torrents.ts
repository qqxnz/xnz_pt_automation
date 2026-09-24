import { z } from 'zod'
import { deleteTorrents, listTorrents, readTorrentStats } from '../../storage.js'
import { batchPushTorrentsCore } from '../../routes/torrents.js'
import { recordOperationLog } from '../../utils/logger.js'
import type { McpContext } from '../context.js'
import { buildOperationLogPayload } from '../context.js'

export const torrentToolDefs = {
  list_torrents: {
    input: z.object({
      keyword: z.string().optional(),
      siteId: z.string().optional(),
      downloaderId: z.string().optional(),
      taskId: z.string().optional(),
      pushStatus: z.enum(['ALL', 'NEW', 'PUSHED', 'PUSH_FAILED', 'DELETED']).optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional()
    })
  },
  push_torrents: { input: z.object({ ids: z.array(z.string().min(1)).min(1) }) },
  delete_torrents: { input: z.object({ ids: z.array(z.string().min(1)).min(1) }) }
}

function safeTorrentItem(t: Record<string, unknown>) {
  const { downloadUrl: _downloadUrl, ...rest } = t as { downloadUrl?: string }
  void _downloadUrl
  return rest
}

export async function listTorrentsTool(input: {
  keyword?: string
  siteId?: string
  downloaderId?: string
  taskId?: string
  pushStatus?: 'ALL' | 'NEW' | 'PUSHED' | 'PUSH_FAILED' | 'DELETED'
  page?: number
  pageSize?: number
}) {
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 20
  const [result, stats] = await Promise.all([
    listTorrents({
      keyword: input.keyword ?? '',
      siteId: input.siteId ?? '',
      downloaderId: input.downloaderId ?? '',
      taskId: input.taskId ?? '',
      pushStatus: input.pushStatus ?? 'ALL',
      sourceRunMode: 'ALL',
      page,
      pageSize
    }),
    readTorrentStats()
  ])
  return {
    items: result.items.map(safeTorrentItem),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    stats
  }
}

export async function pushTorrents(input: { ids: string[] }, ctx: McpContext) {
  const result = await batchPushTorrentsCore(input.ids, {
    actorId: 'mcp',
    actorName: `mcp:${ctx.token.name}`,
    source: 'MCP'
  })
  await recordOperationLog({
    ...buildOperationLogPayload({
      toolName: 'push_torrents',
      status: result.failedCount ? 'FAILED' : 'SUCCESS',
      tokenName: ctx.token.name,
      remoteAddress: ctx.remoteAddress,
      message: `mcp tool: push_torrents 完成：成功 ${result.successCount}，失败 ${result.failedCount}`
    })
  })
  return result
}

export async function deleteTorrentsTool(input: { ids: string[] }, ctx: McpContext) {
  const result = await deleteTorrents(input.ids)
  await recordOperationLog({
    ...buildOperationLogPayload({
      toolName: 'delete_torrents',
      status: 'SUCCESS',
      tokenName: ctx.token.name,
      remoteAddress: ctx.remoteAddress,
      message: `mcp tool: delete_torrents 完成：删除 ${result.deletedCount}，缺失 ${result.missingIds.length}`
    })
  })
  return { deletedCount: result.deletedCount, missingIds: result.missingIds }
}