import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing } from './_helpers.js'

export const v9: Migration = {
  version: 9,
  description: '自我修复：补齐 sites.signin_* 列',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'sites', 'signin_enabled', "INTEGER NOT NULL DEFAULT 0")
    addColumnIfMissing(db, 'sites', 'signin_time', "TEXT NOT NULL DEFAULT '09:00'")
    addColumnIfMissing(db, 'sites', 'last_signin_at', 'TEXT')
    addColumnIfMissing(db, 'sites', 'last_signin_status', 'TEXT')
    addColumnIfMissing(db, 'sites', 'last_signin_message', 'TEXT')
  }
}
