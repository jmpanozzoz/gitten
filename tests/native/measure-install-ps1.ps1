#Requires -Version 5.1
param(
  [Parameter(Mandatory = $true)][string]$FixtureBinary,
  [Parameter(Mandatory = $true)][string]$PesterModule,
  [Parameter(Mandatory = $true)][string]$Report,
  [switch]$IsolatedUserPath
)
$ErrorActionPreference = 'Stop'
Import-Module $PesterModule -RequiredVersion 5.7.1 -Force

$fixture = (Get-Item -LiteralPath $FixtureBinary).FullName
$config = New-PesterConfiguration
$config.Run.Container = New-PesterContainer -Path (Join-Path $PSScriptRoot 'install-coverage.Tests.ps1') -Data @{
  FixtureBinary = $fixture
  IsolatedUserPath = $IsolatedUserPath
}
$config.Run.PassThru = $true
$config.CodeCoverage.Enabled = $true
$config.CodeCoverage.Path = Join-Path $PSScriptRoot '../../install.ps1'
$config.CodeCoverage.OutputPath = $Report
$config.CodeCoverage.CoveragePercentTarget = 100

$result = Invoke-Pester -Configuration $config
if ($result.Result -ne 'Passed' -or $result.PassedCount -eq 0 -or $result.SkippedCount -gt 0) {
  throw 'The PowerShell installer fixture did not run to completion.'
}
[xml]$coverage = Get-Content -LiteralPath $Report -Raw
$commands = @($coverage.report.counter | Where-Object { $_.type -eq 'INSTRUCTION' })
if ($commands.Count -ne 1 -or [int]$commands[0].covered -eq 0) {
  throw 'Pester did not record executable installer commands.'
}
$covered = [int]$commands[0].covered
$total = $covered + [int]$commands[0].missed
Write-Host "install.ps1 executable PowerShell commands: $covered/$total"
if ($covered -ne $total) {
  throw 'Every executable PowerShell installer command must run.'
}
