import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing } from './_helpers.js'

export const v14: Migration = {
  version: 14,
  description: '任务：fetch_limit',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'tasks', 'fetch_limit', 'INTEGER NOT NULL DEFAULT 100')
  }
}
