<#
.SYNOPSIS
  Asks for a new game's name, creates it from the dg-template, adds a desktop
  shortcut for it, and drops you into a Claude Code session in the new folder.
#>

$ErrorActionPreference = 'Stop'

$templateRoot = Split-Path -Parent $PSScriptRoot          # .../dg-template
$gitHubRoot   = Split-Path -Parent $templateRoot          # .../Documents/GitHub

$reservedNames = @(
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
)

function Read-NewGameName {
    while ($true) {
        $name = Read-Host "`nWhat's the name of your new game?"
        $name = $name.Trim()
        if ([string]::IsNullOrWhiteSpace($name)) {
            Write-Host "Please type a name." -ForegroundColor Yellow
            continue
        }

        $folder = ($name -replace '[<>:"/\\|?*]', '') -replace '\s+', '-'
        $folder = $folder.Trim('.', ' ', '-')
        if ([string]::IsNullOrWhiteSpace($folder)) {
            Write-Host "That name doesn't leave any valid characters for a folder - try something else." -ForegroundColor Yellow
            continue
        }
        if ($reservedNames -contains $folder.ToUpper()) {
            Write-Host "'$folder' is a reserved Windows name - try something else." -ForegroundColor Yellow
            continue
        }

        $target = Join-Path $gitHubRoot $folder
        if (Test-Path $target) {
            Write-Host "A folder called '$folder' already exists in Documents\GitHub. Pick another name." -ForegroundColor Yellow
            continue
        }

        return [PSCustomObject]@{ Display = $name; Folder = $folder; Path = $target }
    }
}

Write-Host "=== New diffenderfer.games project ===" -ForegroundColor Cyan
$game = Read-NewGameName

Write-Host "`nCreating '$($game.Folder)' from the template..." -ForegroundColor Cyan
robocopy $templateRoot $game.Path /E /XD .git node_modules dist tools | Out-Null

Push-Location $game.Path
try {
    git init | Out-Null
    git add -A | Out-Null
    git commit -m "Start $($game.Display)" --quiet | Out-Null
} catch {
    Write-Host "(Skipped git init - you can run it by hand later.)" -ForegroundColor DarkYellow
} finally {
    Pop-Location
}

$pkgPath = Join-Path $game.Path 'package.json'
if (Test-Path $pkgPath) {
    try {
        $raw = [System.IO.File]::ReadAllText($pkgPath, [System.Text.Encoding]::UTF8)
        $pkg = $raw | ConvertFrom-Json
        if ($pkg.game) {
            $pkg.game.title = $game.Display
        }
        $json = $pkg | ConvertTo-Json -Depth 20
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($pkgPath, $json, $utf8NoBom)
    } catch {
        Write-Host "(Couldn't auto-update the game title in package.json - edit it by hand.)" -ForegroundColor DarkYellow
    }
}

& (Join-Path $PSScriptRoot 'New-ClaudeShortcut.ps1') -Path $game.Path -Name $game.Display

Write-Host "`n'$($game.Display)' is ready at $($game.Path)" -ForegroundColor Green
Write-Host "A desktop shortcut was created so you can jump back in any time." -ForegroundColor Green
Write-Host "`nStarting Claude..." -ForegroundColor Cyan

Set-Location $game.Path
claude
