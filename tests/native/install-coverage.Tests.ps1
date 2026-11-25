#Requires -Version 5.1
param(
  [Parameter(Mandatory = $true)][string]$FixtureBinary,
  [switch]$IsolatedUserPath
)

Describe 'Gitten Windows installer' {
  It 'installs or preserves the binary for every scripted fixture' {
    & (Join-Path $PSScriptRoot 'install-ps1.test.ps1') -FixtureBinary $FixtureBinary -IsolatedUserPath:$IsolatedUserPath
  }
}
