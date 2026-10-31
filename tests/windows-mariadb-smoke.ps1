[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ArchivePath,
  [string]$SourceRoot = ''
)
$ErrorActionPreference = 'Stop'
$PinnedSha256 = 'ba9cefd6674b3f2f7bc67334c05305dc7c919643d76836e10767e70db0b5fb74'
if ([string]::IsNullOrWhiteSpace($SourceRoot)) { $SourceRoot = Split-Path -Parent $PSScriptRoot }
$testRoot = $null
$serverProcess = $null
$passed = $false
$previousMysqlPwd = $env:MYSQL_PWD

function ConvertTo-WindowsArgument([string]$Value) {
  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append('"')
  $slashes = 0
  foreach ($char in $Value.ToCharArray()) {
    if ($char -eq '\') { $slashes++; continue }
    if ($char -eq '"') {
      [void]$builder.Append(('\' * (2 * $slashes + 1)))
      [void]$builder.Append('"')
      $slashes = 0
      continue
    }
    if ($slashes -gt 0) { [void]$builder.Append(('\' * $slashes)); $slashes = 0 }
    [void]$builder.Append($char)
  }
  if ($slashes -gt 0) { [void]$builder.Append(('\' * (2 * $slashes))) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Invoke-NativeProcess([string]$FilePath, [string[]]$ArgumentList, [string]$InputText = $null, [hashtable]$Environment = @{}, [int]$TimeoutMs = 15000) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $FilePath
  $info.Arguments = (($ArgumentList | ForEach-Object { ConvertTo-WindowsArgument ([string]$_) }) -join ' ')
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.RedirectStandardInput = ($null -ne $InputText)
  foreach ($key in $Environment.Keys) { $info.EnvironmentVariables[[string]$key] = [string]$Environment[$key] }
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "Tidak dapat menjalankan $FilePath" }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if ($null -ne $InputText) {
    $process.StandardInput.Write($InputText)
    $process.StandardInput.Close()
  }
  if (-not $process.WaitForExit($TimeoutMs)) {
    try { $process.Kill() } catch {}
    throw "Proses $([IO.Path]::GetFileName($FilePath)) melewati timeout $TimeoutMs ms."
  }
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  return [pscustomobject]@{ ExitCode = $process.ExitCode; StdOut = $stdout; StdErr = $stderr }
}

function Invoke-Sql([string]$Sql, [string]$Client, [int]$Port, [string]$Password, [string]$InputText = $null) {
  $args = @('--protocol=tcp', '--host=127.0.0.1', "--port=$Port", '--user=root', '--batch', '--skip-column-names')
  if ($null -ne $Sql) { $args += "--execute=$Sql" }
  $result = Invoke-NativeProcess -FilePath $Client -ArgumentList $args -InputText $InputText -Environment @{ MYSQL_PWD = $Password } -TimeoutMs 20000
  if ($result.ExitCode -ne 0) { throw "Klien MariaDB gagal (exit $($result.ExitCode)): $($result.StdErr.Trim()) $($result.StdOut.Trim())" }
  return $result.StdOut.Trim()
}

try {
  if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess) {
    throw 'Smoke test ini hanya untuk PowerShell 64-bit pada Windows x64.'
  }
  $ArchivePath = [IO.Path]::GetFullPath($ArchivePath)
  if ([IO.Path]::GetFileName($ArchivePath) -ine 'mariadb-13.0.2-winx64.zip') { throw 'Pilih file mariadb-13.0.2-winx64.zip asli.' }
  if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { throw "Arsip tidak ditemukan: $ArchivePath" }
  $hash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $PinnedSha256) { throw "Checksum arsip tidak sesuai: $hash" }
  $installer = Join-Path $SourceRoot 'Install-SXL-MariaDB-Version.ps1'
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Installer source tidak ditemukan: $installer" }

  $testRoot = Join-Path ([IO.Path]::GetTempPath()) ('SXL-MariaDB-Smoke-' + [Guid]::NewGuid().ToString('N'))
  $versionRoot = Join-Path $testRoot 'runtime\mariadb\versions\mariadb-13.0.2-winx64'
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $versionRoot) -Force
  $port = $null
  for ($candidate = 43100; $candidate -le 43200; $candidate++) {
    $listener = $null
    try {
      $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
      $listener.Start(); $port = $candidate; break
    } catch { }
    finally { if ($listener) { $listener.Stop() } }
  }
  if (-not $port) { throw 'Tidak menemukan port kosong dalam rentang smoke test 43100-43200.' }

  & $installer -VersionRoot $versionRoot -ArchivePath $ArchivePath -Port $port -ExpectedSha256 $PinnedSha256
  if ($LASTEXITCODE -ne 0) { throw "Installer runtime gagal dengan exit $LASTEXITCODE." }
  $settingsPath = Join-Path $versionRoot 'settings.json'
  $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
  if ($settings.version -ne '13.0.2' -or $settings.versionVerified -ne $true) { throw 'Versi yang disimpan belum diverifikasi.' }
  if ($settings.passwordProtection -ne 'windows-dpapi-v1') { throw 'Kredensial tidak menggunakan DPAPI.' }
  $securePassword = ConvertTo-SecureString -String $settings.password
  $passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr) }

  $serverRoot = Join-Path $versionRoot 'server'
  $server = Join-Path $serverRoot 'bin\mariadbd.exe'
  $client = Join-Path $serverRoot 'bin\mariadb.exe'
  $admin = Join-Path $serverRoot 'bin\mariadb-admin.exe'
  $dump = Join-Path $serverRoot 'bin\mariadb-dump.exe'
  $ini = Join-Path $versionRoot 'config\my.ini'
  foreach ($required in @($server,$client,$admin,$dump,$ini)) { if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "File wajib smoke test hilang: $required" } }
  $versionResult = Invoke-NativeProcess -FilePath $server -ArgumentList @('--version') -TimeoutMs 5000
  if ($versionResult.ExitCode -ne 0 -or $versionResult.StdOut -notmatch '(?i)13\.0\.2') { throw "Versi binary tidak sesuai: $($versionResult.StdOut) $($versionResult.StdErr)" }

  $stdoutLog = Join-Path $testRoot 'server.stdout.log'
  $stderrLog = Join-Path $testRoot 'server.stderr.log'
  $serverArguments = @((ConvertTo-WindowsArgument "--defaults-file=$ini"), (ConvertTo-WindowsArgument '--console')) -join ' '
  $serverProcess = Start-Process -FilePath $server -ArgumentList $serverArguments -WorkingDirectory $serverRoot -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
  $deadline = (Get-Date).AddSeconds(60)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if ($serverProcess.HasExited) { throw "mariadbd berhenti saat startup ($($serverProcess.ExitCode)). $((Get-Content $stderrLog -Raw -ErrorAction SilentlyContinue))" }
    try {
      $result = Invoke-Sql -Sql 'SELECT VERSION()' -Client $client -Port $port -Password $password
      if ($result -match '^13\.0\.2') { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "Server tidak siap pada 127.0.0.1:$port. Periksa log $stderrLog dan $stdoutLog" }

  $null = Invoke-Sql -Sql "CREATE DATABASE sxl_smoke; CREATE TABLE sxl_smoke.t (id INT PRIMARY KEY, nama VARCHAR(40)); INSERT INTO sxl_smoke.t VALUES (1, 'SXL smoke');" -Client $client -Port $port -Password $password
  $dumpResult = Invoke-NativeProcess -FilePath $dump -ArgumentList @('--protocol=tcp','--host=127.0.0.1',"--port=$port",'--user=root','--databases','sxl_smoke') -Environment @{ MYSQL_PWD = $password } -TimeoutMs 30000
  if ($dumpResult.ExitCode -ne 0 -or $dumpResult.StdOut -notmatch 'CREATE TABLE') { throw "Ekspor SQL gagal: $($dumpResult.StdErr)" }
  [IO.File]::WriteAllText((Join-Path $testRoot 'backup.sql'), $dumpResult.StdOut)
  $null = Invoke-Sql -Sql 'DROP DATABASE sxl_smoke' -Client $client -Port $port -Password $password
  $restoreResult = Invoke-NativeProcess -FilePath $client -ArgumentList @('--protocol=tcp','--host=127.0.0.1',"--port=$port",'--user=root','--batch','--skip-column-names') -InputText $dumpResult.StdOut -Environment @{ MYSQL_PWD = $password } -TimeoutMs 30000
  if ($restoreResult.ExitCode -ne 0 -or $restoreResult.StdErr -match '(?i)\bERROR\s+\d+') {
    throw "Restore SQL gagal (exit $($restoreResult.ExitCode)): $($restoreResult.StdErr) $($restoreResult.StdOut)"
  }
  [IO.File]::WriteAllText((Join-Path $testRoot 'restore.stdout.log'), $restoreResult.StdOut)
  [IO.File]::WriteAllText((Join-Path $testRoot 'restore.stderr.log'), $restoreResult.StdErr)
  $count = Invoke-Sql -Sql 'SELECT COUNT(*) FROM sxl_smoke.t' -Client $client -Port $port -Password $password
  if ($count -ne '1') { throw "Restore gagal: jumlah baris diharapkan 1, didapat $count" }

  $rootAccount = Invoke-Sql -Sql 'SELECT CURRENT_USER()' -Client $client -Port $port -Password $password
  if ($rootAccount -notmatch '^root@([A-Za-z0-9._:%-]+)$') { throw "Akun root MariaDB lokal tidak dapat diverifikasi: $rootAccount" }
  $rootHost = $Matches[1]
  $rootChangeSql = "ALTER USER 'root'@'$rootHost' IDENTIFIED BY ''"
  $makeRootPasswordless = Invoke-NativeProcess -FilePath $client -ArgumentList @('--protocol=tcp','--host=127.0.0.1',"--port=$port",'--user=root','--batch',"--execute=$rootChangeSql") -Environment @{ MYSQL_PWD = $password } -TimeoutMs 15000
  if ($makeRootPasswordless.ExitCode -ne 0) { throw "Konfigurasi root tanpa password gagal untuk $rootAccount : $($makeRootPasswordless.StdErr) $($makeRootPasswordless.StdOut)" }
  $noPasswordQuery = Invoke-NativeProcess -FilePath $client -ArgumentList @('--protocol=tcp','--host=127.0.0.1',"--port=$port",'--user=root','--batch','--skip-column-names','--execute=SELECT VERSION()') -Environment @{ MYSQL_PWD = '' } -TimeoutMs 15000
  if ($noPasswordQuery.ExitCode -ne 0 -or $noPasswordQuery.StdOut -notmatch '(?i)^13\.0\.2') {
    $rootAccounts = Invoke-Sql -Sql "SELECT CONCAT(User,'@',Host,':',plugin,':',IF(authentication_string=PASSWORD(''), 'empty', IF(authentication_string=PASSWORD('$password'), 'old', 'other'))) FROM mysql.user WHERE User='root'" -Client $client -Port $port -Password $password
    throw "Akun root $rootAccount tidak dapat terhubung tanpa password: $($noPasswordQuery.StdErr) Accounts: $rootAccounts"
  }
  $shutdown = Invoke-NativeProcess -FilePath $admin -ArgumentList @('--protocol=tcp','--host=127.0.0.1',"--port=$port",'--user=root','shutdown') -Environment @{ MYSQL_PWD = '' } -TimeoutMs 15000
  if ($shutdown.ExitCode -ne 0) { throw "Shutdown normal gagal: $($shutdown.StdErr)" }
  if (-not $serverProcess.WaitForExit(15000)) { throw 'MariaDB tidak berhenti sesudah perintah shutdown normal.' }
  $serverProcess = $null
  $passed = $true
  Write-Host 'PASS: checksum, installer, ACL/DPAPI settings, versi binary, startup, koneksi SQL, dump, restore, dan shutdown normal.' -ForegroundColor Green
  Write-Host "Port uji: $port. Data uji akan dihapus saat cleanup: $testRoot"
} catch {
  Write-Host "GAGAL: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.ScriptStackTrace) { Write-Host $_.ScriptStackTrace }
  if ($testRoot) { Write-Warning "Artefak smoke test dipertahankan untuk diagnosis: $testRoot" }
  exit 1
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    try {
      if (Test-Path -LiteralPath $versionRoot) {
        $settingsPath = Join-Path $versionRoot 'settings.json'
        if (Test-Path -LiteralPath $settingsPath) {
          $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
          $securePassword = ConvertTo-SecureString -String $settings.password
          $passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
          try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr) }
          $admin = Join-Path $versionRoot 'server\bin\mariadb-admin.exe'
          $null = Invoke-NativeProcess -FilePath $admin -ArgumentList @('--protocol=tcp','--host=127.0.0.1',"--port=$port",'--user=root','shutdown') -Environment @{ MYSQL_PWD = $password } -TimeoutMs 5000
        }
      }
    } catch { }
    if (-not $serverProcess.WaitForExit(5000)) { try { $serverProcess.Kill() } catch {} }
  }
  if ($previousMysqlPwd -eq $null) { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue } else { $env:MYSQL_PWD = $previousMysqlPwd }
  if ($passed -and $testRoot -and (Test-Path -LiteralPath $testRoot)) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
