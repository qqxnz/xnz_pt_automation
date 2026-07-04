#!/bin/bash
# xnz-pt-automation 飞牛封装打包脚本
# 依赖：fnpack (https://developer.fnnas.com/docs/cli/fnpack)
set -euo pipefail

cd "$(dirname "$0")"

VERSION="${1:-0.6.2}"
APP_NAME="qqxnz.xnz-pt-automation"

if ! command -v fnpack >/dev/null 2>&1; then
  echo "❌ 未检测到 fnpack，请先安装："
  echo "   curl -fsSL https://static2.fnnas.com/fnpack/fnpack-1.2.1-\$(uname | tr A-Z a-z)-\$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') -o /usr/local/bin/fnpack"
  echo "   chmod +x /usr/local/bin/fnpack"
  exit 1
fi

sed -i.bak "s/^version=.*/version=${VERSION}/" manifest

fnpack build

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
