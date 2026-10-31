'use strict';

// Windows passwords are protected with current-user DPAPI before persistence.
// DPAPI prevents other Windows user accounts from reading the secret at rest;
// it does not protect against malware or administrators running as this user.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const WINDOWS_DPAPI = 'windows-dpapi-v1';
const NO_PASSWORD = 'no-password-v1';
const POWERSHELL_PROTECT = String.raw`
$ErrorActionPreference = 'Stop'
$plain = [Console]::In.ReadToEnd()
$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force
[Console]::Out.Write((ConvertFrom-SecureString -SecureString $secure))
`;
const POWERSHELL_UNPROTECT = String.raw`
$ErrorActionPreference = 'Stop'
$encrypted = [Console]::In.ReadToEnd().Trim()
$secure = ConvertTo-SecureString -String $encrypted
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
`;

function runPowerShell(script, input, options = {}) {
  const executable = process.env.SXL_POWERSHELL_PATH || 'powershell.exe';
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    input: String(input), encoding: 'utf8', windowsHide: true, timeout: 7000, maxBuffer: 1024 * 1024,
    ...options
  });
  if (result.error) throw new Error(`DPAPI Windows tidak tersedia: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Operasi DPAPI gagal (exit ${result.status}): ${(result.stderr || '').trim().slice(-500)}`);
  return String(result.stdout || '').replace(/[\r\n]+$/, '');
}

function protectWindowsPassword(password, platform = process.platform) {
  if (typeof password !== 'string') throw new TypeError('Password database harus berupa teks.');
  if (platform !== 'win32') return password;
  if (!password.length) throw new Error('Password database kosong tidak dapat disimpan sebagai kredensial baru.');
  const encrypted = runPowerShell(POWERSHELL_PROTECT, password);
  if (!encrypted || encrypted === password) throw new Error('DPAPI tidak menghasilkan kredensial terenkripsi yang valid.');
  return encrypted;
}

function unprotectWindowsPassword(value, platform = process.platform) {
  if (typeof value !== 'string' || !value.length) throw new Error('Kredensial database terenkripsi kosong.');
  if (platform !== 'win32') throw new Error('Kredensial DPAPI hanya dapat dibaca oleh akun Windows yang membuatnya.');
  return runPowerShell(POWERSHELL_UNPROTECT, value);
}

function prepareSettingsForStorage(settings, options = {}) {
  const platform = options.platform || process.platform;
  const protect = options.protect || protectWindowsPassword;
  const result = { ...settings };
  delete result._credentialProtection;
  delete result._credentialWarning;
  if (result.password === '') {
    result.passwordProtection = NO_PASSWORD;
  } else if (typeof result.password === 'string' && platform === 'win32') {
    result.password = protect(result.password, platform);
    result.passwordProtection = WINDOWS_DPAPI;
  } else {
    delete result.passwordProtection;
  }
  return result;
}

function decodeSettings(raw, options = {}) {
  const platform = options.platform || process.platform;
  const unprotect = options.unprotect || unprotectWindowsPassword;
  const result = { ...raw };
  if (result.passwordProtection === NO_PASSWORD) {
    if (result.password !== '') throw new Error('Konfigurasi no-password harus menyimpan password kosong.');
    result._credentialProtection = NO_PASSWORD;
  } else if (result.passwordProtection === WINDOWS_DPAPI) {
    result.password = unprotect(result.password, platform);
    result._credentialProtection = WINDOWS_DPAPI;
  } else if (platform === 'win32' && typeof result.password === 'string') {
    // Legacy configs are migrated by the database manager on the next read.
    result._credentialProtection = 'legacy-plaintext';
  } else {
    result._credentialProtection = 'file-permissions';
  }
  return result;
}

function applyWindowsFileAcl(filename) {
  if (process.platform !== 'win32') return;
  const identity = runPowerShell(String.raw`[Console]::Out.Write([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)`, '');
  if (!/^S-\d-\d+(?:-\d+)+$/.test(identity)) throw new Error('SID akun Windows tidak dapat diverifikasi untuk ACL kredensial.');
  const icacls = process.env.SXL_ICACLS_PATH || 'icacls.exe';
  const result = spawnSync(icacls, [filename, '/inheritance:r', '/grant:r', `*${identity}:(R,W)`, '*S-1-5-18:(R,W)', '*S-1-5-32-544:(R,W)'], {
    encoding: 'utf8', windowsHide: true, timeout: 7000, maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new Error(`ACL kredensial Windows gagal diterapkan: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
}


function applyWindowsTreeAcl(directory) {
  if (process.platform !== 'win32') return;
  const root = path.resolve(directory);
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$root = [Console]::In.ReadToEnd().Trim()
if (-not [IO.Path]::IsPathRooted($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { throw 'Direktori ACL tidak valid.' }
$items = @((Get-Item -LiteralPath $root -Force)) + @(Get-ChildItem -LiteralPath $root -Force -Recurse -ErrorAction Stop)
foreach ($item in $items) {
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse point tidak diizinkan dalam runtime tree: $($item.FullName)" }
}
# Use icacls to edit only the DACL; do not apply the full descriptor/SACL,
# which can require SeSecurityPrivilege unavailable to ordinary portable users.
# No ownership or audit/SACL changes are requested here.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($sid -notmatch '^S-\d-\d+(?:-\d+)+$') { throw 'SID akun Windows tidak dapat diverifikasi untuk ACL runtime.' }
$icacls = Join-Path $env:WINDIR 'System32\icacls.exe'
if (-not (Test-Path -LiteralPath $icacls -PathType Leaf)) { $icacls = 'icacls.exe' }
$resetOutput = & $icacls $root /reset /T /Q 2>&1
$resetExit = $LASTEXITCODE
if ($resetExit -ne 0) { throw "icacls gagal membersihkan DACL runtime (exit $resetExit): $(($resetOutput | Out-String).Trim())" }
$aclArgs = @($root, '/inheritance:r', '/grant:r', ('*{0}:(OI)(CI)(F)' -f $sid), '*S-1-5-18:(OI)(CI)(F)', '*S-1-5-32-544:(OI)(CI)(F)', '/Q')
$aclOutput = & $icacls @aclArgs 2>&1
$aclExit = $LASTEXITCODE
if ($aclExit -ne 0) { throw "icacls gagal menerapkan ACL runtime (exit $aclExit): $(($aclOutput | Out-String).Trim())" }
[Console]::Out.Write('ACL runtime berhasil diterapkan menggunakan icacls (DACL saja).')
`;
  const result = spawnSync(process.env.SXL_POWERSHELL_PATH || 'powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
  ], { input: root, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`ACL direktori Windows gagal diterapkan: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  }
}

function writeSettingsAtomic(filename, settings, options = {}) {
  const platform = options.platform || process.platform;
  const prepared = prepareSettingsForStorage(settings, {
    platform,
    protect: options.protect
  });
  const dir = path.dirname(filename);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${filename}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(prepared, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { fs.chmodSync(temp, 0o600); } catch {}
    if (platform === 'win32' && options.applyAcl !== false) applyWindowsFileAcl(temp);
    fs.renameSync(temp, filename);
    try { fs.chmodSync(filename, 0o600); } catch {}
    return prepared;
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch {}
  }
}

module.exports = {
  WINDOWS_DPAPI,
  NO_PASSWORD,
  protectWindowsPassword,
  unprotectWindowsPassword,
  prepareSettingsForStorage,
  decodeSettings,
  writeSettingsAtomic,
  applyWindowsFileAcl,
  applyWindowsTreeAcl
};
