# Shared helper: build a .ico from a game's cover.png so its desktop
# shortcut shows real cover art instead of a generic icon.
# Returns the .ico path, or $null if no cover art / conversion failed.

if (-not ([System.Management.Automation.PSTypeName]'DgIconNative.User32').Type) {
    Add-Type -Namespace DgIconNative -Name User32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool DestroyIcon(System.IntPtr hIcon);
'@ -ErrorAction SilentlyContinue
}

function Get-GameIcon {
    param([Parameter(Mandatory)] [string]$GamePath)

    $pngPath = Join-Path $GamePath 'cover.png'
    if (-not (Test-Path $pngPath)) { return $null }

    try {
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop

        $cacheDir = Join-Path $env:LOCALAPPDATA 'dg-game-icons'
        if (-not (Test-Path $cacheDir)) {
            New-Item -ItemType Directory -Path $cacheDir | Out-Null
        }
        $icoPath = Join-Path $cacheDir ((Split-Path $GamePath -Leaf) + '.ico')

        $source = [System.Drawing.Image]::FromFile($pngPath)
        $square = New-Object System.Drawing.Bitmap 256, 256
        $g = [System.Drawing.Graphics]::FromImage($square)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($source, 0, 0, 256, 256)

        $hicon = $square.GetHicon()
        $icon = [System.Drawing.Icon]::FromHandle($hicon)
        $stream = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
        $icon.Save($stream)
        $stream.Close()

        $g.Dispose()
        $square.Dispose()
        $source.Dispose()
        [void][DgIconNative.User32]::DestroyIcon($hicon)

        return $icoPath
    } catch {
        return $null
    }
}
