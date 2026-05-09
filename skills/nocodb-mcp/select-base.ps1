param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$BaseAlias,

    [Parameter(Mandatory = $true, Position = 1)]
    [string]$Command,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CommandArgs
)

$workerRoot = if ($env:COMMAND_CENTER_WORKER_ROOT) {
    $env:COMMAND_CENTER_WORKER_ROOT
} else {
    Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$credentialsDir = if ($env:NOCODB_MCP_CREDENTIALS_DIR) {
    $env:NOCODB_MCP_CREDENTIALS_DIR
} else {
    Join-Path $workerRoot 'credentials'
}

$aliasMap = @{
    "main"            = "main"
    "getting-started" = "main"
    "hiring-cafe"     = "hiring-cafe"
    "hiring.cafe"     = "hiring-cafe"
    "hiring cafe"     = "hiring-cafe"
    "praxica"         = "praxica"
    "praxica.io"      = "praxica"
    "sourcedeck"      = "sourcedeck"
    "sourcedeck.io"   = "sourcedeck"
}

$normalizedAlias = $BaseAlias.Trim().ToLowerInvariant()
$canonicalAlias = if ($aliasMap.ContainsKey($normalizedAlias)) { $aliasMap[$normalizedAlias] } else { $normalizedAlias }
$configFile = if ($canonicalAlias -eq 'main') { 'nocodb-mcp.local.json' } else { "nocodb-mcp.$canonicalAlias.local.json" }
$configPath = Join-Path $credentialsDir $configFile

if (-not (Test-Path -LiteralPath $configPath)) {
    Write-Error "Missing NocoDB config for alias '$BaseAlias': $configPath"
    exit 1
}

$env:COMMAND_CENTER_WORKER_ROOT = $workerRoot
$env:NOCODB_MCP_CREDENTIALS_DIR = $credentialsDir
$env:NOCODB_MCP_CONFIG = $configPath
$scriptPath = Join-Path $PSScriptRoot 'nocodb-mcp.js'

if (-not (Test-Path -LiteralPath $scriptPath)) {
    Write-Error "Missing nocodb-mcp.js at $scriptPath"
    exit 1
}

& node $scriptPath $Command @CommandArgs
exit $LASTEXITCODE
