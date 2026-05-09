param()

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

if (-not (Test-Path -LiteralPath $credentialsDir)) {
    Write-Error "Missing credentials directory: $credentialsDir"
    exit 1
}

$aliases = @()

if (Test-Path -LiteralPath (Join-Path $credentialsDir 'nocodb-mcp.local.json')) {
    $aliases += 'main'
}

Get-ChildItem -LiteralPath $credentialsDir -Filter 'nocodb-mcp.*.local.json' -File |
    ForEach-Object {
        $name = $_.BaseName
        if ($name -match '^nocodb-mcp\.(.+)\.local$') {
            $aliases += $matches[1]
        }
    }

@($aliases | Sort-Object -Unique) | ConvertTo-Json
