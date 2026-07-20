import { strict as assert } from 'node:assert'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'

const dataDir = path.join('/tmp', `xnz-site-history-${Date.now()}-${Math.random().toString(36).slice(2)}`)
process.env.DATA_DIR = dataDir

const {
  getCurrentDatabase,
  listSiteTrafficSnapshotsFromDb,
  readSiteDailyHistoryFromDb,
  saveSiteTrafficSnapshotToDb
} = await import('../src/storage.js')

after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function snapshot(options: {
  id: string
  siteId?: string
  date: string
  uploaded?: number
  downloaded?: number
  ratio?: number
  ratioInfinite?: boolean
  userLevel?: string
  syncedAt?: string
}) {
  return {
    id: options.id,
    siteId: options.siteId ?? 'site-a',
    siteName: options.siteId === 'site-b' ? '站点 B' : '站点 A',
    date: options.date,
    uploaded: options.uploaded,
    downloaded: options.downloaded,
    ratio: options.ratio,
    ratioInfinite: options.ratioInfinite,
    userLevel: options.userLevel,
    syncedAt: options.syncedAt ?? `${options.date}T12:00:00.000Z`
  }
}

function localDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

test('daily snapshots overwrite the same day and history calculates signed deltas across the filter boundary', async () => {
  await saveSiteTrafficSnapshotToDb(snapshot({ id: 'day-1', date: '2026-07-01', uploaded: 100, downloaded: 50, ratio: 2, userLevel: 'User' }))
  await saveSiteTrafficSnapshotToDb(snapshot({ id: 'day-2-old', date: '2026-07-02', uploaded: 130, downloaded: 55, ratio: 2.36, userLevel: 'Power User', syncedAt: '2026-07-02T10:00:00.000Z' }))
  await saveSiteTrafficSnapshotToDb(snapshot({ id: 'day-2-new', date: '2026-07-02', uploaded: 140, downloaded: 60, ratio: 2.33, userLevel: 'Elite User', syncedAt: '2026-07-02T20:00:00.000Z' }))
  await saveSiteTrafficSnapshotToDb(snapshot({ id: 'day-3', date: '2026-07-03', uploaded: 120, downloaded: 58, ratioInfinite: true }))

  const result = await readSiteDailyHistoryFromDb({
    siteId: 'site-a',
    startDate: '2026-07-02',
    endDate: '2026-07-03',
    page: 1,
    pageSize: 1
  })
  assert.equal(result.total, 2)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].date, '2026-07-03')
  assert.equal(result.items[0].uploadedDelta, -20)
  assert.equal(result.items[0].downloadedDelta, -2)
  assert.equal(result.items[0].ratioInfinite, true)

  const secondPage = await readSiteDailyHistoryFromDb({
    siteId: 'site-a',
    startDate: '2026-07-02',
    endDate: '2026-07-03',
    page: 2,
    pageSize: 1
  })
  assert.equal(secondPage.items[0].date, '2026-07-02')
  assert.equal(secondPage.items[0].uploaded, 140)
  assert.equal(secondPage.items[0].uploadedDelta, 40)
  assert.equal(secondPage.items[0].downloadedDelta, 10)
  assert.equal(secondPage.items[0].userLevel, 'Elite User')

  const firstDay = await readSiteDailyHistoryFromDb({
    siteId: 'site-a',
    startDate: '2026-07-01',
    endDate: '2026-07-01',
    page: 1,
    pageSize: 30
  })
  assert.equal(firstDay.items[0].uploadedDelta, undefined)
  assert.equal(firstDay.items[0].downloadedDelta, undefined)

  const all = await listSiteTrafficSnapshotsFromDb()
  assert.equal(all.filter((item) => item.siteId === 'site-a' && item.date === '2026-07-02').length, 1)
})

test('snapshot retention removes only the current site records older than ten calendar years', async () => {
  const today = new Date()
  const cutoff = new Date(today)
  cutoff.setFullYear(cutoff.getFullYear() - 10)
  const beforeCutoff = new Date(cutoff)
  beforeCutoff.setDate(beforeCutoff.getDate() - 1)

  await saveSiteTrafficSnapshotToDb(snapshot({ id: 'old-a', date: localDateKey(beforeCutoff), uploaded: 1 }))
  await saveSiteTrafficSnapshotToDb(snapshot({ id: 'cutoff-a', date: localDateKey(cutoff), uploaded: 3 }))
  getCurrentDatabase().prepare(`
    INSERT INTO site_traffic_snapshots (id, site_id, site_name, date, uploaded, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('old-b', 'site-b', '站点 B', localDateKey(beforeCutoff), 2, new Date().toISOString())
  await saveSiteTrafficSnapshotToDb(snapshot({ id: 'current-a', date: localDateKey(today), uploaded: 4 }))

  const rows = await listSiteTrafficSnapshotsFromDb()
  assert.equal(rows.some((item) => item.id === 'old-a'), false)
  assert.equal(rows.some((item) => item.id === 'cutoff-a'), true)
  assert.equal(rows.some((item) => item.id === 'old-b'), true)
})
