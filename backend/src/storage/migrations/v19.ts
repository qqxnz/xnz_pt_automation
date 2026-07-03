import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing, dropColumnIfExists } from './_helpers.js'

const TASK_RUNTIME_COLUMNS: Array<[string, string]> = [
  ['delete_on_free_expire', 'INTEGER NOT NULL DEFAULT 0'],
  ['low_upload_kbps', 'INTEGER'],
  ['low_upload_minutes', 'INTEGER'],
  ['seeder_min', 'INTEGER NOT NULL DEFAULT 0'],
  ['seeder_max', 'INTEGER NOT NULL DEFAULT 0'],
  ['size_min_gb', 'REAL'],
  ['size_max_gb', 'REAL'],
  ['torrent_count_condition', 'TEXT'],
  ['torrent_count', 'INTEGER'],
  ['sort_rule', 'TEXT'],
  ['fetch_limit', 'INTEGER NOT NULL DEFAULT 100']
]

export const v19: Migration = {
  version: 19,
  description: '自我修复：补齐所有 tasks 运行时列',
  up: (db: DatabaseSync) => {
    for (const [column, definition] of TASK_RUNTIME_COLUMNS) {
      addColumnIfMissing(db, 'tasks', column, definition)
    }
    dropColumnIfExists(db, 'tasks', 'free_only')
  }
}
