import type { DatabaseSync } from 'node:sqlite'
import type { Migration } from './index.js'
import { createIndexIfMissing, createTableIfMissing } from './_helpers.js'

/**
 * v25：MCP 接入
 *   - api_tokens 表：用户主动生成的 API Token（仅存 scrypt 哈希 + 前缀）
 *   - system_settings 不动结构，由 routes/settings.ts 在 defaultSystemSettings / 校验里
 *     增加 mcp_enabled / mcp_require_loopback；老 settings_json 会通过 defaultSystemSettings
 *     兜底拿到新字段，无需 schema 改动。
 */
export const v25: Migration = {
  version: 25,
  description: 'MCP 接入：api_tokens 表',
  up: (db: DatabaseSync) => {
    createTableIfMissing(
      db,
      `CREATE TABLE api_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        token_prefix TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        allow_writes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        expires_at TEXT,
        notes TEXT
      )`
    )
    createIndexIfMissing(db, 'CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens(token_prefix)')
    createIndexIfMissing(db, 'CREATE INDEX IF NOT EXISTS idx_api_tokens_created_at ON api_tokens(created_at DESC)')
  }
}