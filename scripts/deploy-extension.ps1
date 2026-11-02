param([Parameter(Mandatory=$true)][string]$Source)
$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
if (!(Test-Path -LiteralPath (Join-Path $sourcePath 'manifest.json'))) { throw 'Source has no manifest.json' }
$manifest = Get-Content -Raw -LiteralPath (Join-Path $sourcePath 'manifest.json') | ConvertFrom-Json
if ($manifest.name -ne 'Codex Browser Workspaces') { throw 'Unexpected extension manifest' }
$root = Join-Path $env:LOCALAPPDATA 'CodexBrowserWorkspaces'
$destination = Join-Path $root 'extension'
New-Item -ItemType Directory -Force -Path $root | Out-Null
if (Test-Path -LiteralPath $destination) {
  $backup = Join-Path $root ('extension-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
  Move-Item -LiteralPath $destination -Destination $backup
  Write-Output "Previous extension retained at $backup"
}
Copy-Item -LiteralPath $sourcePath -Destination $destination -Recurse
Write-Output "Extension deployed to $destination"
Write-Output 'Load unpacked (first install) or Reload (update) in chrome://extensions. Do not restart Chrome.'
