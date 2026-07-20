import type { DatabaseSync } from 'node:sqlite'
import type { Migration } from './index.js'
import { addColumnIfMissing, createIndexIfMissing } from './_helpers.js'

export const v23: Migration = {
  version: 23,
  description: '站点每日快照：等级、每日唯一记录与历史查询索引',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'site_traffic_snapshots', 'user_level', 'TEXT')

    db.exec(`
      DELETE FROM site_traffic_snapshots
      WHERE EXISTS (
        SELECT 1
        FROM site_traffic_snapshots AS newer
        WHERE newer.site_id = site_traffic_snapshots.site_id
          AND newer.date = site_traffic_snapshots.date
          AND (
            newer.synced_at > site_traffic_snapshots.synced_at
            OR (newer.synced_at = site_traffic_snapshots.synced_at AND newer.id > site_traffic_snapshots.id)
          )
      )
    `)

    createIndexIfMissing(
      db,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_site_traffic_snapshots_site_date_unique ON site_traffic_snapshots(site_id, date)'
    )
    createIndexIfMissing(
      db,
      'CREATE INDEX IF NOT EXISTS idx_site_traffic_snapshots_site_date_desc ON site_traffic_snapshots(site_id, date DESC)'
    )
  }
}
