import { z } from 'zod'
import {
  getDownloaderFromDb,
  listDownloadersFromDb,
  type DownloaderRecord
} from '../../storage.js'
import { recordOperationLog } from '../../utils/logger.js'
import { testDownloaderConnection } from '../../routes/downloaders.js'
import { McpBusinessError } from '../errors.js'
import type { McpContext } from '../context.js'
import { buildOperationLogPayload } from '../context.js'

function redactDownloader(downloader: DownloaderRecord) {
  const { password: _password, ...rest } = downloader
  void _password
  return rest
}

export const downloaderToolDefs = {
  list_downloaders: {
    input: z.object({
      keyword: z.string().optional(),
      status: z.enum(['UNKNOWN', 'ONLINE', 'OFFLINE', 'AUTH_FAILED']).optional()
    })
  },
  test_downloader: { input: z.object({ id: z.string().min(1) }) }
}

export async function listDownloaders(input: { keyword?: string; status?: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED' }) {
  const items = await listDownloadersFromDb()
  let filtered = items
  if (input.keyword) {
    const kw = input.keyword.toLowerCase()
    filtered = filtered.filter((d) => d.name.toLowerCase().includes(kw) || d.host.toLowerCase().includes(kw))
  }
  if (input.status) {
    filtered = filtered.filter((d) => d.status === input.status)
  }
  return { items: filtered.map(redactDownloader), total: filtered.length }
}

export async function testDownloader(input: { id: string }, ctx: McpContext) {
  const downloader = await getDownloaderFromDb(input.id)
  if (!downloader) throw new McpBusinessError('下载器不存在', { id: input.id })
  const startedAt = Date.now()
  try {
    await testDownloaderConnection(downloader)
    await recordOperationLog({
      ...buildOperationLogPayload({
        toolName: 'test_downloader',
        status: 'SUCCESS',
        tokenName: ctx.token.name,
        remoteAddress: ctx.remoteAddress,
        message: `mcp tool: test_downloader（${downloader.name}）→ ONLINE`
      })
    })
    return {
      status: downloader.status,
      message: downloader.statusMessage ?? '已联通',
      durationMs: Date.now() - startedAt
    }
  } catch (error) {
    await recordOperationLog({
      ...buildOperationLogPayload({
        toolName: 'test_downloader',
        status: 'FAILED',
        tokenName: ctx.token.name,
        remoteAddress: ctx.remoteAddress,
        message: `mcp tool: test_downloader 失败（${downloader.name}）`,
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    })
    throw new McpBusinessError(
      error instanceof Error ? error.message : '连通性测试失败',
      { id: input.id, status: downloader.status, message: downloader.statusMessage }
    )
  }
}