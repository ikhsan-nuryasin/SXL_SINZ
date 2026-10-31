[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$VersionRoot,
  [Parameter(Mandatory=$true)][string]$ArchivePath,
  [Parameter(Mandatory=$true)][int]$Port,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ExpectedName = 'mariadb-13.0.2-winx64.zip'
$PinnedSha256 = 'ba9cefd6674b3f2f7bc67334c05305dc7c919643d76836e10767e70db0b5fb74'


function Set-PrivateTreeAcl([string]$Target) {
  if (-not (Test-Path -LiteralPath $Target -PathType Container)) { throw "Direktori ACL tidak ditemukan: $Target" }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($sid -notmatch '^S-\d-\d+(?:-\d+)+$') { throw 'SID akun Windows tidak dapat diverifikasi untuk ACL runtime.' }

  # Validate the full staging tree before changing permissions; never traverse
  # reparse points. icacls modifies NTFS DACLs only without applying SACLs.
  $items = @((Get-Item -LiteralPath $Target -Force)) + @(Get-ChildItem -LiteralPath $Target -Force -Recurse -ErrorAction Stop)
  foreach ($item in $items) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Runtime staging berisi reparse point yang tidak didukung: $($item.FullName)"
    }
  }

  $icacls = Join-Path $env:WINDIR 'System32\icacls.exe'
  if (-not (Test-Path -LiteralPath $icacls -PathType Leaf)) { $icacls = 'icacls.exe' }
  $resetOutput = & $icacls $Target /reset /T /Q 2>&1
  $resetExit = $LASTEXITCODE
  if ($resetExit -ne 0) {
    throw "icacls gagal membersihkan DACL staging runtime (exit $resetExit): $(($resetOutput | Out-String).Trim())"
  }
  # Apply inheritable ACEs to the root only. Recursing these inheritance-only
  # ACEs onto files leaves them with an empty DACL and prevents MariaDB loading.
  $aclArgs = @($Target, '/inheritance:r', '/grant:r', ('*{0}:(OI)(CI)(F)' -f $sid), '*S-1-5-18:(OI)(CI)(F)', '*S-1-5-32-544:(OI)(CI)(F)', '/Q')
  $aclOutput = & $icacls @aclArgs 2>&1
  $aclExit = $LASTEXITCODE
  if ($aclExit -ne 0) {
    throw "icacls gagal menerapkan ACL staging runtime (exit $aclExit): $(($aclOutput | Out-String).Trim())"
  }
}

function Assert-LeafFile([string]$Path, [string]$Name) {
  if (-not [System.IO.Path]::IsPathRooted($Path)) { throw "$Name harus berupa path absolut." }
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "$Name tidak ditemukan atau bukan file: $resolved" }
  $item = Get-Item -LiteralPath $resolved -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "$Name tidak boleh berupa symbolic link/reparse point." }
  return $resolved
}

function ConvertTo-WindowsArgument([string]$Value) {
  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append('"')
  $slashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') { $slashes++; continue }
    if ($character -eq '"') {
      [void]$builder.Append(('\' * (2 * $slashes + 1)))
      [void]$builder.Append('"')
      $slashes = 0
      continue
    }
    if ($slashes -gt 0) { [void]$builder.Append(('\' * $slashes)); $slashes = 0 }
    [void]$builder.Append($character)
  }
  if ($slashes -gt 0) { [void]$builder.Append(('\' * (2 * $slashes))) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Invoke-MariaDBClient([string]$Executable, [string[]]$Arguments, [int]$TimeoutMs = 10000) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Executable
  $info.Arguments = (($Arguments | ForEach-Object { ConvertTo-WindowsArgument ([string]$_) }) -join ' ')
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  if (-not [string]::IsNullOrEmpty($env:MYSQL_PWD)) {
    $info.EnvironmentVariables['MYSQL_PWD'] = $env:MYSQL_PWD
  }
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "Tidak dapat menjalankan klien MariaDB: $Executable" }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit($TimeoutMs)) {
    try { $process.Kill() } catch {}
    throw "Klien MariaDB melewati batas waktu ${TimeoutMs} ms: $([IO.Path]::GetFileName($Executable))"
  }
  $process.WaitForExit()
  return [pscustomobject]@{
    ExitCode = $process.ExitCode
    StdOut = $stdoutTask.GetAwaiter().GetResult()
    StdErr = $stderrTask.GetAwaiter().GetResult()
  }
}

$Stage = $null
$BootstrapStage = $null
try {
  if ($env:OS -ne 'Windows_NT' -or [Environment]::Is64BitOperatingSystem -ne $true) {
    throw 'MariaDB 13.0.2 runtime ini hanya dapat dipasang pada Windows x64.'
  }
  if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Port database harus berada di antara 1024 dan 65535.' }
  if ($ExpectedSha256.ToLowerInvariant() -ne $PinnedSha256) { throw 'Checksum yang diminta oleh aplikasi tidak sesuai dengan checksum rilis yang dipatok.' }
  $ArchivePath = Assert-LeafFile $ArchivePath 'Arsip MariaDB'
  if ([System.IO.Path]::GetFileName($ArchivePath) -ine $ExpectedName) { throw "Nama arsip wajib $ExpectedName." }
  $archiveHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($archiveHash -ne $PinnedSha256) { throw "SHA-256 arsip tidak cocok. Diharapkan $PinnedSha256, ditemukan $archiveHash." }

  if (-not [System.IO.Path]::IsPathRooted($VersionRoot)) { throw 'Direktori target versi harus berupa path absolut.' }
  $VersionRoot = [System.IO.Path]::GetFullPath($VersionRoot)
  if (Test-Path -LiteralPath $VersionRoot) {
    throw "Direktori target versi sudah ada. Tidak akan menimpa binary, konfigurasi, log, backup, atau data: $VersionRoot"
  }
  $Parent = Split-Path -Parent $VersionRoot
  New-Item -ItemType Directory -Path $Parent -Force | Out-Null
  $Stage = Join-Path $Parent ('.sxl-mariadb-13-stage-' + [Guid]::NewGuid().ToString('N'))
  $Payload = Join-Path $Stage 'payload'
  New-Item -ItemType Directory -Path $Stage,$Payload -Force | Out-Null
  # Keep the committed payload in AppData, but execute the Windows initializer
  # from a normal writable project/temp location. Some Windows security setups
  # deny launching newly staged helper EXEs from protected AppData runtime trees.
  # The ZIP is already pinned and SHA-256 verified above; no system security is disabled.
  $bootstrapBases = @($PSScriptRoot, $env:TEMP) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
  foreach ($base in $bootstrapBases) {
    $candidate = Join-Path $base ('.sxl-mariadb-bootstrap-' + [Guid]::NewGuid().ToString('N'))
    try {
      New-Item -ItemType Directory -Path $candidate -ErrorAction Stop | Out-Null
      Set-PrivateTreeAcl $candidate
      $BootstrapStage = $candidate
      break
    } catch {
      if (Test-Path -LiteralPath $candidate -PathType Container) {
        Remove-Item -LiteralPath $candidate -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }
  if (-not $BootstrapStage) {
    throw 'Tidak dapat membuat direktori bootstrap sementara yang dapat ditulis pada folder aplikasi maupun TEMP.'
  }
  $Extract = Join-Path $BootstrapStage 'extract'
  New-Item -ItemType Directory -Path $Extract -Force | Out-Null
  # Restrict payload and temporary runtime data because the initializer receives a generated root password.
  Set-PrivateTreeAcl $Stage

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    [long]$expandedTotal = 0
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName.Replace('\','/')
      if ($name.StartsWith('/') -or $name -match '^[A-Za-z]:' -or (($name -split '/') -contains '..')) {
        throw "Arsip berisi path yang tidak aman: $name"
      }
      $segments = @($name -split '/')
      # Avoid Select-Object -SkipLast because Windows PowerShell 5.1 is supported.
      if ($name.EndsWith('/') -and $segments.Count -gt 1 -and $segments[-1] -eq '') { $segments = @($segments[0..($segments.Count - 2)]) }
      foreach ($segment in $segments) {
        if ([string]::IsNullOrWhiteSpace($segment) -or $segment -match '[:*?"<>|]' -or $segment -match '[. ]$' -or $segment -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$') {
          throw "Arsip berisi nama path yang tidak aman untuk Windows: $name"
        }
      }
      if (-not $seen.Add($name)) { throw "Arsip memiliki path duplikat yang tidak peka huruf besar/kecil: $name" }
      $expandedTotal += [long]$entry.Length
      if ($expandedTotal -gt 1GB) { throw 'Ukuran hasil ekstraksi melebihi batas pemeriksaan 1 GiB.' }
      $unixMode = ($entry.ExternalAttributes -shr 16) -band 0xF000
      if ($unixMode -eq 0xA000) { throw "Arsip berisi symbolic link yang tidak didukung: $name" }
    }
    if (-not ($seen.Contains('mariadb-13.0.2-winx64/bin/mariadbd.exe') -and $seen.Contains('mariadb-13.0.2-winx64/bin/server.dll') -and $seen.Contains('mariadb-13.0.2-winx64/bin/mariadb-install-db.exe') -and $seen.Contains('mariadb-13.0.2-winx64/bin/mariadb.exe') -and $seen.Contains('mariadb-13.0.2-winx64/bin/mariadb-admin.exe') -and $seen.Contains('mariadb-13.0.2-winx64/bin/mariadb-dump.exe'))) {
      throw 'Arsip tidak memiliki kumpulan executable MariaDB 13.0.2 yang diwajibkan.'
    }
  } finally { $zip.Dispose() }

  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $Extract -Force
  # This archive has a pinned, validated SHA-256. Remove only Windows' per-file
  # download-origin marker from this verified extracted payload, if present; do
  # not disable Defender, SmartScreen, AppLocker, or other machine policies.
  Get-ChildItem -LiteralPath $Extract -File -Recurse -ErrorAction Stop | ForEach-Object {
    try { Unblock-File -LiteralPath $_.FullName -ErrorAction Stop } catch { }
  }
  Set-PrivateTreeAcl $BootstrapStage
  $SourceHome = Join-Path $Extract 'mariadb-13.0.2-winx64'
  $SourceBin = Join-Path $SourceHome 'bin'
  if (-not (Test-Path -LiteralPath (Join-Path $SourceBin 'server.dll') -PathType Leaf)) { throw 'server.dll tidak ditemukan dalam arsip yang telah diekstrak.' }
  if (-not (Test-Path -LiteralPath (Join-Path $SourceHome 'lib\plugin') -PathType Container)) { throw 'Direktori plugin tidak ditemukan.' }
  if (-not (Test-Path -LiteralPath (Join-Path $SourceHome 'share') -PathType Container)) { throw 'Direktori share tidak ditemukan.' }
  if (-not (Test-Path -LiteralPath (Join-Path $SourceHome 'COPYING') -PathType Leaf)) { throw 'File lisensi COPYING tidak ditemukan.' }

  $ServerRoot = Join-Path $Payload 'server'
  New-Item -ItemType Directory -Path $ServerRoot -Force | Out-Null
  # Copy runtime-relevant files only. Debug symbols, import libraries and C/C++ headers are not runtime needs.
  foreach ($part in @('bin','lib','share')) {
    $source = Join-Path $SourceHome $part
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Komponen runtime tidak lengkap: $part" }
    $destination = Join-Path $ServerRoot $part
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Get-ChildItem -LiteralPath $source -File -Recurse | Where-Object {
      $_.Extension -notin @('.pdb','.lib','.a','.la','.h','.hpp','.c','.cc','.cpp','.obj','.exp','.ilk')
    } | ForEach-Object {
      $relative = $_.FullName.Substring($source.Length).TrimStart('\','/')
      $targetFile = Join-Path $destination $relative
      New-Item -ItemType Directory -Path (Split-Path -Parent $targetFile) -Force | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $targetFile
    }
  }
  foreach ($licenseFile in @('COPYING','THIRDPARTY','CREDITS','README.md')) {
    $source = Join-Path $SourceHome $licenseFile
    if (Test-Path -LiteralPath $source -PathType Leaf) { Copy-Item -LiteralPath $source -Destination (Join-Path $ServerRoot $licenseFile) }
  }

  $ServerBinary = Join-Path $ServerRoot 'bin\mariadbd.exe'
  # Keep a copy in the final runtime, but run the initializer from the freshly
  # extracted source tree rather than from the protected AppData payload copy.
  $Installer = Join-Path $ServerRoot 'bin\mariadb-install-db.exe'
  $SourceInstaller = Join-Path $SourceBin 'mariadb-install-db.exe'
  $Client = Join-Path $ServerRoot 'bin\mariadb.exe'
  $Admin = Join-Path $ServerRoot 'bin\mariadb-admin.exe'
  $Dump = Join-Path $ServerRoot 'bin\mariadb-dump.exe'
  foreach ($required in @($ServerBinary,(Join-Path $ServerRoot 'bin\server.dll'),$Installer,$SourceInstaller,$Client,$Admin,$Dump,(Join-Path $ServerRoot 'lib\libmariadb.dll'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "File runtime wajib hilang setelah copy: $required" }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $ServerRoot 'lib\plugin') -PathType Container)) { throw 'Plugin runtime hilang setelah copy.' }
  $versionOutput = (& $ServerBinary --version 2>&1 | Out-String).Trim()
  $versionExitCode = $LASTEXITCODE
  if ($versionExitCode -ne 0 -or $versionOutput -notmatch '(?i)13\.0\.2') {
    throw "Binary server tidak melaporkan MariaDB 13.0.2. Exit=$versionExitCode; output=$($versionOutput.Substring(0, [Math]::Min(500, $versionOutput.Length)))"
  }

  $DataDir = Join-Path $Payload 'data'
  $ConfigDir = Join-Path $Payload 'config'
  $LogsDir = Join-Path $Payload 'logs'
  $TmpDir = Join-Path $Payload 'tmp'
  $BackupsDir = Join-Path $Payload 'backups'
  New-Item -ItemType Directory -Path $DataDir,$ConfigDir,$LogsDir,$TmpDir,$BackupsDir -Force | Out-Null
  # Explicitly secure every extracted runtime file BEFORE the initializer is
  # launched; do not depend on whatever ACLs the ZIP extractor propagated.
  Set-PrivateTreeAcl $Payload
  $Password = ([Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N'))
  if ($Password -notmatch '^[a-f0-9]{64}$') { throw 'Generator kredensial menghasilkan format yang tidak valid.' }
  $InstallLog = Join-Path $Stage 'initialize.log'
  $InstallStdout = Join-Path $Stage 'initialize.stdout.log'
  $InstallStderr = Join-Path $Stage 'initialize.stderr.log'
  Write-Host 'Checksum cocok. Menyiapkan direktori data baru yang terpisah; database lama tidak dibaca atau ditimpa.'
  # The Windows-specific utility accepts --datadir, --password and --port;
  # unlike the Unix shell script, it does not share the full Unix option set.
  Push-Location -LiteralPath $SourceHome
  try {
    # Do not launch the initializer copy under AppData\...\payload\serverin.
    # Its source tree sits in the user's writable project/temp staging directory,
    # and its adjacent bin/lib/share payload is intact from the verified ZIP.
    $InitArgs = @('--verbose-bootstrap', "--datadir=$DataDir", "--password=$Password", "--port=$Port")
    $InitArgumentLine = ($InitArgs | ForEach-Object { '"' + ([string]$_).Replace('"', '\"') + '"' }) -join ' '
    $initProcess = Start-Process -FilePath $SourceInstaller -ArgumentList $InitArgumentLine `
      -WorkingDirectory $SourceHome -WindowStyle Hidden -PassThru -Wait `
      -RedirectStandardOutput $InstallStdout -RedirectStandardError $InstallStderr
    $initExitCode = $initProcess.ExitCode
    $initOutput = @()
    foreach ($outputFile in @($InstallStdout, $InstallStderr)) {
      if (Test-Path -LiteralPath $outputFile -PathType Leaf) {
        $initOutput += @(Get-Content -LiteralPath $outputFile -ErrorAction Stop)
      }
    }
  } catch {
    $launchMessage = $_.Exception.Message
    if ($launchMessage -match '(?i)access is denied|akses ditolak') {
      throw "Windows menolak menjalankan initializer MariaDB dari direktori bootstrap sementara: $SourceInstaller. Tidak ada data runtime lama yang dihapus. Periksa Windows Security > Protection history atau kebijakan AppLocker/WDAC; aplikasi tidak akan menonaktifkan perlindungan Windows. Detail: $launchMessage"
    }
    throw
  } finally { Pop-Location }
  ($initOutput | ForEach-Object { if ($_ -match '(?i)password|credential|secret') { '[output sensitif disamarkan]' } else { $_ } }) | Out-File -LiteralPath $InstallLog -Encoding utf8
  if ($initExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $DataDir 'mysql') -PathType Container)) {
    $detail = (($initOutput | Select-Object -Last 12 | ForEach-Object { if ($_ -match '(?i)password|credential|secret') { '[output sensitif disamarkan]' } else { [string]$_ } }) -join [Environment]::NewLine)
    throw "Inisialisasi data MariaDB gagal (exit code $initExitCode). Tidak ada runtime versi lain yang diubah. Detail: $detail"
  }

  # The Windows initializer may create a generic my.ini beside its new data files.
  # It is staging-only; the version-specific config below is the one SXL will use.
  $generatedIni = Join-Path $DataDir 'my.ini'
  if (Test-Path -LiteralPath $generatedIni -PathType Leaf) { Remove-Item -LiteralPath $generatedIni -Force }
  $pathForIni = { param([string]$Value) $Value.Replace('\','/') }
  $FinalServerRoot = Join-Path $VersionRoot 'server'
  $FinalDataDir = Join-Path $VersionRoot 'data'
  $FinalConfigDir = Join-Path $VersionRoot 'config'
  $FinalLogsDir = Join-Path $VersionRoot 'logs'
  $FinalTmpDir = Join-Path $VersionRoot 'tmp'
  $FinalBackupsDir = Join-Path $VersionRoot 'backups'
  $FinalServerIni = & $pathForIni $FinalServerRoot
  $FinalDataIni = & $pathForIni $FinalDataDir
  $FinalPluginIni = & $pathForIni (Join-Path $FinalServerRoot 'lib\plugin')
  $FinalTmpIni = & $pathForIni $FinalTmpDir
  $FinalPidIni = & $pathForIni (Join-Path $VersionRoot 'mariadbd.pid')
  $FinalLogIni = & $pathForIni (Join-Path $FinalLogsDir 'mariadbd.log')
  $ini = @"
[client]
host=127.0.0.1
port=$Port
protocol=tcp

[mysqld]
basedir="$FinalServerIni"
datadir="$FinalDataIni"
plugin_dir="$FinalPluginIni"
tmpdir="$FinalTmpIni"
pid-file="$FinalPidIni"
log_error="$FinalLogIni"
port=$Port
bind-address=127.0.0.1
skip-name-resolve
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
"@
  [System.IO.File]::WriteAllText((Join-Path $ConfigDir 'my.ini'), $ini, ([System.Text.UTF8Encoding]::new($false)))

  # Do not call this runtime installed just because files and system tables exist.
  # Start the staged instance on loopback, authenticate, run SELECT VERSION(),
  # and shut it down cleanly before committing the runtime directory.
  # Initialization created new files. Reapply explicit ACLs before the
  # server and client processes load the staged EXE/DLL payload for smoke test.
  Set-PrivateTreeAcl $Payload
  $SmokeLog = Join-Path $LogsDir 'mariadbd.log'
  $SmokePid = Join-Path $Stage 'startup-smoke.pid'
  $SmokeStdout = Join-Path $Stage 'startup-smoke.stdout.log'
  $SmokeStderr = Join-Path $Stage 'startup-smoke.stderr.log'
  $SmokeArgs = @(
    '--no-defaults',
    "--basedir=$ServerRoot",
    "--datadir=$DataDir",
    "--plugin-dir=$(Join-Path $ServerRoot 'lib\plugin')",
    "--tmpdir=$TmpDir",
    "--pid-file=$SmokePid",
    "--log-error=$SmokeLog",
    "--port=$Port",
    '--bind-address=127.0.0.1',
    '--skip-name-resolve',
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_unicode_ci'
  )
  # Start-Process joins ArgumentList into a Windows command line; quote each
  # token so user profile paths containing spaces remain a single argument.
  $SmokeArgumentLine = ($SmokeArgs | ForEach-Object { '"' + ([string]$_).Replace('"', '\"') + '"' }) -join ' '
  $PreviousMysqlPwd = [Environment]::GetEnvironmentVariable('MYSQL_PWD', 'Process')
  $SmokeProcess = $null
  $SmokeReady = $false
  $LastPingDiagnostic = ''
  try {
    $env:MYSQL_PWD = $Password
    $SmokeProcess = Start-Process -FilePath $ServerBinary -ArgumentList $SmokeArgumentLine `
      -WorkingDirectory (Join-Path $ServerRoot 'bin') -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $SmokeStdout -RedirectStandardError $SmokeStderr
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while ([DateTime]::UtcNow -lt $deadline) {
      $SmokeProcess.Refresh()
      if ($SmokeProcess.HasExited) {
        $details = ''
        foreach ($f in @($SmokeStderr, $SmokeLog)) {
          if (Test-Path -LiteralPath $f -PathType Leaf) { $details += "`n" + ((Get-Content -LiteralPath $f -Tail 30 -ErrorAction SilentlyContinue) -join "`n") }
        }
        throw "MariaDB 13.0.2 keluar saat startup test (exit $($SmokeProcess.ExitCode)). $details"
      }
      try {
        $pingResult = Invoke-MariaDBClient $Admin @('--no-defaults', '--protocol=tcp', '--host=127.0.0.1', "--port=$Port", '--user=root', 'ping') 3000
        $pingExitCode = $pingResult.ExitCode
        $LastPingDiagnostic = ($pingResult.StdOut + "`n" + $pingResult.StdErr).Trim()
        if ($pingExitCode -eq 0 -and $LastPingDiagnostic -match '(?i)alive') { $SmokeReady = $true; break }
      } catch { $LastPingDiagnostic = $_.Exception.Message }
      Start-Sleep -Milliseconds 500
    }
    if (-not $SmokeReady) {
      $details = ''
      foreach ($f in @($SmokeStderr, $SmokeLog)) {
        if (Test-Path -LiteralPath $f -PathType Leaf) { $details += "`n" + ((Get-Content -LiteralPath $f -Tail 40 -ErrorAction SilentlyContinue) -join "`n") }
      }
      throw "MariaDB 13.0.2 tidak lulus tes koneksi terautentikasi pada 127.0.0.1:$Port dalam 45 detik. Ping terakhir: $LastPingDiagnostic. $details"
    }
    $versionResult = Invoke-MariaDBClient $Client @('--no-defaults', '--protocol=tcp', '--host=127.0.0.1', "--port=$Port", '--user=root', '--batch', '--skip-column-names', '-e', 'SELECT VERSION()')
    $queryExit = $versionResult.ExitCode
    $queryText = $versionResult.StdOut.Trim()
    if ($queryExit -ne 0 -or $queryText -notmatch '(?i)13\.0\.2') {
      throw "MariaDB merespons ping, tetapi SELECT VERSION() gagal atau versinya tidak cocok. Exit=$queryExit; output=$queryText"
    }
    Write-Host "Startup test lulus: koneksi TCP terautentikasi dan SELECT VERSION() mengembalikan $queryText."
  } finally {
    if ($SmokeProcess) {
      try {
        if (-not $SmokeProcess.HasExited) {
          try { $null = Invoke-MariaDBClient $Admin @('--no-defaults', '--protocol=tcp', '--host=127.0.0.1', "--port=$Port", '--user=root', 'shutdown') } catch { }
          $SmokeProcess.WaitForExit(10000) | Out-Null
          $SmokeProcess.Refresh()
          if (-not $SmokeProcess.HasExited) { $SmokeProcess.Kill(); $SmokeProcess.WaitForExit(5000) | Out-Null }
        }
      } catch { }
    }
    if ($null -eq $PreviousMysqlPwd) { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
    else { $env:MYSQL_PWD = $PreviousMysqlPwd }
  }

  $now = (Get-Date).ToString('o')
  # Protect the persisted credential for the Windows account running SXL. The
  # Windows initializer only accepts --password on its command line; the secret
  # is random, short-lived, redacted from logs, and staging is ACL-restricted.
  $securePassword = ConvertTo-SecureString -String $Password -AsPlainText -Force
  $protectedPassword = ConvertFrom-SecureString -SecureString $securePassword
  $settings = [ordered]@{
    version = '13.0.2'
    versionVerified = $true
    detectedBinaryVersion = $versionOutput
    port = $Port
    host = '127.0.0.1'
    user = 'root'
    password = $protectedPassword
    passwordProtection = 'windows-dpapi-v1'
    installedAt = $now
    sourceArchiveSha256 = $archiveHash
  }
  $settings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Payload 'settings.json') -Encoding utf8
  $metadata = [ordered]@{
    schemaVersion = 1
    id = 'mariadb-13.0.2-winx64'
    product = 'MariaDB Server'
    version = '13.0.2'
    architecture = 'windows-x64'
    releaseChannel = 'stable-rolling'
    defaultHost = '127.0.0.1'
    defaultPort = $Port
    archiveName = $ExpectedName
    archiveSha256 = $archiveHash
    detectedBinaryVersion = $versionOutput
    installedAt = $now
    binaries = @('server/bin/mariadbd.exe','server/bin/server.dll','server/bin/mariadb.exe','server/bin/mariadb-admin.exe','server/bin/mariadb-dump.exe','server/bin/mariadb-install-db.exe')
  }
  $metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Payload 'version.json') -Encoding utf8

  # Protect the full payload (binary, configuration, data, backups, and logs) before commit.
  # If ACL application fails, the final version root is never created.
  Set-PrivateTreeAcl $Payload
  # Directory.Move fails if another process created the target after preflight; it never merges into an existing folder.
  [System.IO.Directory]::Move($Payload, $VersionRoot)
  Write-Host 'MariaDB 13.0.2 telah disalin dan data baru berhasil diinisialisasi.'
  Write-Host "Direktori versi: $VersionRoot"
  Write-Host "Port loopback: 127.0.0.1:$Port"
  Write-Host 'Versi aktif tidak diubah; pilih melalui Studio Database setelah verifikasi.'
} catch {
  throw $_
} finally {
  if ($Stage -and (Test-Path -LiteralPath $Stage -PathType Container)) {
    Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($BootstrapStage -and (Test-Path -LiteralPath $BootstrapStage -PathType Container)) {
    Remove-Item -LiteralPath $BootstrapStage -Recurse -Force -ErrorAction SilentlyContinue
  }
}
