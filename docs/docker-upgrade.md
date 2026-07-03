# Docker 升级排错指南

本指南面向使用 Docker 部署的运维人员，介绍升级 PT Automation 时可能遇到的日志以及对应的处理方式。

## 1. 升级时的正常日志

`docker compose pull && docker compose up -d` 后查看日志：

```bash
docker compose logs -f xnz-pt-automation
```

正常升级的日志会按以下顺序出现：

### 1.1 pre-start 阶段

```
[pre-start] XNZ-PT-Automation pre-start
[pre-start] Data dir: /data
[pre-start] Image version: 0.5.18
[pre-start] Detected SQLite at /data/app.db
[pre-start] DB user_version: 15
[pre-start] Image schema version: 21
============================================================
DATABASE UPGRADE REQUIRED
============================================================
[pre-start] Detected upgrade: v15 -> v21
[pre-start] Progress will be reported in docker logs
[pre-start] DO NOT stop the container during upgrade
[pre-start] If upgrade fails, docker will auto-restart and recover from backup
```

### 1.2 升级进行中

```
============================================================
⏳ DATABASE UPGRADE IN PROGRESS  v15 → v21
============================================================
   please wait, do NOT stop the container
   progress will be reported in docker logs
   backup: /data/db-20260703-100001-pre-v15.sqlite3  (314572 bytes)
   step 1/5  v15 → v16  做种人数改为范围：seeder_min / seeder_max
   step 2/5  v16 → v17  自我修复：补齐 tasks 运行时列（兼容老库）
   step 3/5  v17 → v18  自我修复：移除阻塞旧列 free_only
   step 4/5  v18 → v19  自我修复：补齐所有 tasks 运行时列
   step 5/5  v20 → v21  HR 拦截：tasks.skip_hit_and_run
```

### 1.3 升级完成

```
============================================================
✅ DATABASE UPGRADE COMPLETED  v15 → v21
============================================================
   total versions: 5
   duration: 2ms
   backup: /data/db-20260703-100001-pre-v15.sqlite3
   legacy tables (retain 30 days): sites_legacy_v15, tasks_legacy_v15, torrents_legacy_v15
[server] PT Automation ready (schema v21, db v15)
```

## 2. 升级失败的日志

```
============================================================
❌ DATABASE UPGRADE FAILED  v15 → v21
============================================================
   error: v17 addColumnIfMissing: ...
   backup preserved at: /data/db-20260703-100001-pre-v15.sqlite3
   restarting container to retry from backup
   exit code: 10  (docker will auto-restart unless restart limit reached)
```

**含义**：v17 步骤抛错。docker 会在几秒后自动重启容器；下次启动会自动用备份恢复并重试。

最多自动重启 5 次（`docker-compose.yml` 的 `restart: on-failure:5`）。

## 3. 降级拒绝的日志

```
[pre-start][ERROR] ============================================================
DOWNGRADE REJECTED
============================================================
[pre-start][ERROR] Database is v22 but image expects v21
[pre-start][ERROR] Please pull a newer image (>= v22) and restart
[pre-start][ERROR] exit code: 7 (docker will not auto-restart)
```

**含义**：你拉了新版本（v22+）启动后，又想回退到 v21 旧版本。`exit 7` 表示 docker 不会自动重启。

**处理**：
- 拉回新版本镜像：`docker compose pull && docker compose up -d`
- 或确认你真的需要降级（不推荐）

## 4. 升级卡住不动的可能原因

1. **磁盘满**：`df -h /data` 查剩余空间；备份 + 迁移需要约 2x 当前 db 大小
2. **WAL 文件残留**：重启前先 `docker compose down`，删 `data/*.db-wal` / `data/*.db-shm`
3. **文件系统不支持 WAL**：ext4 / btrfs / xfs 都支持；某些 NAS 文件系统（如某些 SMB 挂载）可能不支持

## 5. 数据恢复手册

### 5.1 升级失败但 docker 已停止自动重启

```bash
# 1. 找到最近的备份
docker run --rm -v <data-volume>:/data alpine ls -lh /data/db-*.sqlite3

# 2. 选最近一个备份恢复
docker run --rm -v <data-volume>:/data alpine \
  cp /data/db-...-pre-v15.sqlite3 /data/app.db.recover

# 3. 停掉当前容器
docker compose down

# 4. 用备份覆盖
cp <data-volume>/app.db.recover <data-volume>/app.db

# 5. 启动
docker compose up -d
```

### 5.2 想完全重新开始

```bash
# 警告：会清空所有数据
docker compose down -v
rm -rf ./data/*
docker compose up -d
```

## 6. /api/health 状态对照表

| 返回 | 含义 | 是否需要操作 |
| --- | --- | --- |
| `200 {status:"OK"}` | 正常 | 否 |
| `200 {status:"MIGRATING", percent:45}` | 升级中 | 等待，docker logs 有进度 |
| `200 {status:"FAILED", lastError:"...", lastBackupPath:"..."}` | 升级失败 | 等待 docker 自动重启（最多 5 次） |
| `200 {status:"DOWNGRADE_REJECTED"}` | 镜像版本低于数据库 | 拉新版本镜像 |
| `200 {status:"STARTING"}` | 启动中（< 1s） | 否 |

## 7. 关联文档

- [database-migration.md](./database-migration.md) — 迁移规范、新增字段 checklist
- [pt-automation-technical-design.md](./pt-automation-technical-design.md) — 系统总览
