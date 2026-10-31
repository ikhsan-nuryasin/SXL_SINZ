'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FIELDS = Object.freeze({
  apacheBinary: { label: 'Apache httpd', kind: 'file', basename: /^httpd(?:\.exe)?$/i },
  phpBinary: { label: 'PHP CLI', kind: 'file', basename: /^php(?:\.exe)?$/i },
  phpCgiBinary: { label: 'PHP-CGI', kind: 'file', basename: /^php-cgi(?:\.exe)?$/i },
  composerPhar: { label: 'Composer PHAR', kind: 'file', basename: /^composer\.phar$/i },
  nodeBinary: { label: 'Node.js', kind: 'file', basename: /^node(?:\.exe)?$/i },
  npmCli: { label: 'npm CLI', kind: 'file', basename: /^npm-cli\.js$/i },
  cloudflaredBinary: { label: 'Cloudflare Tunnel', kind: 'file', basename: /^cloudflared(?:\.exe)?$/i },
  phpMyAdminDir: { label: 'Folder phpMyAdmin', kind: 'directory', marker: 'index.php' },
  mariaDbBinDir: { label: 'Folder bin MariaDB', kind: 'directory', requiredGroups: [
    ['mariadbd.exe', 'mysqld.exe', 'mariadbd', 'mysqld'],
    ['mariadb-install-db.exe', 'mysql_install_db.exe', 'mariadb-install-db', 'mysql_install_db'],
    ['mariadb.exe', 'mysql.exe', 'mariadb', 'mysql'],
    ['mariadb-admin.exe', 'mysqladmin.exe', 'mariadb-admin', 'mysqladmin'],
    ['mariadb-dump.exe', 'mysqldump.exe', 'mariadb-dump', 'mysqldump']
  ] }
});

function dataRoot() {
  return process.env.SXL_DATA_DIR || process.env.SXL_APP_ROOT || path.resolve(__dirname, '..');
}
function settingsFile() { return path.join(dataRoot(), 'config', 'runtime-paths.json'); }
function blankPaths() { return Object.fromEntries(Object.keys(FIELDS).map(key => [key, ''])); }
function getRuntimePaths() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsFile(), 'utf8').replace(/^\uFEFF/, ''));
    return { ...blankPaths(), ...Object.fromEntries(Object.keys(FIELDS).map(key => [key, typeof value?.[key] === 'string' ? value[key] : ''])) };
  } catch { return blankPaths(); }
}
function existsAs(file, kind) {
  try { const stat = fs.statSync(file); return kind === 'directory' ? stat.isDirectory() : stat.isFile(); } catch { return false; }
}
function validateRuntimePath(field, input) {
  const spec = FIELDS[field];
  if (!spec) throw new Error(`Jenis runtime manual tidak dikenal: ${field}`);
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return '';
  if (!path.isAbsolute(raw)) throw new Error(`${spec.label}: masukkan path absolut, bukan path relatif.`);
  const resolved = path.resolve(raw);
  if (!existsAs(resolved, spec.kind)) throw new Error(`${spec.label}: path tidak ditemukan atau jenisnya salah: ${resolved}`);
  if (spec.basename && !spec.basename.test(path.basename(resolved))) {
    throw new Error(`${spec.label}: pilih file bernama ${spec.basename.source.replace(/[\\^$]/g, '').replace(/\(\?:/g, '(')}.`);
  }
  if (spec.marker && !existsAs(path.join(resolved, spec.marker), 'file')) {
    throw new Error(`${spec.label}: file ${spec.marker} tidak ditemukan pada folder tersebut.`);
  }
  if (spec.markerAny && !spec.markerAny.some(name => existsAs(path.join(resolved, name), 'file'))) {
    throw new Error(`${spec.label}: folder harus berisi salah satu executable server yang didukung.`);
  }
  if (spec.requiredGroups) {
    const missing = spec.requiredGroups.filter(group => !group.some(name => existsAs(path.join(resolved, name), 'file')));
    if (missing.length) throw new Error(`${spec.label}: folder belum lengkap. Wajib tersedia server, installer database, client, admin, dan dump (mariadbd/mysqld, mariadb-install-db/mysql_install_db, mariadb/mysql, mariadb-admin/mysqladmin, mariadb-dump/mysqldump).`);
  }
  return resolved;
}
function saveRuntimePaths(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Konfigurasi runtime harus berupa objek.');
  const next = getRuntimePaths();
  for (const key of Object.keys(FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) next[key] = validateRuntimePath(key, input[key]);
  }
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
  try { fs.chmodSync(temp, 0o600); } catch {}
  fs.renameSync(temp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
  return next;
}
function runtimePathStatus() {
  const paths = getRuntimePaths();
  const result = {};
  for (const [key, value] of Object.entries(paths)) {
    const spec = FIELDS[key];
    let valid = false;
    if (value) { try { validateRuntimePath(key, value); valid = true; } catch {} }
    result[key] = { path: value || '', configured: Boolean(value), exists: valid };
  }
  return { paths, status: result };
}

module.exports = { FIELDS, dataRoot, settingsFile, blankPaths, getRuntimePaths, saveRuntimePaths, validateRuntimePath, runtimePathStatus };
