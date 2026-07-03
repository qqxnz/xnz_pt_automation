import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing, createTableIfMissing, createIndexIfMissing } from './_helpers.js'

export const v11: Migration = {
  version: 11,
  description: '删除规则 + torrent_logs',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'tasks', 'delete_on_free_expire', 'INTEGER NOT NULL DEFAULT 0')
    addColumnIfMissing(db, 'tasks', 'low_upload_kbps', 'INTEGER')
    addColumnIfMissing(db, 'tasks', 'low_upload_minutes', 'INTEGER')
    addColumnIfMissing(db, 'torrents', 'delete_on_free_expire', 'INTEGER NOT NULL DEFAULT 0')
    addColumnIfMissing(db, 'torrents', 'low_upload_kbps', 'INTEGER')
    addColumnIfMissing(db, 'torrents', 'low_upload_minutes', 'INTEGER')
    addColumnIfMissing(db, 'torrents', 'low_upload_since', 'TEXT')
    createTableIfMissing(
      db,
      `CREATE TABLE torrent_logs (
        id TEXT PRIMARY KEY,
        torrent_id TEXT,
        site_id TEXT,
        site_name TEXT,
        torrent_title TEXT NOT NULL,
        event TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        reason TEXT,
        source TEXT,
        actor_id TEXT,
        actor_name TEXT,
        created_at TEXT NOT NULL
      )`
    )
    createIndexIfMissing(db, `CREATE INDEX IF NOT EXISTS idx_torrent_logs_created ON torrent_logs(created_at DESC)`)
    createIndexIfMissing(db, `CREATE INDEX IF NOT EXISTS idx_torrent_logs_torrent ON torrent_logs(torrent_id, created_at DESC)`)
  }
}
