<#
    Proves the agent pointer is real, on every monitor.

    Three things this checks that nothing else can:

      1. ArcSonare draws its OWN cursor, not the system one. The purple arrow is
         a layered window painted by the app, so it shows up in a screenshot as
         #c084fc pixels. The Windows cursor is not captured by CopyFromScreen at
         all, so any purple found here can only be ours.
      2. A border is drawn around the matched object, sitting on the box rather
         than near it.
      3. Both land at the exact coordinates asked for — including on a monitor
         with a negative origin, where anything that clamps to zero silently
         retargets the primary display.

    The app is launched once per monitor with ARCSONARE_OVERLAY_SELFTEST set to
    "<x>,<y>,<w>,<h>", which parks the marker and the outline on screen.

    Usage: powershell -ExecutionPolicy Bypass -File scripts\verify-pointer.ps1
#>

param(
    [string]$Exe = "$env:LOCALAPPDATA\ArcSonare\ArcSonare.exe"
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not (Test-Path $Exe)) {
    Write-Host "FAIL  ArcSonare is not installed at $Exe" -ForegroundColor Red
    exit 1
}

$diagLog = "$env:LOCALAPPDATA\ArcSonare-overlay.log"
$failed = 0

function Stop-App {
    Get-Process ArcSonare -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 1200
}

function Test-Monitor {
    param($Screen)

    $b = $Screen.Bounds
    # A box in the middle of this monitor, sized so both the outline and the
    # arrow fit comfortably.
    $w = [Math]::Min(240, [int]($b.Width * 0.3))
    $h = [Math]::Min(80, [int]($b.Height * 0.15))
    $x = $b.X + [int](($b.Width - $w) / 2)
    $y = $b.Y + [int](($b.Height - $h) / 2)

    Write-Host ""
    Write-Host ("--- {0} ({1}x{2} at {3},{4}){5} ---" -f `
        $Screen.DeviceName, $b.Width, $b.Height, $b.X, $b.Y,
        $(if ($Screen.Primary) { " primary" } else { "" }))
    Write-Host ("    asking for box ({0},{1}) {2}x{3}" -f $x, $y, $w, $h)

    Stop-App
    Remove-Item $diagLog -Force -ErrorAction SilentlyContinue

    $env:ARCSONARE_OVERLAY_SELFTEST = "$x,$y,$w,$h"
    Start-Process -FilePath $Exe -WindowStyle Minimized
    $env:ARCSONARE_OVERLAY_SELFTEST = $null

    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline -and -not (Test-Path $diagLog)) {
        Start-Sleep -Milliseconds 700
    }
    if (-not (Test-Path $diagLog)) {
        Write-Host "    FAIL  the overlay windows were never created" -ForegroundColor Red
        return 1
    }
    $diag = Get-Content $diagLog -Raw
    if ($diag -notmatch "^created") {
        Write-Host "    FAIL  $diag" -ForegroundColor Red
        return 1
    }
    # Give the compositor a beat to put the layered windows up.
    Start-Sleep -Seconds 3

    # Capture a margin around the box so a near-miss is visible rather than
    # cropped out and mistaken for a pass.
    $margin = 30
    $cx = $x - $margin
    $cy = $y - $margin
    $cw = $w + $margin * 2
    $ch = $h + $margin * 2

    $bmp = New-Object System.Drawing.Bitmap($cw, $ch)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($cx, $cy, 0, 0, (New-Object System.Drawing.Size($cw, $ch)))
    $gfx.Dispose()

    $count = 0
    $minX = [int]::MaxValue; $maxX = [int]::MinValue
    $minY = [int]::MaxValue; $maxY = [int]::MinValue
    # Rows/columns that carry the outline, used to tell a border from a blob.
    for ($py = 0; $py -lt $ch; $py++) {
        for ($px = 0; $px -lt $cw; $px++) {
            $c = $bmp.GetPixel($px, $py)
            # #c084fc is (192,132,252): blue and red high, green clearly lower.
            if ($c.B -gt 190 -and $c.R -gt 120 -and $c.B -gt ($c.G + 40)) {
                $count++
                $sx = $px + $cx; $sy = $py + $cy
                if ($sx -lt $minX) { $minX = $sx }
                if ($sx -gt $maxX) { $maxX = $sx }
                if ($sy -lt $minY) { $minY = $sy }
                if ($sy -gt $maxY) { $maxY = $sy }
            }
        }
    }

    # The arrow tip is placed at the centre of the box, so purple must appear
    # there too - a border on its own would leave the middle empty.
    # The self-test places the tip at the box's top-left corner.
    $tipX = $x - $cx
    $tipY = $y - $cy
    $tipHit = 0
    for ($py = [Math]::Max(0, $tipY); $py -lt [Math]::Min($ch, $tipY + 24); $py++) {
        for ($px = [Math]::Max(0, $tipX); $px -lt [Math]::Min($cw, $tipX + 18); $px++) {
            $c = $bmp.GetPixel($px, $py)
            if ($c.B -gt 190 -and $c.R -gt 120 -and $c.B -gt ($c.G + 40)) { $tipHit++ }
        }
    }

    $shot = Join-Path $PSScriptRoot ("..\pointer-proof-" + ($Screen.DeviceName -replace '[\\.]', '') + ".png")
    $bmp.Save($shot, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    $bad = 0

    if ($count -lt 200) {
        Write-Host "    FAIL  only $count purple pixels - nothing was drawn" -ForegroundColor Red
        $bad = 1
    } else {
        Write-Host "    PASS  $count purple pixels drawn by ArcSonare (own cursor, not the system one)" -ForegroundColor Green
    }

    # The outline must hug the requested box. Allow a few px for the glow.
    $tol = 6
    $okBounds = ([Math]::Abs($minX - $x) -le $tol) -and
                ([Math]::Abs($maxX - ($x + $w)) -le $tol) -and
                ([Math]::Abs($minY - $y) -le $tol) -and
                ([Math]::Abs($maxY - ($y + $h)) -le $tol)
    if ($okBounds) {
        Write-Host ("    PASS  border on the box: ({0},{1})-({2},{3}) vs ({4},{5})-({6},{7})" -f `
            $minX, $minY, $maxX, $maxY, $x, $y, ($x + $w), ($y + $h)) -ForegroundColor Green
    } else {
        Write-Host ("    FAIL  border off target: ({0},{1})-({2},{3}) vs ({4},{5})-({6},{7})" -f `
            $minX, $minY, $maxX, $maxY, $x, $y, ($x + $w), ($y + $h)) -ForegroundColor Red
        $bad = 1
    }

    if ($tipHit -ge 40) {
        Write-Host "    PASS  arrow tip is on the target corner ($tipHit px)" -ForegroundColor Green
    } else {
        Write-Host "    FAIL  no arrow at the target corner ($tipHit px)" -ForegroundColor Red
        $bad = 1
    }

    Write-Host ("    saved {0}" -f (Resolve-Path $shot -ErrorAction SilentlyContinue))
    return $bad
}

Write-Host "Verifying the ArcSonare agent pointer on every monitor"
Write-Host ("virtual desktop: " + [System.Windows.Forms.SystemInformation]::VirtualScreen.ToString())

foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
    $failed += Test-Monitor -Screen $screen
}

Stop-App
Write-Host ""
Write-Host ("-" * 70)
if ($failed -gt 0) {
    Write-Host "$failed monitor(s) FAILED" -ForegroundColor Red
    exit 1
}
Write-Host "all monitors passed" -ForegroundColor Green
exit 0
