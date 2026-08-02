<#
.SYNOPSIS
  One-time setup: adds the "New Diffenderfer Game" and "Add Claude Shortcut"
  launchers to the desktop, and (optionally) a shortcut for every game that
  already exists under Documents\GitHub.

  Run this once. After that your son just double-clicks "New Diffenderfer Game"
  whenever he wants to start a new project.
#>

$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

function New-LauncherShortcut {
    param([string]$Name, [string]$ScriptName, [string]$Description)

    $scriptPath = Join-Path $PSScriptRoot $ScriptName
    $shortcutPath = Join-Path $desktop "$Name.lnk"
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = (Get-Command powershell.exe).Source
    $shortcut.Arguments = "-NoExit -NoLogo -ExecutionPolicy Bypass -File `"$scriptPath`""
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.Description = $Description
    $shortcut.Save()
    Write-Host "Created: $shortcutPath" -ForegroundColor Green
}

New-LauncherShortcut -Name "New Diffenderfer Game" -ScriptName "New-Game.ps1" `
    -Description "Create a new diffenderfer.games project and launch Claude Code in it"

New-LauncherShortcut -Name "Add Claude Shortcut" -ScriptName "Add-Game-Shortcut.ps1" `
    -Description "Add a desktop launcher for an existing game's Claude Code session"

Write-Host "`nWant a 'Claude - <game>' shortcut for every game you already have under Documents\GitHub? (y/n)" -ForegroundColor Cyan
$answer = Read-Host
if ($answer -match '^(y|yes)$') {
    & (Join-Path $PSScriptRoot 'Add-Game-Shortcut.ps1') -All
}

Write-Host "`nSetup complete. Check the desktop." -ForegroundColor Cyan
