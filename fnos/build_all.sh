#!/bin/bash
# fnos/build_all.sh - 编译 x86_64 和 arm64 两个 fnOS fpk 包
# 用法: build_all.sh <version>
# 依赖: fnpack (https://developer.fnnas.com/docs/cli/fnpack)
set -u

cd "$(dirname "$0")"

VERSION="${1:-}"
APP_NAME="qqxnz.xnz-pt-automation"
OUT_DIR="../fpk"

if [ -z "$VERSION" ]; then
  echo "❌ 用法: $0 <version>" >&2
  echo "   例如: $0 0.6.4" >&2
  exit 1
fi

if ! command -v fnpack >/dev/null 2>&1; then
  echo "❌ 未检测到 fnpack，请先安装：" >&2
  echo "   curl -fsSL https://static2.fnnas.com/fnpack/fnpack-1.2.1-\$(uname | tr A-Z a-z)-\$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') -o /usr/local/bin/fnpack" >&2
  echo "   chmod +x /usr/local/bin/fnpack" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

CURRENT_ARCH=$(uname -m)
echo "ℹ️  当前主机架构: $CURRENT_ARCH"
echo "ℹ️  目标版本: $VERSION"
echo ""

restore_manifest() {
  if [ -f manifest.bak ]; then
    mv manifest.bak manifest
  fi
}

build_one() {
  local arch="$1"
  local fpk_name="${APP_NAME}-${VERSION}-${arch}.fpk"

  echo "── 构建 ${arch} ──"
  sed -i.bak "s/^arch=.*/arch=${arch}/" manifest
  sed -i.bak "s/^version=.*/version=${VERSION}/" manifest

  if ! fnpack build 2>&1; then
    echo "⚠️  ${arch} 构建失败（当前 ${CURRENT_ARCH} 主机可能无法交叉编译 ${arch}）"
    echo "   提示：在 ${arch} 主机上重新运行本脚本可补打该包"
    rm -f manifest.bak
    echo ""
    return 1
  fi

  if [ -f "${APP_NAME}.fpk" ]; then
    mv "${APP_NAME}.fpk" "${OUT_DIR}/${fpk_name}"
    rm -f manifest.bak
    echo "✅ ${fpk_name}"
    echo ""
    return 0
  fi

  echo "❌ ${arch}: fnpack 未生成产物"
  rm -f manifest.bak
  echo ""
  return 1
}

trap 'restore_manifest' EXIT

# 还原 manifest 的 arch 默认值
sed -i.bak "s/^arch=.*/arch=x86_64/" manifest 2>/dev/null || true
rm -f manifest.bak

# 编译两个架构
build_one x86_64
X86_RESULT=$?
build_one arm64
ARM_RESULT=$?

# 确保 manifest 还原
sed -i.bak "s/^arch=.*/arch=x86_64/" manifest 2>/dev/null || true
rm -f manifest.bak

echo "── 汇总 ──"
ls -la "$OUT_DIR" 2>/dev/null | tail -n +2 || true

if [ $X86_RESULT -ne 0 ]; then
  echo "⚠️  x86_64 包未生成，建议在 x86_64 主机补打"
fi
if [ $ARM_RESULT -ne 0 ]; then
  echo "⚠️  arm64 包未生成，建议在 arm64 主机补打"
fi

if [ $X86_RESULT -ne 0 ] && [ $ARM_RESULT -ne 0 ]; then
  echo "❌ 两个架构都失败，请检查 fnpack 和 fnos/manifest"
  exit 1
fi

echo ""
echo "✅ fpk 包已生成在: $OUT_DIR/"
