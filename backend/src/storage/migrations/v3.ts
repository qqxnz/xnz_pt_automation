import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing } from './_helpers.js'

export const v3: Migration = {
  version: 3,
  description: '任务：torrentCountCondition / torrentCount',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'tasks', 'torrent_count_condition', 'TEXT')
    addColumnIfMissing(db, 'tasks', 'torrent_count', 'INTEGER')
  }
}
