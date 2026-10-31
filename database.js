'use strict';

// Portable MariaDB manager for SXL. The database listens on loopback only;
// it is never exposed by the static-site tunnel.
const fs = require('node:fs');
const path = require('node:path');
const { isTcpPortAvailable } = require('./lib/port-utils');
const { updateDatabaseIniPort } = require('./lib/ini-port');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const os = require('node:os');
const runtimePaths = require('./lib/runtime-paths');
const { decodeSettings, writeSettingsAtomic, WINDOWS_DPAPI } = require('./lib/secure-settings');
const { quarantineDirectory, restoreQuarantinedDirectory } = require('./lib/runtime-recovery');
const {
  createDatabaseVersionManager, LEGACY_VERSION_ID, MARIADB_13_VERSION_ID,
  MARIADB_13_VERSION, MARIADB_13_SHA256
} = require('./lib/database-version-manager');
const { MAX_SQL_BATCH_STATEMENTS, createMarkedSql, parseMarkedSqlOutput } = require('./lib/sql-batch');

const APP_ROOT = process.env.SXL_APP_ROOT || __dirname;
const DATA_ROOT = process.env.SXL_DATA_DIR || APP_ROOT;
const versionManager = createDatabaseVersionManager(DATA_ROOT);
const DB_ROOT = versionManager.root;
const SCRIPT_PATH = process.env.SXL_INSTALL_SCRIPT_PATH || path.join(APP_ROOT, 'Install-SXL-MariaDB.ps1');
const VERSION_INSTALL_SCRIPT_PATH = process.env.SXL_INSTALL_VERSION_SCRIPT_PATH || path.join(APP_ROOT, 'Install-SXL-MariaDB-Version.ps1');
const DEFAULT_PORT = Number(process.env.SXL_MARIADB_PORT || 3307);
const VERSION_13_DEFAULT_PORT = 3308;
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const QUERY_TIMEOUT_MS = 30 * 1000;
const MAX_QUERY_OUTPUT = 8 * 1024 * 1024;

const MARIADB_13_ARCHIVE_FILENAME = 'mariadb-13.0.2-winx64.zip';

function isPathWithinDirectory(parentPath, candidatePath) {
  if (typeof parentPath !== 'string' || typeof candidatePath !== 'string' || !parentPath.trim() || !candidatePath.trim()) return false;
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function getBundledMariaDBArchivePath() {
  const candidates = [
    process.env.SXL_RUNTIME_PACKAGES_DIR ? path.join(process.env.SXL_RUNTIME_PACKAGES_DIR, MARIADB_13_ARCHIVE_FILENAME) : '',
    path.join(APP_ROOT, 'runtime', 'packages', MARIADB_13_ARCHIVE_FILENAME),
    path.join(DATA_ROOT, 'runtime', 'packages', MARIADB_13_ARCHIVE_FILENAME)
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isFile() && !stat.isSymbolicLink()) return path.resolve(candidate);
    } catch {}
  }
  return '';
}

const runtimeState = { process: null, versionId: null, log: '', lastError: null, stopping: false };
const settingsCache = new Map();
const settingsErrors = new Map();
const detectedVersionCache = new Map();

const PHRASES = [
  ['JIKA BELUM ADA', 'IF NOT EXISTS'],
  ['JIKA TIDAK ADA', 'IF NOT EXISTS'],
  ['BUAT BASIS DATA', 'CREATE DATABASE'],
  ['TAMPILKAN BASIS DATA', 'SHOW DATABASES'],
  ['BUAT DATABASE', 'CREATE DATABASE'],
  ['HAPUS DATABASE', 'DROP DATABASE'],
  ['TAMPILKAN DATABASE', 'SHOW DATABASES'],
  ['LIHAT DATABASE', 'SHOW DATABASES'],
  ['BUAT TABEL', 'CREATE TABLE'],
  ['UBAH TABEL', 'ALTER TABLE'],
  ['HAPUS TABEL', 'DROP TABLE'],
  ['TAMPILKAN TABEL', 'SHOW TABLES'],
  ['LIHAT TABEL', 'SHOW TABLES'],
  ['HAPUS DARI', 'DELETE FROM'],
  ['TAMBAHKAN KE', 'INSERT INTO'],
  ['URUTKAN BERDASARKAN', 'ORDER BY'],
  ['GRUPKAN BERDASARKAN', 'GROUP BY'],
  ['KELOMPOKKAN BERDASARKAN', 'GROUP BY'],
  ['TIDAK KOSONG', 'IS NOT NULL'],
  ['MULAI TRANSAKSI', 'START TRANSACTION'],
  ['SIMPAN PERUBAHAN', 'COMMIT'],
  ['BATALKAN TRANSAKSI', 'ROLLBACK'],
  ['BUAT INDEKS', 'CREATE INDEX'],
  ['DESKRIPSIKAN', 'DESCRIBE']
].map(([from, to]) => ({ words: from.split(' '), to })).sort((a, b) => b.words.length - a.words.length);

const WORDS = {
  BUAT: 'CREATE', HAPUS: 'DELETE FROM', GUNAKAN: 'USE', TAMPILKAN: 'SHOW', LIHAT: 'SHOW',
  PILIH: 'SELECT', DARI: 'FROM', DIMANA: 'WHERE', JIKA: 'IF', ADA: 'EXISTS', BELUM: 'NOT', TIDAK: 'NOT',
  URUTKAN: 'ORDER BY', GRUPKAN: 'GROUP BY', KELOMPOKKAN: 'GROUP BY',
  TAMBAHKAN: 'INSERT INTO', ISI: 'VALUES', PERBARUI: 'UPDATE', UBAH: 'UPDATE',
  ATUR: 'SET', BATASI: 'LIMIT', GABUNGKAN: 'JOIN', IKUTKAN: 'JOIN',
  KIRI: 'LEFT', KANAN: 'RIGHT', DALAM: 'INNER', LUAR: 'OUTER',
  DAN: 'AND', ATAU: 'OR', BUKAN: 'NOT', BENAR: 'TRUE', SALAH: 'FALSE',
  KOSONG: 'NULL', BERBEDA: 'DISTINCT', SEBAGAI: 'AS', HITUNG: 'COUNT',
  DESKRIPSI: 'DESCRIBE', MULAI: 'START', TRANSAKSI: 'TRANSACTION',
  SIMPAN: 'COMMIT', GULUNGKAN: 'ROLLBACK', PADA: 'ON'
};

function lexSql(sql) {
  const tokens = [];
  let i = 0;
  while (i < sql.length) {
    const start = i;
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i++;
      while (i < sql.length && /\s/.test(sql[i])) i++;
      tokens.push({ type: 'space', value: sql.slice(start, i) });
      continue;
    }
    if ((ch === '-' && sql[i + 1] === '-' && (i + 2 >= sql.length || /\s/.test(sql[i + 2]))) || ch === '#') {
      i += ch === '#' ? 1 : 2;
      while (i < sql.length && sql[i] !== '\n') i++;
      tokens.push({ type: 'protected', value: sql.slice(start, i) });
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      if (i < sql.length) i += 2;
      tokens.push({ type: 'protected', value: sql.slice(start, i) });
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === '\\' && quote !== '`' && i + 1 < sql.length) { i += 2; continue; }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      tokens.push({ type: 'protected', value: sql.slice(start, i) });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      i++;
      while (i < sql.length && /[A-Za-z0-9_$]/.test(sql[i])) i++;
      tokens.push({ type: 'word', value: sql.slice(start, i) });
      continue;
    }
    i++;
    tokens.push({ type: 'other', value: ch });
  }
  return tokens;
}

function translateIndonesianSql(sql) {
  if (typeof sql !== 'string') throw new TypeError('SQL harus berupa teks.');
  const tokens = lexSql(sql);
  const output = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type !== 'word') { output.push(token.value); i++; continue; }

    let matched = false;
    for (const phrase of PHRASES) {
      let cursor = i;
      const consumed = [];
      let valid = true;
      for (let wi = 0; wi < phrase.words.length; wi++) {
        if (wi > 0) {
          if (tokens[cursor]?.type !== 'space') { valid = false; break; }
          consumed.push(cursor++);
          if (tokens[cursor]?.type !== 'word') { valid = false; break; }
        }
        if (tokens[cursor]?.type !== 'word' || tokens[cursor].value.toUpperCase() !== phrase.words[wi]) {
          valid = false; break;
        }
        consumed.push(cursor++);
      }
      if (valid) {
        output.push(phrase.to);
        i = cursor;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const upper = token.value.toUpperCase();
    output.push(Object.prototype.hasOwnProperty.call(WORDS, upper) ? WORDS[upper] : token.value);
    i++;
  }
  return output.join('');
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1];
    if (lineComment) {
      current += ch;
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      current += ch;
      if (ch === '*' && next === '/') { current += next; i++; blockComment = false; }
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === '\\' && quote !== '`' && i + 1 < sql.length) { current += sql[++i]; continue; }
      if (ch === quote) {
        if (next === quote) { current += next; i++; continue; }
        quote = null;
      }
      continue;
    }
    if ((ch === '-' && next === '-' && (i + 2 >= sql.length || /\s/.test(sql[i + 2]))) || ch === '#') {
      lineComment = true; current += ch;
      if (ch === '-' && next === '-') current += sql[++i];
      continue;
    }
    if (ch === '/' && next === '*') { blockComment = true; current += ch + next; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; current += ch; continue; }
    if (ch === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter(statement => lexSql(statement).some(token => {
    if (token.type === 'space') return false;
    if (token.type === 'protected' && /^\s*(?:--|#|\/\*)/.test(token.value)) return false;
    return true;
  }));
}

function activeVersionId() {
  const selected = versionManager.getSelectedVersionId();
  // A Windows-only runtime must never be offered as active on macOS or non-x64 Windows.
  if (selected === MARIADB_13_VERSION_ID && (process.platform !== 'win32' || process.arch !== 'x64')) return LEGACY_VERSION_ID;
  return selected;
}

function getSettings(versionId = activeVersionId()) {
  const settingsPath = versionManager.getLayout(versionId).settings;
  try {
    const stat = fs.statSync(settingsPath);
    if (!stat.isFile()) return null;
    const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino || ''}`;
    const cached = settingsCache.get(settingsPath);
    if (cached && cached.stamp === stamp) return cached.value ? { ...cached.value } : null;

    let settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!settings || !Object.prototype.hasOwnProperty.call(settings, 'password') || !Number.isInteger(Number(settings.port)) || Number(settings.port) < 1024 || Number(settings.port) > 65535) {
      settingsCache.set(settingsPath, { stamp, value: null });
      return null;
    }
    settings = decodeSettings(settings);
    settingsErrors.delete(settingsPath);

    // Migrate previously installed Windows instances from plaintext at rest to user-scoped DPAPI.
    // A migration failure never overwrites the original file; keep the instance usable and surface a warning.
    if (process.platform === 'win32' && settings._credentialProtection === 'legacy-plaintext') {
      try {
        writeSettingsAtomic(settingsPath, settings);
        settings = { ...settings, _credentialProtection: WINDOWS_DPAPI };
        try {
          require('./lib/secure-settings').applyWindowsTreeAcl(versionManager.getLayout(versionId).root);
        } catch (aclError) {
          settings._credentialWarning = `Password sudah diproteksi DPAPI, tetapi ACL seluruh folder database belum berhasil diterapkan: ${aclError.message}`;
        }
      } catch (error) {
        settings._credentialWarning = `Kredensial lama belum berhasil diproteksi DPAPI: ${error.message}`;
      }
    }
    const freshStat = fs.statSync(settingsPath);
    const freshStamp = `${freshStat.size}:${freshStat.mtimeMs}:${freshStat.ctimeMs}:${freshStat.ino || ''}`;
    settingsCache.set(settingsPath, { stamp: freshStamp, value: settings });
    return { ...settings };
  } catch (error) {
    // Corrupt or foreign-user DPAPI settings remain untouched for recovery; never reset the database.
    if (fs.existsSync(settingsPath)) settingsErrors.set(settingsPath, `Konfigurasi database tidak dapat dibaca; file tidak diubah. ${error.message}`);
    return null;
  }
}

function detectVersionFromBinary(versionId) {
  const binary = findServerExe(versionId);
  if (!binary) return null;
  try {
    const stat = fs.statSync(binary);
    const stamp = `${binary}:${stat.size}:${stat.mtimeMs}`;
    if (detectedVersionCache.has(stamp)) return detectedVersionCache.get(stamp);
    const result = spawnSync(binary, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 2500, maxBuffer: 256 * 1024 });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const match = result.status === 0 && output.match(/(?:Distrib\s+|Ver\s+)?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)/i);
    const version = match ? match[1] : null;
    detectedVersionCache.set(stamp, version);
    return version;
  } catch { return null; }
}

function findOnPath(command) {
  const pathValue = process.env.PATH || '';
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command.endsWith(ext) ? command : `${command}${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}
function macCandidate(name) {
  const candidates = [
    `/opt/homebrew/opt/mariadb/bin/${name}`, `/usr/local/opt/mariadb/bin/${name}`,
    `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`
  ];
  return candidates.find(p => fs.existsSync(p)) || findOnPath(name);
}
function existingFile(candidate) {
  try { return fs.statSync(candidate).isFile() ? candidate : null; } catch { return null; }
}
function findServerExe(versionId = activeVersionId()) {
  const layout = versionManager.getLayout(versionId);
  const managed = [
    path.join(layout.serverRoot, 'bin', 'mariadbd.exe'),
    path.join(layout.serverRoot, 'bin', 'mysqld.exe'),
    path.join(layout.serverRoot, 'bin', 'mariadbd'),
    path.join(layout.serverRoot, 'bin', 'mysqld')
  ];
  const managedFound = managed.map(existingFile).find(Boolean);
  if (managedFound) return managedFound;
  if (versionId === LEGACY_VERSION_ID) {
    const manualStatus = runtimePaths.runtimePathStatus();
    const configuredBin = manualStatus.status.mariaDbBinDir.exists ? manualStatus.paths.mariaDbBinDir : '';
    const manual = configuredBin ? ['mariadbd.exe', 'mysqld.exe', 'mariadbd', 'mysqld'].map(name => path.join(configuredBin, name)) : [];
    const manualFound = manual.map(existingFile).find(Boolean);
    if (manualFound) return manualFound;
    if (process.platform === 'darwin') return macCandidate('mariadbd') || macCandidate('mysqld') || null;
  }
  return null;
}
function findClientExe(name, versionId = activeVersionId()) {
  const winNames = name === 'admin' ? ['mariadb-admin.exe', 'mysqladmin.exe'] : name === 'installer' ? ['mariadb-install-db.exe', 'mysql_install_db.exe'] : name === 'dump' ? ['mariadb-dump.exe', 'mysqldump.exe'] : ['mariadb.exe', 'mysql.exe'];
  const macNames = name === 'admin' ? ['mariadb-admin', 'mysqladmin'] : name === 'installer' ? ['mariadb-install-db', 'mysql_install_db'] : name === 'dump' ? ['mariadb-dump', 'mysqldump'] : ['mariadb', 'mysql'];
  const layout = versionManager.getLayout(versionId);
  const preferredNames = process.platform === 'win32' ? winNames : macNames;
  for (const exe of [...preferredNames, ...winNames]) {
    const candidate = existingFile(path.join(layout.serverRoot, 'bin', exe));
    if (candidate) return candidate;
  }
  if (versionId === LEGACY_VERSION_ID) {
    const manualStatus = runtimePaths.runtimePathStatus();
    const configuredBin = manualStatus.status.mariaDbBinDir.exists ? manualStatus.paths.mariaDbBinDir : '';
    if (configuredBin) {
      for (const exe of [...preferredNames, ...winNames]) {
        const candidate = existingFile(path.join(configuredBin, exe));
        if (candidate) return candidate;
      }
    }
    if (process.platform === 'darwin') {
      for (const nameCandidate of macNames) {
        const candidate = macCandidate(nameCandidate);
        if (candidate) return candidate;
      }
    }
  }
  return null;
}
function getPaths(versionId = activeVersionId()) {
  const layout = versionManager.getLayout(versionId);
  return {
    versionId,
    root: layout.root,
    serverRoot: layout.serverRoot,
    server: findServerExe(versionId),
    client: findClientExe('client', versionId),
    admin: findClientExe('admin', versionId),
    installer: findClientExe('installer', versionId),
    dump: findClientExe('dump', versionId),
    data: layout.data,
    backups: layout.backups,
    settings: layout.settings,
    ini: layout.ini,
    tmp: layout.tmp,
    log: layout.log,
    socket: path.join(os.tmpdir(), `sxl-mariadb-${versionId}-${typeof process.getuid === 'function' ? process.getuid() : 'user'}.sock`),
    pid: layout.pid
  };
}

function readLog(versionId = activeVersionId()) {
  try { return fs.readFileSync(getPaths(versionId).log, 'utf8').slice(-8000); }
  catch { return runtimeState.versionId === versionId ? runtimeState.log.slice(-8000) : ''; }
}

function readInstallerFailure() {
  const filename = path.join(DB_ROOT, 'logs', 'mariadb-install.log');
  try {
    const contents = fs.readFileSync(filename, 'utf8').slice(-24000);
    const relevant = contents.split(/\r?\n/).filter(line => /\]\s+(?:ERROR:|SUKSES:)/i.test(line));
    const latest = relevant[relevant.length - 1] || '';
    const match = latest.match(/\]\s+ERROR:\s*(.*)$/i);
    if (!match) return null;
    return match[1].replace(/\s+/g, ' ').trim().slice(0, 700) || null;
  } catch { return null; }
}

function isVersionInitialized(versionId) {
  const p = getPaths(versionId);
  return Boolean(getSettings(versionId) && fs.existsSync(path.join(p.data, 'mysql')));
}

function describeVersion(versionId) {
  const layout = versionManager.getLayout(versionId);
  const p = getPaths(versionId);
  const cfg = getSettings(versionId);
  const is13 = versionId === MARIADB_13_VERSION_ID;
  const supportsPlatform = !is13 || (process.platform === 'win32' && process.arch === 'x64');
  const executableChecks = [
    ['server', 'mariadbd.exe / mysqld.exe', p.server],
    ['client', 'mariadb.exe / mysql.exe', p.client],
    ['installer', 'mariadb-install-db.exe / mysql_install_db.exe', p.installer],
    ['admin', 'mariadb-admin.exe / mysqladmin.exe', p.admin],
    ['dump', 'mariadb-dump.exe / mysqldump.exe', p.dump]
  ];
  const missingExecutables = executableChecks.filter(([, , found]) => !found).map(([role, label]) => ({ role, label }));
  const installed = missingExecutables.length === 0;
  const initialized = isVersionInitialized(versionId);
  const configuredVersion = cfg?.versionVerified !== false && typeof cfg?.version === 'string' && cfg.version.trim() && !/^(?:manual runtime|homebrew mariadb|versi belum terverifikasi)$/i.test(cfg.version.trim())
    ? cfg.version.trim() : null;
  const detectedVersion = configuredVersion ? null : detectVersionFromBinary(versionId);
  const version = configuredVersion || detectedVersion || 'Versi belum terverifikasi';
  // The legacy runtime's root also contains the version manager and MariaDB 13.
  // Those shared files alone must not make the legacy instance look partially installed.
  const rootExists = is13
    ? fs.existsSync(layout.root)
    : [layout.serverRoot, layout.data, layout.settings, layout.log, layout.tmp, layout.backups]
        .some(candidate => fs.existsSync(candidate));
  const healthy = installed && initialized;
  const versionVerified = Boolean(configuredVersion || detectedVersion);
  const healthState = healthy ? (versionVerified ? 'ready' : 'unverified') : rootExists ? 'partial' : 'not-installed';
  const issueReason = healthState === 'partial'
    ? (!installed ? `Executable runtime belum lengkap. Komponen tidak ditemukan: ${missingExecutables.map(item => item.label).join(', ')}.` : !initialized ? 'Folder data atau konfigurasi belum selesai diinisialisasi.' : 'Instalasi perlu diperiksa.')
    : healthState === 'unverified' ? 'Runtime terpasang tetapi versi binary belum dapat diverifikasi.' : null;
  const installerFailureReason = !is13 && healthState === 'partial' ? readInstallerFailure() : null;
  return {
    id: versionId,
    label: is13 ? `MariaDB ${MARIADB_13_VERSION} · Windows x64` : `MariaDB ${version} · runtime kompatibel`,
    version,
    versionVerified,
    healthState,
    issueReason,
    installerFailureReason,
    missingExecutables,
    installed,
    initialized,
    repairable: rootExists && !healthy,
    rootExists,
    credentialProtection: cfg?._credentialProtection || null,
    credentialWarning: cfg?._credentialWarning || null,
    settingsError: settingsErrors.get(layout.settings) || null,
    selected: activeVersionId() === versionId,
    canSelect: supportsPlatform && installed && initialized,
    supported: supportsPlatform,
    port: Number(cfg?.port || (is13 ? VERSION_13_DEFAULT_PORT : DEFAULT_PORT)),
    host: '127.0.0.1',
    dataDirectory: layout.data,
    binaryDirectory: path.join(layout.serverRoot, 'bin'),
    configPath: layout.ini,
    logPath: layout.log,
    installerLogPath: !is13 && fs.existsSync(path.join(DB_ROOT, 'logs', 'mariadb-install.log'))
      ? path.join(DB_ROOT, 'logs', 'mariadb-install.log') : null,
    rootDirectory: layout.root
  };
}

function versions() {
  return [describeVersion(LEGACY_VERSION_ID), describeVersion(MARIADB_13_VERSION_ID)];
}

function status() {
  const versionId = activeVersionId();
  const p = getPaths(versionId);
  const cfg = getSettings(versionId);
  const selected = describeVersion(versionId);
  const running = Boolean(runtimeState.versionId === versionId && runtimeState.process && runtimeState.process.exitCode === null);
  return {
    supported: ['win32', 'darwin'].includes(process.platform) && (versionId !== MARIADB_13_VERSION_ID || process.arch === 'x64'),
    versionId,
    version: selected.version,
    installed: selected.installed,
    initialized: selected.initialized,
    repairable: selected.repairable,
    healthState: selected.healthState,
    issueReason: selected.issueReason,
    versionVerified: selected.versionVerified,
    running,
    port: Number(cfg?.port || selected.port || DEFAULT_PORT),
    host: '127.0.0.1',
    username: 'root',
    dataDirectory: p.data,
    binaryDirectory: path.join(p.serverRoot, 'bin'),
    configPath: p.ini,
    logPath: p.log,
    credentialProtection: cfg?._credentialProtection || null,
    credentialWarning: cfg?._credentialWarning || null,
    settingsError: settingsErrors.get(p.settings) || null,
    lastError: runtimeState.lastError,
    versions: versions()
  };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 0, input, ...spawnOptions } = options;
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...spawnOptions });
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
    let stdout = '', stderr = '', settled = false;
    const timer = timeoutMs ? setTimeout(() => {
      if (settled) return;
      try { child.kill(); } catch {}
      settled = true;
      reject(new Error(`Proses melebihi batas waktu ${Math.round(timeoutMs / 1000)} detik.`));
    }, timeoutMs) : null;
    child.stdout?.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-MAX_QUERY_OUTPUT); });
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-MAX_QUERY_OUTPUT); });
    child.once('error', error => {
      if (settled) return;
      settled = true; if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true; if (timer) clearTimeout(timer);
      if (code !== 0) reject(new Error((stderr || stdout || `Proses gagal (${code}).`).trim()));
      else resolve({ stdout, stderr, code });
    });
  });
}

function legacyRecoveryCandidates() {
  const layout = versionManager.getLayout(LEGACY_VERSION_ID);
  return [
    { name: 'server', source: layout.serverRoot, directory: true },
    { name: 'data', source: layout.data, directory: true },
    { name: 'backups', source: layout.backups, directory: true },
    { name: 'tmp', source: layout.tmp, directory: true },
    { name: 'settings.json', source: layout.settings, directory: false },
    { name: 'mariadbd.log', source: layout.log, directory: false },
    { name: 'mariadbd.pid', source: layout.pid, directory: false }
  ];
}

function inspectLegacyRecoveryPorts() {
  const layout = versionManager.getLayout(LEGACY_VERSION_ID);
  const settings = getSettings(LEGACY_VERSION_ID);
  const ports = new Set([DEFAULT_PORT]);
  if (Number.isInteger(Number(settings?.port)) && Number(settings.port) >= 1024 && Number(settings.port) <= 65535) ports.add(Number(settings.port));
  try {
    const ini = fs.readFileSync(layout.ini, 'utf8');
    const match = ini.match(/^\s*port\s*=\s*(\d+)\s*$/im);
    if (match && Number(match[1]) >= 1024 && Number(match[1]) <= 65535) ports.add(Number(match[1]));
  } catch {}
  return [...ports];
}

function quarantineLegacyPartial() {
  const candidates = legacyRecoveryCandidates().filter(item => fs.existsSync(item.source));
  if (!candidates.length) return null;
  const recoveryRoot = path.join(versionManager.versionsRoot, 'recovery');
  fs.mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let recoveryPath = path.join(recoveryRoot, `mariadb-managed-${timestamp}`);
  for (let i = 1; fs.existsSync(recoveryPath); i++) recoveryPath = path.join(recoveryRoot, `mariadb-managed-${timestamp}-${i}`);
  fs.mkdirSync(recoveryPath, { recursive: false, mode: 0o700 });
  const moved = [];
  try {
    for (const item of candidates) {
      const st = fs.lstatSync(item.source);
      if (st.isSymbolicLink() || (item.directory ? !st.isDirectory() : !st.isFile())) {
        throw new Error(`Tidak aman memindahkan ${item.name}: item bukan ${item.directory ? 'folder' : 'file'} biasa.`);
      }
      const destination = path.join(recoveryPath, item.name);
      fs.renameSync(item.source, destination);
      moved.push({ ...item, destination });
    }
    return { recoveryPath, moved };
  } catch (error) {
    // Best-effort rollback; leave the recovery directory untouched if a rollback path is occupied.
    for (const item of [...moved].reverse()) {
      try { if (!fs.existsSync(item.source) && fs.existsSync(item.destination)) fs.renameSync(item.destination, item.source); } catch {}
    }
    throw new Error(`Pemulihan parsial dibatalkan saat mengamankan runtime lama: ${error.message}. Folder recovery diperiksa sebelum melanjutkan: ${recoveryPath}`);
  }
}

function restoreLegacyPartial(recovery, reason) {
  if (!recovery?.recoveryPath) return '';
  const failedStamp = new Date().toISOString().replace(/[:.]/g, '-');
  let failedRoot = path.join(path.dirname(recovery.recoveryPath), `mariadb-managed-install-failed-${failedStamp}`);
  for (let i = 1; fs.existsSync(failedRoot); i++) failedRoot = path.join(path.dirname(recovery.recoveryPath), `mariadb-managed-install-failed-${failedStamp}-${i}`);
  let hasFailedItems = false;
  for (const item of legacyRecoveryCandidates()) {
    if (!fs.existsSync(item.source)) continue;
    if (!hasFailedItems) { fs.mkdirSync(failedRoot, { recursive: false, mode: 0o700 }); hasFailedItems = true; }
    const destination = path.join(failedRoot, item.name);
    fs.renameSync(item.source, destination);
  }
  for (const item of [...recovery.moved].reverse()) {
    if (fs.existsSync(item.source)) throw new Error(`Tidak dapat memulihkan ${item.name}: target sudah muncul. Data lama tetap aman di ${recovery.recoveryPath}.`);
    fs.renameSync(item.destination, item.source);
  }
  try { fs.rmdirSync(recovery.recoveryPath); } catch {}
  return hasFailedItems
    ? ` Runtime lama telah dikembalikan ke lokasi sebelumnya. Berkas percobaan yang gagal disimpan di ${failedRoot}.`
    : ' Runtime lama telah dikembalikan ke lokasi sebelumnya.';
}

async function install() {
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Database otomatis saat ini mendukung Windows dan macOS.');
  if (process.platform === 'win32' && process.arch !== 'x64') throw new Error('MariaDB portable memerlukan Windows x64.');
  if (isVersionInitialized(LEGACY_VERSION_ID) && describeVersion(LEGACY_VERSION_ID).installed) {
    return { message: 'Runtime MariaDB bawaan/LTS sudah terpasang; tidak ada data yang diubah.', status: status(), versions: versions() };
  }
  const current = describeVersion(LEGACY_VERSION_ID);
  const manualDatabasePath = runtimePaths.runtimePathStatus();
  const manualPathConfigured = manualDatabasePath.status.mariaDbBinDir.configured;
  const manualPathMissing = manualPathConfigured && !manualDatabasePath.status.mariaDbBinDir.exists;
  const stalePathInsideManagedRuntime = manualPathMissing && current.repairable && isPathWithinDirectory(DB_ROOT, manualDatabasePath.paths.mariaDbBinDir);
  if (manualPathMissing && !stalePathInsideManagedRuntime) {
    throw new Error('Folder bin MariaDB manual tidak lengkap atau sudah dipindahkan. Buka Web & Runtime → Path Manual, pilih folder yang memiliki server, installer, client, admin, dan dump, atau kosongkan path manual. Jika path menunjuk ke runtime SXL yang rusak, gunakan Pulihkan Instalasi Parsial agar SXL mengarantina path lama lalu memasang runtime baru.');
  }
  if (runtimeState.process && runtimeState.process.exitCode === null) throw new Error('Hentikan database SXL yang sedang berjalan sebelum memasang runtime lain. SXL tidak akan menghentikan proses secara otomatis.');

  let recovery = null;
  let recoveryNotice = '';
  if (current.repairable) {
    for (const port of inspectLegacyRecoveryPorts()) {
      if (!(await isTcpPortAvailable(port))) {
        throw new Error(`Port ${port} masih digunakan. SXL tidak memindahkan instalasi parsial agar tidak mengganggu layanan lain. Hentikan layanan pemilik port setelah memverifikasi prosesnya, lalu ulangi pemulihan.`);
      }
    }
    recovery = quarantineLegacyPartial();
    if (recovery) recoveryNotice = ` Instalasi parsial lama dipindahkan dengan aman ke ${recovery.recoveryPath}; tidak ada file lama yang dihapus.`;
  }

  runtimeState.lastError = null;
  fs.mkdirSync(DB_ROOT, { recursive: true });
  try {
    if (process.platform === 'win32') {
      if (!fs.existsSync(SCRIPT_PATH)) throw new Error('Skrip Install-SXL-MariaDB.ps1 tidak ditemukan. Ekstrak ulang atau pasang ulang aplikasi.');
      const powershell = process.env.SXL_POWERSHELL_PATH || 'powershell.exe';
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH, '-RuntimeRoot', DB_ROOT, '-Port', String(DEFAULT_PORT)];
      // Re-check after quarantine: a saved manual path can point to the broken
      // SXL-managed server/bin folder that has just been moved into recovery.
      // Only pass a folder that still satisfies every required executable group.
      const manualRuntimeAfterRecovery = runtimePaths.runtimePathStatus();
      const manualBin = manualRuntimeAfterRecovery.status.mariaDbBinDir.exists
        ? manualRuntimeAfterRecovery.paths.mariaDbBinDir
        : '';
      if (manualBin) args.push('-SourceBinDir', manualBin);
      const child = spawn(powershell, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', chunk => { log = (log + chunk.toString()).slice(-12000); runtimeState.log = log; });
      child.stderr.on('data', chunk => { log = (log + chunk.toString()).slice(-12000); runtimeState.log = log; });
      const timeout = setTimeout(() => { try { child.kill(); } catch {} }, INSTALL_TIMEOUT_MS);
      try {
        await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('close', code => code === 0 ? resolve() : reject(new Error(log.trim() || `Installer MariaDB gagal (code ${code}).`)));
        });
      } finally { clearTimeout(timeout); }
    } else {
      await installMacMariaDB();
    }
    const installed = describeVersion(LEGACY_VERSION_ID);
    if (!installed.initialized || !installed.installed || !installed.versionVerified) {
      throw new Error('Installer selesai tetapi runtime, data, atau versi executable belum dapat diverifikasi. Periksa log sebelum menggunakan database.');
    }
  } catch (error) {
    runtimeState.lastError = error.message;
    let restoreNotice = '';
    if (recovery) {
      try { restoreNotice = restoreLegacyPartial(recovery, error.message); }
      catch (restoreError) {
        throw new Error(`Pemasangan runtime baru gagal: ${error.message}. Pemulihan otomatis belum selesai: ${restoreError.message}. Folder runtime lama tetap disimpan di ${recovery.recoveryPath}.`);
      }
    }
    const installDiagnosticPath = path.join(DB_ROOT, 'logs', 'mariadb-install.log');
    const diagnosticNotice = fs.existsSync(installDiagnosticPath) ? ` Log diagnostik tersimpan di: ${installDiagnosticPath}.` : '';
    throw new Error(`Pemasangan MariaDB LTS gagal: ${error.message}${restoreNotice}${recovery && !restoreNotice ? ` Folder lama tersimpan di ${recovery.recoveryPath}.` : ''}${diagnosticNotice}`);
  }
  return { message: `Runtime MariaDB bawaan/LTS siap dan versi binary telah diverifikasi. Data baru tersimpan di ${versionManager.getLayout(LEGACY_VERSION_ID).data}; host hanya 127.0.0.1.${recoveryNotice}`, status: status(), versions: versions() };
}

async function sha256File(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filename);
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function findAvailablePort(startPort, endPort = startPort + 100) {
  for (let port = startPort; port <= endPort; port++) {
    if (await isTcpPortAvailable(port)) return port;
  }
  throw new Error(`Tidak ditemukan port kosong pada rentang ${startPort}–${endPort}. Tutup aplikasi yang tidak diperlukan atau ubah rentang port secara manual.`);
}

async function installVersionArchive({ archivePath, repairPartial = false } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('MariaDB 13.0.2 dalam arsip ini khusus Windows x64. Runtime tidak diimpor pada macOS atau arsitektur lain.');
  }
  if (runtimeState.process && runtimeState.process.exitCode === null) {
    throw new Error('Hentikan database SXL yang sedang berjalan sebelum memasang versi tambahan. Tidak ada proses yang dihentikan otomatis.');
  }
  if (typeof archivePath !== 'string' || !path.isAbsolute(archivePath.trim())) {
    throw new Error('Pilih arsip mariadb-13.0.2-winx64.zip melalui tombol Pilih ZIP; path harus absolut.');
  }
  const resolvedArchive = path.resolve(archivePath.trim());
  if (path.basename(resolvedArchive).toLowerCase() !== 'mariadb-13.0.2-winx64.zip') {
    throw new Error('Arsip harus bernama persis mariadb-13.0.2-winx64.zip. Paket lain tidak akan dieksekusi.');
  }
  const fileStat = await fs.promises.lstat(resolvedArchive).catch(() => null);
  if (!fileStat || !fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error('Arsip tidak ditemukan, bukan file biasa, atau berupa symbolic link.');
  if (fileStat.size !== 104263573) throw new Error(`Ukuran arsip tidak cocok dengan paket terverifikasi (diterima ${fileStat.size} byte; diharapkan 104263573).`);
  const actualHash = await sha256File(resolvedArchive);
  if (actualHash !== MARIADB_13_SHA256) throw new Error(`SHA-256 arsip tidak cocok; arsip ditolak. SHA-256 terhitung: ${actualHash}`);
  if (!fs.existsSync(VERSION_INSTALL_SCRIPT_PATH)) throw new Error('Skrip Install-SXL-MariaDB-Version.ps1 tidak ditemukan. Ekstrak ulang source SXL.');

  const versionRoot = versionManager.getLayout(MARIADB_13_VERSION_ID).root;
  const port = await findAvailablePort(VERSION_13_DEFAULT_PORT, VERSION_13_DEFAULT_PORT + 100);
  let recoveryPath = null;
  let recoveryRoot = null;
  const pathStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const existed = fs.existsSync(versionRoot);
  if (existed) {
    const existing = describeVersion(MARIADB_13_VERSION_ID);
    if (existing.installed && existing.initialized) {
      throw new Error('MariaDB 13.0.2 sudah terpasang dan terinisialisasi. Tidak perlu memasang ulang atau menimpa data.');
    }
    if (repairPartial !== true) {
      throw new Error('Direktori MariaDB 13.0.2 ada tetapi belum sehat. Pilih “Pulihkan instalasi parsial” untuk memindahkannya ke folder pemulihan tanpa menghapus binary, konfigurasi, log, backup, atau data lama.');
    }
    const rootStat = await fs.promises.lstat(versionRoot).catch(() => null);
    if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new Error('Folder runtime parsial berupa symbolic link atau bukan direktori biasa. SXL menolak memindahkannya.');
    }
    const configuredPort = Number(existing.port || VERSION_13_DEFAULT_PORT);
    if (!(await isTcpPortAvailable(configuredPort))) {
      throw new Error(`Port ${configuredPort} yang tercatat untuk instance parsial masih digunakan. SXL tidak memindahkan instance agar tidak mengganggu proses lain; periksa proses pemilik port terlebih dahulu.`);
    }
    const { applyWindowsTreeAcl } = require('./lib/secure-settings');
    applyWindowsTreeAcl(versionRoot);
    recoveryRoot = path.join(versionManager.versionsRoot, 'recovery');
    await fs.promises.mkdir(recoveryRoot, { recursive: true, mode: 0o700 });
    applyWindowsTreeAcl(recoveryRoot);
    recoveryPath = path.join(recoveryRoot, `${MARIADB_13_VERSION_ID}-${pathStamp}`);
    // Same-volume rename is atomic. Data is quarantined, never recursively deleted.
    recoveryPath = quarantineDirectory(versionRoot, recoveryRoot, MARIADB_13_VERSION_ID, pathStamp);
  } else if (repairPartial === true) {
    throw new Error('Tidak ada folder instalasi parsial yang perlu dipulihkan; jalankan pemasangan normal.');
  }

  const powershell = process.env.SXL_POWERSHELL_PATH || 'powershell.exe';
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', VERSION_INSTALL_SCRIPT_PATH,
    '-VersionRoot', versionRoot, '-ArchivePath', resolvedArchive, '-Port', String(port),
    '-ExpectedSha256', MARIADB_13_SHA256
  ];
  runtimeState.lastError = null;
  runtimeState.log = `Memverifikasi arsip MariaDB 13.0.2; SHA-256 cocok. Target port: ${port}.`;
  const child = spawn(powershell, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = runtimeState.log;
  const append = chunk => { log = (log + '\n' + chunk.toString()).slice(-16000); runtimeState.log = log; };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const timeout = setTimeout(() => { try { child.kill(); } catch {} }, INSTALL_TIMEOUT_MS);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(log.trim() || `Installer MariaDB 13.0.2 gagal (code ${code}).`)));
    });
    const installedVersion = describeVersion(MARIADB_13_VERSION_ID);
    if (!isVersionInitialized(MARIADB_13_VERSION_ID) || !installedVersion.installed || !installedVersion.versionVerified) {
      throw new Error('Skrip selesai, tetapi binary lengkap, versi executable, atau folder data/mysql tidak terverifikasi. Versi tidak diaktifkan. Periksa direktori dan log.');
    }
  } catch (error) {
    runtimeState.lastError = error.message;
    // If this was a repair, preserve the attempted install separately and restore the old folder name.
    if (recoveryPath && fs.existsSync(recoveryPath)) {
      try {
        const { applyWindowsTreeAcl } = require('./lib/secure-settings');
        restoreQuarantinedDirectory(versionRoot, recoveryPath, recoveryRoot, `${MARIADB_13_VERSION_ID}-failed`, pathStamp, target => applyWindowsTreeAcl(target));
      } catch (recoveryError) {
        throw new Error(`Instalasi gagal: ${error.message}. Pemulihan otomatis juga gagal: ${recoveryError.message}. Data dipertahankan di ${recoveryPath}; jangan menghapus folder tersebut.`);
      }
    }
    throw new Error(`Instalasi MariaDB 13.0.2 gagal atau belum terverifikasi: ${error.message}${recoveryPath ? ` Folder asli telah dipulihkan dari ${recoveryPath}.` : ''}`);
  } finally {
    clearTimeout(timeout);
  }
  settingsCache.delete(versionManager.getLayout(MARIADB_13_VERSION_ID).settings);
  return {
    message: `MariaDB 13.0.2 berhasil disalin, versi executable diverifikasi, dan data baru diinisialisasi pada port ${port}. Runtime lama tetap utuh; pilih MariaDB 13.0.2 secara eksplisit bila ingin menggunakannya.${recoveryPath ? ` Instalasi parsial sebelumnya disimpan aman di ${recoveryPath}.` : ''}`,
    versionId: MARIADB_13_VERSION_ID,
    port,
    recoveryPath,
    version: describeVersion(MARIADB_13_VERSION_ID),
    versions: versions()
  };
}

function selectVersion(versionId) {
  if (runtimeState.process && runtimeState.process.exitCode === null) {
    throw new Error('Hentikan database SXL yang sedang berjalan sebelum mengganti versi aktif. SXL tidak akan menghentikannya otomatis.');
  }
  if (versionId === MARIADB_13_VERSION_ID && (process.platform !== 'win32' || process.arch !== 'x64')) {
    throw new Error('MariaDB 13.0.2 yang tersedia hanya mendukung Windows x64.');
  }
  const version = describeVersion(versionId);
  if (!version.installed || !version.initialized) throw new Error(`${version.label} belum terpasang dan terinisialisasi. Pasang versi terlebih dahulu.`);
  versionManager.setSelectedVersionId(versionId);
  runtimeState.lastError = null;
  return { message: `Versi database aktif diubah ke ${version.label}. Data, port, konfigurasi, dan backup versi lain tidak diubah.`, status: status(), versions: versions() };
}

async function setPort(portValue) {
  if (runtimeState.process && runtimeState.process.exitCode === null) {
    throw new Error('Hentikan database SXL sebelum mengubah port.');
  }
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port harus berupa bilangan bulat antara 1024 dan 65535.');
  const p = getPaths();
  const cfg = getSettings();
  if (!cfg || !p.settings) throw new Error('Runtime database aktif belum terinisialisasi.');
  if (!(await isTcpPortAvailable(port))) {
    throw new Error(`Port ${port} sedang digunakan layanan lain. SXL tidak menghentikan proses tersebut; pilih port lain atau hentikan layanan itu secara manual setelah memverifikasi pemiliknya.`);
  }
  const next = { ...cfg, port, host: '127.0.0.1' };
  const token = `${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  const tempSettings = `${p.settings}.${token}.tmp`;
  let tempIni = null;
  let iniWarning = '';
  try {
    if (fs.existsSync(p.ini)) {
      const iniStat = fs.lstatSync(p.ini);
      if (iniStat.isSymbolicLink() || !iniStat.isFile()) {
        iniWarning = ' my.ini tidak diubah karena bukan file biasa; saat start, SXL tetap menerapkan port dari pengaturan lokal.';
      } else {
        const sourceIni = fs.readFileSync(p.ini, 'utf8');
        const nextIni = updateDatabaseIniPort(sourceIni, port);
        tempIni = `${p.ini}.${token}.tmp`;
        fs.writeFileSync(tempIni, nextIni, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        try { fs.chmodSync(tempIni, 0o600); } catch {}
      }
    }
    // Write securely to a unique file, then atomically replace the active settings file.
    const stored = require('./lib/secure-settings').prepareSettingsForStorage(next);
    fs.writeFileSync(tempSettings, JSON.stringify(stored, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { fs.chmodSync(tempSettings, 0o600); } catch {}
    if (process.platform === 'win32') require('./lib/secure-settings').applyWindowsFileAcl(tempSettings);
    fs.renameSync(tempSettings, p.settings);
    try { fs.chmodSync(p.settings, 0o600); } catch {}
    settingsCache.delete(p.settings);
    if (tempIni) {
      try { fs.renameSync(tempIni, p.ini); tempIni = null; }
      catch (error) { iniWarning = ` Pengaturan port sudah tersimpan di SXL, tetapi my.ini tidak dapat diperbarui (${error.message}); SXL akan tetap menerapkan port melalui argumen server.`; }
    }
  } finally {
    try { fs.rmSync(tempSettings, { force: true }); } catch {}
    if (tempIni) try { fs.rmSync(tempIni, { force: true }); } catch {}
  }
  return { message: `Port ${port} disimpan untuk ${status().version}. Host tetap 127.0.0.1.${iniWarning}`, status: status() };
}

function getBrewCommand() {
  return ['/opt/homebrew/bin/brew', '/usr/local/bin/brew', findOnPath('brew')].filter(Boolean).find(p => fs.existsSync(p)) || null;
}

async function installMacMariaDB() {
  const brew = getBrewCommand();
  if (!brew) throw new Error('Homebrew belum ditemukan. Pasang terlebih dahulu dari https://brew.sh, lalu buka ulang SXL dan coba lagi. SXL tidak akan menjalankan skrip pemasangan yang tidak diverifikasi.');

  if (!findServerExe(LEGACY_VERSION_ID) || !findClientExe('client', LEGACY_VERSION_ID) || !findClientExe('installer', LEGACY_VERSION_ID)) {
    runtimeState.log = 'Menyiapkan MariaDB melalui Homebrew...';
    const result = await runProcess(brew, ['install', 'mariadb'], { timeoutMs: INSTALL_TIMEOUT_MS });
    runtimeState.log = (result.stdout + '\n' + result.stderr).slice(-12000);
  }

  const p = getPaths(LEGACY_VERSION_ID);
  if (!p.server || !p.client || !p.installer || !p.admin || !p.dump) {
    throw new Error('MariaDB terpasang, tetapi executable mariadbd/mariadb/mariadb-admin/mariadb-install-db/mariadb-dump tidak lengkap. Periksa `brew info mariadb` dan buka ulang SXL.');
  }
  if (fs.existsSync(path.join(p.data, 'mysql'))) {
    throw new Error('Direktori data sudah berisi database tetapi settings.json belum tersedia. SXL menghentikan proses agar data tidak ditimpa. Periksa folder: ' + p.data);
  }
  const existing = fs.existsSync(p.data) ? fs.readdirSync(p.data) : [];
  if (existing.length) throw new Error(`Folder data MariaDB tidak kosong tetapi belum terinisialisasi. Demi keamanan, tidak akan dihapus: ${p.data}`);
  fs.mkdirSync(p.data, { recursive: true, mode: 0o700 });
  const prefix = path.resolve(path.dirname(p.server), '..');
  const initArgs = [`--basedir=${prefix}`, `--datadir=${p.data}`, '--auth-root-authentication-method=normal', '--skip-test-db'];
  const initResult = await runProcess(p.installer, initArgs, { timeoutMs: INSTALL_TIMEOUT_MS });
  runtimeState.log = (runtimeState.log + '\n' + initResult.stdout + '\n' + initResult.stderr).slice(-12000);
  if (!fs.existsSync(path.join(p.data, 'mysql'))) throw new Error('mariadb-install-db berjalan tetapi direktori sistem mysql tidak muncul. ' + runtimeState.log.slice(-1000));

  const password = crypto.randomBytes(32).toString('hex');
  try { fs.rmSync(p.socket, { force: true }); } catch {}
  const bootstrap = spawn(p.server, ['--no-defaults', `--basedir=${prefix}`, `--datadir=${p.data}`, `--socket=${p.socket}`, `--pid-file=${p.pid}`, '--skip-networking', '--log-error=' + p.log], { stdio: ['ignore', 'pipe', 'pipe'] });
  runtimeState.process = bootstrap;
  const bootstrapLog = chunk => { runtimeState.log = (runtimeState.log + chunk.toString()).slice(-12000); };
  bootstrap.stdout.on('data', bootstrapLog); bootstrap.stderr.on('data', bootstrapLog);
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (bootstrap.exitCode !== null) throw new Error('Server MariaDB gagal saat inisialisasi. ' + runtimeState.log.slice(-1500));
      if (fs.existsSync(p.socket)) break;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    if (!fs.existsSync(p.socket)) throw new Error('Socket sementara MariaDB tidak siap dalam 30 detik. ' + runtimeState.log.slice(-1500));
    const sql = "ALTER USER 'root'@'localhost' IDENTIFIED BY '" + password + "'; CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '" + password + "'; ALTER USER 'root'@'127.0.0.1' IDENTIFIED BY '" + password + "'; GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION; FLUSH PRIVILEGES;\n";
    await runProcess(p.client, ['--no-defaults', '--protocol=socket', `--socket=${p.socket}`, '--user=root'], { timeoutMs: 15000, input: sql });
  } finally {
    try {
      await runProcess(p.admin, ['--no-defaults', '--protocol=socket', `--socket=${p.socket}`, '--user=root', 'shutdown'], { timeoutMs: 5000, env: { ...process.env, MYSQL_PWD: password } });
    } catch { try { bootstrap.kill('SIGTERM'); } catch {} }
    if (bootstrap.exitCode === null) await new Promise(resolve => {
      const timeout = setTimeout(() => { try { bootstrap.kill('SIGTERM'); } catch {} resolve(); }, 5000);
      bootstrap.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
    runtimeState.process = null;
  }
  let version = 'Versi belum terverifikasi';
  let versionVerified = false;
  try {
    const versionResult = await runProcess(p.server, ['--version'], { timeoutMs: 5000 });
    const match = `${versionResult.stdout}\n${versionResult.stderr}`.match(/(?:Distrib\s+|Ver\s+)?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)/i);
    if (match) { version = match[1]; versionVerified = true; }
  } catch {}
  const config = { version, versionVerified, port: DEFAULT_PORT, host: '127.0.0.1', user: 'root', password, installedAt: new Date().toISOString() };
  writeSettingsAtomic(p.settings, config);
  settingsCache.delete(p.settings);
}

function recheckRuntimeVersion(versionId = activeVersionId()) {
  if (![LEGACY_VERSION_ID, MARIADB_13_VERSION_ID].includes(versionId)) throw new Error('Versi database tidak dikenal.');
  const binary = findServerExe(versionId);
  if (!binary) throw new Error('Executable server MariaDB tidak ditemukan. Runtime tidak lengkap; gunakan Pulihkan Instalasi Parsial, yang menyimpan file lama di recovery.');
  // Clear cached negative results so a transient process/environment error can be retried.
  detectedVersionCache.clear();
  const version = detectVersionFromBinary(versionId);
  if (!version) throw new Error(`Output versi dari binary tidak dapat diverifikasi: ${binary}. Periksa runtime atau gunakan pemulihan yang menyimpan file lama di recovery.`);
  return { ok: true, version, binary, message: `Versi binary MariaDB ${version} berhasil diverifikasi. Konfigurasi data tidak diubah.` };
}

async function isMariaDBReady(port, versionId = activeVersionId()) {
  const admin = findClientExe('admin', versionId);
  const cfg = getSettings(versionId);
  if (!admin || !cfg) return false;
  try {
    await runProcess(admin, ['--protocol=tcp', '--host=127.0.0.1', `--port=${port}`, '--user=root', 'ping'], {
      env: { ...process.env, MYSQL_PWD: cfg.password }, timeoutMs: 1500
    });
    return true;
  } catch { return false; }
}
async function waitForPort(port, maxMs = 20000, versionId = activeVersionId()) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (runtimeState.versionId === versionId && runtimeState.process && runtimeState.process.exitCode !== null) {
      throw new Error(`MariaDB berhenti saat startup. ${readLog(versionId).slice(-1500)}`);
    }
    if (await isMariaDBReady(port, versionId)) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`MariaDB tidak siap pada 127.0.0.1:${port} dalam ${Math.round(maxMs / 1000)} detik. ${readLog(versionId).slice(-1500)}`);
}

async function start() {
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('MariaDB otomatis saat ini mendukung Windows dan macOS.');
  const versionId = activeVersionId();
  const current = status();
  if (!current.initialized) throw new Error('Versi database aktif belum terpasang/terinisialisasi. Pasang atau pilih versi database yang sudah siap.');
  if (current.running) return { message: 'MariaDB sudah berjalan.', status: status() };
  const p = getPaths(versionId);
  const cfg = getSettings(versionId);
  if (!p.server || !p.admin || !p.client) throw new Error('Executable server/client/admin database tidak lengkap. Periksa pemasangan runtime yang dipilih.');
  if (!cfg || !Number.isInteger(Number(cfg.port)) || Number(cfg.port) < 1024 || Number(cfg.port) > 65535) throw new Error('Konfigurasi port database tidak valid; gunakan port 1024–65535.');
  if (!(await isTcpPortAvailable(Number(cfg.port)))) {
    throw new Error(`Port ${cfg.port} sudah digunakan layanan lain pada 127.0.0.1. SXL tidak menghentikan proses lain; ubah port database atau hentikan layanan tersebut secara manual setelah memverifikasi pemiliknya.`);
  }
  await fs.promises.mkdir(p.tmp, { recursive: true });
  await fs.promises.mkdir(path.dirname(p.log), { recursive: true });
  const args = [];
  if (process.platform === 'darwin') {
    // Do not inherit a Homebrew system-wide config: SXL owns its own data dir and port.
    args.push('--no-defaults');
    try { fs.rmSync(p.socket, { force: true }); } catch {}
  } else if (fs.existsSync(p.ini)) {
    // Version 13 keeps its own config beside the runtime; legacy uses data/my.ini.
    args.push(`--defaults-file=${p.ini}`);
  }
  args.push(`--datadir=${p.data}`, `--port=${cfg.port}`, '--bind-address=127.0.0.1', '--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci', `--log-error=${p.log}`, `--tmpdir=${p.tmp}`);
  if (process.platform === 'darwin') args.push(`--socket=${p.socket}`, `--pid-file=${p.pid}`);
  else args.push('--console');
  runtimeState.lastError = null;
  runtimeState.log = '';
  runtimeState.versionId = versionId;
  runtimeState.stopping = false;
  const child = spawn(p.server, args, { windowsHide: true, cwd: path.dirname(p.server), stdio: ['ignore', 'pipe', 'pipe'] });
  runtimeState.process = child;
  const onData = chunk => { runtimeState.log = (runtimeState.log + chunk.toString()).slice(-12000); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('error', err => {
    runtimeState.lastError = `Gagal menjalankan MariaDB: ${err.message}`;
    if (runtimeState.process === child) { runtimeState.process = null; runtimeState.versionId = null; }
  });
  child.once('exit', (code, signal) => {
    if (runtimeState.process === child) { runtimeState.process = null; runtimeState.versionId = null; }
    if (!runtimeState.stopping && code !== 0) runtimeState.lastError = `MariaDB berhenti (code=${code}, signal=${signal || 'none'}). ${readLog(versionId).slice(-1500)}`;
  });
  try {
    await waitForPort(Number(cfg.port), 20000, versionId);
  } catch (error) {
    // Only terminate the exact child process spawned by this SXL instance.
    if (child.exitCode === null) { try { child.kill(); } catch {} }
    if (runtimeState.process === child) runtimeState.process = null;
    if (runtimeState.versionId === versionId) runtimeState.versionId = null;
    runtimeState.lastError = error.message;
    throw error;
  }
  return { message: `${current.version} aktif pada 127.0.0.1:${cfg.port}.`, status: status() };
}

async function stop() {
  const child = runtimeState.process;
  const versionId = runtimeState.versionId || activeVersionId();
  if (!child || child.exitCode !== null) {
    runtimeState.process = null;
    runtimeState.versionId = null;
    return { message: 'Database SXL tidak sedang berjalan.', status: status() };
  }
  runtimeState.stopping = true;
  const cfg = getSettings(versionId);
  const admin = findClientExe('admin', versionId);
  if (admin && cfg) {
    try {
      await runProcess(admin, ['--protocol=tcp', '--host=127.0.0.1', `--port=${cfg.port}`, '--user=root', 'shutdown'], {
        env: { ...process.env, MYSQL_PWD: cfg.password }, timeoutMs: 5000
      });
    } catch { /* only the tracked child is eligible for the bounded fallback below */ }
  }
  if (child.exitCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(); }, 4000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  if (runtimeState.process === child) runtimeState.process = null;
  runtimeState.versionId = null;
  runtimeState.stopping = false;
  runtimeState.lastError = null;
  return { message: 'Database SXL dihentikan.', status: status() };
}

function splitBatchRow(line) {
  const cells = [];
  let value = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\t') { cells.push(value); value = ''; continue; }
    if (ch === '\\' && i + 1 < line.length) {
      const next = line[++i];
      if (next === 't') value += '\t';
      else if (next === 'n') value += '\n';
      else if (next === 'r') value += '\r';
      else if (next === '0') value += '\0';
      else if (next === 'N') value += '\N';
      else value += next;
      continue;
    }
    value += ch;
  }
  cells.push(value);
  return cells;
}

async function query({ sql, language = 'id', database: databaseName = '' }) {
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Eksekusi MariaDB otomatis mendukung Windows dan macOS.');
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('Masukkan minimal satu perintah SQL terlebih dahulu.');
  if (sql.length > 100000) throw new Error('SQL terlalu panjang (maksimal 100.000 karakter).');
  if (language !== 'id' && language !== 'native') throw new Error('Pilih Bahasa Indonesia atau SQL standar.');
  const statements = splitSqlStatements(sql);
  if (!statements.length) throw new Error('Tidak ada perintah SQL yang dapat dijalankan.');
  if (statements.length > MAX_SQL_BATCH_STATEMENTS) {
    throw new Error(`Maksimal ${MAX_SQL_BATCH_STATEMENTS} perintah dapat dijalankan sekaligus.`);
  }
  if (!status().running) throw new Error('MariaDB belum berjalan. Tekan Jalankan Database terlebih dahulu.');
  const translatedStatements = statements.map(statement =>
    language === 'id' ? translateIndonesianSql(statement) : statement
  );
  const translatedSql = translatedStatements.join(';\n');
  const markedSql = createMarkedSql(translatedStatements, crypto.randomBytes(16).toString('hex'));
  const p = getPaths();
  const cfg = getSettings();
  if (!p.client) throw new Error('Klien MariaDB tidak ditemukan. Pasang ulang MariaDB dari panel.');
  const args = [
    '--protocol=tcp', '--host=127.0.0.1', `--port=${cfg.port}`, '--user=root',
    '--batch', '--column-names', '--default-character-set=utf8mb4', '--connect-timeout=5'
  ];
  if (typeof databaseName === 'string' && databaseName.trim()) {
    const cleanDatabase = databaseName.trim();
    if (cleanDatabase.length > 64 || /[\u0000-\u001f\u007f]/.test(cleanDatabase)) throw new Error('Nama database tidak valid.');
    args.push(`--database=${cleanDatabase}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(p.client, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MYSQL_PWD: cfg.password } });
    let stdout = '', stderr = '', settled = false;
    const collectCompletedResults = () => {
      const parsed = parseMarkedSqlOutput(stdout, markedSql.markers, splitBatchRow);
      const results = parsed.results.map((result, index) => ({
        ...result,
        statement: translatedStatements[index],
        message: result.rowCount ? `${result.rowCount} baris hasil.` : 'Perintah berhasil dijalankan.'
      }));
      return { parsed, results };
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true; try { child.kill(); } catch {}
      const { results } = collectCompletedResults();
      const error = new Error(`SQL melebihi batas waktu 30 detik dan dihentikan setelah ${results.length} perintah selesai.`);
      error.partialResults = results;
      error.failedStatementIndex = results.length + 1;
      reject(error);
    }, QUERY_TIMEOUT_MS);
    const accumulate = (dest, chunk) => {
      if (dest === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
      if (stdout.length + stderr.length > MAX_QUERY_OUTPUT) {
        settled = true; clearTimeout(timeout); try { child.kill(); } catch {}
        const { results } = collectCompletedResults();
        const error = new Error('Hasil SQL terlalu besar (maksimal 8 MB). Tambahkan LIMIT pada SELECT.');
        error.partialResults = results;
        error.failedStatementIndex = results.length + 1;
        reject(error);
      }
    };
    child.stdout.on('data', c => accumulate('stdout', c));
    child.stderr.on('data', c => accumulate('stderr', c));
    child.once('error', err => { if (settled) return; settled = true; clearTimeout(timeout); reject(err); });
    child.once('close', code => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      const { parsed, results } = collectCompletedResults();
      if (code !== 0 || !parsed.complete) {
        const failedIndex = results.length + 1;
        const detail = (stderr || parsed.remainingOutput || `Query gagal (${code}).`).trim();
        const error = new Error(`Perintah ke-${failedIndex} gagal: ${detail}`);
        error.partialResults = results;
        error.failedStatementIndex = failedIndex;
        return reject(error);
      }
      if (results.length === 1) {
        return resolve({
          ...results[0],
          translatedSql: results[0].statement,
          results,
          rawOutput: stdout
        });
      }
      const totalRows = results.reduce((sum, result) => sum + result.rowCount, 0);
      resolve({
        translatedSql,
        results,
        rowCount: totalRows,
        truncated: results.some(result => result.truncated),
        message: `${results.length} perintah berhasil dijalankan berurutan (${totalRows} baris hasil).`
      });
    });
    child.stdin.end(`${markedSql.sql}\n`);
  });
}

async function listDatabases() {
  const result = await query({ sql: 'SHOW DATABASES', language: 'native' });
  return (result.rows || []).map(row => row[0]).filter(name => typeof name === 'string');
}

async function createDatabase(databaseName) {
  const name = validateDatabaseName(databaseName);
  if (!name || isSystemDatabase(name)) throw new Error('Nama database tidak valid atau dicadangkan.');
  const result = await query({ sql: `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, language: 'native' });
  return { message: `Database ${name} siap digunakan.`, database: name, result };
}
async function dropDatabase(databaseName) {
  const name = validateDatabaseName(databaseName);
  if (!name || isSystemDatabase(name)) throw new Error('Database sistem tidak boleh dihapus melalui SXL.');
  const existing = await listDatabases();
  if (!existing.includes(name)) throw new Error(`Database ${name} tidak ditemukan.`);
  await query({ sql: `DROP DATABASE \`${name}\``, language: 'native' });
  return { message: `Database ${name} telah dihapus.`, database: name };
}

async function enablePhpMyAdminRootNoPassword() {
  const versionId = activeVersionId();
  const cfg = getSettings(versionId);
  if (!cfg) throw new Error('Kredensial MariaDB tidak tersedia; password root tidak diubah.');
  if ((cfg.user || 'root').toLowerCase() !== 'root') throw new Error('phpMyAdmin tanpa password hanya dapat dikonfigurasi untuk akun root.');
  if (cfg.password === '') return { changed: false };
  if (!runtimeState.process || runtimeState.process.exitCode !== null || runtimeState.versionId !== versionId) {
    throw new Error('Jalankan MariaDB yang dipilih sebelum mengaktifkan root tanpa password.');
  }

  const paths = getPaths(versionId);
  if (!paths.client) throw new Error('Klien MariaDB tidak ditemukan; password root tidak diubah.');
  const execute = (sql, password = cfg.password) => runProcess(paths.client, [
    '--no-defaults', '--protocol=tcp', '--host=127.0.0.1', `--port=${cfg.port}`,
    '--user=root', '--batch', `--execute=${sql}`
  ], { env: { ...process.env, MYSQL_PWD: password }, timeoutMs: 10000 });

  const accountResult = await execute('SELECT CURRENT_USER()');
  const account = accountResult.stdout.trim().split(/\r?\n/).pop() || '';
  const accountMatch = account.match(/^root@([A-Za-z0-9._:%-]+)$/i);
  if (!accountMatch) throw new Error(`Akun root MariaDB lokal tidak dapat diverifikasi (${account || 'kosong'}); password tidak diubah.`);
  const accountName = `'root'@'${accountMatch[1]}'`;
  const updatePassword = password => `ALTER USER ${accountName} IDENTIFIED BY '${password}'`;
  await execute(updatePassword(''));
  try {
    writeSettingsAtomic(paths.settings, { ...cfg, password: '' });
  } catch (persistError) {
    const escapedPassword = cfg.password.replace(/\\/g, '\\\\').replace(/'/g, "''");
    try {
      await execute(updatePassword(escapedPassword), '');
    } catch (rollbackError) {
      throw new Error(`Password root sudah dikosongkan tetapi penyimpanan pengaturan gagal (${persistError.message}) dan pemulihan password lama juga gagal (${rollbackError.message}). Jangan tutup aplikasi sebelum memeriksa koneksi database.`);
    }
    throw new Error(`Password root lama dipulihkan karena pengaturan no-password tidak dapat disimpan: ${persistError.message}`);
  }
  settingsCache.delete(paths.settings);
  runtimeState.log = (runtimeState.log + '\nAkun root MariaDB diubah ke password kosong untuk phpMyAdmin lokal.').slice(-12000);
  return { changed: true };
}

function credentials() {
  const cfg = getSettings();
  if (!cfg) throw new Error('MariaDB belum dipasang.');
  return { host: '127.0.0.1', port: cfg.port, username: cfg.user || 'root', password: cfg.password, version: cfg.version };
}

function validateProjectUsername(username) {
  if (typeof username !== 'string' || !/^[a-z][a-z0-9_]{2,31}$/.test(username)) {
    throw new Error('Nama pengguna aplikasi harus 3–32 karakter, diawali huruf kecil, dan hanya berisi huruf kecil, angka, atau garis bawah.');
  }
  if (['root', 'admin', 'mysql', 'mariadb', 'mariadb_sys'].includes(username)) {
    throw new Error('Nama pengguna tersebut dicadangkan. Pilih nama khusus untuk aplikasi.');
  }
  return username;
}

async function createProjectUser({ database: databaseName, username } = {}) {
  if (!status().running) throw new Error('Jalankan MariaDB terlebih dahulu.');
  const cleanDatabase = validateDatabaseName(databaseName);
  if (!cleanDatabase) throw new Error('Pilih database proyek terlebih dahulu.');
  if (isSystemDatabase(cleanDatabase)) throw new Error('Akun proyek tidak boleh dibuat untuk schema sistem MariaDB.');
  const databases = await listDatabases();
  if (!databases.includes(cleanDatabase)) throw new Error(`Database ${cleanDatabase} tidak ditemukan.`);
  const cleanUsername = validateProjectUsername(username);
  const existing = await query({ sql: `SELECT User FROM mysql.user WHERE User = '${cleanUsername}' LIMIT 1`, language: 'native' });
  if (existing.rows?.length) throw new Error(`Pengguna ${cleanUsername} sudah ada. Gunakan nama lain; SXL tidak akan mengubah hak akses akun yang sudah ada.`);

  const cfg = getSettings();
  const p = getPaths();
  const password = crypto.randomBytes(24).toString('hex');
  const dbIdentifier = '`' + cleanDatabase.replace(/`/g, '``') + '`';
  const sql = [
    `CREATE USER '${cleanUsername}'@'127.0.0.1' IDENTIFIED BY '${password}';`,
    `CREATE USER '${cleanUsername}'@'localhost' IDENTIFIED BY '${password}';`,
    `GRANT ALL PRIVILEGES ON ${dbIdentifier}.* TO '${cleanUsername}'@'127.0.0.1';`,
    `GRANT ALL PRIVILEGES ON ${dbIdentifier}.* TO '${cleanUsername}'@'localhost';`,
    'FLUSH PRIVILEGES;'
  ].join('\n');
  try {
    await runProcess(p.client, ['--protocol=tcp', '--host=127.0.0.1', `--port=${cfg.port}`, '--user=root', '--batch', '--skip-column-names'], {
      timeoutMs: QUERY_TIMEOUT_MS, env: { ...process.env, MYSQL_PWD: cfg.password }, input: sql
    });
  } catch (error) {
    // Never broaden privileges as a recovery path. If creation fails part-way, attempt to
    // remove only the newly requested account names so a partial user is not left behind.
    const cleanup = `DROP USER IF EXISTS '${cleanUsername}'@'127.0.0.1'; DROP USER IF EXISTS '${cleanUsername}'@'localhost';\n`;
    try { await runProcess(p.client, ['--protocol=tcp', '--host=127.0.0.1', `--port=${cfg.port}`, '--user=root', '--batch', '--skip-column-names'], { timeoutMs: QUERY_TIMEOUT_MS, env: { ...process.env, MYSQL_PWD: cfg.password }, input: cleanup }); } catch {}
    throw new Error(`Pengguna aplikasi gagal dibuat: ${error.message}`);
  }
  return {
    database: cleanDatabase, username: cleanUsername, password,
    host: '127.0.0.1', port: cfg.port,
    privileges: `Hak akses hanya pada database ${cleanDatabase}; tidak memiliki hak global.`,
    message: 'Akun aplikasi berhasil dibuat. Kata sandi hanya ditampilkan kali ini; simpan ke konfigurasi rahasia proyek.'
  };
}

function isSafeBackupFilename(filename) {
  return typeof filename === 'string' && /^sxl-backup-(?:all|db-[A-Za-z0-9_-]{1,64})-\d{8}T\d{9}Z\.sql$/.test(filename);
}

function validateDatabaseName(databaseName) {
  if (databaseName === undefined || databaseName === null || databaseName === '') return '';
  if (typeof databaseName !== 'string' || !/^[A-Za-z0-9_$-]{1,64}$/.test(databaseName)) {
    throw new Error('Nama database backup hanya boleh berisi huruf, angka, garis bawah, dan tanda hubung (maksimal 64 karakter).');
  }
  return databaseName;
}

const SYSTEM_DATABASES = new Set(['information_schema', 'performance_schema', 'mysql', 'sys']);
function isSystemDatabase(databaseName) { return typeof databaseName === 'string' && SYSTEM_DATABASES.has(databaseName.toLowerCase()); }

function getUserDatabases(databaseNames = []) {
  return [...new Set(databaseNames)]
    .filter(name => typeof name === 'string' && name && !isSystemDatabase(name));
}

function backupArgs(databaseName = '', databaseNames = []) {
  const cfg = getSettings();
  if (!cfg) throw new Error('MariaDB belum dipasang.');
  const p = getPaths();
  if (!p.dump) throw new Error('mariadb-dump tidak ditemukan. Pasang ulang MariaDB atau periksa instalasi database.');
  const args = [
    '--protocol=tcp', '--host=127.0.0.1', `--port=${cfg.port}`, '--user=root',
    '--single-transaction', '--routines', '--events', '--triggers', '--hex-blob',
    '--default-character-set=utf8mb4', '--skip-lock-tables'
  ];
  const clean = validateDatabaseName(databaseName);
  if (clean && isSystemDatabase(clean)) throw new Error('Backup database sistem MariaDB tidak diizinkan karena berisi akun dan hak akses internal.');
  if (clean) args.push('--databases', clean);
  else {
    const userDatabases = getUserDatabases(databaseNames);
    for (const name of userDatabases) validateDatabaseName(name);
    if (!userDatabases.length) throw new Error('Belum ada database pengguna untuk di-backup. Database sistem MariaDB tidak disertakan demi keamanan.');
    args.push('--databases', ...userDatabases);
  }
  return { command: p.dump, args, env: { ...process.env, MYSQL_PWD: cfg.password } };
}

async function assertBackupDoesNotRestoreSystemSchemas(filename) {
  // Old releases could create --all-databases dumps containing MariaDB's mysql schema.
  // Refuse these instead of risking overwriting local users or grants on restore.
  const stream = fs.createReadStream(filename, { encoding: 'utf8' });
  const readline = require('node:readline');
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!/^\s*(?:CREATE\s+DATABASE\b|USE\s+)/i.test(line)) continue;
      const normalized = line.replace(/\/\*![\s\S]*?\*\//g, ' ').trim();
      const createMatch = normalized.match(/^CREATE\s+DATABASE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|'([^']+)'|"([^"]+)"|([A-Za-z0-9_$-]+))/i);
      const useMatch = normalized.match(/^USE\s+(?:`([^`]+)`|'([^']+)'|"([^"]+)"|([A-Za-z0-9_$-]+))/i);
      const database = (createMatch && (createMatch[1] || createMatch[2] || createMatch[3] || createMatch[4])) || (useMatch && (useMatch[1] || useMatch[2] || useMatch[3] || useMatch[4]));
      if (database && SYSTEM_DATABASES.has(database.toLowerCase())) {
        throw new Error(`Backup berisi schema sistem MariaDB (${database}). Pemulihan dibatalkan agar akun dan hak akses database tidak tertimpa.`);
      }
    }
  } finally { lines.close(); stream.destroy(); }
}

function runToFile(command, args, destination, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: options.env || process.env });
    const out = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
    let stderr = '', settled = false;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) return reject(err);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      out.destroy();
      fs.rmSync(destination, { force: true });
      finish(new Error('Proses backup melebihi batas waktu 15 menit.'));
    }, INSTALL_TIMEOUT_MS);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.once('error', error => { out.destroy(); fs.rmSync(destination, { force: true }); finish(error); });
    child.stdout.pipe(out);
    out.once('error', error => { try { child.kill(); } catch {} fs.rmSync(destination, { force: true }); finish(error); });
    child.once('close', code => {
      if (code !== 0) {
        fs.rmSync(destination, { force: true });
        return finish(new Error((stderr || `Backup gagal (exit code ${code}).`).trim()));
      }
      finish(null, { stderr });
    });
  });
}

function runFromFile(command, args, sourcePath, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'], env: options.env || process.env });
    const input = fs.createReadStream(sourcePath);
    let stderr = '', settled = false;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.destroy();
      if (err) return reject(err);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(new Error('Proses pemulihan melebihi batas waktu 15 menit.'));
    }, INSTALL_TIMEOUT_MS);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.once('error', error => finish(error));
    input.once('error', error => { try { child.kill(); } catch {} finish(error); });
    input.pipe(child.stdin);
    child.stdin.on('error', error => { if (!settled) finish(error); });
    child.once('close', code => code === 0 ? finish(null, { stderr }) : finish(new Error((stderr || `Pemulihan gagal (exit code ${code}).`).trim())));
  });
}

async function listBackups() {
  const p = getPaths();
  await fs.promises.mkdir(p.backups, { recursive: true, mode: 0o700 });
  const entries = await fs.promises.readdir(p.backups, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isSafeBackupFilename(entry.name)) continue;
    const fullPath = path.join(p.backups, entry.name);
    const stat = await fs.promises.lstat(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    backups.push({ filename: entry.name, size: stat.size, createdAt: stat.mtime.toISOString() });
  }
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function createBackup({ database: databaseName = '' } = {}) {
  if (!status().running) throw new Error('Jalankan MariaDB terlebih dahulu sebelum membuat backup.');
  const clean = validateDatabaseName(databaseName);
  const p = getPaths();
  await fs.promises.mkdir(p.backups, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(p.backups, 0o700); } catch {}
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('.', '');
  const label = clean ? `db-${clean.replace(/[^A-Za-z0-9_-]/g, '_')}` : 'all';
  const filename = `sxl-backup-${label}-${stamp}.sql`;
  const fullPath = path.join(p.backups, filename);
  let databaseNames = [];
  if (clean) {
    if (isSystemDatabase(clean)) throw new Error('Backup database sistem MariaDB tidak diizinkan karena berisi akun dan hak akses internal.');
    const knownDatabases = await listDatabases();
    if (!knownDatabases.includes(clean)) throw new Error(`Database ${clean} tidak ditemukan.`);
    databaseNames = [clean];
  } else {
    databaseNames = getUserDatabases(await listDatabases());
  }
  if (!clean && databaseNames.length === 0) {
    // An empty but valid safety dump allows restore into a freshly initialized instance.
    await fs.promises.writeFile(fullPath, '-- SXL Localhost backup: no user databases existed at backup time.\n', { flag: 'wx', mode: 0o600 });
  } else {
    const spec = backupArgs(clean, databaseNames);
    await runToFile(spec.command, spec.args, fullPath, { env: spec.env });
  }
  const stat = await fs.promises.stat(fullPath);
  return { filename, size: stat.size, createdAt: stat.mtime.toISOString(), backupDirectory: p.backups, message: databaseNames.length ? 'Backup database pengguna berhasil dibuat; schema sistem tidak disertakan.' : 'Backup kosong berhasil dibuat karena belum ada database pengguna.' };
}

async function restoreBackup({ filename } = {}) {
  if (!status().running) throw new Error('Jalankan MariaDB terlebih dahulu sebelum memulihkan backup.');
  if (!isSafeBackupFilename(filename)) throw new Error('Nama file backup tidak valid. Pilih file dari daftar backup SXL.');
  const p = getPaths();
  const fullPath = path.resolve(p.backups, filename);
  if (path.dirname(fullPath) !== path.resolve(p.backups)) throw new Error('Path backup tidak valid.');
  const stat = await fs.promises.lstat(fullPath).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new Error('File backup tidak ditemukan atau tidak aman.');
  const listed = await listBackups();
  if (!listed.some(item => item.filename === filename)) throw new Error('File backup tidak terdaftar sebagai file backup SXL yang valid.');
  await assertBackupDoesNotRestoreSystemSchemas(fullPath);

  // Save current state before restoring; the safety copy remains available if restore fails.
  const safety = await createBackup();
  const cfg = getSettings();
  const p2 = getPaths();
  const result = await runFromFile(p2.client, [
    '--protocol=tcp', '--host=127.0.0.1', `--port=${cfg.port}`, '--user=root',
    '--default-character-set=utf8mb4', '--connect-timeout=5'
  ], fullPath, { env: { ...process.env, MYSQL_PWD: cfg.password } });
  return { message: 'Backup berhasil dipulihkan. Salinan kondisi sebelum pemulihan dibuat otomatis.', safetyBackup: safety.filename, warnings: result.stderr || '' };
}

function recordBootstrapFailure(error) {
  const message = error instanceof Error ? error.message : String(error || 'Penyebab tidak diketahui.');
  runtimeState.lastError = `Penyiapan otomatis database gagal: ${message}`.slice(0, 4000);
  return status();
}

async function shutdown() { try { await stop(); } catch {} }

module.exports = {
  status, versions, selectVersion, setPort, installVersionArchive, getBundledMariaDBArchivePath, install, start, stop, shutdown, query, credentials, createProjectUser, validateProjectUsername,
  enablePhpMyAdminRootNoPassword,
  getSettings, detectVersionFromBinary, recheckRuntimeVersion,
  translateIndonesianSql, splitSqlStatements, getPaths, readLog, listDatabases,
  createBackup, listBackups, restoreBackup, createDatabase, dropDatabase, isSafeBackupFilename, validateDatabaseName, backupArgs, getUserDatabases, isSystemDatabase, assertBackupDoesNotRestoreSystemSchemas,
  isPathWithinDirectory, recordBootstrapFailure
};
