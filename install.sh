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
mkdir -p "$TARGET_ROOT/mcp/kanban-worker" "$TARGET_ROOT/skills/command-center-kanban" "$TARGET_ROOT/skills/nocodb-mcp" "$TARGET_ROOT/skills/hiring-cafe-scraper" "$TARGET_ROOT/credentials"

cp "$SOURCE_ROOT/mcp/kanban-worker/kanban-worker-mcp-server.js" "$TARGET_ROOT/mcp/kanban-worker/kanban-worker-mcp-server.js"
cp "$SOURCE_ROOT/skills/command-center-kanban/SKILL.md" "$TARGET_ROOT/skills/command-center-kanban/SKILL.md"
cp "$SOURCE_ROOT/skills/nocodb-mcp/nocodb-mcp.js" "$TARGET_ROOT/skills/nocodb-mcp/nocodb-mcp.js"
cp "$SOURCE_ROOT/skills/nocodb-mcp/mission-records.js" "$TARGET_ROOT/skills/nocodb-mcp/mission-records.js"
cp "$SOURCE_ROOT/skills/nocodb-mcp/select-base.ps1" "$TARGET_ROOT/skills/nocodb-mcp/select-base.ps1"
cp "$SOURCE_ROOT/skills/nocodb-mcp/list-bases.ps1" "$TARGET_ROOT/skills/nocodb-mcp/list-bases.ps1"
cp "$SOURCE_ROOT/skills/nocodb-mcp/SKILL.md" "$TARGET_ROOT/skills/nocodb-mcp/SKILL.md"
cp "$SOURCE_ROOT/skills/hiring-cafe-scraper/scrape-hiring-cafe.js" "$TARGET_ROOT/skills/hiring-cafe-scraper/scrape-hiring-cafe.js"
cp "$SOURCE_ROOT/skills/hiring-cafe-scraper/command-center-prospecting.js" "$TARGET_ROOT/skills/hiring-cafe-scraper/command-center-prospecting.js"
cp "$SOURCE_ROOT/skills/hiring-cafe-scraper/import-prospecting-records.js" "$TARGET_ROOT/skills/hiring-cafe-scraper/import-prospecting-records.js"
cp "$SOURCE_ROOT/skills/hiring-cafe-scraper/SKILL.md" "$TARGET_ROOT/skills/hiring-cafe-scraper/SKILL.md"
cp "$SOURCE_ROOT/skills/hiring-cafe-scraper/package.json" "$TARGET_ROOT/skills/hiring-cafe-scraper/package.json"
cp "$SOURCE_ROOT/skills/hiring-cafe-scraper/package-lock.json" "$TARGET_ROOT/skills/hiring-cafe-scraper/package-lock.json"

cat > "$TARGET_ROOT/.env" <<EOF
COMMAND_CENTER_URL=$COMMAND_CENTER_URL
COMMAND_CENTER_AGENT=$AGENT_KEY
COMMAND_CENTER_TOKEN=$TOKEN
COMMAND_CENTER_KANBAN_ACTION_LOG=$TARGET_ROOT/mcp/kanban-worker/action_log.jsonl
COMMAND_CENTER_WORKER_ROOT=$TARGET_ROOT
PRAXICA_KNOWLEDGE_DEFAULT_COLLECTION="10 Research"
NOCODB_MCP_CREDENTIALS_DIR=$TARGET_ROOT/credentials
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
      COMMAND_CENTER_WORKER_ROOT: "$TARGET_ROOT"
      PRAXICA_KNOWLEDGE_DEFAULT_COLLECTION: "10 Research"
      NOCODB_MCP_CREDENTIALS_DIR: "$TARGET_ROOT/credentials"
    timeout: 120
    connect_timeout: 60
EOF

echo "OK: installed Command Center worker kit to $TARGET_ROOT"
echo "NocoDB credentials dir: $TARGET_ROOT/credentials"
