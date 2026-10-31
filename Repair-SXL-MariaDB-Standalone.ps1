[CmdletBinding()]
param(
  [string]$RuntimeRoot = (Join-Path $env:APPDATA 'SXL Localhost\runtime\mariadb'),
  [int]$Port = 3307
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step([string]$Message) { Write-Host "[SXL MariaDB] $Message" -ForegroundColor Cyan }
function Write-Failure([string]$Message) { Write-Host "[SXL MariaDB] GAGAL: $Message" -ForegroundColor Red }
function Test-PortFree([int]$CandidatePort) {
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $CandidatePort)
    $listener.Start()
    return $true
  } catch { return $false }
  finally { if ($listener) { try { $listener.Stop() } catch {} } }
}
function Test-RequiredBinaries([string]$Root) {
  $bin = Join-Path $Root 'server\bin'
  $groups = @(
    @('mariadbd.exe','mysqld.exe'),
    @('mariadb-install-db.exe','mysql_install_db.exe'),
    @('mariadb.exe','mysql.exe'),
    @('mariadb-admin.exe','mysqladmin.exe'),
    @('mariadb-dump.exe','mysqldump.exe')
  )
  foreach ($group in $groups) {
    $found = $false
    foreach ($name in $group) {
      if (Test-Path -LiteralPath (Join-Path $bin $name) -PathType Leaf) { $found = $true; break }
    }
    if (-not $found) { return $false }
  }
  return $true
}
function Move-ItemPreservingType([string]$Source, [string]$Destination, [bool]$Directory) {
  if ($Directory) { [System.IO.Directory]::Move($Source, $Destination) }
  else { [System.IO.File]::Move($Source, $Destination) }
}

$moved = New-Object System.Collections.Generic.List[object]
$recoveryPath = $null
$failedPath = $null
try {
  if ($env:OS -ne 'Windows_NT' -or [Environment]::Is64BitOperatingSystem -ne $true) {
    throw 'Perbaikan ini hanya untuk Windows 64-bit.'
  }
  if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Port harus berada pada rentang 1024–65535.' }
  if (-not [System.IO.Path]::IsPathRooted($RuntimeRoot)) { throw 'RuntimeRoot harus berupa path absolut.' }
  $RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot)
  $Installer = Join-Path $PSScriptRoot 'Install-SXL-MariaDB.ps1'
  if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) {
    throw "Install-SXL-MariaDB.ps1 tidak ditemukan di folder yang sama dengan skrip perbaikan: $PSScriptRoot"
  }
  if (-not (Test-Path -LiteralPath $env:APPDATA -PathType Container)) { throw 'Folder APPDATA akun Windows tidak ditemukan.' }

  $alreadyReady = $false
  if ((Test-RequiredBinaries $RuntimeRoot) -and
      (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'data\mysql') -PathType Container) -and
      (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'settings.json') -PathType Leaf)) {
    try {
      $currentServer = Join-Path $RuntimeRoot 'server\bin\mariadbd.exe'
      if (-not (Test-Path -LiteralPath $currentServer -PathType Leaf)) { $currentServer = Join-Path $RuntimeRoot 'server\bin\mysqld.exe' }
      $currentVersionOutput = (& $currentServer --version 2>&1 | Out-String).Trim()
      $currentVersionExit = $LASTEXITCODE
      $currentSettings = Get-Content -LiteralPath (Join-Path $RuntimeRoot 'settings.json') -Raw | ConvertFrom-Json
      $alreadyReady = $currentVersionExit -eq 0 -and $currentVersionOutput -match '(?i)11\.4\.13' -and $currentSettings.versionVerified -eq $true
    } catch { $alreadyReady = $false }
  }
  if ($alreadyReady) {
    Write-Step 'Runtime MariaDB 11.4.13 dan metadata versinya sudah terverifikasi. Tidak ada berkas yang diubah.'
    exit 0
  }

  if (-not (Test-PortFree $Port)) {
    throw "Port 127.0.0.1:$Port sedang digunakan. Tidak ada file yang dipindahkan dan tidak ada proses lain yang dihentikan. Tutup SXL/layanan pemilik port lalu coba lagi."
  }

  $candidates = @(
    [pscustomobject]@{ Name='server'; Path=(Join-Path $RuntimeRoot 'server'); Directory=$true },
    [pscustomobject]@{ Name='data'; Path=(Join-Path $RuntimeRoot 'data'); Directory=$true },
    [pscustomobject]@{ Name='backups'; Path=(Join-Path $RuntimeRoot 'backups'); Directory=$true },
    [pscustomobject]@{ Name='tmp'; Path=(Join-Path $RuntimeRoot 'tmp'); Directory=$true },
    [pscustomobject]@{ Name='settings.json'; Path=(Join-Path $RuntimeRoot 'settings.json'); Directory=$false },
    [pscustomobject]@{ Name='mariadbd.log'; Path=(Join-Path $RuntimeRoot 'mariadbd.log'); Directory=$false },
    [pscustomobject]@{ Name='mariadbd.pid'; Path=(Join-Path $RuntimeRoot 'mariadbd.pid'); Directory=$false }
  ) | Where-Object { Test-Path -LiteralPath $_.Path }

  $recoveryRoot = Join-Path $RuntimeRoot 'versions\recovery'
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss-fff')
  $recoveryPath = Join-Path $recoveryRoot "mariadb-managed-manual-$stamp"
  $failedPath = Join-Path $recoveryRoot "mariadb-managed-repair-failed-$stamp"
  $hasQuarantine = $candidates.Count -gt 0

  if ($hasQuarantine) {
    foreach ($candidate in $candidates) {
      $item = Get-Item -LiteralPath $candidate.Path -Force
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Pemulihan dibatalkan: '$($candidate.Path)' adalah symbolic link/reparse point. Tidak ada komponen yang dipindahkan."
      }
      if ($candidate.Directory -and -not $item.PSIsContainer) { throw "Pemulihan dibatalkan: '$($candidate.Path)' bukan folder biasa." }
      if (-not $candidate.Directory -and $item.PSIsContainer) { throw "Pemulihan dibatalkan: '$($candidate.Path)' bukan file biasa." }
    }

    Write-Host ''
    Write-Host 'Instalasi MariaDB saat ini parsial.' -ForegroundColor Yellow
    Write-Host 'Folder server, data, backup, konfigurasi, dan log PID yang ada akan dipindahkan ke recovery; tidak dihapus.' -ForegroundColor Yellow
    Write-Host 'Setelah itu SXL akan membuat data MariaDB BARU. Data lama tidak otomatis diimpor.' -ForegroundColor Yellow
    Write-Host "Folder recovery: $recoveryPath"
    $answer = Read-Host 'Ketik PINDAHKAN untuk melanjutkan'
    if ($answer -cne 'PINDAHKAN') { throw 'Dibatalkan oleh pengguna. Tidak ada file yang dipindahkan.' }

    New-Item -ItemType Directory -Path $recoveryRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $recoveryPath -Force | Out-Null
    foreach ($candidate in $candidates) {
      $destination = Join-Path $recoveryPath $candidate.Name
      Move-ItemPreservingType -Source $candidate.Path -Destination $destination -Directory ([bool]$candidate.Directory)
      $moved.Add([pscustomobject]@{ Name=$candidate.Name; Source=$candidate.Path; Destination=$destination; Directory=[bool]$candidate.Directory })
      Write-Step "Komponen lama diamankan: $($candidate.Name)"
    }
  }

  try {
    Write-Step 'Menjalankan pemasang MariaDB dengan pemeriksaan ukuran dan SHA-256.'
    & $Installer -RuntimeRoot $RuntimeRoot -Port $Port
    if (-not (Test-RequiredBinaries $RuntimeRoot)) { throw 'Pemasang selesai, tetapi lima kelompok executable belum tersedia di server\bin.' }
    $server = Join-Path $RuntimeRoot 'server\bin\mariadbd.exe'
    if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { $server = Join-Path $RuntimeRoot 'server\bin\mysqld.exe' }
    $versionText = (& $server --version 2>&1 | Out-String).Trim()
    $versionExit = $LASTEXITCODE
    if ($versionExit -ne 0 -or $versionText -notmatch '(?i)11\.4\.13') {
      throw "Versi binary tidak cocok atau tidak bisa dijalankan. Exit=$versionExit; output=$versionText"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'data\mysql') -PathType Container)) { throw 'Folder data/mysql tidak ditemukan setelah instalasi.' }
    if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'settings.json') -PathType Leaf)) { throw 'settings.json tidak dibuat oleh installer.' }
    Write-Step "BERHASIL: MariaDB 11.4.13 diverifikasi. Binary: $server"
    Write-Step "Host: 127.0.0.1; port: $Port"
    Write-Step "Data baru: $(Join-Path $RuntimeRoot 'data')"
    if ($hasQuarantine) { Write-Step "Data/komponen lama masih tersimpan di: $recoveryPath" }
    Write-Step 'Tutup jendela ini, lalu buka SXL Localhost lagi dan tekan Verifikasi Binary.'
  } catch {
    $originalError = [string]$_.Exception.Message
    $hasFailedItems = $false
    foreach ($candidate in @(
      [pscustomobject]@{ Name='server'; Path=(Join-Path $RuntimeRoot 'server'); Directory=$true },
      [pscustomobject]@{ Name='data'; Path=(Join-Path $RuntimeRoot 'data'); Directory=$true },
      [pscustomobject]@{ Name='backups'; Path=(Join-Path $RuntimeRoot 'backups'); Directory=$true },
      [pscustomobject]@{ Name='tmp'; Path=(Join-Path $RuntimeRoot 'tmp'); Directory=$true },
      [pscustomobject]@{ Name='settings.json'; Path=(Join-Path $RuntimeRoot 'settings.json'); Directory=$false },
      [pscustomobject]@{ Name='mariadbd.log'; Path=(Join-Path $RuntimeRoot 'mariadbd.log'); Directory=$false },
      [pscustomobject]@{ Name='mariadbd.pid'; Path=(Join-Path $RuntimeRoot 'mariadbd.pid'); Directory=$false }
    )) {
      if (Test-Path -LiteralPath $candidate.Path) {
        $sourceItem = Get-Item -LiteralPath $candidate.Path -Force
        if (($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        if (-not $hasFailedItems) { New-Item -ItemType Directory -Path $failedPath -Force | Out-Null; $hasFailedItems = $true }
        $target = Join-Path $failedPath $candidate.Name
        try { Move-ItemPreservingType -Source $candidate.Path -Destination $target -Directory ([bool]$candidate.Directory) } catch { }
      }
    }
    $restoreError = $null
    for ($index = $moved.Count - 1; $index -ge 0; $index--) {
      $old = $moved[$index]
      if (Test-Path -LiteralPath $old.Source) { $restoreError = "Target pemulihan sudah ada: $($old.Source)"; continue }
      try { Move-ItemPreservingType -Source $old.Destination -Destination $old.Source -Directory ([bool]$old.Directory) }
      catch { $restoreError = $_.Exception.Message }
    }
    if ($hasFailedItems) { $originalError += " Komponen dari percobaan gagal disimpan di $failedPath." }
    if ($hasQuarantine) { $originalError += " Komponen lama tetap tersedia di $recoveryPath." }
    if ($restoreError) { $originalError += " Pemulihan otomatis belum selesai: $restoreError" }
    $originalError += " Log instalasi: $(Join-Path $RuntimeRoot 'logs\mariadb-install.log')"
    throw $originalError
  }
} catch {
  $outerError = [string]$_.Exception.Message
  for ($index = $moved.Count - 1; $index -ge 0; $index--) {
    $old = $moved[$index]
    if ((Test-Path -LiteralPath $old.Destination) -and -not (Test-Path -LiteralPath $old.Source)) {
      try { Move-ItemPreservingType -Source $old.Destination -Destination $old.Source -Directory ([bool]$old.Directory) }
      catch { $outerError += " Pemulihan komponen $($old.Name) belum selesai; file lama tetap di $($old.Destination)." }
    }
  }
  Write-Failure $outerError
  exit 1
}
