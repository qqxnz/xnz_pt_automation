#!/bin/bash
# xnz-pt-automation 飞牛封装打包脚本
# 依赖：fnpack (https://developer.fnnas.com/docs/cli/fnpack)
set -euo pipefail

cd "$(dirname "$0")"

VERSION="${1:-0.6.2}"
APP_NAME="qqxnz.pta"

if ! command -v fnpack >/dev/null 2>&1; then
  echo "ℹ️  fnpack 未安装，尝试自动安装…"

  OS=$(uname | tr A-Z a-z)
  RAW_ARCH=$(uname -m)
  case "$RAW_ARCH" in
    x86_64) ARCH=amd64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *)
      echo "❌ 不支持的主机架构: $RAW_ARCH" >&2
      echo "   请手动安装 fnpack：https://developer.fnnas.com/docs/cli/fnpack" >&2
      exit 1
      ;;
  esac

  FNPACK_URL="https://static2.fnnas.com/fnpack/fnpack-1.2.1-${OS}-${ARCH}"
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  INSTALL_PATH="$INSTALL_DIR/fnpack"

  if curl -fsSL --fail -o "$INSTALL_PATH" "$FNPACK_URL"; then
    chmod +x "$INSTALL_PATH"
    echo "✅ fnpack 已下载到 $INSTALL_PATH"
  else
    echo "❌ 自动下载 fnpack 失败" >&2
    echo "   请手动安装：curl -fsSL $FNPACK_URL -o $INSTALL_PATH && chmod +x $INSTALL_PATH" >&2
    exit 1
  fi

  FNPACK_CMD="$INSTALL_PATH"
else
  FNPACK_CMD="fnpack"
fi

sed -i.bak "s/^version=.*/version=${VERSION}/" manifest

"$FNPACK_CMD" build

FPK_NAME="${APP_NAME}-${VERSION}.fpk"
if [ -f "${APP_NAME}.fpk" ]; then
  mv "${APP_NAME}.fpk" "../$FPK_NAME"
  rm -f manifest.bak
  echo ""
  echo "✅ 打包完成: ../$FPK_NAME"
  echo "   飞牛安装命令：appcenter-cli install-fpk ../$FPK_NAME"
else
  rm -f manifest.bak
  echo "❌ fnpack 构建未生成 ${APP_NAME}.fpk"
  exit 1
fi
