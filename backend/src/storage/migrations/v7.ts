import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { tryRemoveLegacyStateFile } from './_bootstrap.js'
import { dropLegacyStateTable } from './_bootstrap.js'

export const v7: Migration = {
  version: 7,
  description: '移除旧版 JSON 状态存储（app_state 表 / app-state.json）',
  up: (_db: DatabaseSync, ctx) => {
    dropLegacyStateTable(_db)
    tryRemoveLegacyStateFile(ctx.dataDir)
  }
}
