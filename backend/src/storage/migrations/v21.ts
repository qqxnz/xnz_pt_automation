import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing } from './_helpers.js'

export const v21: Migration = {
  version: 21,
  description: 'HR 拦截：tasks.skip_hit_and_run',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'tasks', 'skip_hit_and_run', 'INTEGER NOT NULL DEFAULT 1')
  }
}
