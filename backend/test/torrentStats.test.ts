import { strict as assert } from 'node:assert'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { localDateKey, localDayRangeIso } from '../src/utils/time.js'

const dataDir = path.join('/tmp', `xnz-torrent-stats-${Date.now()}-${Math.random().toString(36).slice(2)}`)
process.env.DATA_DIR = dataDir

const { insertTorrents, readTorrentStats } = await import('../src/storage.js')

function torrent(id: string, siteId: string, firstSeenAt: string, pushStatus: 'NEW' | 'PUSHED' = 'NEW') {
  return {
    id,
    siteId,
    siteName: `站点 ${siteId}`,
    torrentId: id,
    title: `种子 ${id}`,
    size: 1,
    discountType: 'FREE' as const,
    isFreeNow: true,
    currentState: pushStatus === 'PUSHED' ? 'PUSHED' as const : 'FREE_NOW' as const,
    pushStatus,
    linkStatus: 'SAVED' as const,
    sourceRunMode: 'AUTO' as const,
    firstSeenAt,
    lastSeenAt: firstSeenAt
  }
}

test('readTorrentStats counts today-added torrents and distinct sites by local date', async () => {
  const { startIso } = localDayRangeIso(localDateKey())
  const today = new Date(new Date(startIso).getTime() + 60 * 60 * 1000).toISOString()
  const yesterday = new Date(new Date(startIso).getTime() - 60 * 60 * 1000).toISOString()

  try {
    await insertTorrents([
      torrent('today-a', 'site-a', today, 'PUSHED'),
      torrent('today-b', 'site-a', today),
      torrent('today-c', 'site-b', today),
      torrent('yesterday-a', 'site-c', yesterday)
    ])

    const stats = await readTorrentStats()
    assert.equal(stats.total, 4)
    assert.equal(stats.running, 1)
    assert.equal(stats.todayAdded, 3)
    assert.equal(stats.todaySiteCount, 2)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
