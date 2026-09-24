#!/usr/bin/env bash
# scripts/mcp-smoke.sh
#
# 烟雾测试：在 MCP HTTP 端点上跑一次 initialize → tools/list → tools/call。
#
# 使用：
#   MCP_URL=http://localhost:3180/mcp \
#   MCP_TOKEN=tk_xxxxxxxx \
#   bash scripts/mcp-smoke.sh
#
# 要求：
#   - jq（用于解析 JSON-RPC 响应）
#   - 服务端 mcp_enabled=true 且 mcp_require_loopback=false（远程访问），或者在容器内本机调用
#
# 成功：所有步骤返回有效 JSON，tools/list 至少 1 个 tool。

set -euo pipefail

if [[ -z "${MCP_URL:-}" || -z "${MCP_TOKEN:-}" ]]; then
  echo "Usage: MCP_URL=... MCP_TOKEN=... bash scripts/mcp-smoke.sh" >&2
  exit 2
fi

if ! command -v jq >/dev/null; then
  echo "jq is required for this smoke test" >&2
  exit 2
fi

REQUEST_ID=1

rpc() {
  local method="$1"
  local params="${2:-null}"
  local body
  body=$(printf '{"jsonrpc":"2.0","id":%d,"method":%s,"params":%s}' "$REQUEST_ID" "$(printf '%s' "$method" | jq -R .)" "$params")
  REQUEST_ID=$((REQUEST_ID+1))
  curl -sS -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "X-MCP-Token: $MCP_TOKEN" \
    -d "$body"
}

echo "==> initialize"
INIT=$(rpc initialize '{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}')
echo "$INIT" | jq . || exit 1
SERVER_NAME=$(echo "$INIT" | jq -r '.result.serverInfo.name')
echo "server: $SERVER_NAME"

echo "==> tools/list"
LIST=$(rpc tools/list '{}')
COUNT=$(echo "$LIST" | jq '.result.tools | length')
echo "tool count: $COUNT"
if [[ "$COUNT" -lt 1 ]]; then
  echo "ERROR: no tools returned" >&2
  exit 1
fi
echo "$LIST" | jq -r '.result.tools[].name' | sort | head -10

echo "==> tools/call list_sites"
CALL=$(rpc tools/call '{"name":"list_sites","arguments":{}}')
TOTAL=$(echo "$CALL" | jq -r '.result.content[0].text' | jq '.total')
echo "list_sites total: $TOTAL"

echo "==> tools/call get_system_info"
SYS=$(rpc tools/call '{"name":"get_system_info","arguments":{}}')
VERSION=$(echo "$SYS" | jq -r '.result.content[0].text' | jq -r '.version')
echo "version: $VERSION"

echo
echo "smoke test passed"