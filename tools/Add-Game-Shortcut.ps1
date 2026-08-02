<#
.SYNOPSIS
  Adds a "Claude - <game>" desktop shortcut for an existing game folder.

.PARAMETER Path
  Path to an existing game's repo folder. If omitted, a folder-picker opens.

.PARAMETER All
  Instead of one folder, scan Documents\GitHub for every game project (any
  folder with a package.json, other than dg-template itself) and add a
  shortcut for each.

.EXAMPLE
  .\Add-Game-Shortcut.ps1 -All

.EXAMPLE
  .\Add-Game-Shortcut.ps1 -Path 'C:\Users\Mason\Documents\GitHub\some-game'
#>
param(
    [string]$Path,
    [switch]$All
)

$ErrorActionPreference = 'Stop'

$templateRoot = Split-Path -Parent $PSScriptRoot          # .../dg-template
$gitHubRoot   = Split-Path -Parent $templateRoot          # .../Documents/GitHub

if ($All) {
    $repos = Get-ChildItem -Path $gitHubRoot -Directory |
        Where-Object { $_.FullName -ne $templateRoot -and (Test-Path (Join-Path $_.FullName 'package.json')) }

    if (-not $repos) {
        Write-Host "No existing game projects found under $gitHubRoot." -ForegroundColor Yellow
        return
    }

    foreach ($repo in $repos) {
        & (Join-Path $PSScriptRoot 'New-ClaudeShortcut.ps1') -Path $repo.FullName
    }
    Write-Host "`nCreated shortcuts for $($repos.Count) existing game(s)." -ForegroundColor Green
    return
}

if (-not $Path) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Pick the game folder to add a Claude shortcut for"
    if (Test-Path $gitHubRoot) {
        $dialog.SelectedPath = $gitHubRoot
    }
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        Write-Host "Cancelled." -ForegroundColor Yellow
        return
    }
    $Path = $dialog.SelectedPath
}

if (-not (Test-Path -LiteralPath $Path)) {
    Write-Host "That folder doesn't exist: $Path" -ForegroundColor Red
    exit 1
}

& (Join-Path $PSScriptRoot 'New-ClaudeShortcut.ps1') -Path $Path
