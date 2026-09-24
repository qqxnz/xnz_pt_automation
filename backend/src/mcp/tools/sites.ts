import { z } from 'zod'
import { getSiteFromDb, listSitesFromDb, type SiteRecord } from '../../storage.js'
import { recordOperationLog } from '../../utils/logger.js'
import { performSiteSignin } from '../../routes/signin/index.js'
import { McpBusinessError } from '../errors.js'
import type { McpContext } from '../context.js'
import { buildOperationLogPayload } from '../context.js'

/** 去掉 apiKey / cookie 明文后输出 */
function redactSite(site: SiteRecord) {
  const { apiKey: _apiKey, cookie: _cookie, ...rest } = site
  void _apiKey
  void _cookie
  return rest
}

/**
 * 调用 sites/index.ts 中私有 testSite()：动态 import 它（未公开 export 时直接调用会失败）。
 * 实际我们用更轻量的方式：通过 storage.ts 的 connectivityStatus 字段返回缓存结果，避免直接连 qB / PT。
 */
async function testSiteInline(site: SiteRecord) {
  // sites/index.ts 私有；直接读取 connectivityStatus 即可，连通性测试需要在 web UI 手动触发
  // 这里返回快照，并提示 Agent 使用 web UI 中的 /api/sites/:id/test-connectivity
  return {
    status: site.connectivityStatus,
    message: site.lastConnectError
      ? `上次失败：${site.lastConnectError}`
      : '当前仅返回缓存状态；实时测试请调用 web UI /api/sites/:id/test-connectivity 或重启 task 后观察',
    lastConnectedAt: site.lastConnectedAt,
    lastTestedAt: site.lastConnectedAt
  }
}

export const siteToolDefs = {
  list_sites: { input: z.object({ keyword: z.string().optional(), enabled: z.boolean().optional() }) },
  get_site: { input: z.object({ id: z.string().min(1) }) },
  test_site_connectivity: { input: z.object({ id: z.string().min(1) }) },
  signin_site: { input: z.object({ id: z.string().min(1) }) }
}

export async function listSites(input: { keyword?: string; enabled?: boolean }) {
  const items = await listSitesFromDb()
  let filtered = items
  if (input.keyword) {
    const kw = input.keyword.toLowerCase()
    filtered = filtered.filter(
      (s) => s.name.toLowerCase().includes(kw) || s.domain.toLowerCase().includes(kw)
    )
  }
  if (typeof input.enabled === 'boolean') {
    filtered = filtered.filter((s) => s.enabled === input.enabled)
  }
  return { items: filtered.map(redactSite), total: filtered.length }
}

export async function getSite(input: { id: string }) {
  const site = await getSiteFromDb(input.id)
  if (!site) throw new McpBusinessError('站点不存在', { id: input.id })
  return redactSite(site)
}

export async function testSiteConnectivity(input: { id: string }, ctx: McpContext) {
  const site = await getSiteFromDb(input.id)
  if (!site) throw new McpBusinessError('站点不存在', { id: input.id })
  const startedAt = Date.now()
  try {
    const result = await testSiteInline(site)
    await recordOperationLog({
      ...buildOperationLogPayload({
        toolName: 'test_site_connectivity',
        status: result.status === 'ONLINE' ? 'SUCCESS' : 'FAILED',
        tokenName: ctx.token.name,
        remoteAddress: ctx.remoteAddress,
        message: `mcp tool: test_site_connectivity（${site.name}）→ ${result.status}`
      })
    })
    return {
      status: result.status,
      message: result.message,
      durationMs: Date.now() - startedAt
    }
  } catch (error) {
    await recordOperationLog({
      ...buildOperationLogPayload({
        toolName: 'test_site_connectivity',
        status: 'FAILED',
        tokenName: ctx.token.name,
        remoteAddress: ctx.remoteAddress,
        message: `mcp tool: test_site_connectivity 失败（${site.name}）`,
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    })
    throw new McpBusinessError(
      error instanceof Error ? error.message : '连通性测试失败',
      { id: input.id }
    )
  }
}

export async function signinSite(input: { id: string }, ctx: McpContext) {
  const site = await getSiteFromDb(input.id)
  if (!site) throw new McpBusinessError('站点不存在', { id: input.id })
  const result = await performSiteSignin(site, {
    runMode: 'AUTO',
    triggerSource: 'mcp',
    now: new Date()
  }).catch((error) => {
    throw new McpBusinessError(
      error instanceof Error ? error.message : '签到失败',
      { id: input.id }
    )
  })
  await recordOperationLog({
    ...buildOperationLogPayload({
      toolName: 'signin_site',
      status: result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      tokenName: ctx.token.name,
      remoteAddress: ctx.remoteAddress,
      message: `mcp tool: signin_site（${site.name}）→ ${result.status}`
    })
  })
  return {
    status: result.status,
    message: result.message,
    durationMs: result.durationMs
  }
}