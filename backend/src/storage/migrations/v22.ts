import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing } from './_helpers.js'

export const v22: Migration = {
  version: 22,
  description: '推送确认状态：torrents.push_unconfirmed',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'torrents', 'push_unconfirmed', 'INTEGER NOT NULL DEFAULT 0')
  }
}