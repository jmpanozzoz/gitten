#Requires -Version 5.1
<#
.SYNOPSIS
  Installs gitten on Windows.
.EXAMPLE
  irm https://raw.githubusercontent.com/jmpanozzoz/gitten/main/install.ps1 | iex
#>
[CmdletBinding()] param()
$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

$REPO     = "jmpanozzoz/gitten"
$ASSET    = "gitten-windows-x64.exe"
$BINARY   = "gitten.exe"
$BAR_W    = 36

# ── clack-style primitives ─────────────────────────────────────────────────────
function _Sep  { Write-Host "  " -NoNewline; Write-Host "│" -ForegroundColor DarkGray }
function _Msg  { param($m)
  Write-Host "  " -NoNewline; Write-Host "│" -NoNewline -ForegroundColor DarkGray
  Write-Host "  $m"
}
function _Row  { param($label, $value)
  Write-Host "  " -NoNewline; Write-Host "│" -NoNewline -ForegroundColor DarkGray
  Write-Host "  " -NoNewline
  Write-Host ("{0,-12}" -f $label) -NoNewline -ForegroundColor DarkGray
  Write-Host "  $value"
}
function _Ok   { param($m)
  Write-Host "  " -NoNewline; Write-Host "◇" -NoNewline -ForegroundColor DarkGray
  Write-Host "  " -NoNewline; Write-Host "✓" -NoNewline -ForegroundColor Green
  Write-Host "  $m"
}
function _Warn { param($m)
  Write-Host "  " -NoNewline; Write-Host "│" -NoNewline -ForegroundColor DarkGray
  Write-Host "  " -NoNewline; Write-Host "▲" -NoNewline -ForegroundColor Yellow
  Write-Host "  $m"
}
function _Fail { param($m)
  Write-Host "  " -NoNewline; Write-Host "│" -NoNewline -ForegroundColor DarkGray
  Write-Host "  " -NoNewline; Write-Host "✗" -NoNewline -ForegroundColor Red
  Write-Host "  $m"; exit 1
}
function _Act  { param($m)
  Write-Host "  " -NoNewline; Write-Host "◆" -NoNewline -ForegroundColor Cyan
  Write-Host "  $m"
}
function _Intro { param($m)
  Write-Host ""
  _Sep
  Write-Host "  " -NoNewline; Write-Host "◇" -NoNewline -ForegroundColor DarkGray
  Write-Host "  " -NoNewline; Write-Host $m -ForegroundColor White
  _Sep
}
function _Outro { param($m)
  _Sep
  Write-Host "  " -NoNewline; Write-Host "└" -NoNewline -ForegroundColor DarkGray
  Write-Host "  $m"
  Write-Host ""
}
function _Bar  { param([int]$pct)
  $filled = [Math]::Floor(($pct * $BAR_W) / 100)
  $empty  = $BAR_W - $filled
  $f = "─" * $filled
  $e = "─" * $empty
  Write-Host -NoNewline "`r  "
  Write-Host -NoNewline "│" -ForegroundColor DarkGray
  Write-Host -NoNewline "  "
  Write-Host -NoNewline $f -ForegroundColor White
  Write-Host -NoNewline $e -ForegroundColor DarkGray
  Write-Host -NoNewline ("  {0,3}%" -f $pct)
}

# ── Architecture check ─────────────────────────────────────────────────────────
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -ne "AMD64") { _Fail "Unsupported architecture: $arch. Only x64 is supported." }

# ── Previous version ───────────────────────────────────────────────────────────
$prevVer = ""
$existing = Get-Command gitten -ErrorAction SilentlyContinue
if ($existing) { try { $prevVer = (& gitten --version 2>$null) } catch {} }

# ── Install directory ──────────────────────────────────────────────────────────
$installDir = Join-Path $env:LOCALAPPDATA "Programs\gitten"
if (-not (Test-Path $installDir)) {
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}
$dest        = Join-Path $installDir $BINARY
$downloadUrl = "https://github.com/$REPO/releases/latest/download/$ASSET"

# ── Header ─────────────────────────────────────────────────────────────────────
_Intro "🐱 gitten installer"
_Row "Platform" "Windows x64"
_Row "Binary"   $ASSET
_Row "Target"   $dest
_Sep

# ── Download with progress bar ─────────────────────────────────────────────────
_Act "Downloading $ASSET"
_Bar 0

$webClient = New-Object System.Net.WebClient
$tmpFile   = [System.IO.Path]::GetTempFileName()

try {
  $done = $false
  $webClient.DownloadFileAsync([uri]$downloadUrl, $dest)

  # Register progress event
  $webClient.add_DownloadProgressChanged({
    param($s, $e)
    _Bar $e.ProgressPercentage
  })
  $webClient.add_DownloadFileCompleted({
    param($s, $e)
    $script:done = $true
    if ($e.Error) { throw $e.Error }
  })

  while (-not $done) { Start-Sleep -Milliseconds 100 }

} catch {
  Write-Host ""
  _Fail "Download failed: $_`n  Check https://github.com/$REPO/releases"
} finally {
  $webClient.Dispose()
  Remove-Item $tmpFile -ErrorAction SilentlyContinue
}

Write-Host ""    # newline after progress bar

# ── PATH ───────────────────────────────────────────────────────────────────────
_Sep
_Ok "Installed at $dest"

$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($userPath -notlike "*$installDir*") {
  [Environment]::SetEnvironmentVariable("PATH", "$userPath;$installDir", "User")
  $env:PATH = "$env:PATH;$installDir"
  _Ok "Added to PATH"
}

# ── Verify ─────────────────────────────────────────────────────────────────────
try {
  $newVer = (& $dest --version 2>$null)
  _Ok "Verified  $newVer"
} catch {
  _Warn "Could not verify — try: $dest --version"
  $newVer = ""
}

# ── Outro ──────────────────────────────────────────────────────────────────────
if ($prevVer -and $prevVer -ne $newVer) {
  _Outro "Updated $prevVer → $newVer. Restart your terminal, then run: gitten"
} else {
  _Outro "$($newVer ?? 'gitten') installed. Restart your terminal, then run: gitten"
}
