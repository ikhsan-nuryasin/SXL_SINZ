[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$PackageDir = Join-Path $PSScriptRoot 'runtime\packages'
$PhpName = 'php-8.3.36-1-nts-Win32-vs16-x64.zip'
$PhpUrl = 'https://downloads.php.net/~windows/releases/archives/php-8.3.36-1-nts-Win32-vs16-x64.zip'
$PhpSha256 = '1a097d52b7a68622cdc723073b61cc70caf79c941218ff65b2d8441dbc6b10d4'
$MariaName = 'mariadb-13.0.2-winx64.zip'
$MariaUrl = 'https://archive.mariadb.org/mariadb-13.0.2/winx64-packages/mariadb-13.0.2-winx64.zip'
$MariaSha256 = 'ba9cefd6674b3f2f7bc67334c05305dc7c919643d76836e10767e70db0b5fb74'
$MariaSize = 104263573L

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
  throw 'Bootstrapper runtime ini khusus Windows x64.'
}
if ([Environment]::Is64BitOperatingSystem -ne $true) {
  throw 'PHP/MariaDB pack ini hanya mendukung Windows x64.'
}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null

function Install-VerifiedArchive {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$Url,
    [Parameter(Mandatory=$true)][string]$ExpectedSha256,
    [Nullable[long]]$ExpectedSize = $null
  )
  $target = Join-Path $PackageDir $Name
  if ((Test-Path -LiteralPath $target -PathType Leaf) -and -not $Force) {
    $existingHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    $existingSize = (Get-Item -LiteralPath $target).Length
    $sizeOk = $null -eq $ExpectedSize -or $existingSize -eq [long]$ExpectedSize
    if ($existingHash -eq $ExpectedSha256 -and $sizeOk) {
      Write-Host "OK sudah tersedia dan terverifikasi: $Name" -ForegroundColor Green
      return
    }
    throw "Arsip yang sudah ada tidak cocok dengan metadata terverifikasi: $Name. Pindahkan file tersebut atau jalankan ulang dengan -Force untuk mengunduh ulang."
  }

  $partial = "$target.download-$PID"
  Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
  Write-Host "Mengunduh $Name dari sumber resmi..."
  try {
    Invoke-WebRequest -Uri $Url -OutFile $partial -UseBasicParsing
    $item = Get-Item -LiteralPath $partial
    if ($null -ne $ExpectedSize -and $item.Length -ne [long]$ExpectedSize) {
      throw "Ukuran arsip tidak cocok. Diterima $($item.Length) byte; seharusnya $ExpectedSize byte."
    }
    $hash = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $ExpectedSha256.ToLowerInvariant()) {
      throw "SHA-256 tidak cocok untuk $Name. Hasil: $hash"
    }
    Move-Item -LiteralPath $partial -Destination $target -Force
    Write-Host "TERVERIFIKASI: $Name ($([math]::Round((Get-Item -LiteralPath $target).Length / 1MB, 1)) MB)" -ForegroundColor Green
  } catch {
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    throw "Gagal menyiapkan $Name. Arsip tidak disimpan jika checksum/ukuran tidak benar. Detail: $($_.Exception.Message)"
  }
}

Install-VerifiedArchive -Name $PhpName -Url $PhpUrl -ExpectedSha256 $PhpSha256
Install-VerifiedArchive -Name $MariaName -Url $MariaUrl -ExpectedSha256 $MariaSha256 -ExpectedSize $MariaSize

Write-Host ''
Write-Host 'Paket runtime selesai disiapkan di:' -ForegroundColor Green
Write-Host $PackageDir
Write-Host 'SXL akan memakai paket PHP lokal saat pemasangan runtime; tombol MariaDB 13.0.2 akan memilih ZIP lokal secara otomatis.'
