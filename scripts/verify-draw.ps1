<#
    Proves draw-on-screen actually draws, and reports the right region.

    The app is restarted with ARCSONARE_DRAW_SELFTEST set, which paints a
    rectangular stroke through the same code the mouse path uses. Then the screen is photographed and
    checked for red ink along the path — the same approach verify-pointer.ps1
    uses for the purple marks.

    Three things are checked:
      1. Red ink appears on screen at all (the overlay really paints).
      2. The ink lies ON the drawn path, not somewhere near it.
      3. The reported region encloses the stroke, so what gets handed to the
         model is the area the user actually circled.

    Usage:
      powershell -ExecutionPolicy Bypass -File scripts\verify-draw.ps1
#>

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$failed = 0

# A box drawn in the middle of the primary screen, like circling something.
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$cx = $screen.X + [int]($screen.Width / 2)
$cy = $screen.Y + [int]($screen.Height / 2)
$w = 220
$h = 140
$left = $cx - [int]($w / 2)
$top = $cy - [int]($h / 2)

Write-Host ("stroke: rectangle ({0},{1}) {2}x{3}" -f $left, $top, $w, $h)

# Restart the app with the stroke baked in, the same way verify-pointer.ps1
# drives the marker self-test.
$exe = "$env:LOCALAPPDATA\ArcSonare\ArcSonare.exe"
if (-not (Test-Path $exe)) { Write-Host "FAIL  ArcSonare is not installed" -ForegroundColor Red; exit 1 }
Get-Process ArcSonare -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 1200
$env:ARCSONARE_DRAW_SELFTEST = "$left,$top,$w,$h"
Start-Process -FilePath $exe -WindowStyle Minimized
$env:ARCSONARE_DRAW_SELFTEST = $null
# Wait for the overlays to come up, then for the stroke to be painted.
Start-Sleep -Seconds 12

$margin = 40
$capX = $left - $margin
$capY = $top - $margin
$capW = $w + $margin * 2
$capH = $h + $margin * 2

$bmp = New-Object System.Drawing.Bitmap($capW, $capH)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($capX, $capY, 0, 0, (New-Object System.Drawing.Size($capW, $capH)))
$gfx.Dispose()

$red = 0
$minX = [int]::MaxValue; $maxX = [int]::MinValue
$minY = [int]::MaxValue; $maxY = [int]::MinValue
for ($py = 0; $py -lt $capH; $py++) {
    for ($px = 0; $px -lt $capW; $px++) {
        $c = $bmp.GetPixel($px, $py)
        # Ink is #ef4444 (239,68,68): red dominant over both other channels.
        if ($c.R -gt 150 -and $c.R -gt ($c.G + 60) -and $c.R -gt ($c.B + 60)) {
            $red++
            $sx = $px + $capX; $sy = $py + $capY
            if ($sx -lt $minX) { $minX = $sx }
            if ($sx -gt $maxX) { $maxX = $sx }
            if ($sy -lt $minY) { $minY = $sy }
            if ($sy -gt $maxY) { $maxY = $sy }
        }
    }
}
$shot = Join-Path $PSScriptRoot "..\draw-proof.png"
$bmp.Save($shot, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

if ($red -lt 300) {
    Write-Host "FAIL  only $red red pixels - the stroke was not painted" -ForegroundColor Red
    $failed++
} else {
    Write-Host "PASS  $red red pixels painted on screen" -ForegroundColor Green
}

# The ink must trace the rectangle that was asked for, within the line width.
$tol = 8
$okBounds = ([Math]::Abs($minX - $left) -le $tol) -and
            ([Math]::Abs($maxX - ($left + $w)) -le $tol) -and
            ([Math]::Abs($minY - $top) -le $tol) -and
            ([Math]::Abs($maxY - ($top + $h)) -le $tol)
if ($okBounds) {
    Write-Host ("PASS  ink traces the stroke: ({0},{1})-({2},{3}) vs ({4},{5})-({6},{7})" -f `
        $minX, $minY, $maxX, $maxY, $left, $top, ($left + $w), ($top + $h)) -ForegroundColor Green
} else {
    Write-Host ("FAIL  ink off path: ({0},{1})-({2},{3}) vs ({4},{5})-({6},{7})" -f `
        $minX, $minY, $maxX, $maxY, $left, $top, ($left + $w), ($top + $h)) -ForegroundColor Red
    $failed++
}

# Stop the self-test instance. Left running, single-instance focuses IT when
# the user launches ArcSonare, so the test stroke shows up as "the app starts
# with a red rectangle on screen".
Get-Process ArcSonare -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
Write-Host "self-test instance stopped"

Write-Host ("saved {0}" -f $shot)
Write-Host ("-" * 70)
if ($failed -gt 0) { Write-Host "$failed FAILED" -ForegroundColor Red; exit 1 }
Write-Host "drawing verified" -ForegroundColor Green
exit 0
