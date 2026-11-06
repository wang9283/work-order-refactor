$ErrorActionPreference = 'Stop'

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$imports = [System.IO.Path]::GetFullPath((Join-Path $workspace 'data\imports'))
if (-not $imports.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe import directory: $imports"
}

Get-ChildItem -LiteralPath $imports -File | Remove-Item -Force
