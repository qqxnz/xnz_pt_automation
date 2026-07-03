import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing } from './_helpers.js'

export const v5: Migration = {
  version: 5,
  description: '任务：size_min_gb / size_max_gb',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'tasks', 'size_min_gb', 'REAL')
    addColumnIfMissing(db, 'tasks', 'size_max_gb', 'REAL')
  }
}
