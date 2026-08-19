param(
    [Parameter(Mandatory = $true)]
    [string]$TargetRoot,

    [Parameter(Mandatory = $true)]
    [string]$AgentKey,

    [Parameter(Mandatory = $true)]
    [string]$CommandCenterUrl,

    [Parameter(Mandatory = $true)]
    [string]$Token
)

$ErrorActionPreference = "Stop"

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$normalizedAgent = $AgentKey.Trim().ToLowerInvariant()
if ($normalizedAgent -notmatch "^[a-z0-9_-]{2,64}$") {
    throw "Invalid AgentKey"
}

New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $TargetRoot "mcp\kanban-worker") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $TargetRoot "skills\command-center-kanban") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $TargetRoot "skills\nocodb-mcp") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $TargetRoot "skills\hiring-cafe-scraper") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $TargetRoot "credentials") | Out-Null

Copy-Item -LiteralPath (Join-Path $sourceRoot "mcp\kanban-worker\kanban-worker-mcp-server.js") -Destination (Join-Path $TargetRoot "mcp\kanban-worker\kanban-worker-mcp-server.js") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\command-center-kanban\SKILL.md") -Destination (Join-Path $TargetRoot "skills\command-center-kanban\SKILL.md") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\nocodb-mcp\nocodb-mcp.js") -Destination (Join-Path $TargetRoot "skills\nocodb-mcp\nocodb-mcp.js") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\nocodb-mcp\mission-records.js") -Destination (Join-Path $TargetRoot "skills\nocodb-mcp\mission-records.js") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\nocodb-mcp\select-base.ps1") -Destination (Join-Path $TargetRoot "skills\nocodb-mcp\select-base.ps1") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\nocodb-mcp\list-bases.ps1") -Destination (Join-Path $TargetRoot "skills\nocodb-mcp\list-bases.ps1") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\nocodb-mcp\SKILL.md") -Destination (Join-Path $TargetRoot "skills\nocodb-mcp\SKILL.md") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\hiring-cafe-scraper\scrape-hiring-cafe.js") -Destination (Join-Path $TargetRoot "skills\hiring-cafe-scraper\scrape-hiring-cafe.js") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\hiring-cafe-scraper\command-center-prospecting.js") -Destination (Join-Path $TargetRoot "skills\hiring-cafe-scraper\command-center-prospecting.js") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\hiring-cafe-scraper\import-prospecting-records.js") -Destination (Join-Path $TargetRoot "skills\hiring-cafe-scraper\import-prospecting-records.js") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\hiring-cafe-scraper\SKILL.md") -Destination (Join-Path $TargetRoot "skills\hiring-cafe-scraper\SKILL.md") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\hiring-cafe-scraper\package.json") -Destination (Join-Path $TargetRoot "skills\hiring-cafe-scraper\package.json") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\hiring-cafe-scraper\package-lock.json") -Destination (Join-Path $TargetRoot "skills\hiring-cafe-scraper\package-lock.json") -Force

@"
COMMAND_CENTER_URL=$CommandCenterUrl
COMMAND_CENTER_AGENT=$normalizedAgent
COMMAND_CENTER_TOKEN=$Token
COMMAND_CENTER_KANBAN_ACTION_LOG=$TargetRoot\mcp\kanban-worker\action_log.jsonl
COMMAND_CENTER_WORKER_ROOT=$TargetRoot
PRAXICA_KNOWLEDGE_DEFAULT_COLLECTION="10 Research"
NOCODB_MCP_CREDENTIALS_DIR=$TargetRoot\credentials
"@ | Set-Content -LiteralPath (Join-Path $TargetRoot ".env") -Encoding ASCII

@"
mcp_servers:
  command_center_kanban:
    command: "node"
    args:
      - "$((Join-Path $TargetRoot "mcp\kanban-worker\kanban-worker-mcp-server.js").Replace('\','/'))"
    env:
      COMMAND_CENTER_URL: "$CommandCenterUrl"
      COMMAND_CENTER_AGENT: "$normalizedAgent"
      COMMAND_CENTER_TOKEN: "$Token"
      COMMAND_CENTER_KANBAN_ACTION_LOG: "$((Join-Path $TargetRoot "mcp\kanban-worker\action_log.jsonl").Replace('\','/'))"
      COMMAND_CENTER_WORKER_ROOT: "$($TargetRoot.Replace('\','/'))"
      PRAXICA_KNOWLEDGE_DEFAULT_COLLECTION: "10 Research"
      NOCODB_MCP_CREDENTIALS_DIR: "$((Join-Path $TargetRoot "credentials").Replace('\','/'))"
    timeout: 120
    connect_timeout: 60
"@ | Set-Content -LiteralPath (Join-Path $TargetRoot "mcp-config.yaml") -Encoding ASCII

Write-Host "OK: installed Command Center worker kit to $TargetRoot"
Write-Host "MCP config snippet: $TargetRoot\mcp-config.yaml"
Write-Host "NocoDB credentials dir: $TargetRoot\credentials"
