#!/bin/sh
# XNZ-PT-Automation pre-start script
# 在启动 pm2 / node 之前：
#   1) 检测 /data 可写
#   2) 打印当前 schema 版本与镜像版本
#   3) 提示用户升级进度将出现在 docker logs
#   4) 检测降级（数据库 user_version > 镜像 SCHEMA_VERSION）→ exit 7 拒绝启动
#
# 退出码：
#   0  - 正常，继续启动 node/pm2
#   7  - 降级拒绝，docker 不会自动重启（除非另行配置）
#   1  - 致命错误，docker 会按 restart 策略重启

set -u

DATA_DIR="${DATA_DIR:-/data}"
DB_FILE="${DATA_DIR}/app.db"

banner() {
  printf '\n'
  printf '============================================================\n'
  printf '%s\n' "$1"
  printf '============================================================\n'
}

info() {
  printf '[pre-start] %s\n' "$1"
}

warn() {
  printf '[pre-start][WARN] %s\n' "$1" >&2
}

err() {
  printf '[pre-start][ERROR] %s\n' "$1" >&2
}

banner "XNZ-PT-Automation pre-start"
info "Data dir: ${DATA_DIR}"

# 1) 检查 data 目录可写
if [ ! -d "${DATA_DIR}" ]; then
  err "data dir ${DATA_DIR} does not exist; container should mount a volume here"
  exit 1
fi
if ! touch "${DATA_DIR}/.write-test" 2>/dev/null; then
  err "data dir ${DATA_DIR} is not writable"
  exit 1
fi
rm -f "${DATA_DIR}/.write-test"

# 2) 读取镜像版本
IMAGE_VERSION="${XNZ_VERSION:-unknown}"
info "Image version: ${IMAGE_VERSION}"

# 3) 读取数据库 user_version
DB_VERSION="0"
if [ -f "${DB_FILE}" ]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    DB_VERSION=$(sqlite3 "${DB_FILE}" "PRAGMA user_version;" 2>/dev/null || echo "0")
  else
    DB_VERSION="(unknown - sqlite3 cli not present; node will validate on boot)"
  fi
fi
info "Detected SQLite at ${DB_FILE}"
info "DB user_version: ${DB_VERSION}"

# 4) 通过环境变量传入 schema version（由镜像构建时注入），否则用占位 unknown
#    node 端会在启动时基于镜像代码里的 SCHEMA_VERSION 做真实校验
SCHEMA_VERSION="${XNZ_SCHEMA_VERSION:-unknown}"
info "Image schema version: ${SCHEMA_VERSION}"

# 5) 降级检测：仅在 DB_VERSION 与 SCHEMA_VERSION 都是数字时做严格比较
if [ "${DB_VERSION}" != "0" ] && [ "${SCHEMA_VERSION}" != "unknown" ] && [ "${DB_VERSION}" != "${SCHEMA_VERSION}" ]; then
  if [ "${DB_VERSION}" -gt "${SCHEMA_VERSION}" ] 2>/dev/null; then
    banner "DOWNGRADE REJECTED"
    err "Database is v${DB_VERSION} but image expects v${SCHEMA_VERSION}"
    err "Please pull a newer image (>= v${DB_VERSION}) and restart"
    err "exit code: 7 (docker will not auto-restart)"
    exit 7
  fi
  if [ "${DB_VERSION}" -lt "${SCHEMA_VERSION}" ] 2>/dev/null; then
    banner "DATABASE UPGRADE REQUIRED"
    info "Detected upgrade: v${DB_VERSION} -> v${SCHEMA_VERSION}"
    info "Progress will be reported in docker logs"
    info "DO NOT stop the container during upgrade"
    info "If upgrade fails, docker will auto-restart and recover from backup"
  fi
fi

banner "PRE-START OK - launching node process"
if command -v pm2-runtime >/dev/null 2>&1; then
  exec pm2-runtime ecosystem.config.cjs
else
  exec node /app/backend/dist/server.js
fi
