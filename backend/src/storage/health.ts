/**
 * 数据库健康检查（启动兜底）
 *
 * 启动时如果 user_version == SCHEMA_VERSION 但表结构有缺列/缺表/缺行，
 * 自动修复并写 STORAGE_SCHEMA_REPAIR 操作日志。
 *
 * 升级期如果迁移中途失败留下 _new 临时表，启动时也会自动清理。
 */

import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing, createTableIfMissing, createIndexIfMissing, dropColumnIfExists, tableExists, tableHasColumn } from './migrations/_helpers.js'
import { getMeta, setMeta } from './_meta.js'

export type TableSpec = {
  name: string
  ddl: string
  /** 关键列：缺则视为损坏 */
  requiredColumns: string[]
  /** 强制保留的列（防止被误删） */
  guardedColumns?: string[]
  /** 必须存在的索引（CREATE INDEX IF NOT EXISTS DDL 列表） */
  indexes?: string[]
}

export type HealthIssue = {
  table: string
  kind: 'MISSING_TABLE' | 'MISSING_COLUMN' | 'ORPHAN_NEW_TABLE' | 'MISSING_SINGLETON'
  detail: string
}

export type HealthReport = {
  tablesChecked: number
  repairedColumns: number
  repairedTables: number
  removedNewTables: number
  issues: HealthIssue[]
}

const TABLE_SPECS: TableSpec[] = [
  {
    name: 'users',
    ddl: `CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_changed_at TEXT,
      last_login_at TEXT
    )`,
    requiredColumns: ['id', 'username', 'password_hash', 'password_changed_at', 'last_login_at']
  },
  {
    name: 'sites',
    ddl: `CREATE TABLE sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      api_key TEXT,
      cookie TEXT,
      user_agent TEXT,
      proxy_id TEXT,
      connectivity_status TEXT NOT NULL,
      current_credential TEXT,
      user_level TEXT,
      ratio REAL,
      ratio_infinite INTEGER,
      uploaded REAL,
      downloaded REAL,
      traffic_synced_at TEXT,
      last_connected_at TEXT,
      last_connect_error TEXT,
      signin_enabled INTEGER NOT NULL DEFAULT 0,
      signin_time TEXT NOT NULL DEFAULT '09:00',
      last_signin_at TEXT,
      last_signin_status TEXT,
      last_signin_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    requiredColumns: [
      'id', 'name', 'domain', 'enabled', 'api_key', 'cookie', 'user_agent', 'proxy_id',
      'connectivity_status', 'current_credential', 'user_level', 'ratio', 'ratio_infinite',
      'uploaded', 'downloaded', 'traffic_synced_at', 'last_connected_at', 'last_connect_error',
      'signin_enabled', 'signin_time', 'last_signin_at', 'last_signin_status', 'last_signin_message',
      'created_at', 'updated_at'
    ]
  },
  {
    name: 'proxies',
    ddl: `CREATE TABLE proxies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      type TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      last_test_status TEXT,
      last_tested_at TEXT
    )`,
    requiredColumns: ['id', 'name', 'enabled', 'type', 'host', 'port']
  },
  {
    name: 'downloaders',
    ddl: `CREATE TABLE downloaders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      host TEXT NOT NULL,
      username TEXT,
      password TEXT,
      save_path TEXT,
      status TEXT NOT NULL,
      status_message TEXT,
      last_tested_at TEXT,
      last_synced_at TEXT,
      has_ipv6_peers INTEGER,
      ipv6_torrent_count INTEGER,
      ipv6_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    requiredColumns: [
      'id', 'name', 'type', 'enabled', 'host', 'username', 'password', 'save_path',
      'status', 'status_message', 'last_tested_at', 'last_synced_at',
      'has_ipv6_peers', 'ipv6_torrent_count', 'ipv6_synced_at', 'created_at', 'updated_at'
    ]
  },
  {
    name: 'tasks',
    ddl: `CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      site_id TEXT NOT NULL,
      downloader_id TEXT NOT NULL,
      auto_run_enabled INTEGER NOT NULL,
      auto_run_started_at TEXT,
      next_run_at TEXT,
      interval_minutes INTEGER NOT NULL,
      only_free_download INTEGER NOT NULL,
      delete_on_free_expire INTEGER NOT NULL DEFAULT 0,
      skip_hit_and_run INTEGER NOT NULL DEFAULT 1,
      low_upload_kbps INTEGER,
      low_upload_minutes INTEGER,
      auto_push INTEGER NOT NULL,
      discount_types_json TEXT NOT NULL,
      seeder_min INTEGER NOT NULL DEFAULT 0,
      seeder_max INTEGER NOT NULL DEFAULT 0,
      size_min_gb REAL,
      size_max_gb REAL,
      torrent_count_condition TEXT,
      torrent_count INTEGER,
      sort_rule TEXT,
      fetch_limit INTEGER NOT NULL DEFAULT 100,
      save_path_override TEXT,
      category_override TEXT,
      tags_override_json TEXT,
      running INTEGER NOT NULL,
      last_run_mode TEXT,
      last_started_at TEXT,
      last_finished_at TEXT,
      last_status TEXT,
      last_summary TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    requiredColumns: [
      'id', 'name', 'site_id', 'downloader_id', 'auto_run_enabled', 'interval_minutes',
      'only_free_download', 'auto_push', 'discount_types_json', 'seeder_min', 'seeder_max',
      'fetch_limit', 'running', 'created_at', 'updated_at',
      'delete_on_free_expire', 'skip_hit_and_run', 'low_upload_kbps', 'low_upload_minutes',
      'size_min_gb', 'size_max_gb', 'torrent_count_condition', 'torrent_count', 'sort_rule'
    ]
  },
  {
    name: 'torrents',
    ddl: `CREATE TABLE torrents (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      torrent_id TEXT,
      title TEXT NOT NULL,
      title_lc TEXT NOT NULL,
      size REAL NOT NULL,
      discount_type TEXT NOT NULL,
      is_free_now INTEGER NOT NULL,
      current_state TEXT NOT NULL,
      free_end_at TEXT,
      seeders INTEGER,
      leechers INTEGER,
      push_status TEXT NOT NULL,
      link_status TEXT NOT NULL,
      only_free_download INTEGER NOT NULL,
      delete_on_free_expire INTEGER NOT NULL DEFAULT 0,
      low_upload_kbps INTEGER,
      low_upload_minutes INTEGER,
      low_upload_since TEXT,
      detail_url TEXT,
      downloader_id TEXT,
      downloader_name TEXT,
      downloader_type TEXT,
      downloader_state TEXT,
      torrent_hash TEXT,
      download_progress REAL,
      download_state TEXT,
      ratio REAL,
      upload_speed REAL,
      download_speed REAL,
      uploaded REAL,
      downloaded REAL,
      task_save_path TEXT,
      downloader_save_path TEXT,
      download_stats_synced_at TEXT,
      source_task_id TEXT,
      source_task_name TEXT,
      source_run_mode TEXT NOT NULL,
      error_message TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      pushed_at TEXT,
      download_url_hash TEXT,
      download_url TEXT,
      has_ipv6_peers INTEGER,
      ipv6_peer_count INTEGER,
      total_peer_count INTEGER,
      peer_sync_rid INTEGER,
      peer_synced_at TEXT
    )`,
    requiredColumns: [
      'id', 'site_id', 'site_name', 'title', 'title_lc', 'size', 'discount_type',
      'is_free_now', 'current_state', 'push_status', 'link_status', 'only_free_download',
      'source_run_mode', 'first_seen_at', 'last_seen_at',
      'has_ipv6_peers', 'ipv6_peer_count', 'total_peer_count', 'peer_sync_rid', 'peer_synced_at',
      'delete_on_free_expire', 'low_upload_kbps', 'low_upload_minutes', 'low_upload_since'
    ]
  },
  {
    name: 'operation_logs',
    ddl: `CREATE TABLE operation_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      message TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      ip TEXT,
      user_agent TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    requiredColumns: ['id', 'action', 'message', 'status', 'created_at'],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at DESC)`
    ]
  },
  {
    name: 'task_logs',
    ddl: `CREATE TABLE task_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      task_name TEXT NOT NULL,
      run_mode TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      fetched_count INTEGER,
      matched_count INTEGER,
      skipped_existing_count INTEGER,
      pushed_count INTEGER,
      push_failed_count INTEGER,
      summary TEXT,
      error_message TEXT,
      fetch_error_message TEXT,
      push_error_messages_json TEXT,
      failure_details_json TEXT,
      created_at TEXT NOT NULL
    )`,
    requiredColumns: ['id', 'task_name', 'message', 'status', 'created_at'],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_task_logs_created ON task_logs(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_task_logs_task_created ON task_logs(task_id, created_at DESC)`
    ]
  },
  {
    name: 'schedule_logs',
    ddl: `CREATE TABLE schedule_logs (
      id TEXT PRIMARY KEY,
      job_name TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduled_at TEXT,
      triggered_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      summary TEXT,
      error_message TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL
    )`,
    requiredColumns: ['id', 'job_name', 'message', 'status', 'created_at'],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_schedule_logs_created ON schedule_logs(created_at DESC)`
    ]
  },
  {
    name: 'site_signin_logs',
    ddl: `CREATE TABLE site_signin_logs (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      run_mode TEXT NOT NULL,
      trigger_source TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      error_message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    )`,
    requiredColumns: ['id', 'site_id', 'site_name', 'run_mode', 'trigger_source', 'status', 'message', 'started_at', 'created_at'],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_site_signin_logs_created ON site_signin_logs(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_site_signin_logs_site ON site_signin_logs(site_id, created_at DESC)`
    ]
  },
  {
    name: 'torrent_logs',
    ddl: `CREATE TABLE torrent_logs (
      id TEXT PRIMARY KEY,
      torrent_id TEXT,
      site_id TEXT,
      site_name TEXT,
      torrent_title TEXT NOT NULL,
      event TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      reason TEXT,
      source TEXT,
      actor_id TEXT,
      actor_name TEXT,
      created_at TEXT NOT NULL
    )`,
    requiredColumns: ['id', 'torrent_title', 'event', 'status', 'message', 'created_at'],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_torrent_logs_created ON torrent_logs(created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_torrent_logs_torrent ON torrent_logs(torrent_id, created_at DESC)`
    ]
  },
  {
    name: 'site_traffic_snapshots',
    ddl: `CREATE TABLE site_traffic_snapshots (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      date TEXT NOT NULL,
      uploaded REAL,
      downloaded REAL,
      ratio REAL,
      ratio_infinite INTEGER,
      synced_at TEXT NOT NULL
    )`,
    requiredColumns: ['id', 'site_id', 'site_name', 'date', 'synced_at']
  },
  {
    name: 'site_torrent_traffic_daily',
    ddl: `CREATE TABLE site_torrent_traffic_daily (
      date TEXT NOT NULL,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      uploaded REAL NOT NULL DEFAULT 0,
      downloaded REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (date, site_id)
    )`,
    requiredColumns: ['date', 'site_id', 'site_name', 'uploaded', 'downloaded', 'updated_at'],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_site_torrent_traffic_daily_site_date ON site_torrent_traffic_daily(site_id, date)`
    ]
  },
  {
    name: 'torrent_traffic_cursors',
    ddl: `CREATE TABLE torrent_traffic_cursors (
      torrent_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      uploaded REAL NOT NULL DEFAULT 0,
      downloaded REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,
    requiredColumns: ['torrent_id', 'site_id', 'site_name', 'uploaded', 'downloaded', 'updated_at']
  },
  {
    name: 'system_settings',
    ddl: `CREATE TABLE system_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      settings_json TEXT NOT NULL,
      updated_at TEXT
    )`,
    requiredColumns: ['id', 'settings_json']
  }
]

const TORRENT_INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_torrents_first_seen ON torrents(first_seen_at DESC, id)`,
  `CREATE INDEX IF NOT EXISTS idx_torrents_site ON torrents(site_id)`,
  `CREATE INDEX IF NOT EXISTS idx_torrents_downloader ON torrents(downloader_id)`,
  `CREATE INDEX IF NOT EXISTS idx_torrents_task ON torrents(source_task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_torrents_push_status ON torrents(push_status)`,
  `CREATE INDEX IF NOT EXISTS idx_torrents_current_state ON torrents(current_state)`,
  `CREATE INDEX IF NOT EXISTS idx_torrents_run_mode ON torrents(source_run_mode)`,
  `CREATE INDEX IF NOT EXISTS idx_torrents_download_url_hash ON torrents(download_url_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_torrents_torrent_hash ON torrents(torrent_hash)`
]

function extractColumnDefsFromDdl(ddl: string): Array<{ name: string; definition: string }> {
  const match = /\(([\s\S]+)\)\s*;?\s*$/.exec(ddl.trim())
  if (!match) return []
  const body = match[1]
  const parts: string[] = []
  let depth = 0
  let buf = ''
  for (const ch of body) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim())
      buf = ''
    } else {
      buf += ch
    }
  }
  if (buf.trim()) parts.push(buf.trim())
  const out: Array<{ name: string; definition: string }> = []
  for (const part of parts) {
    if (/^\s*(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)/i.test(part)) continue
    const m = /^\s*(\w+)\s+([\s\S]+)$/.exec(part)
    if (!m) continue
    out.push({ name: m[1], definition: m[2].replace(/,$/, '').trim() })
  }
  return out
}

export function inspectDatabaseHealth(db: DatabaseSync): HealthReport {
  const report: HealthReport = {
    tablesChecked: 0,
    repairedColumns: 0,
    repairedTables: 0,
    removedNewTables: 0,
    issues: []
  }

  for (const spec of TABLE_SPECS) {
    report.tablesChecked++
    if (!tableExists(db, spec.name)) {
      const created = createTableIfMissing(db, spec.ddl)
      if (created) {
        report.repairedTables++
        report.issues.push({ table: spec.name, kind: 'MISSING_TABLE', detail: '表不存在已重建' })
      }
    } else {
      const cols = extractColumnDefsFromDdl(spec.ddl)
      for (const { name, definition } of cols) {
        if (tableHasColumn(db, spec.name, name)) continue
        const fixed = addColumnIfMissing(db, spec.name, name, definition)
        if (fixed) {
          report.repairedColumns++
          report.issues.push({
            table: spec.name,
            kind: 'MISSING_COLUMN',
            detail: `补齐列 ${name}`
          })
        }
      }
    }
    if (spec.indexes) {
      for (const ddl of spec.indexes) {
        createIndexIfMissing(db, ddl)
      }
    }
    if (spec.name === 'torrents') {
      for (const ddl of TORRENT_INDEXES) createIndexIfMissing(db, ddl)
    }
  }

  if (tableExists(db, 'users')) {
    const row = db.prepare('SELECT 1 AS ok FROM users WHERE id = ?').get('admin') as
      | { ok?: number }
      | undefined
    if (!row?.ok) {
      report.issues.push({ table: 'users', kind: 'MISSING_SINGLETON', detail: 'admin 用户缺失' })
    }
  }
  if (tableExists(db, 'system_settings')) {
    const row = db.prepare('SELECT 1 AS ok FROM system_settings WHERE id = 1').get() as
      | { ok?: number }
      | undefined
    if (!row?.ok) {
      report.issues.push({ table: 'system_settings', kind: 'MISSING_SINGLETON', detail: '系统设置单行缺失' })
    }
  }

  const orphanResult = cleanupOrphanNewTables(db)
  report.removedNewTables = orphanResult.removed.length
  for (const t of orphanResult.removed) {
    report.issues.push({ table: t, kind: 'ORPHAN_NEW_TABLE', detail: '上次迁移失败遗留的临时表已清理' })
  }

  return report
}

function cleanupOrphanNewTables(db: DatabaseSync): { removed: string[] } {
  const removed: string[] = []
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%\\_new' ESCAPE '\\'")
    .all() as Array<{ name: string }>
  for (const r of rows) {
    try {
      db.exec(`DROP TABLE IF EXISTS ${r.name}`)
      removed.push(r.name)
    } catch {
      // 忽略
    }
  }
  return { removed }
}

export function hasHealthIssues(report: HealthReport): boolean {
  return report.issues.length > 0
}

export function summarizeHealth(report: HealthReport): string {
  if (report.issues.length === 0) return '结构健康检查通过'
  const parts: string[] = []
  if (report.repairedTables) parts.push(`重建 ${report.repairedTables} 张表`)
  if (report.repairedColumns) parts.push(`补齐 ${report.repairedColumns} 列`)
  if (report.removedNewTables) parts.push(`清理 ${report.removedNewTables} 个临时表`)
  return parts.join('；')
}

export { TABLE_SPECS }
