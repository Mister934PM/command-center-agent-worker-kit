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

Copy-Item -LiteralPath (Join-Path $sourceRoot "mcp\kanban-worker\kanban-worker-mcp-server.js") -Destination (Join-Path $TargetRoot "mcp\kanban-worker\kanban-worker-mcp-server.js") -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "skills\command-center-kanban\SKILL.md") -Destination (Join-Path $TargetRoot "skills\command-center-kanban\SKILL.md") -Force

@"
COMMAND_CENTER_URL=$CommandCenterUrl
COMMAND_CENTER_AGENT=$normalizedAgent
COMMAND_CENTER_TOKEN=$Token
COMMAND_CENTER_KANBAN_ACTION_LOG=$TargetRoot\mcp\kanban-worker\action_log.jsonl
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
    timeout: 120
    connect_timeout: 60
"@ | Set-Content -LiteralPath (Join-Path $TargetRoot "mcp-config.yaml") -Encoding ASCII

Write-Host "OK: installed Command Center worker kit to $TargetRoot"
Write-Host "MCP config snippet: $TargetRoot\mcp-config.yaml"
