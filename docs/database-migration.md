# 数据库迁移规范

## 1. 目标

- 升级时不会因为"漏写 ALTER"导致服务起不来
- 升级失败时可以自动从备份恢复
- 用户在 `docker logs` 上能看到完整升级进度
- 老库（任意版本）能一次升级到当前版本

## 2. 迁移文件约定

每个迁移是一个文件 `backend/src/storage/migrations/v{N}.ts`：

```ts
import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing, createIndexIfMissing, createTableIfMissing, dropColumnIfExists } from './_helpers.js'

export const vN: Migration = {
  version: N,
  description: '一句话说明这次改了什么',
  up: (db: DatabaseSync) => {
    // 用 addColumnIfMissing 而不是直接 ALTER TABLE —— 这样可以幂等
    addColumnIfMissing(db, 'tasks', 'new_column', 'TEXT')
    createTableIfMissing(db, `CREATE TABLE new_table (...)`)
    createIndexIfMissing(db, `CREATE INDEX IF NOT EXISTS idx_name ON new_table(col)`)
    dropColumnIfExists(db, 'tasks', 'obsolete_column')
  }
}
```

**约定**：
- 必须 `export const version = N`
- 必须 `export const description = '...'` （中文或英文，简短）
- `up(db)` 函数中只用幂等的 helper（`addColumnIfMissing` / `createTableIfMissing` / `createIndexIfMissing` / `dropColumnIfExists`）
- 不要在 `up` 里写 `INSERT/UPDATE/DELETE` 数据操作（数据迁移放到 `_bootstrap.ts`）
- 不要在 `up` 里手动 `PRAGMA user_version = N`（由 `runMigrations` 自动设置）
- 不要在 `up` 里写 `BEGIN/COMMIT/ROLLBACK`（由 `runMigrations` 包裹事务）

## 3. 新增字段/表的 checklist

每加一个 `v{N}` **必须**同步完成 5 件事：

1. 在 `backend/src/storage/migrations/v{N}.ts` 新建文件并实现 `up`
2. 在 `backend/src/storage/migrations/index.ts` 把 `SCHEMA_VERSION` 从 `N-1` 改成 `N`，并把 `vN` 加进 `MIGRATIONS` 数组
3. 在 `backend/src/storage/health.ts` 的 `TABLE_SPECS` 里给对应表加新列到 `ddl` 字段 + `requiredColumns`（用于启动时兜底校验）
4. 在 `docs/pt-automation-technical-design.md` 第 18 节更新"实际表结构"小节
5. 在 `docs/<涉及的模块>-plan.md` 字段说明里加一句"详见 `docs/database-migration.md`"

漏任一步 → 升级到该版本时会出现以下问题：
- 漏 1 → 升级时该字段缺失，运行时报错
- 漏 3 → 启动时健康检查无法自动修复，导出/排序会出错

## 4. 升级失败时会发生什么

```
1. 容器启动
   ↓
2. pre-start.sh 检测 /data 可写、读 user_version
   ↓ (发现需要升级)
3. [migration] ⏳ 数据库正在升级：v15 → v21
4. [migration]    已生成备份：/data/db-...-pre-v15.sqlite3  （xxxxxx 字节）
5. [migration]    进度 1/5：v15 → v16  描述...
6. [migration]    进度 2/5：v16 → v17  描述...
7. ...
   ↓ (如果某步失败)
8. [migration] ❌ 数据库升级失败：v15 → v21
9. [migration]    错误：v17 addColumnIfMissing: no such column: x
10. [migration]    备份保留在：/data/db-...-pre-v15.sqlite3
11. [migration]    退出码 10（达到重启上限前，docker 会自动重启）
   ↓
12. 容器退出 10，docker 自动重启
   ↓ (下次启动)
13. pre-start.sh 检测到 last_migration_status=FAILED
   ↓
14. 自动用 last_backup_path 恢复 db
   ↓
15. 重新尝试升级
```

最多自动重启 5 次（`docker-compose.yml` `restart: on-failure:5`）。如果 5 次后仍失败，停止自动重启，用户需要：
- 查看 `docker logs <container> --tail 200` 找到失败原因
- 手动从备份恢复：`docker cp /path/to/backup.sqlite3 <container>:/data/app.db && docker restart <container>`
- 或拉更新版本的镜像

## 5. 升级期间的服务状态

| 状态 | `/api/health` | 其他 `/api/*` | 前端 |
| --- | --- | --- | --- |
| STARTING | 200 `{status:'STARTING'}` | 503 | (前端目前未拦截，浏览器会 503) |
| MIGRATING | 200 `{status:'MIGRATING', from, to, percent, currentTable}` | 503 `{error:'MIGRATING', percent}` | (同上) |
| READY | 200 `{status:'OK'}` | 200 | 正常 |
| MIGRATION_FAILED | 200 `{status:'FAILED', lastError, lastBackupPath}` | 503 | (前端会 503) |
| DOWNGRADE_REJECTED | 200 `{status:'DOWNGRADE_REJECTED', ...}` | 503 | (前端会 503) |

## 6. 旧表（_legacy_v*）清理

每次升级时旧表保留为 `*_legacy_v{prev}`，30 天后由 `legacyReaper` 在启动时清理。

如果想立即清理：
- 删 `data/*_legacy_v*.db*` 不行（那是备份文件）
- 通过 `system-info` 接口或直接 sqlite3 进入 `app.db` 查 `*_legacy_v*` 表
- `app_meta` 表有 `legacy_retain_<table>` 字段记录保留日期，删除该行可让 reaper 立即清理

## 7. 常见操作

### 查看当前数据库版本

```bash
docker exec <container> sqlite3 /data/app.db "PRAGMA user_version;"
```

或 `GET /api/settings/system-info` 看 `database.schemaVersion`。

### 查看上次迁移结果

```bash
docker exec <container> sqlite3 /data/app.db \
  "SELECT key, value FROM app_meta WHERE key LIKE 'last_migration%' OR key = 'migrated_at' OR key = 'migrated_from';"
```

或 `GET /api/settings/system-info.database`。

### 查看备份文件

```bash
ls -lh /data/db-*.sqlite3
```

最近保留 10 份。

### 强制从备份恢复

```bash
docker stop <container>
docker cp <container>:/data/db-...-pre-vX.sqlite3 /tmp/restore.db
docker cp /tmp/restore.db <container>:/data/app.db
docker start <container>
```

## 8. 不要做的事

- ❌ **不要手工用 sqlite3 改库**（`ALTER TABLE ADD COLUMN` 之后 user_version 不会自动更新，会导致升级流程错乱）
- ❌ **不要删除 `app_meta` 表**（保存 schema_version 和迁移状态）
- ❌ **不要在升级中途 `docker stop` 容器**（事务会自动 ROLLBACK 但状态可能不一致）
- ❌ **不要跨多版本跳着读 docs**（每个版本独立，跨读会遗漏破坏性变更）
- ❌ **不要在 `up` 里写 `db.exec('PRAGMA user_version = N')`**（由 `runMigrations` 自动设置）
