param(
  [Parameter(Mandatory=$true)][string]$RuntimeRoot,
  [int]$Port = 3307,
  [string]$SourceBinDir = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

# Keep the legacy-compatible LTS runtime. Do not derive a trusted checksum from
# the same download host; the pinned digest is checked before any binary executes.
$Version = '11.4.13'
$FileName = "mariadb-$Version-winx64.zip"
$ExpectedArchiveBytes = [long]95024126
$ExpectedSha256 = 'd62986d433eeebfde218560b276103831604a61e929e87f1a17f5aebd80257e2'
$ArchiveUrls = @(
  "https://archive.mariadb.org/mariadb-$Version/winx64-packages/$FileName",
  "https://mirror.math.princeton.edu/pub/mariadb/mariadb-$Version/winx64-packages/$FileName",
  "https://mirror.ossplanet.net/mirror/mariadb/mariadb-$Version/winx64-packages/$FileName",
  "https://mirror.dogado.de/mariadb/mariadb-$Version/winx64-packages/$FileName"
)
$RuntimeRootWasAbsolute = [System.IO.Path]::IsPathRooted($RuntimeRoot)
$RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot)
$LogRoot = Join-Path $RuntimeRoot 'logs'
$PersistentLog = Join-Path $LogRoot 'mariadb-install.log'
$ServerRoot = Join-Path $RuntimeRoot 'server'
$DataDir = Join-Path $RuntimeRoot 'data'
$SettingsPath = Join-Path $RuntimeRoot 'settings.json'

function Protect-InstallText([string]$Text) {
  $safe = $Text -replace '(?i)(--password(?:=|\s+))\S+', '$1[REDACTED]'
  $safe = $safe -replace '(?i)((?:password|passwd|secret|credential)\s*[:=]\s*)\S+', '$1[REDACTED]'
  return $safe
}
function Write-InstallLog([string]$Message) {
  try {
    New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
    $safeMessage = Protect-InstallText $Message
    Add-Content -LiteralPath $PersistentLog -Value ("[{0}] {1}" -f (Get-Date).ToString('o'), $safeMessage) -Encoding UTF8
  } catch { }
}
function Test-AnyLeafInDirectory([string]$Directory, [string[]]$Names) {
  foreach ($name in $Names) {
    if (Test-Path -LiteralPath (Join-Path $Directory $name) -PathType Leaf) { return $true }
  }
  return $false
}

function Copy-RuntimeTree([string]$SourceRoot, [string]$DestinationRoot) {
  if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) { throw "Folder sumber runtime tidak ditemukan: $SourceRoot" }
  if (Test-Path -LiteralPath $DestinationRoot) { throw "Folder staging tujuan sudah ada: $DestinationRoot" }
  $source = (Get-Item -LiteralPath $SourceRoot -Force).FullName.TrimEnd([char[]]@(92,47))
  New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
  Get-ChildItem -LiteralPath $source -Force -Recurse | ForEach-Object {
    $item = $_
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Arsip runtime memuat reparse point yang tidak diizinkan: $($item.FullName)"
    }
    $relative = $item.FullName.Substring($source.Length).TrimStart([char[]]@(92,47))
    if (-not $relative) { return }
    $target = Join-Path $DestinationRoot $relative
    if ($item.PSIsContainer) {
      New-Item -ItemType Directory -Path $target -Force | Out-Null
    } else {
      New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
      Copy-Item -LiteralPath $item.FullName -Destination $target -Force
    }
  }
}

function Test-VerifiedArchive([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Arsip cache tidak boleh berupa reparse point: $Path" }
  if ($item.Length -ne $ExpectedArchiveBytes) {
    Write-InstallLog "Arsip cache diabaikan: ukuran $($item.Length), seharusnya $ExpectedArchiveBytes."
    return $false
  }
  $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $ExpectedSha256) {
    Write-InstallLog "Arsip cache diabaikan: SHA-256 $hash tidak cocok."
    return $false
  }
  return $true
}
trap {
  $caughtText = Protect-InstallText ([string]$_.Exception.Message)
  Write-InstallLog "ERROR: $caughtText"
  throw
}

function Set-PrivateTreeAcl([string]$Target) {
  if (-not (Test-Path -LiteralPath $Target -PathType Container)) { throw "Direktori ACL tidak ditemukan: $Target" }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($sid -notmatch '^S-\d-\d+(?:-\d+)+$') { throw 'SID akun Windows tidak dapat diverifikasi untuk ACL runtime.' }
  $resetOutput = & icacls.exe $Target '/reset' '/T' '/Q' 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Gagal mengatur ulang ACL direktori runtime (exit $LASTEXITCODE): $($resetOutput | Select-Object -Last 4 | Out-String)" }
  $rules = @("*$($sid):(OI)(CI)F", '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
  # Keep the inheritable ACEs on the root so children inherit usable file rights.
  $aclOutput = & icacls.exe $Target '/inheritance:r' '/grant:r' @rules 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Gagal membatasi ACL direktori runtime (exit $LASTEXITCODE): $($aclOutput | Select-Object -Last 4 | Out-String)" }
}

if (-not $RuntimeRootWasAbsolute) { throw 'RuntimeRoot harus berupa path absolut.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Port database harus berada di antara 1024 dan 65535.' }
New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
Write-InstallLog "Mulai pemasangan MariaDB $Version; port=$Port; runtime=$RuntimeRoot"
$ExistingServer = Join-Path $ServerRoot 'bin\mariadbd.exe'
$ExistingData = Join-Path $DataDir 'mysql'
if ((Test-Path -LiteralPath $ExistingServer -PathType Leaf) -and (Test-Path -LiteralPath $ExistingData -PathType Container) -and (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
  Write-Host 'MariaDB sudah terpasang dan data lama dipertahankan.'
  exit 0
}
if ((Test-Path -LiteralPath $ExistingData -PathType Container) -and -not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
  throw "Folder data MariaDB sudah ada tetapi settings.json tidak ditemukan. Demi keamanan, pemasangan otomatis dihentikan agar data lama tidak ditimpa. Periksa $RuntimeRoot."
}
if ((Test-Path -LiteralPath $DataDir -PathType Container) -and -not (Test-Path -LiteralPath $ExistingData -PathType Container)) {
  $UnexpectedData = @(Get-ChildItem -LiteralPath $DataDir -Force -ErrorAction SilentlyContinue)
  if ($UnexpectedData.Count -gt 0) {
    throw "Folder data MariaDB tidak kosong tetapi belum memiliki schema mysql. Demi keamanan, data tidak disentuh: $DataDir"
  }
}
if (Test-Path -LiteralPath $ServerRoot) {
  throw "Folder binary MariaDB sudah ada tetapi belum terverifikasi sebagai instalasi lengkap. Tidak akan ditimpa atau dihapus: $ServerRoot"
}

$DataDirExistedBeforeInstall = Test-Path -LiteralPath $DataDir -PathType Container
$CreatedServerRoot = $false
$InstallStage = Join-Path $RuntimeRoot ('.sxl-mariadb-install-' + [Guid]::NewGuid().ToString('N'))
$CacheDir = Join-Path $RuntimeRoot 'packages'
$ZipPath = Join-Path $CacheDir $FileName
$DownloadDir = Join-Path $InstallStage 'downloads'
$ExtractDir = Join-Path $InstallStage 'extract'
$InstallLog = Join-Path $InstallStage 'install.log'
Write-InstallLog "Folder staging dibuat: $InstallStage"
New-Item -ItemType Directory -Path $InstallStage,$CacheDir -Force | Out-Null
New-Item -ItemType Directory -Path $DownloadDir,$ExtractDir -Force | Out-Null
try {
  Set-PrivateTreeAcl $InstallStage
if ($SourceBinDir) {
  if (-not [System.IO.Path]::IsPathRooted($SourceBinDir) -or -not (Test-Path -LiteralPath $SourceBinDir -PathType Container)) {
    throw "Folder bin MariaDB manual tidak valid: $SourceBinDir"
  }
  $ManualServer = Get-ChildItem -LiteralPath $SourceBinDir -File | Where-Object { $_.Name -in @('mariadbd.exe','mysqld.exe') } | Select-Object -First 1
  $ManualInstaller = Get-ChildItem -LiteralPath $SourceBinDir -File | Where-Object { $_.Name -in @('mariadb-install-db.exe','mysql_install_db.exe') } | Select-Object -First 1
  $ManualClient = Get-ChildItem -LiteralPath $SourceBinDir -File | Where-Object { $_.Name -in @('mariadb.exe','mysql.exe') } | Select-Object -First 1
  $ManualAdmin = Get-ChildItem -LiteralPath $SourceBinDir -File | Where-Object { $_.Name -in @('mariadb-admin.exe','mysqladmin.exe') } | Select-Object -First 1
  $ManualDump = Get-ChildItem -LiteralPath $SourceBinDir -File | Where-Object { $_.Name -in @('mariadb-dump.exe','mysqldump.exe') } | Select-Object -First 1
  if (-not $ManualServer -or -not $ManualInstaller -or -not $ManualClient -or -not $ManualAdmin -or -not $ManualDump) {
    throw 'Folder manual harus berisi server, installer database, client, admin, dan dump (mariadbd/mysqld, mariadb-install-db/mysql_install_db, mariadb/mysql, mariadb-admin/mysqladmin, mariadb-dump/mysqldump). MySQL Server tidak selalu kompatibel dengan installer MariaDB.'
  }
  $SourceHome = Split-Path $SourceBinDir -Parent
  try {
    $ManualVersionOutput = (& $ManualServer.FullName --version 2>&1 | Out-String)
    if ($ManualVersionOutput -match '(?i)(\d+\.\d+\.\d+)') { $Version = "Manual $($Matches[1])" }
    else { $Version = 'Manual runtime' }
  } catch { $Version = 'Manual runtime' }
  $ExtractDir = Join-Path $InstallStage 'manual-stage'
  New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
  Write-Host "Menggunakan binary MariaDB dari folder yang dipilih: $SourceBinDir"
  foreach ($Part in @('bin','share','lib','include','scripts','support-files')) {
    $PartSource = Join-Path $SourceHome $Part
    if (Test-Path -LiteralPath $PartSource) {
      $PartDestination = Join-Path $ExtractDir $Part
      New-Item -ItemType Directory -Path $PartDestination -Force | Out-Null
      Get-ChildItem -LiteralPath $PartSource -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $PartDestination -Recurse -Force
      }
    }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $ExtractDir 'bin\mariadb-install-db.exe') -PathType Leaf) -and -not (Test-Path -LiteralPath (Join-Path $ExtractDir 'bin\mysql_install_db.exe') -PathType Leaf)) {
    throw 'Binary MariaDB berhasil dibaca tetapi installer database tidak ditemukan setelah penyalinan.'
  }
  if (Test-Path -LiteralPath $ServerRoot) { throw "Folder binary runtime sudah ada; tidak ditimpa atau dihapus: $ServerRoot" }
  [System.IO.Directory]::Move($ExtractDir, $ServerRoot)
  $CreatedServerRoot = $true
} else {
  Write-Host "Menyiapkan MariaDB Server $Version LTS dari cache tepercaya atau sumber resmi/cermin HTTPS..."
  $downloadedAndVerified = $false
  if (Test-VerifiedArchive $ZipPath) {
    Write-InstallLog "Menggunakan arsip cache yang telah terverifikasi: $ZipPath"
    Write-Host 'Arsip MariaDB lokal sudah terverifikasi; unduhan dilewati.'
    $downloadedAndVerified = $true
  } else {
    Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue
    $downloadErrors = @()
    foreach ($archiveUrl in $ArchiveUrls) {
      $partialZip = Join-Path $CacheDir ($FileName + '.download-' + [Guid]::NewGuid().ToString('N'))
      try {
        Write-InstallLog "Mencoba unduh arsip dari $archiveUrl"
        $curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
        if ($curl) {
          & $curl.Source '--fail' '--location' '--silent' '--show-error' '--connect-timeout' '20' '--max-time' '300' '--proto' '=https' '--proto-redir' '=https' '--output' $partialZip $archiveUrl
          if ($LASTEXITCODE -ne 0) { throw "curl.exe gagal dengan kode $LASTEXITCODE." }
        } else {
          Invoke-WebRequest -Uri $archiveUrl -OutFile $partialZip -UseBasicParsing -TimeoutSec 300
        }
        if (-not (Test-Path -LiteralPath $partialZip -PathType Leaf)) { throw 'Unduhan tidak menghasilkan file arsip.' }
        $downloadSize = (Get-Item -LiteralPath $partialZip).Length
        if ($downloadSize -ne $ExpectedArchiveBytes) { throw "Ukuran arsip tidak sesuai: $downloadSize byte; diharapkan $ExpectedArchiveBytes byte." }
        $Actual = (Get-FileHash -LiteralPath $partialZip -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($Actual -ne $ExpectedSha256) { throw "SHA-256 tidak cocok: $Actual. Arsip tidak akan dieksekusi." }
        Move-Item -LiteralPath $partialZip -Destination $ZipPath -Force
        Write-InstallLog "Checksum cocok dari sumber $archiveUrl; size=$downloadSize; sha256=$Actual"
        $downloadedAndVerified = $true
        break
      } catch {
        $sourceError = Protect-InstallText ([string]$_.Exception.Message)
        $downloadErrors += "$archiveUrl - $sourceError"
        Write-InstallLog "Sumber unduhan gagal: $archiveUrl - $sourceError"
        Remove-Item -LiteralPath $partialZip -Force -ErrorAction SilentlyContinue
      }
    }
    if (-not $downloadedAndVerified) {
      throw "Tidak ada sumber MariaDB yang menghasilkan arsip sesuai ukuran dan SHA-256 terpatok. Rincian: $($downloadErrors -join ' || ')"
    }
  }

  New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
  Write-Host 'Checksum benar. Mengekstrak MariaDB portable...'
  Write-InstallLog 'Mulai ekstraksi arsip yang telah diverifikasi.'
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractDir -Force
  $ServerBinary = Get-ChildItem -LiteralPath $ExtractDir -Filter 'mariadbd.exe' -File -Recurse | Select-Object -First 1
  if (-not $ServerBinary) { $ServerBinary = Get-ChildItem -LiteralPath $ExtractDir -Filter 'mysqld.exe' -File -Recurse | Select-Object -First 1 }
  if (-not $ServerBinary) { throw "Arsip telah diverifikasi tetapi mariadbd.exe / mysqld.exe tidak ditemukan setelah ekstraksi ke $ExtractDir." }
  $SourceBin = Split-Path $ServerBinary.FullName -Parent
  $SourceHome = Split-Path $SourceBin -Parent
  $SourceGroups = @(
    @{ Label = 'server'; Names = @('mariadbd.exe','mysqld.exe') },
    @{ Label = 'installer'; Names = @('mariadb-install-db.exe','mysql_install_db.exe') },
    @{ Label = 'client'; Names = @('mariadb.exe','mysql.exe') },
    @{ Label = 'admin'; Names = @('mariadb-admin.exe','mysqladmin.exe') },
    @{ Label = 'dump'; Names = @('mariadb-dump.exe','mysqldump.exe') }
  )
  $missingInArchive = @()
  foreach ($group in $SourceGroups) {
    if (-not (Test-AnyLeafInDirectory $SourceBin $group.Names)) { $missingInArchive += $group.Label }
  }
  if ($missingInArchive.Count) { throw "Arsip MariaDB tidak lengkap setelah ekstraksi. Komponen hilang: $($missingInArchive -join ', '); folder bin yang diperiksa: $SourceBin." }

  # Copy each file to an exact relative destination inside staging. This avoids
  # Copy-Item folder nesting differences between Windows PowerShell versions.
  $StagedServerRoot = Join-Path $InstallStage 'server-payload'
  Copy-RuntimeTree -SourceRoot $SourceHome -DestinationRoot $StagedServerRoot
  $StagedBin = Join-Path $StagedServerRoot 'bin'
  $missingAfterCopy = @()
  foreach ($group in $SourceGroups) {
    if (-not (Test-AnyLeafInDirectory $StagedBin $group.Names)) { $missingAfterCopy += $group.Label }
  }
  if ($missingAfterCopy.Count) { throw "Hasil staging runtime tidak lengkap. Komponen hilang: $($missingAfterCopy -join ', '); bin staging: $StagedBin." }

  $stagedServerExe = Join-Path $StagedBin 'mariadbd.exe'
  if (-not (Test-Path -LiteralPath $stagedServerExe -PathType Leaf)) { $stagedServerExe = Join-Path $StagedBin 'mysqld.exe' }
  $stagedVersionOutput = (& $stagedServerExe --version 2>&1 | Out-String).Trim()
  $stagedVersionExitCode = $LASTEXITCODE
  if ($stagedVersionExitCode -ne 0 -or $stagedVersionOutput -notmatch '(?i)11\.4\.13') {
    throw "Binary staging belum dapat diverifikasi sebagai MariaDB 11.4.13. Exit=$stagedVersionExitCode; output=$stagedVersionOutput"
  }
  if (Test-Path -LiteralPath $ServerRoot) { throw "Folder binary runtime sudah ada; tidak ditimpa atau dihapus: $ServerRoot" }
  [System.IO.Directory]::Move($StagedServerRoot, $ServerRoot)
  $CreatedServerRoot = $true
  Write-InstallLog "Arsip diverifikasi; server dan client dipindahkan dari staging ke lokasi tetap: $ServerRoot; versi=$stagedVersionOutput"
}
$InstalledServer = Join-Path $ServerRoot 'bin\mariadbd.exe'
if (-not (Test-Path -LiteralPath $InstalledServer -PathType Leaf)) { $InstalledServer = Join-Path $ServerRoot 'bin\mysqld.exe' }
if (-not (Test-Path -LiteralPath $InstalledServer -PathType Leaf)) { throw 'Binary server tidak ditemukan setelah ekstraksi/penyalinan.' }
$RequiredRuntimeGroups = @(
  @{ Label = 'server'; Names = @('mariadbd.exe','mysqld.exe') },
  @{ Label = 'installer'; Names = @('mariadb-install-db.exe','mysql_install_db.exe') },
  @{ Label = 'client'; Names = @('mariadb.exe','mysql.exe') },
  @{ Label = 'admin'; Names = @('mariadb-admin.exe','mysqladmin.exe') },
  @{ Label = 'dump'; Names = @('mariadb-dump.exe','mysqldump.exe') }
)
$missingAfterCopy = @()
foreach ($group in $RequiredRuntimeGroups) {
  if (-not (Test-AnyLeafInDirectory (Join-Path $ServerRoot 'bin') $group.Names)) { $missingAfterCopy += $group.Label }
}
if ($missingAfterCopy.Count) { throw "Hasil salinan runtime tidak lengkap. Komponen hilang: $($missingAfterCopy -join ', ')." }
$ActualVersionOutput = (& $InstalledServer --version 2>&1 | Out-String).Trim()
$ActualVersionExitCode = $LASTEXITCODE
if ($ActualVersionExitCode -ne 0 -or $ActualVersionOutput -notmatch '(?i)(\d+\.\d+\.\d+)') {
  throw "Versi executable database tidak dapat diverifikasi. Exit=$ActualVersionExitCode; output=$ActualVersionOutput"
}
$ActualVersion = $Matches[1]
if (-not $SourceBinDir -and $ActualVersion -ne $Version) {
  throw "Versi binary tidak cocok dengan paket yang diminta: diharapkan $Version, ditemukan $ActualVersion."
}
if ($SourceBinDir -and $Version -match '(\d+\.\d+\.\d+)' -and $Matches[1] -ne $ActualVersion) {
  throw "Versi binary sumber manual berubah saat penyalinan: $($Matches[1]) menjadi $ActualVersion."
}
if ($SourceBinDir) { $Version = "Manual $ActualVersion" } else { $Version = $ActualVersion }
Write-InstallLog "Executable server terverifikasi: $ActualVersionOutput"
$Installer = Join-Path $ServerRoot 'bin\mariadb-install-db.exe'
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { $Installer = Join-Path $ServerRoot 'bin\mysql_install_db.exe' }
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'Installer database tidak ditemukan setelah ekstraksi/penyalinan.' }

New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
$Password = ([Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N') + '!Sx7')
Write-Host 'Membuat direktori data dan akun root lokal...'
Write-InstallLog "Mulai inisialisasi database pada data dir $DataDir dan port $Port"
Push-Location -LiteralPath $ServerRoot
try {
  $BootstrapOutput = & $Installer "--datadir=$DataDir" "--password=$Password" "--port=$Port" 2>&1
  $BootstrapExitCode = $LASTEXITCODE
} finally { Pop-Location }
$SafeBootstrapLines = @($BootstrapOutput | ForEach-Object { Protect-InstallText ([string]$_) })
$SafeBootstrapLines | Out-File -LiteralPath $InstallLog -Encoding utf8
foreach ($safeLine in $SafeBootstrapLines) { if (-not [string]::IsNullOrWhiteSpace($safeLine)) { Write-InstallLog "bootstrap: $safeLine" } }
if ($BootstrapExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $DataDir 'mysql') -PathType Container)) {
  $SafeBootstrapDetail = ($SafeBootstrapLines | Select-Object -Last 8) -join [Environment]::NewLine
  throw "Inisialisasi MariaDB gagal (exit code $BootstrapExitCode). Detail: $SafeBootstrapDetail"
}
Write-InstallLog 'Inisialisasi database berhasil; schema mysql ditemukan.'

# Limit access to all managed files before the settings file is written.
Set-PrivateTreeAcl $RuntimeRoot
$SecurePassword = ConvertTo-SecureString -String $Password -AsPlainText -Force
$ProtectedPassword = ConvertFrom-SecureString -SecureString $SecurePassword
$Settings = [ordered]@{
  version = $Version
  versionVerified = $true
  detectedBinaryVersion = $ActualVersionOutput
  port = $Port
  host = '127.0.0.1'
  user = 'root'
  password = $ProtectedPassword
  passwordProtection = 'windows-dpapi-v1'
  installedAt = (Get-Date).ToString('o')
}
$Settings | ConvertTo-Json | Set-Content -LiteralPath $SettingsPath -Encoding utf8

if ($SourceBinDir) { Write-Host "MariaDB manual ($Version) berhasil disiapkan di $RuntimeRoot." } else { Write-Host "MariaDB $Version portable berhasil dipasang di $RuntimeRoot." }
Write-Host "Data disimpan di $DataDir. Database hanya akan mendengarkan pada 127.0.0.1."
Write-InstallLog "SUKSES: MariaDB $Version terpasang; data=$DataDir; port=$Port; host=127.0.0.1"
} catch {
  $errorText = Protect-InstallText ([string]$_.Exception.Message)
  Write-InstallLog "ERROR: $errorText"
  throw
} finally {
  if ($InstallStage -and (Test-Path -LiteralPath $InstallStage -PathType Container)) {
    Remove-Item -LiteralPath $InstallStage -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($CreatedServerRoot -and (Test-Path -LiteralPath $ServerRoot -PathType Container) -and -not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
    Remove-Item -LiteralPath $ServerRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (-not $DataDirExistedBeforeInstall -and (Test-Path -LiteralPath $DataDir -PathType Container) -and -not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
    Remove-Item -LiteralPath $DataDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
