import { strict as assert } from 'node:assert'
import { test, before, after, beforeEach } from 'node:test'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const tmpDir = path.join('/tmp', `xnz-mcp-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`)
process.env.DATA_DIR = tmpDir
process.env.NODE_ENV = 'test'

const storage = await import('../src/storage.js')

before(async () => {
  mkdirSync(tmpDir, { recursive: true })
  await storage.initializeStorage()
})

after(async () => {
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

beforeEach(async () => {
  // 清空所有 sites / tasks / torrents / downloaders
  const sites = await storage.listSitesFromDb()
  for (const s of sites) await storage.deleteSiteFromDb(s.id)
  const tasks = await storage.listTasksFromDb()
  for (const t of tasks) await storage.deleteTaskFromDb(t.id)
  const downloaders = await storage.listDownloadersFromDb()
  for (const d of downloaders) await storage.deleteDownloaderFromDb(d.id)
  const tokens = await storage.listApiTokensFromDb()
  for (const tk of tokens) await storage.deleteApiTokenFromDb(tk.id)
})

async function makeSite(name: string, domain: string) {
  const site = {
    id: `s_${Math.random().toString(36).slice(2, 10)}`,
    name,
    domain,
    enabled: true,
    userAgent: 'test',
    connectivityStatus: 'UNKNOWN' as const,
    signinEnabled: false,
    signinTime: '09:00',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  await storage.insertSiteToDb(site)
  return site
}

async function makeTask(name: string, siteId: string, downloaderId: string) {
  const task = {
    id: `t_${Math.random().toString(36).slice(2, 10)}`,
    name,
    siteId,
    downloaderId,
    autoRunEnabled: false,
    intervalMinutes: 60,
    autoPush: false,
    discountTypes: ['FREE' as const],
    running: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  await storage.insertTaskToDb(task)
  return task
}

async function makeDownloader(name: string) {
  const downloader = {
    id: `d_${Math.random().toString(36).slice(2, 10)}`,
    name,
    type: 'QBITTORRENT' as const,
    enabled: true,
    host: 'http://qb.test:8080',
    status: 'UNKNOWN' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  await storage.insertDownloaderToDb(downloader)
  return downloader
}

test('listSites tool redacts apiKey/cookie', async () => {
  const site = await makeSite('api-smoke', 'api.smoke.test')
  await storage.updateSiteInDb({ ...site, apiKey: 'secret-api-key', cookie: 'c_secure=abc' })

  const sitesTools = await import('../src/mcp/tools/sites.js')
  const result = await sitesTools.listSites({})
  assert.equal(result.total, 1)
  for (const item of result.items) {
    assert.equal(item.apiKey, undefined, 'apiKey must be redacted')
    assert.equal(item.cookie, undefined, 'cookie must be redacted')
  }
})

test('listTasks tool filters by enabled', async () => {
  const site = await makeSite('s1', 's1.test')
  const downloader = await makeDownloader('d1')
  const t1 = await makeTask('t-on', site.id, downloader.id)
  await storage.updateTaskFieldsInDb(t1.id, { autoRunEnabled: true })
  const t2 = await makeTask('t-off', site.id, downloader.id)
  await storage.updateTaskFieldsInDb(t2.id, { autoRunEnabled: false })

  const tasksTools = await import('../src/mcp/tools/tasks.js')
  const onlyEnabled = await tasksTools.listTasks({ enabled: true })
  assert.equal(onlyEnabled.total, 1)
  assert.equal(onlyEnabled.items[0].id, t1.id)

  const all = await tasksTools.listTasks({})
  assert.equal(all.total, 2)
})

test('listDownloaders tool redacts password', async () => {
  const d = await makeDownloader('redact-test')
  await storage.updateDownloaderInDb({ ...d, password: 'super-secret' })

  const downloadersTools = await import('../src/mcp/tools/downloaders.js')
  const result = await downloadersTools.listDownloaders({})
  assert.equal(result.total, 1)
  assert.equal(result.items[0].password, undefined, 'password must be redacted')
})

test('listTorrentsTool returns empty result when no torrents exist', async () => {
  const torrentsTools = await import('../src/mcp/tools/torrents.js')
  const result = await torrentsTools.listTorrentsTool({})
  assert.equal(result.items.length, 0)
  assert.equal(result.total, 0)
  assert.ok(result.stats, 'should include stats')
})

test('getSystemInfo returns package fields', async () => {
  const systemTools = await import('../src/mcp/tools/system.js')
  const info = await systemTools.getSystemInfo()
  assert.ok(info.version)
  assert.ok(info.nodeVersion)
  assert.ok(info.timezone)
  assert.equal(info.database.type, 'sqlite')
})

test('getSettingsTool hides proxyTestUrl', async () => {
  const systemTools = await import('../src/mcp/tools/system.js')
  const settings = await systemTools.getSettingsTool()
  assert.equal((settings as Record<string, unknown>).proxyTestUrl, undefined)
  assert.ok(typeof settings.sessionTtlHours === 'number')
})

test('queryLogsTool returns operation log items', async () => {
  const logsTools = await import('../src/mcp/tools/logs.js')
  const result = await logsTools.queryLogsTool({ type: 'operation', pageSize: 5 })
  assert.ok(Array.isArray(result.items))
})