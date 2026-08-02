<#
.SYNOPSIS
  Creates a desktop shortcut that opens a terminal in a game folder and starts Claude Code.

.PARAMETER Path
  Path to the game's repo folder.

.PARAMETER Name
  Display name for the shortcut. Defaults to the folder name.
#>
param(
    [Parameter(Mandatory)] [string]$Path,
    [string]$Name
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\Icon.ps1')

$Path = (Resolve-Path -LiteralPath $Path).Path

if (-not $Name) {
    $Name = Split-Path $Path -Leaf
}

$desktop = [Environment]::GetFolderPath('Desktop')
$safeName = ($Name -replace '[<>:"/\\|?*]', '').Trim()
$shortcutPath = Join-Path $desktop "Claude - $safeName.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = (Get-Command powershell.exe).Source
$shortcut.Arguments = "-NoExit -NoLogo -ExecutionPolicy Bypass -Command `"Set-Location -LiteralPath '$Path'; claude`""
$shortcut.WorkingDirectory = $Path
$shortcut.Description = "Launch Claude Code in $Name"

$icon = Get-GameIcon -GamePath $Path
if ($icon) {
    $shortcut.IconLocation = "$icon,0"
}

$shortcut.Save()

Write-Host "Desktop shortcut created: $shortcutPath" -ForegroundColor Green
