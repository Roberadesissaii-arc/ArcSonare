<#
    Capture the screen to a PNG, for feeding the vision checks.

    Pass -WindowTitle to capture one window instead of the whole monitor. That
    matters for the control checks: their expectations are fractions of the
    image, so a window that fills a third of an ultrawide monitor would put
    every control in the left third and fail for the wrong reason.

    Usage:
      powershell -ExecutionPolicy Bypass -File scripts\grab-screen.ps1 out.png
      powershell -ExecutionPolicy Bypass -File scripts\grab-screen.ps1 out.png -WindowTitle YouTube
#>
param(
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$WindowTitle
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if ($WindowTitle) {
    $sig = @"
using System; using System.Runtime.InteropServices;
public class GrabWin {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
}
"@
    Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue
    $proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*$WindowTitle*" } | Select-Object -First 1
    if (-not $proc) { Write-Error "no window matching '$WindowTitle'"; exit 1 }
    $r = New-Object GrabWin+RECT
    [GrabWin]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null
    $b = New-Object System.Drawing.Rectangle($r.L, $r.T, ($r.R - $r.L), ($r.B - $r.T))
} else {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
}
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($b.X, $b.Y, 0, 0, (New-Object System.Drawing.Size($b.Width, $b.Height)))
$gfx.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host ("captured {0}x{1} from ({2},{3}) -> {4}" -f $b.Width, $b.Height, $b.X, $b.Y, $Out)
