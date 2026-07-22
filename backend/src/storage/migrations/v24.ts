import type { DatabaseSync } from 'node:sqlite'
import type { Migration } from './index.js'
import { createIndexIfMissing, createTableIfMissing } from './_helpers.js'

export const v24: Migration = {
  version: 24,
  description: '通知配置与通知发送日志',
  up: (db: DatabaseSync) => {
    createTableIfMissing(db, `CREATE TABLE notification_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      token TEXT NOT NULL,
      events_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
    createTableIfMissing(db, `CREATE TABLE notification_logs (
      id TEXT PRIMARY KEY,
      config_id TEXT,
      config_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      event TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      http_status INTEGER,
      provider_code INTEGER,
      provider_message TEXT,
      error_message TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    )`)
    createIndexIfMissing(db, 'CREATE INDEX IF NOT EXISTS idx_notification_logs_created ON notification_logs(created_at DESC)')
    createIndexIfMissing(db, 'CREATE INDEX IF NOT EXISTS idx_notification_logs_config_created ON notification_logs(config_id, created_at DESC)')
  }
}
