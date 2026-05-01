#!/usr/bin/env sh
set -eu

TARGET_ROOT="${1:?target root required}"
AGENT_KEY="${2:?agent key required}"
COMMAND_CENTER_URL="${3:?command center url required}"
TOKEN="${4:?token required}"

case "$AGENT_KEY" in
  *[!a-z0-9_-]*|"") echo "Invalid agent key" >&2; exit 1 ;;
esac

SOURCE_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p "$TARGET_ROOT/mcp/kanban-worker" "$TARGET_ROOT/skills/command-center-kanban"

cp "$SOURCE_ROOT/mcp/kanban-worker/kanban-worker-mcp-server.js" "$TARGET_ROOT/mcp/kanban-worker/kanban-worker-mcp-server.js"
cp "$SOURCE_ROOT/skills/command-center-kanban/SKILL.md" "$TARGET_ROOT/skills/command-center-kanban/SKILL.md"

cat > "$TARGET_ROOT/.env" <<EOF
COMMAND_CENTER_URL=$COMMAND_CENTER_URL
COMMAND_CENTER_AGENT=$AGENT_KEY
COMMAND_CENTER_TOKEN=$TOKEN
COMMAND_CENTER_KANBAN_ACTION_LOG=$TARGET_ROOT/mcp/kanban-worker/action_log.jsonl
EOF

cat > "$TARGET_ROOT/mcp-config.yaml" <<EOF
mcp_servers:
  command_center_kanban:
    command: "node"
    args:
      - "$TARGET_ROOT/mcp/kanban-worker/kanban-worker-mcp-server.js"
    env:
      COMMAND_CENTER_URL: "$COMMAND_CENTER_URL"
      COMMAND_CENTER_AGENT: "$AGENT_KEY"
      COMMAND_CENTER_TOKEN: "$TOKEN"
      COMMAND_CENTER_KANBAN_ACTION_LOG: "$TARGET_ROOT/mcp/kanban-worker/action_log.jsonl"
    timeout: 120
    connect_timeout: 60
EOF

echo "OK: installed Command Center worker kit to $TARGET_ROOT"
