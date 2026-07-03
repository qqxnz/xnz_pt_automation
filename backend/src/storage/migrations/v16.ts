import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing, tableHasColumn } from './_helpers.js'

export const v16: Migration = {
  version: 16,
  description: '做种人数改为范围：seeder_min / seeder_max',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'tasks', 'seeder_min', 'INTEGER NOT NULL DEFAULT 0')
    addColumnIfMissing(db, 'tasks', 'seeder_max', 'INTEGER NOT NULL DEFAULT 0')
    if (tableHasColumn(db, 'tasks', 'seeder_condition') || tableHasColumn(db, 'tasks', 'seeder_count')) {
      db.exec("UPDATE tasks SET seeder_condition = NULL, seeder_count = NULL")
    }
  }
}
