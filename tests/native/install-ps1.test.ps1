#Requires -Version 5.1
param(
  [Parameter(Mandatory = $true)][string]$FixtureBinary,
  [switch]$IsolatedUserPath
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\install.ps1')

$mockFixture = (Get-Item -LiteralPath $FixtureBinary).FullName
$mockVersion = (& $mockFixture --version) -join "`n"
$mockTag = $mockVersion -replace '^gitten ', ''
$mockScenario = ''

function Invoke-RestMethod {
  param([string]$Uri, [string]$ErrorAction, [int]$MaximumRedirection = -1)
  if ($Uri -cne 'https://api.github.com/repos/jmpanozzoz/gitten/releases/latest' -or $MaximumRedirection -ne 0) {
    throw "Unexpected API request."
  }
  if ($mockScenario -eq 'release-offline') { throw "Release information unavailable." }
  $tag = $mockTag
  if ($mockScenario -eq 'wrong-tag') { $tag = 'invalid' }
  if ($mockScenario -eq 'list-tag') { $tag = @($mockTag) }
  if ($mockScenario -eq 'wrong-version') { $tag = 'v999.0.0' }
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $digest = [BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::ASCII.GetBytes((Get-MockManifest))))
  } finally {
    $sha256.Dispose()
  }
  $asset = @{ name = 'SHA256SUMS'; state = 'uploaded'; digest = ('sha256:' + $digest.Replace('-', '').ToLowerInvariant()) }
  if ($mockScenario -eq 'missing-manifest') { $asset.name = 'another-asset' }
  if ($mockScenario -eq 'incomplete-manifest') { $asset.state = 'starter' }
  if ($mockScenario -eq 'invalid-digest') { $asset.digest = 'sha256:000' }
  $assets = @($asset)
  if ($mockScenario -eq 'duplicate-manifest') { $assets += $asset }
  return @{ tag_name = $tag; assets = $assets }
}

function Get-MockManifest {
  $hash = (Get-FileHash -LiteralPath $mockFixture -Algorithm SHA256).Hash
  if ($mockScenario -eq 'corrupt') { $hash = '0' * 64 }
  $line = "$hash  gitten-windows-x64.exe`n"
  if ($mockScenario -eq 'missing-hash') { $line = "$hash  another-asset.exe`n" }
  if ($mockScenario -eq 'duplicate') { return $line + $line }
  return $line
}

function Invoke-WebRequest {
  param([string]$Uri, [switch]$UseBasicParsing, [string]$ErrorAction, [string]$OutFile)
  if ($Uri -like 'https://github.com/jmpanozzoz/gitten/releases/download/*/SHA256SUMS') {
    if ($mockScenario -eq 'manifest-offline') { throw "Checksum manifest unavailable." }
    $manifest = Get-MockManifest
    if ($mockScenario -eq 'replaced-manifest') { $manifest += "`n" }
    [IO.File]::WriteAllText($OutFile, $manifest, [Text.Encoding]::ASCII)
    return
  }
  if ($Uri -notlike 'https://github.com/jmpanozzoz/gitten/releases/download/*/gitten-windows-x64.exe') {
    throw "Unexpected asset request."
  }
  if ($mockScenario -eq 'interrupted') {
    Set-Content -LiteralPath $OutFile -Value 'partial'
    throw "Download interrupted."
  }
  if ($mockScenario -eq 'replaced-manifest') { throw "The artifact was requested before validating the manifest." }
  Copy-Item -LiteralPath $mockFixture -Destination $OutFile
}

if (-not $IsolatedUserPath) {
  function Add-GittenToPath {
    param([string]$Directory)
    if (-not (Test-Path -LiteralPath $Directory -PathType Container)) { throw "Missing PATH directory." }
  }
}

function Assert-NoTemporaryFiles {
  param([string]$Directory)
  if (Get-ChildItem -LiteralPath $Directory -Filter '.gitten-install-*') { throw "Temporary files were left behind." }
}

function Assert-Rejected {
  param([string]$Scenario, [string]$Expected)
  $mockScenario = $Scenario
  Set-Content -LiteralPath $destination -Value 'existing-installation'
  $message = ''
  try { Install-Gitten -Directory $target } catch { $message = $_.Exception.Message }
  if ($message -notlike "*$Expected*") { throw "Unexpected outcome for $Scenario. $message" }
  if ((Get-Content -LiteralPath $destination) -ne 'existing-installation') {
    throw "The old binary changed during $Scenario."
  }
  Assert-NoTemporaryFiles $target
}

$target = Join-Path ([IO.Path]::GetTempPath()) ("gitten-installer-test-" + [Guid]::NewGuid().ToString("N"))
$destination = Join-Path $target 'gitten.exe'
$previousInstallDirectory = $env:GITTEN_INSTALL_DIR
if ($IsolatedUserPath) {
  $previousUserPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
  $previousProcessPath = $env:PATH
}

try {
  Install-Gitten -Directory $target
  if ((& $destination --version) -cne $mockVersion) { throw "Installed binary is wrong." }
  Assert-NoTemporaryFiles $target
  Install-Gitten -Directory $target
  Assert-NoTemporaryFiles $target
  Assert-Rejected 'corrupt' 'checksum mismatch'
  Assert-Rejected 'interrupted' 'Download interrupted'
  Assert-Rejected 'release-offline' 'Release information unavailable'
  Assert-Rejected 'missing-manifest' 'Missing or ambiguous release manifest metadata'
  Assert-Rejected 'incomplete-manifest' 'Missing or ambiguous release manifest metadata'
  Assert-Rejected 'duplicate-manifest' 'Missing or ambiguous release manifest metadata'
  Assert-Rejected 'invalid-digest' 'Invalid release manifest digest'
  Assert-Rejected 'manifest-offline' 'Checksum manifest unavailable'
  Assert-Rejected 'replaced-manifest' 'checksum mismatch for the release manifest'
  Assert-Rejected 'missing-hash' 'Missing or ambiguous checksum'
  Assert-Rejected 'duplicate' 'ambiguous checksum'
  Assert-Rejected 'wrong-tag' 'Unexpected release tag'
  Assert-Rejected 'list-tag' 'Unexpected release tag'
  Assert-Rejected 'wrong-version' 'failed its version check'

  $platformError = ''
  try { Install-Gitten -Directory $target -Architecture 'ARM64' } catch { $platformError = $_.Exception.Message }
  if ($platformError -notlike '*requires Windows x64*') { throw "The unsupported architecture was accepted." }
  $mockScenario = ''
  Install-Gitten -Directory '' -LocalAppData $target
  $default = Join-Path $target 'Programs/gitten/gitten.exe'
  if ((& $default --version) -cne $mockVersion) { throw "Default installation path is wrong." }

  if ($IsolatedUserPath) {
    $entryPointTarget = Join-Path $target 'entrypoint'
    $processPathBeforeEntryPoint = $env:PATH
    $userPathBeforeEntryPoint = [Environment]::GetEnvironmentVariable('PATH', 'User')
    $env:GITTEN_INSTALL_DIR = $entryPointTarget
    & (Join-Path $PSScriptRoot '../../install.ps1')
    & (Join-Path $PSScriptRoot '../../install.ps1')
    $binary = Join-Path $entryPointTarget 'gitten.exe'
    if ((& $binary --version) -cne $mockVersion) { throw "The installer entry point did not install Gitten." }
    if ($env:PATH -cne "$processPathBeforeEntryPoint;$entryPointTarget") {
      throw "The installer changed existing process PATH entries or duplicated the new entry."
    }
    if ($env:OS -eq 'Windows_NT') {
      $expectedUserEntries = @($userPathBeforeEntryPoint -split ';' | Where-Object { $_ }) + $entryPointTarget
      $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
      if ($userPath -cne ($expectedUserEntries -join ';')) {
        throw "The installer changed existing user PATH entries or duplicated the new entry."
      }
    }
  }
} finally {
  $env:GITTEN_INSTALL_DIR = $previousInstallDirectory
  if ($IsolatedUserPath) {
    if ($null -eq $previousUserPath) {
      [Environment]::SetEnvironmentVariable('PATH', [NullString]::Value, 'User')
    } else {
      [Environment]::SetEnvironmentVariable('PATH', $previousUserPath, 'User')
    }
    $env:PATH = $previousProcessPath
  }
  Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
}
