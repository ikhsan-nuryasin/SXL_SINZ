'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('portable launcher sets per-user runtime paths and requests MariaDB bootstrap before starting the panel', () => {
  const launcher = fs.readFileSync(path.join(root, 'Start-SXL-Website-Sharing.ps1'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(launcher, /SXL_DATA_DIR\s*=\s*Join-Path\s+\$env:APPDATA\s+'SXL Localhost'/);
  assert.match(launcher, /SXL_RUNTIME_PACKAGES_DIR\s*=\s*Join-Path\s+\$ProjectRoot\s+'runtime\\packages'/);
  assert.match(launcher, /SXL_AUTO_BOOTSTRAP_MARIADB\s*=\s*'1'/);
  assert.match(server, /if\s*\(process\.env\.SXL_AUTO_BOOTSTRAP_MARIADB\s*!==\s*'1'\)/);
  assert.match(server, /await\s+bootstrapMariaDBForPortableLaunch\(\);\s*await\s+startServer\(\);/);
});

test('portable launcher does not require Cloudflare download to open the local panel', () => {
  const launcher = fs.readFileSync(path.join(root, 'Start-SXL-Website-Sharing.ps1'), 'utf8');
  assert.match(launcher, /Do not download cloudflared during normal local startup/i);
  assert.doesNotMatch(launcher, /\$CloudflaredExe\s*=\s*Get-CloudflaredExecutable\s*\n\s*\$env:CLOUDFLARED_PATH\s*=\s*\$CloudflaredExe/);
});

test('MariaDB 13.0.2 initializer runs from verified source staging outside the protected AppData payload', () => {
  const installer = fs.readFileSync(path.join(root, 'Install-SXL-MariaDB-Version.ps1'), 'utf8');
  assert.match(installer, /\$BootstrapStage\s*=\s*\$null/);
  assert.match(installer, /\$bootstrapBases\s*=\s*@\(\$PSScriptRoot,\s*\$env:TEMP\)/);
  assert.match(installer, /Unblock-File\s+-LiteralPath\s+\$_\.FullName/);
  assert.match(installer, /\$SourceInstaller\s*=\s*Join-Path\s+\$SourceBin\s+'mariadb-install-db\.exe'/);
  assert.match(installer, /Push-Location\s+-LiteralPath\s+\$SourceHome/);
  assert.match(installer, /\$initProcess\s*=\s*Start-Process\s+-FilePath\s+\$SourceInstaller/);
  assert.match(installer, /-RedirectStandardOutput\s+\$InstallStdout\s+-RedirectStandardError\s+\$InstallStderr/);
  assert.match(installer, /Windows menolak menjalankan initializer MariaDB/);
  assert.match(installer, /Protection history|AppLocker\/WDAC/);
  assert.match(installer, /Remove-Item\s+-LiteralPath\s+\$BootstrapStage/);
});
