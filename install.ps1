#Requires -Version 5.1
[CmdletBinding()]
param()

function Get-GittenRelease {
  $response = Invoke-RestMethod -ErrorAction Stop -MaximumRedirection 0 `
    -Uri "https://api.github.com/repos/jmpanozzoz/gitten/releases/latest"
  $tag = $response.tag_name
  if ($tag -isnot [string] -or $tag -cnotmatch '\Av[0-9]+\.[0-9]+\.[0-9]+\z') {
    throw "Unexpected release tag."
  }
  $manifests = @($response.assets | Where-Object { $_.name -ceq 'SHA256SUMS' })
  if ($manifests.Count -ne 1 -or $manifests[0].state -cne 'uploaded') {
    throw "Missing or ambiguous release manifest metadata."
  }
  $digest = $manifests[0].digest
  if ($digest -isnot [string] -or $digest -cnotmatch '\Asha256:[a-f0-9]{64}\z') {
    throw "Invalid release manifest digest."
  }
  return @{ Tag = $tag; ManifestDigest = $digest.Substring(7) }
}

function Get-GittenDownload {
  param([string]$Url, [string]$Destination)
  Invoke-WebRequest -Uri $Url -UseBasicParsing -ErrorAction Stop -OutFile $Destination
}

function Confirm-GittenArtifact {
  param([string]$Manifest, [string]$Asset, [string]$Artifact)
  $pattern = '^([a-fA-F0-9]{64})\s+' + [Regex]::Escape($Asset) + '$'
  $entries = @(Select-String -LiteralPath $Manifest -Pattern $pattern)
  if ($entries.Count -ne 1) {
    throw "Missing or ambiguous checksum for $Asset."
  }
  $expected = $entries[0].Matches[0].Groups[1].Value
  $actual = (Get-FileHash -LiteralPath $Artifact -Algorithm SHA256).Hash
  if ($expected -ine $actual) {
    throw "SHA-256 checksum mismatch for $Asset."
  }
}

function Install-Gitten {
  param(
    [string]$Directory = $env:GITTEN_INSTALL_DIR,
    [string]$Architecture = $env:PROCESSOR_ARCHITECTURE,
    [string]$LocalAppData = $env:LOCALAPPDATA
  )
  $ErrorActionPreference = "Stop"
  $ProgressPreference = "SilentlyContinue"
  if ($Architecture -ne 'AMD64') {
    throw "Unsupported platform. Gitten requires Windows x64."
  }
  if (-not $Directory) {
    $Directory = Join-Path $LocalAppData "Programs\gitten"
  }

  $null = New-Item -ItemType Directory -Path $Directory -Force
  $Directory = (Get-Item -LiteralPath $Directory).FullName
  $destination = Join-Path $Directory "gitten.exe"
  $asset = "gitten-windows-x64.exe"
  $release = Get-GittenRelease
  $tag = $release.Tag
  $base = "https://github.com/jmpanozzoz/gitten/releases/download/$tag"
  $temporary = Join-Path $Directory (".gitten-install-" + [Guid]::NewGuid().ToString("N"))
  $null = New-Item -ItemType Directory -Path $temporary
  try {
    $manifest = Join-Path $temporary "SHA256SUMS"
    $candidate = Join-Path $temporary $asset
    Write-Host "Downloading $asset from $tag"
    Get-GittenDownload "$base/SHA256SUMS" $manifest
    if ((Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash -ine $release.ManifestDigest) {
      throw "SHA-256 checksum mismatch for the release manifest."
    }
    Get-GittenDownload "$base/$asset" $candidate
    Confirm-GittenArtifact $manifest $asset $candidate

    $version = (& $candidate --version) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $version -cne "gitten $tag") {
      throw "The verified binary failed its version check."
    }

    if ([IO.File]::Exists($destination)) {
      $backup = Join-Path $temporary 'previous.exe'
      [IO.File]::Replace($candidate, $destination, $backup)
    } else {
      [IO.File]::Move($candidate, $destination)
    }
    Write-Host "Installed $version at $destination"
  } finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
  }

  Add-GittenToPath $Directory
}

function Add-GittenToPath {
  param([string]$Directory)
  $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
  $entries = @($userPath -split ';' | Where-Object { $_ })
  if ($entries -inotcontains $Directory) {
    [Environment]::SetEnvironmentVariable("PATH", (($entries + $Directory) -join ';'), "User")
  }
  if ((@($env:PATH -split ';')) -inotcontains $Directory) {
    $env:PATH = "$env:PATH;$Directory"
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  Install-Gitten
}
