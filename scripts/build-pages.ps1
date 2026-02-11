param(
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$deployDir = Join-Path $Root 'deploy/pages'
$utilsOut = Join-Path $deployDir 'src/utils'
$zipPath = Join-Path $Root 'deploy/pages.zip'

New-Item -ItemType Directory -Force -Path $deployDir | Out-Null
New-Item -ItemType Directory -Force -Path $utilsOut | Out-Null

# Copy static site files (root only). Note: `-Include` is unreliable without wildcards; filter by extension explicitly.
$exts = @('.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico')
$rootFiles = Get-ChildItem -Path $Root -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'server.js' -and $exts -contains $_.Extension.ToLowerInvariant() }

foreach ($f in $rootFiles) {
    Copy-Item -Force -Path $f.FullName -Destination (Join-Path $deployDir $f.Name)
}

# Copy shared utils.
Copy-Item -Force -Path (Join-Path $Root 'src/utils/*.js') -Destination $utilsOut

# Rebuild zip for Cloudflare Pages "Upload your static files".
Compress-Archive -Path (Join-Path $deployDir '*') -DestinationPath $zipPath -Force

Write-Host "Built: $zipPath"
