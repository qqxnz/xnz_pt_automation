import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing, createTableIfMissing, createIndexIfMissing } from './_helpers.js'

export const v8: Migration = {
  version: 8,
  description: '站点签到：sites.signin_* + site_signin_logs',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'sites', 'signin_enabled', "INTEGER NOT NULL DEFAULT 0")
    addColumnIfMissing(db, 'sites', 'signin_time', "TEXT NOT NULL DEFAULT '09:00'")
    addColumnIfMissing(db, 'sites', 'last_signin_at', 'TEXT')
    addColumnIfMissing(db, 'sites', 'last_signin_status', 'TEXT')
    addColumnIfMissing(db, 'sites', 'last_signin_message', 'TEXT')
    createTableIfMissing(
      db,
      `CREATE TABLE site_signin_logs (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        site_name TEXT NOT NULL,
        run_mode TEXT NOT NULL,
        trigger_source TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        error_message TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL
      )`
    )
    createIndexIfMissing(
      db,
      `CREATE INDEX IF NOT EXISTS idx_site_signin_logs_created ON site_signin_logs(created_at DESC)`
    )
    createIndexIfMissing(
      db,
      `CREATE INDEX IF NOT EXISTS idx_site_signin_logs_site ON site_signin_logs(site_id, created_at DESC)`
    )
  }
}
