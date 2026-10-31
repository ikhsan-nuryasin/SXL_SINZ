'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'Install-SXL-MariaDB.ps1'), 'utf8');

test('legacy MariaDB installer pins archive size and SHA-256 before running any downloaded executable', () => {
  assert.match(script, /\$Version\s*=\s*'11\.4\.13'/);
  assert.match(script, /\$ExpectedArchiveBytes\s*=\s*\[long\]95024126/);
  assert.match(script, /\$ExpectedSha256\s*=\s*'d62986d433eeebfde218560b276103831604a61e929e87f1a17f5aebd80257e2'/i);
  assert.match(script, /Get-FileHash\s+-LiteralPath\s+\$(?:partialZip|Path)\s+-Algorithm\s+SHA256/);
  assert.match(script, /if \(\$Actual -ne \$ExpectedSha256\)/);
});

test('legacy MariaDB installer has bounded HTTPS mirror fallback and persistent sanitized diagnostics', () => {
  assert.match(script, /https:\/\/archive\.mariadb\.org\//);
  assert.match(script, /https:\/\/mirror\.math\.princeton\.edu\//);
  assert.match(script, /https:\/\/mirror\.ossplanet\.net\//);
  assert.match(script, /https:\/\/mirror\.dogado\.de\//);
  assert.match(script, /TimeoutSec 300/);
  assert.match(script, /mariadb-install\.log/);
  assert.match(script, /Protect-InstallText/);
  assert.match(script, /Sumber unduhan gagal/);
});

test('legacy MariaDB installer verifies server, installer, client, admin, and dump paths after extraction', () => {
  for (const name of ['mariadbd.exe','mysqld.exe','mariadb-install-db.exe','mysql_install_db.exe','mariadb.exe','mysql.exe','mariadb-admin.exe','mysqladmin.exe','mariadb-dump.exe','mysqldump.exe']) {
    assert.ok(script.includes(name), `expected installer source to recognize ${name}`);
  }
  assert.match(script, /Hasil staging runtime tidak lengkap/);
  assert.match(script, /Copy-RuntimeTree -SourceRoot \$SourceHome -DestinationRoot \$StagedServerRoot/);
  assert.match(script, /\[System\.IO\.Directory\]::Move\(\$StagedServerRoot, \$ServerRoot\)/);
  assert.match(script, /Push-Location -LiteralPath \$ServerRoot/);
});

test('database repair exposes persistent installer log and presents status as readable separate lines', () => {
  const databaseSource = fs.readFileSync(path.join(root, 'database.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const cssSource = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
  assert.match(databaseSource, /installerLogPath:\s*!is13 && fs\.existsSync/);
  assert.match(databaseSource, /Log diagnostik tersimpan di/);
  assert.match(appSource, /lines\.join\('\\n'\)/);
  assert.match(cssSource, /#dbVersionMessage\{[^}]*white-space:pre-line/);
});


test('legacy MariaDB installer reuses only a verified cache and keeps the archive outside temporary staging', () => {
  assert.match(script, /\$CacheDir\s*=\s*Join-Path \$RuntimeRoot 'packages'/);
  assert.match(script, /if \(Test-VerifiedArchive \$ZipPath\)/);
  assert.match(script, /function Test-VerifiedArchive/);
  assert.match(script, /curl\.exe/);
  assert.match(script, /'--proto-redir' '\=https'/);
});

test('database status exposes the most recent persisted MariaDB installer failure', () => {
  const databaseSource = fs.readFileSync(path.join(root, 'database.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(databaseSource, /function readInstallerFailure\(/);
  assert.match(databaseSource, /installerFailureReason/);
  assert.match(appSource, /Kegagalan pemasangan terakhir/);
});


test('standalone repair asks before quarantining old data and invokes the verified installer', () => {
  const repair = fs.readFileSync(path.join(root, 'Repair-SXL-MariaDB-Standalone.ps1'), 'utf8');
  const launcher = fs.readFileSync(path.join(root, 'Repair-SXL-MariaDB.bat'), 'utf8');
  assert.match(repair, /Join-Path \$env:APPDATA 'SXL Localhost\\runtime\\mariadb'/);
  assert.match(repair, /Read-Host 'Ketik PINDAHKAN untuk melanjutkan'/);
  assert.match(repair, /Move-ItemPreservingType/);
  assert.match(repair, /Install-SXL-MariaDB\.ps1/);
  assert.match(repair, /Test-PortFree/);
  assert.match(repair, /Log instalasi:/);
  assert.doesNotMatch(repair, /Remove-Item[^\r\n]*Join-Path \$RuntimeRoot '(?:data|server)'/);
  assert.match(launcher, /Repair-SXL-MariaDB-Standalone\.ps1/);
});

test('MariaDB 13.0.2 installer performs an authenticated startup and SELECT VERSION smoke test before commit', () => {
  const installer = fs.readFileSync(path.join(root, 'Install-SXL-MariaDB-Version.ps1'), 'utf8');
  assert.match(installer, /Start-Process\s+-FilePath\s+\$ServerBinary/);
  assert.match(installer, /--protocol=tcp/);
  assert.match(installer, /SELECT VERSION\(\)/);
  assert.match(installer, /Startup test lulus/);
  const initializerStart = installer.indexOf('$initProcess = Start-Process -FilePath $SourceInstaller');
  assert.ok(initializerStart >= 0, 'initializer must run as a separate process with redirected output');
  assert.ok(installer.indexOf('Set-PrivateTreeAcl $Payload') < initializerStart, 'staged files must receive explicit ACLs before database initialization');
  assert.match(installer, /-RedirectStandardOutput \$InstallStdout -RedirectStandardError \$InstallStderr/);
  const smokeStart = installer.indexOf("$SmokeLog = Join-Path $LogsDir");
  assert.ok(installer.lastIndexOf('Set-PrivateTreeAcl $Payload', smokeStart) > initializerStart, 'staged files must receive explicit ACLs before startup smoke test');
  assert.ok(installer.indexOf('SELECT VERSION()') < installer.indexOf('[System.IO.Directory]::Move($Payload, $VersionRoot)'), 'runtime must pass SQL smoke test before commit');
});

test('MariaDB runtime ACL uses icacls DACL-only permissions without SeSecurityPrivilege-dependent Set-Acl', () => {
  const installer = fs.readFileSync(path.join(root, 'Install-SXL-MariaDB-Version.ps1'), 'utf8');
  const legacyInstaller = fs.readFileSync(path.join(root, 'Install-SXL-MariaDB.ps1'), 'utf8');
  const secureSettings = fs.readFileSync(path.join(root, 'lib', 'secure-settings.js'), 'utf8');
  assert.match(installer, /icacls\s*=\s*Join-Path \$env:WINDIR 'System32\\icacls\.exe'/);
  assert.match(installer, /\/inheritance:r/);
  assert.match(installer, /\/grant:r/);
  assert.match(installer, /\/reset \/T \/Q/);
  assert.doesNotMatch(installer, /'\*\/T'|'\s\/T'\s*,\s*'\/Q'/);
  assert.match(secureSettings, /icacls\.exe/);
  assert.match(secureSettings, /\/inheritance:r/);
  assert.match(secureSettings, /\/grant:r/);
  assert.match(secureSettings, /\/reset \/T \/Q/);
  assert.doesNotMatch(secureSettings, /'\*\/T'|'\s\/T'\s*,\s*'\/Q'/);
  assert.match(legacyInstaller, /\/reset'\s+'\/T'\s+'\/Q'/);
  assert.match(legacyInstaller, /\/inheritance:r'\s+'\/grant:r'\s+@rules 2>&1/);
  assert.doesNotMatch(legacyInstaller, /@rules '\/T'/);
  assert.doesNotMatch(installer, /\bSet-Acl\b/);
  const treeAcl = secureSettings.slice(secureSettings.indexOf('function applyWindowsTreeAcl'), secureSettings.indexOf('function writeSettingsAtomic'));
  assert.doesNotMatch(treeAcl, /\bSet-Acl\b/);
  assert.match(treeAcl, /ReparsePoint/);
});

test('Electron first-run bootstrap runs before the main server/UI and preserves diagnostic failures', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const bootstrapIndex = main.indexOf('prepareDatabaseForLaunch');
  const serverIndex = main.indexOf("require(path.join(appRoot, 'server.js'))");
  assert.ok(bootstrapIndex >= 0 && bootstrapIndex < serverIndex);
  assert.match(main, /SXL_RUNTIME_PACKAGES_DIR/);
  assert.match(main, /recordBootstrapFailure/);
});

test('MariaDB runtime launches from the executable directory to resolve its adjacent server DLL', () => {
  const databaseSource = fs.readFileSync(path.join(root, 'database.js'), 'utf8');
  assert.match(databaseSource, /cwd:\s*path\.dirname\(p\.server\)/);
});
