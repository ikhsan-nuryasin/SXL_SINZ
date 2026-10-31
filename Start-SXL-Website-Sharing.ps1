$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

$ProjectRoot = $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot 'runtime'
$DownloadsDir = Join-Path $RuntimeDir 'downloads'
$NodeVersion = 'v24.22.1'
$NodeZipName = "node-$NodeVersion-win-x64.zip"
$NodeFolder = Join-Path $RuntimeDir "node-$NodeVersion-win-x64"
$PortableNode = Join-Path $NodeFolder 'node.exe'
$CloudflaredVersion = '2026.10.4'
$CloudflaredPath = Join-Path $RuntimeDir 'cloudflared.exe'
$CloudflaredSha256 = '411b16d40c8d872243efeb52c550053d00af0a8a97fbb32e730fb8aba429eaa8'

function Write-Step([string]$Message) {
  Write-Host "`n[SXL] $Message" -ForegroundColor Cyan
}

function Get-NodeExecutable {
  $installed = Get-Command node -ErrorAction SilentlyContinue
  if ($installed) {
    try {
      $versionText = (& $installed.Source --version 2>$null | Select-Object -First 1).Trim()
      if ($versionText -match '^v(\d+)\.(\d+)\.(\d+)') {
        $major = [int]$Matches[1]; $minor = [int]$Matches[2]
        if ($major -gt 22 -or ($major -eq 22 -and $minor -ge 12)) {
          Write-Host "Menggunakan Node.js sistem: $versionText" -ForegroundColor Green
          return $installed.Source
        }
      }
    } catch { }
  }

  if (Test-Path -LiteralPath $PortableNode -PathType Leaf) {
    Write-Host "Menggunakan Node.js portable: $NodeVersion" -ForegroundColor Green
    return $PortableNode
  }

  Write-Step "Mengunduh Node.js portable $NodeVersion dari server resmi nodejs.org (membutuhkan internet)"
  New-Item -ItemType Directory -Path $DownloadsDir -Force | Out-Null
  $zipPath = Join-Path $DownloadsDir $NodeZipName
  $sumsPath = Join-Path $DownloadsDir 'SHASUMS256.txt'
  $baseUrl = "https://nodejs.org/dist/$NodeVersion"

  Invoke-WebRequest -Uri "$baseUrl/$NodeZipName" -OutFile $zipPath -UseBasicParsing -TimeoutSec 600
  Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -OutFile $sumsPath -UseBasicParsing -TimeoutSec 60
  $sumLine = Get-Content -LiteralPath $sumsPath | Where-Object { $_ -match [regex]::Escape($NodeZipName) } | Select-Object -First 1
  if (-not $sumLine) { throw 'Checksum Node.js tidak ditemukan pada daftar resmi.' }
  $expected = (($sumLine -split '\s+')[0]).ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    throw 'Verifikasi SHA-256 Node.js gagal. File unduhan ditolak.'
  }

  Expand-Archive -LiteralPath $zipPath -DestinationPath $RuntimeDir -Force
  Remove-Item -LiteralPath $zipPath, $sumsPath -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath $PortableNode -PathType Leaf)) {
    throw 'Ekstraksi Node.js selesai tetapi node.exe tidak ditemukan.'
  }
  return $PortableNode
}

function Get-CloudflaredExecutable {
  New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
  if (Test-Path -LiteralPath $CloudflaredPath -PathType Leaf) {
    $existingHash = (Get-FileHash -LiteralPath $CloudflaredPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($existingHash -eq $CloudflaredSha256) {
      Write-Host "Menggunakan cloudflared terverifikasi: $CloudflaredVersion" -ForegroundColor Green
      return $CloudflaredPath
    }
    Write-Host 'cloudflared lokal berbeda dari versi terverifikasi; file lama akan dipertahankan sebagai recovery.' -ForegroundColor Yellow
  }

  Write-Step "Mengunduh cloudflared $CloudflaredVersion dari rilis resmi Cloudflare"
  New-Item -ItemType Directory -Path $DownloadsDir -Force | Out-Null
  $uri = "https://github.com/cloudflare/cloudflared/releases/download/$CloudflaredVersion/cloudflared-windows-amd64.exe"
  $token = [Guid]::NewGuid().ToString('N')
  $temporary = Join-Path $DownloadsDir "cloudflared-$token.download"
  $quarantine = $null
  try {
    Invoke-WebRequest -Uri $uri -OutFile $temporary -UseBasicParsing -TimeoutSec 180
    $actualHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $CloudflaredSha256) {
      throw "Verifikasi SHA-256 cloudflared gagal (diterima $actualHash). File unduhan ditolak."
    }

    if (Test-Path -LiteralPath $CloudflaredPath -PathType Leaf) {
      $quarantine = "$CloudflaredPath.unverified-$((Get-Date).ToString('yyyyMMdd-HHmmss'))-$token"
      Move-Item -LiteralPath $CloudflaredPath -Destination $quarantine
    }
    try {
      Move-Item -LiteralPath $temporary -Destination $CloudflaredPath
    } catch {
      if ($quarantine -and (Test-Path -LiteralPath $quarantine) -and -not (Test-Path -LiteralPath $CloudflaredPath)) {
        Move-Item -LiteralPath $quarantine -Destination $CloudflaredPath
        $quarantine = $null
      }
      throw
    }
    if ($quarantine) { Write-Host "Binary lama dipertahankan di: $quarantine" -ForegroundColor Yellow }
    return $CloudflaredPath
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

try {
  if ($env:OS -ne 'Windows_NT') { throw 'Launcher ini hanya untuk Windows 10/11.' }
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Launcher saat ini membutuhkan Windows 64-bit.' }

  Write-Host 'SXL LOCALHOST — WEBSITE SHARING' -ForegroundColor Magenta
  Write-Host 'Aplikasi berjalan lokal tanpa Laragon. Browser lain dapat mengakses URL publik ketika sharing aktif.'
  $NodeExe = Get-NodeExecutable
  # Do not download cloudflared during normal local startup. The tunnel binary is
  # installed and checksum-verified on demand only when the user enables sharing.
  $env:SXL_AUTO_OPEN_BROWSER = '1'
  # Keep mutable state in the user's profile, not beside the extracted/downloaded app.
  $env:SXL_APP_ROOT = $ProjectRoot
  $env:SXL_DATA_DIR = Join-Path $env:APPDATA 'SXL Localhost'
  $env:SXL_RUNTIME_PACKAGES_DIR = Join-Path $ProjectRoot 'runtime\packages'
  $env:SXL_INSTALL_SCRIPT_PATH = Join-Path $ProjectRoot 'Install-SXL-MariaDB.ps1'
  $env:SXL_INSTALL_VERSION_SCRIPT_PATH = Join-Path $ProjectRoot 'Install-SXL-MariaDB-Version.ps1'
  # A pristine Windows x64 profile auto-installs the bundled MariaDB archive, then
  # starts it and verifies the selected server before the UI server opens.
  $env:SXL_AUTO_BOOTSTRAP_MARIADB = '1'

  Write-Step 'Menyiapkan MariaDB lokal (ZIP bawaan), memverifikasi startup + SQL, lalu membuka panel lokal'
  Write-Step 'Menjalankan server lokal (port 4177 digunakan jika tersedia; URL aktual muncul di bawah)'
  Write-Host 'Biarkan jendela ini tetap terbuka. Tekan Ctrl+C untuk menghentikan server.' -ForegroundColor Yellow
  & $NodeExe (Join-Path $ProjectRoot 'server.js')
  if ($LASTEXITCODE -ne 0) {
    throw "Server berhenti dengan kode $LASTEXITCODE. Periksa pesan error di atas."
  }
} catch {
  Write-Host "`nGAGAL: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Periksa koneksi internet saat penyiapan runtime, lalu coba jalankan ulang launcher.' -ForegroundColor Yellow
  exit 1
}
