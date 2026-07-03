import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { dropColumnIfExists } from './_helpers.js'

export const v13: Migration = {
  version: 13,
  description: '移除 tasks.free_only 旧列',
  up: (db: DatabaseSync) => {
    dropColumnIfExists(db, 'tasks', 'free_only')
  }
}
