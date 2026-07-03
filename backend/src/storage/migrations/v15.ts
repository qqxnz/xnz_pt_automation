import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing } from './_helpers.js'

export const v15: Migration = {
  version: 15,
  description: '兜底：再次确保 fetch_limit 列存在',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'tasks', 'fetch_limit', 'INTEGER NOT NULL DEFAULT 100')
  }
}
