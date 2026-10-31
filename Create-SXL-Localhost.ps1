param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,

  [Parameter(Mandatory = $true)]
  [string]$DestinationPath
)

$ErrorActionPreference = 'Stop'

function Get-NormalizedPath([string]$PathValue) {
  $full = [System.IO.Path]::GetFullPath($PathValue)
  $root = [System.IO.Path]::GetPathRoot($full)
  if ($full.Length -gt $root.Length) { $full = $full.TrimEnd([char[]]@('\', '/')) }
  return $full
}

function Test-PathContains([string]$ParentPath, [string]$ChildPath) {
  $parent = Get-NormalizedPath $ParentPath
  $child = Get-NormalizedPath $ChildPath
  if ($parent -ieq $child) { return $true }
  $prefix = $parent
  if (-not $prefix.EndsWith([System.IO.Path]::DirectorySeparatorChar.ToString())) { $prefix += [System.IO.Path]::DirectorySeparatorChar }
  return $child.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) {
  throw "SourcePath harus menunjuk ke folder yang sudah ada: $SourcePath"
}
$source = Get-NormalizedPath (Resolve-Path -LiteralPath $SourcePath).Path
$destination = Get-NormalizedPath $DestinationPath
$moduleRoot = Get-NormalizedPath $PSScriptRoot

if (-not (Test-Path -LiteralPath (Join-Path $source 'package.json') -PathType Leaf)) {
  throw "SourcePath bukan folder proyek yang valid (package.json tidak ditemukan): $source"
}
if (Test-Path -LiteralPath $destination) {
  throw "Folder tujuan sudah ada. Pilih folder baru agar tidak menimpa data: $destination"
}

# Reject every overlapping layout before creating or copying anything. This prevents
# recursive copy loops and protects both the source project and this sharing module.
if ((Test-PathContains $source $destination) -or (Test-PathContains $destination $source)) {
  throw "Folder sumber dan tujuan tidak boleh saling berada di dalam satu sama lain. Sumber: $source; tujuan: $destination"
}
if ((Test-PathContains $moduleRoot $destination) -or (Test-PathContains $destination $moduleRoot)) {
  throw "Folder tujuan tidak boleh sama dengan atau berada di dalam folder modul (atau sebaliknya). Tujuan: $destination; modul: $moduleRoot"
}

Write-Host "Sumber      : $source"
Write-Host "Tujuan baru : $destination"
Write-Host "Modul       : $moduleRoot"
Write-Host 'Folder sumber asli tidak akan dimodifikasi; tidak ada perintah Git/push.' -ForegroundColor Cyan
$confirm = Read-Host 'Lanjutkan menyalin proyek ke folder baru? Ketik YA'
if ($confirm -cne 'YA') { throw 'Dibatalkan pengguna.' }

New-Item -ItemType Directory -Path $destination | Out-Null
try {
  # Skip root-level transient metadata/dependencies and the downloaded runtime.
  Get-ChildItem -LiteralPath $source -Force | Where-Object {
    $_.Name -notin @('node_modules', '.git', 'runtime')
  } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
  }

  $targetModule = Join-Path $destination 'tools\website-sharing'
  if (Test-Path -LiteralPath $targetModule) {
    Remove-Item -LiteralPath $targetModule -Recurse -Force
  }
  New-Item -ItemType Directory -Path $targetModule -Force | Out-Null

  Get-ChildItem -LiteralPath $moduleRoot -Force | Where-Object {
    $_.Name -notin @('Create-SXL-Localhost.ps1', '.git', 'node_modules', 'runtime')
  } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $targetModule -Recurse -Force
  }

  Write-Host ''
  Write-Host "SXL Localhost salinan dibuat di: $destination" -ForegroundColor Green
  Write-Host "Modul Website Sharing: $targetModule"
  Write-Host "Untuk menjalankan: buka $targetModule lalu klik Start-SXL-Website-Sharing.bat"
} catch {
  Write-Host "Penyalinan gagal: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Tujuan parsial berada di: $destination. Periksa sebelum menghapusnya." -ForegroundColor Yellow
  throw
}
