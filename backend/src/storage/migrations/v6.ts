import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { getMeta, setMeta } from '../_meta.js'
import { localDateKey } from './_helpers.js'

export const v6: Migration = {
  version: 6,
  description: '站点流量按日聚合 + 种子流量基线 seed',
  up: (db: DatabaseSync) => {
    const already = getMeta(db, 'torrent_traffic_seeded_at')
    if (already) return
    const migratedAt = new Date().toISOString()
    const date = localDateKey(new Date(migratedAt))
    db.exec(`
      CREATE TABLE IF NOT EXISTS site_torrent_traffic_daily (
        date TEXT NOT NULL,
        site_id TEXT NOT NULL,
        site_name TEXT NOT NULL,
        uploaded REAL NOT NULL DEFAULT 0,
        downloaded REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (date, site_id)
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS torrent_traffic_cursors (
        torrent_id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        site_name TEXT NOT NULL,
        uploaded REAL NOT NULL DEFAULT 0,
        downloaded REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `)
    db.prepare(`
      INSERT INTO site_torrent_traffic_daily (date, site_id, site_name, uploaded, downloaded, updated_at)
      SELECT ?, site_id, site_name, SUM(COALESCE(uploaded, 0)), SUM(COALESCE(downloaded, 0)), ?
      FROM torrents
      WHERE COALESCE(uploaded, 0) > 0 OR COALESCE(downloaded, 0) > 0
      GROUP BY site_id, site_name
      ON CONFLICT(date, site_id) DO UPDATE SET
        uploaded = site_torrent_traffic_daily.uploaded + excluded.uploaded,
        downloaded = site_torrent_traffic_daily.downloaded + excluded.downloaded,
        site_name = excluded.site_name,
        updated_at = excluded.updated_at
    `).run(date, migratedAt)
    db.prepare(`
      INSERT INTO torrent_traffic_cursors (torrent_id, site_id, site_name, uploaded, downloaded, updated_at)
      SELECT id, site_id, site_name, COALESCE(uploaded, 0), COALESCE(downloaded, 0), ?
      FROM torrents
      WHERE 1
      ON CONFLICT(torrent_id) DO NOTHING
    `).run(migratedAt)
    setMeta(db, 'torrent_traffic_seeded_at', migratedAt)
  }
}
