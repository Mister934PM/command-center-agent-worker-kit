param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$BaseAlias,

    [Parameter(Mandatory = $true, Position = 1)]
    [string]$Command,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CommandArgs
)

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

$baseIds = @{
    "main"        = "pd6ks71ihvvtpen"
    "hiring-cafe" = "prwnmdijh9wlrx9"
    "praxica"     = "pia6bumiscfio0p"
    "sourcedeck"  = "ptefvr801ewl3dk"
}

$normalizedAlias = $BaseAlias.Trim().ToLowerInvariant()
$canonicalAlias = if ($aliasMap.ContainsKey($normalizedAlias)) { $aliasMap[$normalizedAlias] } else { $normalizedAlias }
if (-not $baseIds.ContainsKey($canonicalAlias)) {
    Write-Error "Unknown NocoDB base alias: $BaseAlias"
    exit 1
}
$baseId = $baseIds[$canonicalAlias]
$adminScript = "C:\Users\user\.vixxie\workspace\skills\nocodb-admin\nocodb-admin.js"

if (Test-Path -LiteralPath $adminScript) {
    if ($Command -eq 'base-info') {
        $basesJson = & node $adminScript bases
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        $bases = $basesJson | Out-String | ConvertFrom-Json
        $base = @($bases) | Where-Object { $_.id -eq $baseId } | Select-Object -First 1
        $base | ConvertTo-Json -Depth 20
        exit 0
    }

    if ($Command -eq 'tables') {
        & node $adminScript tables --base $baseId
        exit $LASTEXITCODE
    }

    if ($Command -eq 'schema' -or $Command -eq 'columns') {
        if (-not $CommandArgs -or -not $CommandArgs[0]) {
            Write-Error "schema requires TABLE_ID"
            exit 1
        }
        & node $adminScript columns --table $CommandArgs[0]
        exit $LASTEXITCODE
    }

    if ($Command -eq 'records') {
        if (-not $CommandArgs -or -not $CommandArgs[0]) {
            Write-Error "records requires TABLE_ID [limit]"
            exit 1
        }
        $limit = if ($CommandArgs.Count -ge 2) { $CommandArgs[1] } else { "20" }
        & node $adminScript records --table $CommandArgs[0] --limit $limit
        exit $LASTEXITCODE
    }
}

$workerRoot = if ($env:COMMAND_CENTER_WORKER_ROOT) {
    $env:COMMAND_CENTER_WORKER_ROOT
} else {
    Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$configFile = if ($canonicalAlias -eq 'main') { 'nocodb-mcp.local.json' } else { "nocodb-mcp.$canonicalAlias.local.json" }
$credentialsDir = if ($env:NOCODB_MCP_CREDENTIALS_DIR) {
    $env:NOCODB_MCP_CREDENTIALS_DIR
} else {
    $homeDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
    $candidates = @(
        (Join-Path $homeDir '.vixxie\credentials'),
        (Join-Path $workerRoot 'credentials')
    )
    $match = $candidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ $configFile) } | Select-Object -First 1
    if ($match) { $match } else { $candidates[0] }
}

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

