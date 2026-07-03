import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing } from './_helpers.js'

export const v12: Migration = {
  version: 12,
  description: '任务：sort_rule',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'tasks', 'sort_rule', 'TEXT')
  }
}
