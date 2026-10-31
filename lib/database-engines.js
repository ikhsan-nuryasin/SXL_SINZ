'use strict';

// First-party local managers for PostgreSQL and SQLite. These managers never adopt
// an arbitrary user data directory: PostgreSQL's cluster and all SQLite files live
// under the SXL data root. MariaDB remains managed by database.js.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { isTcpPortAvailable } = require('./port-utils');
const { WINDOWS_DPAPI, writeSettingsAtomic, decodeSettings, applyWindowsFileAcl, applyWindowsTreeAcl } = require('./secure-settings');

const execFileAsync = promisify(execFile);
const DEFAULT_PG_PORT = 5433;
const DEFAULT_PG_USER = 'sxl_admin';
const MAX_SQL_LENGTH = 128 * 1024;
const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/;

function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port harus berupa bilangan 1024–65535.');
  return port;
}

function validateDatabaseName(value) {
  const name = String(value || '').trim();
  if (!NAME_RE.test(name) || name.length > 63) throw new Error('Nama database hanya boleh memakai huruf, angka, garis bawah, dan tanda hubung; harus diawali huruf atau garis bawah.');
  return name;
}

function validateSql(value) {
  const sql = String(value ?? '').trim();
  if (!sql) throw new Error('Query SQL tidak boleh kosong.');
  if (Buffer.byteLength(sql, 'utf8') > MAX_SQL_LENGTH) throw new Error('Query SQL terlalu besar (maksimum 128 KiB).');
  if (sql.includes('\0')) throw new Error('Query SQL mengandung karakter NUL yang tidak valid.');
  return sql;
}

function resolveExecutable(binDir, baseName) {
  if (typeof binDir !== 'string' || !path.isAbsolute(binDir)) throw new Error('Masukkan jalur absolut folder binary database.');
  const resolvedDir = path.resolve(binDir);
  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) throw new Error(`Folder binary tidak ditemukan: ${resolvedDir}`);
  const candidates = process.platform === 'win32' ? [`${baseName}.exe`, baseName] : [baseName, `${baseName}.exe`];
  for (const candidate of candidates) {
    const full = path.join(resolvedDir, candidate);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile()) return full;
    } catch {}
  }
  throw new Error(`Executable ${baseName}${process.platform === 'win32' ? '.exe' : ''} tidak ditemukan di folder yang dipilih.`);
}

function within(parent, candidate) {
  const rel = path.relative(path.resolve(parent), path.resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function escapePgPass(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/[\r\n]/g, '');
}

class DatabaseEngineManager {
  constructor(dataRoot, options = {}) {
    this.dataRoot = path.resolve(dataRoot);
    this.platform = options.platform || process.platform;
    this.runCommand = options.runCommand || (async (command, args, runOptions = {}) => {
      const { stdout, stderr } = await execFileAsync(command, args, {
        windowsHide: true, timeout: runOptions.timeout || 30_000,
        maxBuffer: runOptions.maxBuffer || 8 * 1024 * 1024,
        cwd: runOptions.cwd || this.dataRoot,
        env: runOptions.env || process.env
      });
      return { stdout: String(stdout || ''), stderr: String(stderr || '') };
    });
    this.portAvailable = options.portAvailable || isTcpPortAvailable;
    this.settingsFile = path.join(this.dataRoot, 'config', 'database-engines.json');
    this.credentialsFile = path.join(this.dataRoot, 'config', 'postgresql-credentials.json');
    this.pgDataDir = path.join(this.dataRoot, 'data', 'database-engines', 'postgresql', 'default');
    this.pgLogDir = path.join(this.dataRoot, 'logs', 'database-engines');
    this.pgLogFile = path.join(this.pgLogDir, 'postgresql.log');
    this.pgTempDir = path.join(this.dataRoot, 'tmp', 'database-engines', 'postgresql');
    this.pgBackupDir = path.join(this.dataRoot, 'backups', 'database-engines', 'postgresql');
    this.sqliteDir = path.join(this.dataRoot, 'data', 'database-engines', 'sqlite');
  }

  readSettings() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
      return { schemaVersion: 1, ...raw };
    } catch (error) {
      if (error.code === 'ENOENT') return { schemaVersion: 1, postgresql: null, sqlite: null };
      throw new Error(`Konfigurasi database tambahan tidak dapat dibaca: ${error.message}`);
    }
  }

  writeSettings(settings) {
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    writeSettingsAtomic(this.settingsFile, settings, { platform: this.platform });
  }

  readCredentials() {
    try { return decodeSettings(JSON.parse(fs.readFileSync(this.credentialsFile, 'utf8')), { platform: this.platform }); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error(`Kredensial PostgreSQL tidak dapat dibaca: ${error.message}`);
    }
  }

  writeCredentials(password) {
    if (typeof password !== 'string' || password.length < 16 || password.length > 256) throw new Error('Kata sandi PostgreSQL harus memiliki 16–256 karakter.');
    fs.mkdirSync(path.dirname(this.credentialsFile), { recursive: true });
    writeSettingsAtomic(this.credentialsFile, { username: DEFAULT_PG_USER, password }, { platform: this.platform });
  }

  async configurePostgres(input = {}) {
    const settings = this.readSettings();
    const existing = settings.postgresql || {};
    if (existing.dataDir && path.resolve(existing.dataDir) !== path.resolve(this.pgDataDir)) throw new Error('Konfigurasi data PostgreSQL lama tidak cocok dengan direktori data SXL. Tidak diadopsi otomatis.');
    if (!settings.postgresql && fs.existsSync(this.pgDataDir) && fs.readdirSync(this.pgDataDir).length > 0) throw new Error('Direktori data PostgreSQL sudah berisi file tetapi belum tercatat sebagai instance SXL. Demi keamanan, direktori tersebut tidak diadopsi otomatis.');
    const binDir = path.resolve(String(input.binDir || ''));
    const executables = {};
    for (const name of ['postgres', 'initdb', 'pg_ctl', 'psql', 'pg_dump']) executables[name] = resolveExecutable(binDir, name);
    const versionOutput = await this.runCommand(executables.postgres, ['--version'], { timeout: 10_000, cwd: binDir });
    const versionText = `${versionOutput.stdout || ''}\n${versionOutput.stderr || ''}`.trim();
    const versionMatch = versionText.match(/PostgreSQL\)?\s+(\d+)(?:\.\d+)?/i);
    if (!versionMatch) throw new Error('Binary postgres ditemukan tetapi output --version tidak dapat diverifikasi sebagai PostgreSQL.');
    if (Number(versionMatch[1]) < 14) throw new Error(`PostgreSQL ${versionMatch[1]} belum didukung oleh manager ini. Gunakan PostgreSQL 14 atau lebih baru.`);
    const port = validatePort(input.port ?? DEFAULT_PG_PORT);
    if (settings.postgresql && fs.existsSync(path.join(this.pgDataDir, 'PG_VERSION'))) {
      const dataMajorText = fs.readFileSync(path.join(this.pgDataDir, 'PG_VERSION'), 'utf8').trim();
      const dataMajor = Number(dataMajorText.split('.')[0]);
      if (Number.isInteger(dataMajor) && dataMajor !== Number(versionMatch[1])) {
        throw new Error(`Cluster data PostgreSQL memakai major version ${dataMajor}, sedangkan binary yang dipilih major version ${versionMatch[1]}. Upgrade/downgrade major wajib melalui backup dan prosedur migrasi terpisah; binary/data tidak diubah.`);
      }
      const previousBinDir = path.resolve(String(settings.postgresql.binDir || ''));
      const previousPort = validatePort(settings.postgresql.port ?? DEFAULT_PG_PORT);
      const binaryOrPortChanging = previousBinDir !== binDir || previousPort !== port;
      if (binaryOrPortChanging) {
        let oldCfg;
        try { oldCfg = this.getPostgresConfig(); }
        catch (error) {
          throw new Error(`Tidak dapat memverifikasi status cluster memakai runtime sebelumnya (${error.message}). Untuk melindungi data, SXL tidak akan mengganti binary atau port sampai layanan lama dapat diperiksa dan dihentikan secara normal.`);
        }
        // Unknown status is an error; never interpret an unverifiable service as stopped.
        if (await this.isPostgresRunning(oldCfg)) {
          throw new Error('PostgreSQL sedang berjalan. Hentikan layanan secara normal sebelum mengubah binary atau port. Tidak ada proses yang dihentikan otomatis.');
        }
        if (previousPort !== port && !await this.portAvailable(port, '127.0.0.1')) {
          throw new Error(`Port ${port} sedang digunakan. Pilih port yang tersedia; konfigurasi PostgreSQL lama dipertahankan.`);
        }
      }
    }
    fs.mkdirSync(path.dirname(this.pgDataDir), { recursive: true });
    fs.mkdirSync(this.pgLogDir, { recursive: true });
    fs.mkdirSync(this.pgTempDir, { recursive: true });
    fs.mkdirSync(this.pgBackupDir, { recursive: true });
    const currentCredentials = this.readCredentials();
    if (!currentCredentials?.password) this.writeCredentials(crypto.randomBytes(32).toString('base64url'));
    else if (this.platform === 'win32' && currentCredentials._credentialProtection !== WINDOWS_DPAPI) this.writeCredentials(currentCredentials.password);
    settings.postgresql = { binDir, port, username: DEFAULT_PG_USER, versionVerified: versionText, dataDir: this.pgDataDir, logFile: this.pgLogFile, backupDir: this.pgBackupDir };
    this.writeSettings(settings);
    if (this.platform === 'win32') {
      for (const directory of [path.dirname(this.pgDataDir), this.pgLogDir, this.pgTempDir, this.pgBackupDir]) applyWindowsTreeAcl(directory);
    }
    return { ok: true, status: await this.postgresStatus(), executables };
  }

  getPostgresConfig() {
    const cfg = this.readSettings().postgresql;
    if (!cfg) throw new Error('PostgreSQL belum dikonfigurasi. Pilih folder binary PostgreSQL terlebih dahulu.');
    const out = { ...cfg, dataDir: this.pgDataDir, logFile: this.pgLogFile, backupDir: this.pgBackupDir };
    for (const name of ['postgres', 'initdb', 'pg_ctl', 'psql', 'pg_dump']) out[name] = resolveExecutable(out.binDir, name);
    out.port = validatePort(out.port);
    return out;
  }

  async postgresVersion(cfg) {
    try {
      const { stdout, stderr } = await this.runCommand(cfg.postgres, ['--version'], { timeout: 10_000, cwd: cfg.binDir });
      return `${stdout}\n${stderr}`.trim().slice(0, 300);
    } catch { return 'Belum dapat diverifikasi'; }
  }

  async isPostgresRunning(cfg) {
    try {
      await this.runCommand(cfg.pg_ctl, ['-D', cfg.dataDir, 'status'], { timeout: 10_000, cwd: cfg.binDir });
      return true;
    } catch (error) {
      const detail = String(`${error.message || ''} ${error.stderr || ''} ${error.stdout || ''}`).toLowerCase();
      if (/no server running|server is not running|could not open pid file|not running/.test(detail) || Number(error.code) === 3) return false;
      throw new Error(`Status PostgreSQL tidak dapat dipastikan dari pg_ctl: ${error.message || detail}`);
    }
  }

  async postgresStatus() {
    const settings = this.readSettings();
    if (!settings.postgresql) return { configured: false, installed: false, initialized: fs.existsSync(path.join(this.pgDataDir, 'PG_VERSION')), running: false, port: DEFAULT_PG_PORT, host: '127.0.0.1', message: 'Pilih folder binary PostgreSQL untuk mengaktifkan pengelola.' };
    let cfg;
    try { cfg = this.getPostgresConfig(); }
    catch (error) { return { configured: true, installed: false, initialized: fs.existsSync(path.join(this.pgDataDir, 'PG_VERSION')), running: false, port: settings.postgresql.port || DEFAULT_PG_PORT, host: '127.0.0.1', error: error.message }; }
    const initialized = fs.existsSync(path.join(cfg.dataDir, 'PG_VERSION'));
    const running = initialized ? await this.isPostgresRunning(cfg) : false;
    return { configured: true, installed: true, initialized, running, version: await this.postgresVersion(cfg), binDir: cfg.binDir, host: '127.0.0.1', port: cfg.port, username: cfg.username, dataDir: cfg.dataDir, logFile: cfg.logFile, backupDir: cfg.backupDir, passwordConfigured: Boolean(this.readCredentials()?.password), message: !initialized ? 'Binary tersedia; cluster PostgreSQL belum diinisialisasi.' : running ? 'PostgreSQL aktif di loopback.' : 'Cluster PostgreSQL siap tetapi layanan berhenti.' };
  }

  async initializePostgres() {
    const cfg = this.getPostgresConfig();
    if (fs.existsSync(path.join(cfg.dataDir, 'PG_VERSION'))) throw new Error('Cluster PostgreSQL sudah diinisialisasi. Data tidak diubah.');
    if (fs.existsSync(cfg.dataDir) && fs.readdirSync(cfg.dataDir).length > 0) throw new Error('Folder data PostgreSQL tidak kosong tetapi tidak memiliki PG_VERSION. Demi keamanan, inisialisasi ditolak; periksa atau pulihkan folder secara manual.');
    const credentials = this.readCredentials();
    if (!credentials?.password) throw new Error('Kredensial PostgreSQL belum tersedia; konfigurasi ulang runtime terlebih dahulu.');
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    fs.mkdirSync(this.pgTempDir, { recursive: true });
    const passwordFile = path.join(this.pgTempDir, `initdb-${process.pid}-${crypto.randomBytes(8).toString('hex')}.pw`);
    fs.writeFileSync(passwordFile, `${credentials.password}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try {
      if (this.platform === 'win32') { applyWindowsFileAcl(passwordFile); applyWindowsTreeAcl(path.dirname(cfg.dataDir)); }
      await this.runCommand(cfg.initdb, ['-D', cfg.dataDir, '-U', DEFAULT_PG_USER, `--pwfile=${passwordFile}`, '--auth=scram-sha-256', '--encoding=UTF8'], { timeout: 180_000, cwd: cfg.binDir, maxBuffer: 4 * 1024 * 1024 });
      if (!fs.existsSync(path.join(cfg.dataDir, 'PG_VERSION'))) throw new Error('initdb selesai tetapi file PG_VERSION tidak ditemukan. Periksa log dan direktori data.');
      return { ok: true, status: await this.postgresStatus() };
    } catch (error) {
      let recovery = '';
      // We checked that the target was absent/empty before initdb. If initdb left
      // a partial cluster, rename it beside the target instead of deleting it.
      try {
        if (fs.existsSync(cfg.dataDir) && fs.readdirSync(cfg.dataDir).length > 0 && !fs.existsSync(path.join(cfg.dataDir, 'PG_VERSION'))) {
          const recoveryDir = path.join(path.dirname(cfg.dataDir), `recovery-default-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`);
          fs.renameSync(cfg.dataDir, recoveryDir);
          recovery = ` Direktori parsial dipertahankan di: ${recoveryDir}`;
        }
      } catch (recoveryError) {
        recovery = ` Direktori parsial tidak dapat dipindahkan otomatis (${recoveryError.message}); isinya tetap dipertahankan di lokasi semula.`;
      }
      throw new Error(`Inisialisasi PostgreSQL gagal. Data parsial tidak dihapus.${recovery} ${error.message}`);
    } finally { try { fs.rmSync(passwordFile, { force: true }); } catch {} }
  }

  async startPostgres() {
    const cfg = this.getPostgresConfig();
    if (!fs.existsSync(path.join(cfg.dataDir, 'PG_VERSION'))) throw new Error('PostgreSQL belum diinisialisasi. Jalankan inisialisasi terlebih dahulu.');
    if (await this.isPostgresRunning(cfg)) return { ok: true, status: await this.postgresStatus(), alreadyRunning: true };
    if (!await this.portAvailable(cfg.port, '127.0.0.1')) throw new Error(`Port ${cfg.port} sedang digunakan. Pilih port lain; SXL tidak akan menghentikan proses lain.`);
    fs.mkdirSync(path.dirname(cfg.logFile), { recursive: true });
    await this.runCommand(cfg.pg_ctl, ['-D', cfg.dataDir, '-l', cfg.logFile, '-o', `-h 127.0.0.1 -p ${cfg.port} -c listen_addresses=127.0.0.1 -c password_encryption=scram-sha-256`, '-w', '-t', '30', 'start'], { timeout: 45_000, cwd: cfg.binDir, maxBuffer: 2 * 1024 * 1024 });
    if (!await this.isPostgresRunning(cfg)) throw new Error('pg_ctl tidak mengonfirmasi PostgreSQL aktif. Periksa log PostgreSQL.');
    return { ok: true, status: await this.postgresStatus() };
  }

  async stopPostgres() {
    const cfg = this.getPostgresConfig();
    if (!await this.isPostgresRunning(cfg)) return { ok: true, stopped: false, status: await this.postgresStatus() };
    await this.runCommand(cfg.pg_ctl, ['-D', cfg.dataDir, '-m', 'fast', '-w', '-t', '30', 'stop'], { timeout: 45_000, cwd: cfg.binDir, maxBuffer: 2 * 1024 * 1024 });
    if (await this.isPostgresRunning(cfg)) throw new Error('PostgreSQL masih terdeteksi berjalan setelah perintah shutdown normal.');
    return { ok: true, stopped: true, status: await this.postgresStatus() };
  }

  async withPgPass(callback) {
    const cfg = this.getPostgresConfig();
    const credentials = this.readCredentials();
    if (!credentials?.password) throw new Error('Kredensial PostgreSQL tidak tersedia.');
    fs.mkdirSync(this.pgTempDir, { recursive: true });
    const passFile = path.join(this.pgTempDir, `pgpass-${process.pid}-${crypto.randomBytes(8).toString('hex')}.conf`);
    const line = `127.0.0.1:${cfg.port}:*:${cfg.username}:${escapePgPass(credentials.password)}\n`;
    fs.writeFileSync(passFile, line, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try {
      if (this.platform === 'win32') applyWindowsFileAcl(passFile);
      const env = { ...process.env, PGPASSFILE: passFile, PGCONNECT_TIMEOUT: '5' };
      return await callback(cfg, env);
    } finally { try { fs.rmSync(passFile, { force: true }); } catch {} }
  }

  async queryPostgres(input = {}) {
    const sql = validateSql(input.sql);
    const db = validateDatabaseName(input.database || 'postgres');
    const cfg = this.getPostgresConfig();
    if (!await this.isPostgresRunning(cfg)) throw new Error('PostgreSQL belum berjalan. Jalankan layanan terlebih dahulu.');
    return this.withPgPass(async (current, env) => {
      const { stdout, stderr } = await this.runCommand(current.psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(current.port), '-U', current.username, '-d', db, '-A', '-F', '\t', '-P', 'footer=off', '-c', sql], { timeout: 60_000, cwd: current.binDir, env, maxBuffer: 8 * 1024 * 1024 });
      return { ok: true, database: db, output: stdout.trim(), notice: stderr.trim() };
    });
  }

  async listPostgresDatabases() {
    const result = await this.queryPostgres({ database: 'postgres', sql: 'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;' });
    return result.output.split(/\r?\n/).map(v => v.trim()).filter(v => Boolean(v) && v.toLowerCase() !== 'datname');
  }

  async createPostgresDatabase(input = {}) {
    const name = validateDatabaseName(input.name);
    const existing = await this.listPostgresDatabases();
    if (existing.includes(name)) throw new Error(`Database PostgreSQL “${name}” sudah ada; tidak ada data yang ditimpa.`);
    const quoted = `\"${name.replace(/\"/g, '\"\"')}\"`;
    const result = await this.queryPostgres({ database: 'postgres', sql: `CREATE DATABASE ${quoted};` });
    return { ok: true, database: name, message: `Database ${name} berhasil dibuat.`, output: result.output || `Database ${name} berhasil dibuat.` };
  }

  async backupPostgres(input = {}) {
    const databaseName = validateDatabaseName(input.database || 'postgres');
    const cfg = this.getPostgresConfig();
    if (!await this.isPostgresRunning(cfg)) throw new Error('PostgreSQL belum berjalan.');
    fs.mkdirSync(cfg.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const output = path.join(cfg.backupDir, `${databaseName}-${stamp}.dump`);
    return this.withPgPass(async (current, env) => {
      await this.runCommand(current.pg_dump, ['-Fc', '-h', '127.0.0.1', '-p', String(current.port), '-U', current.username, '-d', databaseName, '-f', output], { timeout: 180_000, cwd: current.binDir, env, maxBuffer: 4 * 1024 * 1024 });
      if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error('pg_dump tidak menghasilkan file backup yang valid.');
      return { ok: true, database: databaseName, backup: output, size: fs.statSync(output).size };
    });
  }

  async postgresCredentials() {
    const cfg = this.getPostgresConfig();
    const credentials = this.readCredentials();
    if (!credentials?.password) throw new Error('Password PostgreSQL belum tersedia.');
    return { ok: true, host: '127.0.0.1', port: cfg.port, username: cfg.username, password: credentials.password, dataDir: cfg.dataDir };
  }

  async configureSqlite(input = {}) {
    const executable = path.resolve(String(input.executable || ''));
    if (!path.isAbsolute(executable) || !fs.existsSync(executable) || !fs.statSync(executable).isFile()) throw new Error('Executable sqlite3 tidak ditemukan. Masukkan path ke file sqlite3.exe atau sqlite3.');
    if (!/^sqlite3(?:\.exe)?$/i.test(path.basename(executable))) throw new Error('Nama executable harus sqlite3.exe atau sqlite3; executable lain ditolak.');
    const versionResult = await this.runCommand(executable, ['--version'], { timeout: 10_000, cwd: path.dirname(executable) });
    const versionText = `${versionResult.stdout || ''}\n${versionResult.stderr || ''}`.trim();
    if (!/\b\d{1,3}\.\d+\.\d+\b/.test(versionText)) throw new Error('Executable sqlite3 tidak menghasilkan versi yang valid; path tidak disimpan.');
    const settings = this.readSettings();
    settings.sqlite = { executable, version: versionText.slice(0, 160) };
    this.writeSettings(settings);
    fs.mkdirSync(this.sqliteDir, { recursive: true });
    if (this.platform === 'win32') applyWindowsTreeAcl(this.sqliteDir);
    return { ok: true, status: this.sqliteStatus() };
  }

  sqliteStatus() {
    const configured = this.readSettings().sqlite;
    const executable = configured?.executable || null;
    let available = false;
    if (executable) { try { available = fs.existsSync(executable) && fs.statSync(executable).isFile(); } catch {} }
    fs.mkdirSync(this.sqliteDir, { recursive: true });
    const files = fs.readdirSync(this.sqliteDir, { withFileTypes: true }).filter(entry => entry.isFile() && /\.sqlite3?$/i.test(entry.name)).map(entry => entry.name).sort();
    return { configured: Boolean(executable), available, executable: available ? executable : null, version: available ? String(configured?.version || 'versi belum diverifikasi') : null, directory: this.sqliteDir, files };
  }

  getSqliteExecutable() {
    const status = this.sqliteStatus();
    if (!status.available) throw new Error('SQLite belum dikonfigurasi atau executable sqlite3 tidak ditemukan. Pilih binary sqlite3 yang tepercaya.');
    return status.executable;
  }

  resolveSqliteDatabase(name) {
    const safeName = validateDatabaseName(name);
    const file = path.join(this.sqliteDir, `${safeName}.sqlite3`);
    if (!within(this.sqliteDir, file)) throw new Error('Path database SQLite berada di luar direktori SXL.');
    return file;
  }

  async createSqlite(input = {}) {
    const name = validateDatabaseName(input.name);
    const executable = this.getSqliteExecutable();
    const file = this.resolveSqliteDatabase(name);
    if (fs.existsSync(file)) throw new Error('File database SQLite sudah ada. Pilih nama lain; file lama tidak akan ditimpa.');
    fs.mkdirSync(this.sqliteDir, { recursive: true });
    try {
      await this.runCommand(executable, ['-batch', file, 'PRAGMA user_version;'], { timeout: 20_000, cwd: this.sqliteDir, maxBuffer: 1024 * 1024 });
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('SQLite tidak membuat file database.');
      return { ok: true, name, file, status: this.sqliteStatus() };
    } catch (error) {
      // Preserve any file created by sqlite3 for inspection; never delete an uncertain DB.
      throw new Error(`Pembuatan database SQLite gagal; file yang mungkin telah dibuat tetap dipertahankan untuk pemeriksaan. ${error.message}`);
    }
  }

  async querySqlite(input = {}) {
    const name = validateDatabaseName(input.database);
    const sql = validateSql(input.sql);
    const executable = this.getSqliteExecutable();
    const file = this.resolveSqliteDatabase(name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('Database SQLite tidak ditemukan pada direktori data SXL.');
    const { stdout, stderr } = await this.runCommand(executable, ['-batch', '-json', file, sql], { timeout: 60_000, cwd: this.sqliteDir, maxBuffer: 8 * 1024 * 1024 });
    let rows = null;
    try { rows = stdout.trim() ? JSON.parse(stdout) : []; } catch {}
    return { ok: true, database: name, output: stdout.trim(), rows, notice: stderr.trim() };
  }

  async backupSqlite(input = {}) {
    const name = validateDatabaseName(input.database);
    const executable = this.getSqliteExecutable();
    const source = this.resolveSqliteDatabase(name);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('Database SQLite tidak ditemukan.');
    const backupDir = path.join(this.dataRoot, 'backups', 'database-engines', 'sqlite');
    fs.mkdirSync(backupDir, { recursive: true });
    if (this.platform === 'win32') applyWindowsTreeAcl(backupDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(backupDir, `${name}-${stamp}.sqlite3`);
    const sqliteQuote = value => `"${String(value).replace(/\\/g, '/').replace(/"/g, '""')}"`;
    try {
      await this.runCommand(executable, ['-batch', source, `.backup ${sqliteQuote(dest)}`], { timeout: 180_000, cwd: this.sqliteDir, maxBuffer: 2 * 1024 * 1024 });
      if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) throw new Error('SQLite tidak menghasilkan file backup yang valid.');
      return { ok: true, database: name, backup: dest, size: fs.statSync(dest).size };
    } catch (error) {
      throw new Error(`Backup SQLite gagal. File sumber tidak diubah. ${error.message}`);
    }
  }
}

module.exports = { DatabaseEngineManager, validatePort, validateDatabaseName, validateSql, resolveExecutable, within, escapePgPass, DEFAULT_PG_PORT, DEFAULT_PG_USER, MAX_SQL_LENGTH };
