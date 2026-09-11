$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$faturaNode = Get-Command node -ErrorAction SilentlyContinue
$faturaPnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $faturaNode -or -not $faturaPnpm) {
    $faturaRuntime = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies'
    $faturaNodePath = Join-Path $faturaRuntime 'node/bin/node.exe'
    $faturaPnpmPath = Join-Path $faturaRuntime 'bin/fallback/pnpm.cmd'
    if (-not (Test-Path -LiteralPath $faturaNodePath) -or -not (Test-Path -LiteralPath $faturaPnpmPath)) {
        throw 'Instale Node.js 24 LTS e pnpm 11 para iniciar o aplicativo.'
    }
    $env:PATH = (Split-Path -Parent $faturaNodePath) + [IO.Path]::PathSeparator + $env:PATH
} else { $faturaPnpmPath = $faturaPnpm.Source }
$env:NEXT_TELEMETRY_DISABLED = '1'
if (-not (Test-Path -LiteralPath 'node_modules')) { & $faturaPnpmPath install --frozen-lockfile }
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Não foi possível instalar as dependências.' }
& $faturaPnpmPath dev
