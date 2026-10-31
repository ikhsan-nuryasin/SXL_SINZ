'use strict';

// SXL local development stack manager. Admin APIs call this module only from
// loopback; Apache, project servers and phpMyAdmin bind to loopback by default.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { openFolder } = require('./lib/open-folder');
const execFileAsync = promisify(execFile);
const database = require('./database');
const runtimeInstaller = require('./lib/runtime-installer');
const runtimePaths = require('./lib/runtime-paths');
const phpVersions = require('./lib/php-versions');
const projectSettingsStore = require('./lib/project-settings');
const downloadCenter = require('./lib/download-center');
const githubPublisher = require('./lib/github-publish').createGitHubPublisher();

const APP_ROOT = process.env.SXL_APP_ROOT || __dirname;
const DATA_ROOT = process.env.SXL_DATA_DIR || APP_ROOT;
const RUNTIME_ROOT = path.join(DATA_ROOT, 'runtime');
const WWW_ROOT = path.join(DATA_ROOT, 'www');
const CONFIG_ROOT = path.join(DATA_ROOT, 'config');
const APACHE_ROOT = path.join(RUNTIME_ROOT, 'apache');
const APACHE_PORT_DEFAULT = Number(process.env.SXL_APACHE_PORT || 8080);
const PMA_VERSION = '5.2.3';
const PMA_FILENAME = `phpMyAdmin-${PMA_VERSION}-all-languages.zip`;
const PMA_URL = `https://files.phpmyadmin.net/phpMyAdmin/${PMA_VERSION}/${PMA_FILENAME}`;
const COMPOSER_URL = 'https://getcomposer.org/download/latest-stable/composer.phar';
const COMPOSER_SHA_URL = `${COMPOSER_URL}.sha256sum`;
const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;
const APACHE_MANIFEST_BASE = 'https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/a/ApacheLounge/httpd';

const state = {
  apache: { process: null, config: null, port: APACHE_PORT_DEFAULT, log: '', lastError: null, startedAt: null },
  phpMyAdmin: { process: null, port: 8081, log: '', lastError: null, startedAt: null },
  projects: new Map()
};
const activeProjectCreations = new Set();
const activeManagedInstalls = new Set();
let laravelMetadataCache = { expiresAt: 0, value: null };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.xml': 'application/xml; charset=utf-8', '.webmanifest': 'application/manifest+json'
};
const PRIVATE_NAMES = new Set([
  '.env', '.git', '.svn', '.hg', '.idea', '.vscode', 'node_modules', 'vendor', 'composer.json', 'composer.lock',
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'settings.json', 'credentials.json', 'secrets.json',
  'config.php', 'database.php', 'db.php', 'connect.php', 'connection.php', 'wp-config.php', 'phpinfo.php', 'install.php',
  'setup.php', 'database.sql', 'dump.sql', 'backup.sql'
]);
const PRIVATE_EXTENSIONS = new Set(['.php', '.phtml', '.phar', '.sql', '.sqlite', '.sqlite3', '.db', '.bak', '.backup', '.log', '.pem', '.key', '.p12', '.pfx', '.ini', '.conf', '.ps1', '.bat', '.cmd', '.sh', '.swp', '.swo']);

function ensureFolders() {
  fs.mkdirSync(WWW_ROOT, { recursive: true });
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
  fs.mkdirSync(CONFIG_ROOT, { recursive: true });
}
function slugProjectName(value) {
  if (typeof value !== 'string') throw new Error('Nama proyek harus berupa teks.');
  const slug = value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) throw new Error('Nama proyek harus 2–40 karakter dan hanya berisi huruf kecil, angka, atau tanda hubung.');
  if (['api', 'admin', 'phpmyadmin', 'www', 'runtime', 'config'].includes(slug)) throw new Error('Nama tersebut dicadangkan oleh SXL.');
  return slug;
}
function projectDirectory(slug) {
  const safe = slugProjectName(slug);
  const target = path.resolve(WWW_ROOT, safe);
  if (path.dirname(target) !== path.resolve(WWW_ROOT)) throw new Error('Folder proyek keluar dari workspace SXL.');
  return target;
}
function readProjectManifest(folder) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(folder, 'sxl-project.json'), 'utf8'));
    if (parsed && ['static', 'php', 'node'].includes(parsed.type)) return parsed;
  } catch {}
  // Discover existing projects placed in the SXL workspace, even if they were
  // not originally created by SXL. Detection is read-only: it never writes a manifest.
  let entries;
  try { entries = new Set(fs.readdirSync(folder)); } catch { return null; }
  let packageJson = null;
  try { packageJson = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')); } catch {}
  let type = null;
  if (entries.has('artisan') || entries.has('composer.json') || entries.has('index.php')) type = 'php';
  else if (packageJson && (packageJson.scripts?.start || entries.has('app.js') || entries.has('server.js'))) type = 'node';
  else if (entries.has('index.html')) type = 'static';
  if (!type) return null;
  const slug = path.basename(folder);
  let name = slug;
  if (packageJson && typeof packageJson.name === 'string' && packageJson.name.trim()) name = packageJson.name.trim().slice(0, 80);
  return { name, slug, type, createdAt: null, version: 1, discovered: true };
}
function listProjects() {
  ensureFolders();
  const items = [];
  for (const entry of fs.readdirSync(WWW_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(entry.name)) continue;
    const folder = path.join(WWW_ROOT, entry.name);
    const manifest = readProjectManifest(folder);
    if (!manifest) continue;
    const active = state.projects.get(entry.name);
    const projectSettings = manifest.type === 'php' ? projectSettingsStore.getProjectSettings(entry.name) : null;
    items.push({
      slug: entry.name, name: manifest.name || entry.name, type: manifest.type,
      framework: manifest.framework || null, frameworkVersion: manifest.frameworkVersion || null,
      database: manifest.database || null,
      createdAt: manifest.createdAt || null, path: folder, composerAvailable: fs.existsSync(path.join(folder, 'composer.json')),
      phpBinary: projectSettings?.phpBinary || '', phpCgiBinary: projectSettings?.phpCgiBinary || '',
      phpVersion: active?.phpVersion || null, phpVersionError: active?.lastError || null,
      running: Boolean(active && (active.server || (active.process && active.process.exitCode === null))),
      port: active?.port || null, url: active?.url || null, log: active?.log?.slice(-1200) || ''
    });
  }
  return items.sort((a, b) => a.slug.localeCompare(b.slug));
}
function createProject({ name, type = 'static' } = {}) {
  ensureFolders();
  const slug = slugProjectName(name);
  if (!['static', 'php', 'node'].includes(type)) throw new Error('Jenis proyek harus static, php, atau node.');
  const folder = projectDirectory(slug);
  if (fs.existsSync(folder)) throw new Error(`Folder proyek ${slug} sudah ada.`);
  fs.mkdirSync(folder, { recursive: true });
  const title = String(name).trim().replace(/[<>]/g, '').slice(0, 80) || slug;
  const manifest = { name: title, slug, type, createdAt: new Date().toISOString(), version: 1 };
  fs.writeFileSync(path.join(folder, 'sxl-project.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  if (type === 'static') {
    fs.writeFileSync(path.join(folder, 'index.html'), `<!doctype html>\n<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px system-ui;max-width:760px;margin:12vh auto;padding:24px;color:#1f2937}code{background:#f2f4f7;padding:3px 6px;border-radius:6px}</style></head><body><h1>${escapeHtml(title)}</h1><p>Proyek ini dibuat oleh SXL Localhost.</p><p>Edit file <code>index.html</code> untuk mulai.</p></body></html>\n`, { mode: 0o600 });
  } else if (type === 'php') {
    fs.writeFileSync(path.join(folder, 'index.php'), `<?php\n$title = ${JSON.stringify(title)};\necho '<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</title><body style="font:16px system-ui;max-width:760px;margin:12vh auto;padding:24px"><h1>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h1><p>Proyek PHP lokal SXL Localhost berhasil berjalan.</p><p>Mulai edit <code>index.php</code>.</p></body></html>';\n`, { mode: 0o600 });
  } else {
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: slug, version: '1.0.0', private: true, scripts: { start: 'node app.js' } }, null, 2), { mode: 0o600 });
    fs.writeFileSync(path.join(folder, 'app.js'), `const http = require('node:http');\nconst host = process.env.HOST || '127.0.0.1';\nconst port = Number(process.env.PORT || 3000);\nhttp.createServer((_req, res) => { res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end('<!doctype html><html lang="id"><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="font:16px system-ui;max-width:760px;margin:12vh auto;padding:24px"><h1>${escapeHtml(title)}</h1><p>Node.js project from SXL Localhost.</p></body></html>'); }).listen(port, host, () => console.log('Listening on http://' + host + ':' + port));\n`, { mode: 0o600 });
  }
  return { message: `Proyek ${slug} berhasil dibuat.`, project: { slug, name: title, type, path: folder, running: false } };
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '', done = false;
    const limit = options.maxBuffer || 2 * 1024 * 1024;
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, options.timeoutMs || 10 * 60 * 1000);
    const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolve(result); };
    child.stdout?.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-limit); });
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-limit); });
    child.once('error', error => finish(error));
    child.once('close', code => code === 0 ? finish(null, { stdout, stderr }) : finish(new Error((stderr || stdout || `${command} keluar dengan kode ${code}`).trim())));
  });
}
function findOnPath(command) {
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const suffix = extension && !command.toLowerCase().endsWith(extension.toLowerCase()) ? extension : '';
      const candidate = path.join(dir, `${command}${suffix}`);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
    }
  }
  return null;
}
function apacheCandidates() {
  const configured = runtimePaths.getRuntimePaths();
  const user = configured.apacheBinary || process.env.SXL_APACHE_PATH;
  const candidates = [
    user,
    path.join(APACHE_ROOT, 'Apache24', 'bin', process.platform === 'win32' ? 'httpd.exe' : 'httpd'),
    path.join(APACHE_ROOT, 'bin', process.platform === 'win32' ? 'httpd.exe' : 'httpd'),
    ...(process.platform === 'win32' ? [
      'C:/Apache24/bin/httpd.exe', 'C:/tools/Apache24/bin/httpd.exe', 'C:/xampp/apache/bin/httpd.exe',
      path.join(process.env.ProgramFiles || 'C:/Program Files', 'Apache Group/Apache2/bin/httpd.exe')
    ] : [
      '/opt/homebrew/opt/httpd/bin/httpd', '/usr/local/opt/httpd/bin/httpd',
      '/opt/homebrew/bin/httpd', '/usr/local/bin/httpd', '/usr/sbin/httpd'
    ]),
    findOnPath('httpd')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}
function apachePaths(binary = apacheCandidates()) {
  if (!binary) return null;
  const binDir = path.dirname(binary);
  const root = path.basename(binDir).toLowerCase() === 'bin' ? path.dirname(binDir) : path.dirname(binary);
  const configs = [path.join(root, 'conf', 'httpd.conf')];
  if (process.platform === 'darwin') configs.push('/opt/homebrew/etc/httpd/httpd.conf', '/usr/local/etc/httpd/httpd.conf');
  if (process.platform === 'win32') configs.push(path.join(root, 'conf', 'httpd.conf'));
  return { binary, root, baseConfig: configs.find(file => fs.existsSync(file)) || null };
}
function isApacheRunning() { return Boolean(state.apache.process && state.apache.process.exitCode === null); }
function isPmaRunning() { return Boolean(state.phpMyAdmin.process && state.phpMyAdmin.process.exitCode === null); }
async function canConnect(port, timeoutMs = 350) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    const done = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs); socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}
async function choosePort(start = 8080) {
  for (let port = start; port < start + 60; port++) if (!(await canConnect(port))) return port;
  throw new Error(`Tidak ada port tersedia pada rentang ${start}–${start + 59}.`);
}
function apacheConfigEscape(value) { return path.resolve(value).replace(/\\/g, '/').replace(/"/g, '\\"'); }
function activePhpProjectRecords() {
  // Keep the virtual host configured while PHP-CGI is recovering. The worker
  // can briefly be null during supervised restart; removing the vhost during
  // that window would leave it missing after an unrelated Apache restart.
  return listProjects()
    .filter(project => project.type === 'php')
    .map(project => ({ project, entry: state.projects.get(project.slug) }))
    .filter(({ entry }) => Boolean(entry && entry.fcgiPort && !entry.stopping));
}
function projectDocumentRoot(project) {
  const publicDirectory = path.join(project.path, 'public');
  if (fs.existsSync(path.join(project.path, 'artisan')) && fs.existsSync(path.join(publicDirectory, 'index.php'))) return publicDirectory;
  return project.path;
}
function apacheModulePath(install, moduleName) {
  const moduleStem = moduleName.replace(/_module$/, '');
  const filename = `mod_${moduleStem}.so`;
  const candidates = [
    path.join(install.root, 'modules', filename),
    path.join(install.root, 'lib', 'httpd', 'modules', filename),
    path.join(path.dirname(install.binary), '..', 'lib', 'httpd', 'modules', filename),
    ...(process.platform === 'darwin' ? [
      `/opt/homebrew/opt/httpd/lib/httpd/modules/${filename}`,
      `/usr/local/opt/httpd/lib/httpd/modules/${filename}`
    ] : [])
  ].map(candidate => path.resolve(candidate));
  return candidates.find(candidate => { try { return fs.statSync(candidate).isFile(); } catch { return false; } }) || null;
}
function ensureApacheModules(conf, install, moduleNames) {
  const lines = moduleNames.map(name => {
    const modulePath = apacheModulePath(install, name);
    if (!modulePath) throw new Error(`Modul Apache mod_${name}.so tidak ditemukan. Pastikan paket Apache lengkap menyertakan modul ${name}.`);
    return `LoadModule ${name} "${apacheConfigEscape(modulePath)}"`;
  });
  const namesPattern = moduleNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const removeRequired = new RegExp(`^[\\t ]*#?[\\t ]*LoadModule[\\t ]+(?:${namesPattern})\\b[^\\r\\n]*(?:\\r?\\n)?`, 'gmi');
  conf = conf.replace(removeRequired, '');
  const serverRootPattern = /^[ \t]*ServerRoot[ \t]+[^\r\n]*(?:\r?\n|$)/mi;
  const match = conf.match(serverRootPattern);
  if (!match) throw new Error('Direktif ServerRoot tidak ditemukan di konfigurasi Apache.');
  return conf.replace(serverRootPattern, `${match[0]}\n# SXL required modules for PHP FastCGI\n${lines.join('\n')}\n`);
}
function renderPhpProjectVhost(project, port, fcgiPort) {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(project.slug)) throw new Error('Slug virtual host tidak valid.');
  if (!Number.isInteger(Number(fcgiPort)) || Number(fcgiPort) < 1 || Number(fcgiPort) > 65535) throw new Error('Port FastCGI tidak valid.');
  const root = apacheConfigEscape(projectDocumentRoot(project));
  return `\n# SXL managed PHP FastCGI virtual host: ${project.slug}\n<VirtualHost 127.0.0.1:${port}>\n    ServerName ${project.slug}.localhost\n    DocumentRoot "${root}"\n    DirectoryIndex index.php index.html\n    ProxyRequests Off\n    ProxyFCGIBackendType GENERIC\n    <Directory "${root}">\n        Options -Indexes +SymLinksIfOwnerMatch\n        AllowOverride FileInfo Options=Indexes,MultiViews\n        Require all granted\n    </Directory>\n    <FilesMatch "(?i)\\.php$">\n        SetHandler "proxy:fcgi://127.0.0.1:${Number(fcgiPort)}"\n    </FilesMatch>\n    <FilesMatch "(?i)^(config|database|db|connect|connection|credentials|secrets|wp-config|install|setup|phpinfo)\\.php$">\n        Require all denied\n    </FilesMatch>\n    <FilesMatch "(?i)^(composer\\.(json|lock)|package(-lock)?\\.json|pnpm-lock\\.yaml|yarn\\.lock|artisan|phpunit\\.xml(\\.dist)?)$">\n        Require all denied\n    </FilesMatch>\n    <FilesMatch "(?i)\\.(php[0-9]+|phtml|phar|sql|sqlite|sqlite3|db|bak|backup|log|pem|key|p12|pfx|ini|conf|ps1|bat|cmd|sh)$">\n        Require all denied\n    </FilesMatch>\n    <FilesMatch "(?i)^\\.">\n        Require all denied\n    </FilesMatch>\n</VirtualHost>\n`;
}

function projectVirtualHosts(port) {
  const projects = listProjects();
  const workspace = apacheConfigEscape(WWW_ROOT);
  const defaultVhost = `\n# SXL default virtual host: deny execution/source exposure for unknown hosts\n<VirtualHost 127.0.0.1:${port}>\n    ServerName sxl.localhost\n    DocumentRoot "${workspace}"\n    DirectoryIndex index.html\n    <Directory "${workspace}">\n        Options -Indexes -FollowSymLinks -SymLinksIfOwnerMatch\n        AllowOverride None\n        Require all denied\n    </Directory>\n    <FilesMatch "(?i)\\.(php[0-9]*|phtml|phar|sql|sqlite|sqlite3|db|bak|backup|log|pem|key|p12|pfx|ini|conf|ps1|bat|cmd|sh)$">\n        Require all denied\n    </FilesMatch>\n    <FilesMatch "(?i)^\\.">\n        Require all denied\n    </FilesMatch>\n</VirtualHost>\n`;

  const staticVhosts = projects.filter(project => project.type === 'static').map(project => {
    const root = apacheConfigEscape(project.path);
    return `\n# SXL managed static virtual host: ${project.slug}\n<VirtualHost 127.0.0.1:${port}>\n    ServerName ${project.slug}.localhost\n    DocumentRoot "${root}"\n    DirectoryIndex index.html\n    <Directory "${root}">\n        Options -Indexes -FollowSymLinks -SymLinksIfOwnerMatch\n        AllowOverride None\n        Require all granted\n    </Directory>\n    <FilesMatch "(?i)\\.(php[0-9]*|phtml|phar|sql|sqlite|sqlite3|db|bak|backup|log|pem|key|p12|pfx|ini|conf|ps1|bat|cmd|sh)$">\n        Require all denied\n    </FilesMatch>\n    <FilesMatch "(?i)^\\.">\n        Require all denied\n    </FilesMatch>\n</VirtualHost>\n`;
  }).join('\n');

  const phpVhosts = activePhpProjectRecords().map(({ project, entry }) => renderPhpProjectVhost(project, port, entry.fcgiPort)).join('\n');

  return `${defaultVhost}\n${staticVhosts}\n${phpVhosts}`;
}
function buildApacheConfig(install, port) {
  if (!install?.baseConfig || !fs.existsSync(install.baseConfig)) throw new Error('File conf/httpd.conf Apache tidak ditemukan. Periksa instalasi Apache.');
  const workspace = apacheConfigEscape(WWW_ROOT);
  let conf = fs.readFileSync(install.baseConfig, 'utf8');
  if (process.platform === 'win32') {
    const serverRoot = apacheConfigEscape(install.root);
    conf = conf.replace(/^\s*Define\s+SRVROOT\s+.+$/mi, `Define SRVROOT "${serverRoot}"`);
    conf = conf.replace(/^\s*ServerRoot\s+.+$/mi, 'ServerRoot "${SRVROOT}"');
  }
  const phpProjects = activePhpProjectRecords();
  if (phpProjects.length) conf = ensureApacheModules(conf, install, ['dir_module', 'proxy_module', 'proxy_fcgi_module', 'rewrite_module']);

  let listenDone = false;
  conf = conf.replace(/^\s*Listen\s+.*$/gmi, () => {
    if (listenDone) return '';
    listenDone = true;
    return `Listen 127.0.0.1:${port}`;
  });
  if (!listenDone) conf = `Listen 127.0.0.1:${port}\n` + conf;
  const oldDocMatch = conf.match(/^\s*DocumentRoot\s+"?([^"\r\n]+?)"?\s*$/mi);
  if (oldDocMatch) {
    const oldRoot = oldDocMatch[1].trim();
    conf = conf.replace(/^\s*DocumentRoot\s+.*$/mi, `DocumentRoot "${workspace}"`);
    const oldDir = `<Directory "${oldRoot}">`;
    const newDir = `<Directory "${workspace}">`;
    conf = conf.replace(oldDir, newDir);
    const dirStart = conf.indexOf(newDir);
    const dirEnd = dirStart < 0 ? -1 : conf.indexOf('</Directory>', dirStart);
    if (dirStart >= 0 && dirEnd >= 0) {
      const hardenedDirectory = `${newDir}\n    Options -Indexes -FollowSymLinks -SymLinksIfOwnerMatch\n    AllowOverride None\n    Require all denied\n</Directory>`;
      conf = conf.slice(0, dirStart) + hardenedDirectory + conf.slice(dirEnd + '</Directory>'.length);
    }
  } else {
    conf += `\nDocumentRoot "${workspace}"\n<Directory "${workspace}">\n    Options -Indexes -FollowSymLinks -SymLinksIfOwnerMatch\n    AllowOverride None\n    Require all denied\n</Directory>\n`;
  }
  if (/^\s*ServerName\s+/mi.test(conf)) conf = conf.replace(/^\s*ServerName\s+.*$/mi, `ServerName 127.0.0.1:${port}`);
  else conf += `\nServerName 127.0.0.1:${port}\n`;
  // Only vhosts that do not execute PHP have source-code denials. PHP vhosts
  // explicitly route .php scripts through their loopback-only FastCGI worker.
  conf += `\n# SXL hardening\nServerTokens Prod\nServerSignature Off\n<DirectoryMatch \"(?i)/(?:node_modules|vendor|\\.git|\\.svn|\\.hg)(?:/|$)\">\n    Require all denied\n</DirectoryMatch>\n`;
  conf += projectVirtualHosts(port);
  const configFile = path.join(CONFIG_ROOT, 'apache', 'httpd.conf');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, conf, { mode: 0o600 });
  return configFile;
}

function isAllowedHttpsUrl(value, allowedHosts) {
  if (!Array.isArray(allowedHosts) || !allowedHosts.length) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && allowedHosts.map(host => String(host).toLowerCase()).includes(parsed.hostname.toLowerCase());
  } catch { return false; }
}
async function fetchBuffer(url, maxBytes = MAX_ARCHIVE_BYTES, allowedHosts = []) {
  if (!Array.isArray(allowedHosts) || !allowedHosts.length) throw new Error('Daftar host unduhan tepercaya wajib ditentukan.');
  const requested = new URL(url);
  if (!isAllowedHttpsUrl(requested.href, allowedHosts)) {
    throw new Error('SXL menolak URL unduhan yang tidak masuk allowlist.');
  }
  const response = await fetch(requested, { signal: AbortSignal.timeout(10 * 60 * 1000), redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Unduhan gagal (HTTP ${response.status}).`);
  const finalUrl = new URL(response.url);
  if (!isAllowedHttpsUrl(finalUrl.href, allowedHosts)) {
    await response.body.cancel().catch(() => {});
    throw new Error('SXL menolak pengalihan unduhan ke host yang tidak diizinkan.');
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > maxBytes) {
    await response.body.cancel().catch(() => {});
    throw new Error(`Arsip terlalu besar (maksimum ${Math.round(maxBytes / 1024 / 1024)} MB).`);
  }
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Arsip terlalu besar (maksimum ${Math.round(maxBytes / 1024 / 1024)} MB).`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}
function verifySha256(bytes, expected) {
  if (!/^[a-f0-9]{64}$/i.test(String(expected || ''))) return false;
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(actual.toLowerCase(), 'hex'), Buffer.from(String(expected).toLowerCase(), 'hex'));
}
function parseApacheManifestSha256(yaml, selectedUrl) {
  const selected = new URL(selectedUrl);
  const version = (selected.pathname.match(/httpd-(\d+\.\d+\.\d+)-[^/]*win64-vs\d+\.zip$/i) || [])[1];
  if (!version) throw new Error('Nama arsip Apache tidak mengikuti format rilis yang dikenali.');
  const declaredVersion = (String(yaml).match(/^PackageVersion:\s*([^\s#]+)/m) || [])[1];
  if (declaredVersion !== version) throw new Error(`Versi Apache pada manifest (${declaredVersion || 'tidak ada'}) tidak sama dengan arsip (${version}).`);
  const blocks = String(yaml).split(/(?=^\s*- Architecture:)/m);
  const block = blocks.find(item => /^\s*- Architecture:\s*x64\s*$/m.test(item));
  const manifestUrlText = block && (block.match(/^\s*InstallerUrl:\s*(\S+)\s*$/m) || [])[1];
  const expected = block && (block.match(/^\s*InstallerSha256:\s*([a-f0-9]{64})\s*$/im) || [])[1];
  if (!manifestUrlText || !expected) throw new Error('Manifest Apache tidak memiliki URL dan SHA-256 x64. Instalasi dibatalkan.');
  const manifestUrl = new URL(manifestUrlText);
  if (manifestUrl.protocol !== 'https:' || !['www.apachelounge.com', 'apachelounge.com'].includes(manifestUrl.hostname.toLowerCase()) || manifestUrl.pathname.toLowerCase() !== selected.pathname.toLowerCase()) {
    throw new Error('URL arsip Apache tidak cocok dengan manifest verifikasi independen. Instalasi dibatalkan.');
  }
  return expected.toLowerCase();
}
async function expectedApacheSha256(selectedUrl) {
  const selected = new URL(selectedUrl);
  const version = (selected.pathname.match(/httpd-(\d+\.\d+\.\d+)-[^/]*win64-vs\d+\.zip$/i) || [])[1];
  if (!version) throw new Error('Versi rilis Apache tidak dapat dibaca dari URL.');
  const manifestUrl = `${APACHE_MANIFEST_BASE}/${version}/ApacheLounge.httpd.installer.yaml`;
  const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) throw new Error(`Manifest checksum Apache tidak tersedia (HTTP ${response.status}). Instalasi ditolak; coba lagi setelah manifest rilis tersedia.`);
  const manifestHost = new URL(response.url).hostname.toLowerCase();
  if (manifestHost !== 'raw.githubusercontent.com') throw new Error('Host manifest Apache tidak tepercaya.');
  return parseApacheManifestSha256(await response.text(), selected.href);
}
async function extractZip(archive, destination) {
  fs.mkdirSync(destination, { recursive: true });
  if (process.platform === 'win32') {
    const escapedArchive = archive.replace(/'/g, "''"), escapedDest = destination.replace(/'/g, "''");
    await runCommand(process.env.SXL_POWERSHELL_PATH || 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDest}' -Force`], { timeoutMs: 5 * 60 * 1000 });
  } else {
    await runCommand('unzip', ['-q', archive, '-d', destination], { timeoutMs: 5 * 60 * 1000 });
  }
}
async function installApache() {
  ensureFolders();
  const knownApache = apachePaths();
  if (knownApache?.baseConfig) return { message: 'Apache sudah terdeteksi dan konfigurasi dasarnya tersedia.', status: apacheStatus() };
  if (knownApache && !knownApache.baseConfig && process.env.SXL_APACHE_PATH) {
    throw new Error('Binary Apache sudah ditemukan melalui SXL_APACHE_PATH, tetapi conf/httpd.conf tidak ditemukan. Atur SXL_APACHE_PATH ke binary dari paket Apache lengkap.');
  }
  if (process.platform === 'darwin') {
    const brew = findOnPath('brew') || ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(p => fs.existsSync(p));
    if (!brew) throw new Error('Homebrew belum ditemukan. Pasang Homebrew dari brew.sh, lalu coba Pasang Apache kembali. SXL tidak mengubah konfigurasi global macOS.');
    await runCommand(brew, ['install', 'httpd'], { timeoutMs: 20 * 60 * 1000 });
    if (!apacheCandidates()) throw new Error('Homebrew selesai, tetapi binary Apache belum ditemukan. Tutup dan buka ulang SXL atau atur SXL_APACHE_PATH.');
    return { message: 'Apache terpasang melalui Homebrew. SXL akan menjalankannya sebagai proses milik SXL, bukan service Homebrew.', status: apacheStatus() };
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Pemasangan Apache otomatis hanya tersedia untuk Windows x64 dan macOS.');
  // Apache HTTP Server lists third-party Windows binary providers. Apache Lounge
  // is used because upstream Apache does not publish official Windows binaries.
  const listingUrl = 'https://www.apachelounge.com/download/VS18/binaries/';
  let listing;
  try { listing = (await fetch(listingUrl, { signal: AbortSignal.timeout(30000), redirect: 'follow' })); }
  catch { throw new Error(`Tidak dapat membuka indeks unduhan Apache Lounge. Buka ${listingUrl} dan unduh Apache VS18 x64, lalu ekstrak ke ${path.join(APACHE_ROOT, 'Apache24')}.`); }
  const finalHost = new URL(listing.url).hostname.toLowerCase();
  if (!listing.ok || !['www.apachelounge.com', 'apachelounge.com'].includes(finalHost)) throw new Error(`Apache Lounge tidak tersedia. Unduh manual dari ${listingUrl}.`);
  const html = await listing.text();
  const matches = [...html.matchAll(/href\s*=\s*["']([^"']*httpd-2\.4\.\d+[^"']*win64[^"']*VS\d+\.zip)["']/gi)]
    .map(match => { try { return new URL(match[1].replace(/&amp;/g, '&'), listing.url); } catch { return null; } })
    .filter(url => url && url.protocol === 'https:' && ['www.apachelounge.com', 'apachelounge.com'].includes(url.hostname.toLowerCase()));
  matches.sort((a, b) => {
    const av = (a.pathname.match(/httpd-(\d+\.\d+\.\d+)/i) || [,'0.0.0'])[1].split('.').map(Number);
    const bv = (b.pathname.match(/httpd-(\d+\.\d+\.\d+)/i) || [,'0.0.0'])[1].split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((av[i] || 0) !== (bv[i] || 0)) return (av[i] || 0) - (bv[i] || 0);
    const aVs = Number((a.pathname.match(/VS(\d+)\.zip$/i) || [,'0'])[1]);
    const bVs = Number((b.pathname.match(/VS(\d+)\.zip$/i) || [,'0'])[1]);
    return aVs - bVs;
  });
  const selected = matches.at(-1);
  if (!selected) throw new Error(`Tidak menemukan arsip Apache VS18 x64 di halaman resmi penyedia ${listingUrl}. Unduh manual lalu ekstrak ke ${path.join(APACHE_ROOT, 'Apache24')}.`);
  const expectedSha = await expectedApacheSha256(selected.href);
  const archiveBytes = await fetchBuffer(selected.href, MAX_ARCHIVE_BYTES, ['www.apachelounge.com', 'apachelounge.com']);
  if (!verifySha256(archiveBytes, expectedSha)) throw new Error('SHA-256 arsip Apache tidak cocok dengan manifest verifikasi. Arsip ditolak.');
  const tmp = path.join(RUNTIME_ROOT, 'downloads'); fs.mkdirSync(tmp, { recursive: true });
  const archivePath = path.join(tmp, 'apache-lounge.zip'); fs.writeFileSync(archivePath, archiveBytes, { mode: 0o600 });
  const stage = `${APACHE_ROOT}.staging-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await extractZip(archivePath, stage);
    const exe = findFile(stage, 'httpd.exe');
    if (!exe || !fs.existsSync(path.join(path.dirname(path.dirname(exe)), 'conf', 'httpd.conf'))) throw new Error('Arsip tidak berisi susunan Apache24 yang valid.');
    const root = path.dirname(path.dirname(exe));
    const finalRoot = path.join(APACHE_ROOT, 'Apache24');
    const backupRoot = path.join(APACHE_ROOT, `Apache24.previous-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(APACHE_ROOT, { recursive: true });
    const versionCheck = await runCommand(path.join(root, 'bin', 'httpd.exe'), ['-v'], { timeoutMs: 15000 });
    if (!/Apache\/2\.4\.\d+/i.test(versionCheck.stdout)) throw new Error('Binary Apache tidak mengembalikan versi yang valid.');
    let movedOld = false;
    try {
      if (fs.existsSync(finalRoot)) { await fs.promises.rename(finalRoot, backupRoot); movedOld = true; }
      await fs.promises.rename(root, finalRoot);
      await fs.promises.rm(backupRoot, { recursive: true, force: true });
    } catch (error) {
      await fs.promises.rm(finalRoot, { recursive: true, force: true }).catch(() => {});
      if (movedOld && fs.existsSync(backupRoot)) await fs.promises.rename(backupRoot, finalRoot).catch(() => {});
      throw error;
    }
    const version = await runCommand(path.join(finalRoot, 'bin', 'httpd.exe'), ['-v'], { timeoutMs: 15000 });
    fs.writeFileSync(path.join(APACHE_ROOT, 'source.json'), JSON.stringify({ provider: 'Apache Lounge', url: selected.href, version: version.stdout.trim(), installedAt: new Date().toISOString(), sha256: expectedSha, verification: 'SHA-256 matched Microsoft winget-pkgs manifest; archive layout verified' }, null, 2), { mode: 0o600 });
  } catch (error) {
    await fs.promises.rm(stage, { recursive: true, force: true });
    throw new Error(`Pemasangan Apache gagal: ${error.message}. Instalasi Windows menggunakan binary pihak ketiga Apache Lounge; periksa juga Microsoft Visual C++ Redistributable.`);
  } finally {
    await fs.promises.rm(archivePath, { force: true }).catch(() => {});
    await fs.promises.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
  return { message: 'Apache terpasang. SHA-256 cocok dengan manifest verifikasi independen; sumber dan checksum dicatat di runtime/apache/source.json.', status: apacheStatus() };
}
function findFile(root, name) {
  const direct = path.join(root, name);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  const queue = [root]; let visited = 0;
  while (queue.length && visited < 20000) {
    const current = queue.shift(); visited++;
    let children; try { children = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      const candidate = path.join(current, child.name);
      if (child.isFile() && child.name.toLowerCase() === name.toLowerCase()) return candidate;
      if (child.isDirectory() && child.name !== 'node_modules' && child.name !== '.git') queue.push(candidate);
    }
  }
  return null;
}
function configuredPhpMyAdminPath() {
  const configured = runtimePaths.getRuntimePaths().phpMyAdminDir;
  return configured && fs.existsSync(path.join(configured, 'index.php')) ? configured : path.join(RUNTIME_ROOT, 'phpmyadmin', 'app');
}
function configuredComposerPath() {
  const configured = runtimePaths.getRuntimePaths().composerPhar;
  return configured && fs.existsSync(configured) ? configured : path.join(RUNTIME_ROOT, 'composer', 'composer.phar');
}
function getManualRuntimePaths() { return runtimePaths.runtimePathStatus(); }
function saveManualRuntimePaths(input) {
  const paths = runtimePaths.saveRuntimePaths(input?.paths || input || {});
  return { message: 'Jalur runtime manual berhasil disimpan. Tekan Segarkan agar status layanan diperbarui.', ...runtimePaths.runtimePathStatus(), saved: paths };
}

function getPhpVersionsRoot() {
  const root = phpVersions.getPhpVersionsRoot(DATA_ROOT);
  fs.mkdirSync(root, { recursive: true });
  return root;
}
async function getPhpVersions() {
  const root = getPhpVersionsRoot();
  const configured = runtimePaths.getRuntimePaths();
  let versions = phpVersions.discoverPhpVersions(root);
  const portablePhp = runtimeInstaller.getPhpPaths(DATA_ROOT).php;
  const detectedPhp = configured.phpBinary || process.env.SXL_PHP_PATH || (fs.existsSync(portablePhp) ? portablePhp : runtimeInstaller.findOnPath('php')) || '';
  const projectPhpPaths = Object.values(projectSettingsStore.allProjectSettings()).map(item => item.phpBinary).filter(Boolean);
  for (const candidate of [...new Set([detectedPhp, ...projectPhpPaths])]) {
    versions = phpVersions.addCurrentExternalPhp(versions, candidate, candidate === detectedPhp ? (configured.phpCgiBinary || process.env.SXL_PHP_CGI_PATH || '') : '', root);
  }
  const checked = [];
  for (const entry of versions) {
    let version = '';
    let executable = false;
    let error = '';
    try {
      const result = await runCommand(entry.phpBinary, ['-r', 'echo PHP_VERSION;'], { timeoutMs: 7000, maxBuffer: 4096 });
      version = result.stdout.trim();
      executable = /^\d+\.\d+\.\d+/.test(version);
      if (!executable) error = 'Versi PHP tidak dapat dibaca.';
    } catch (err) { error = `Tidak bisa menjalankan PHP: ${err.message}`; }
    let cgiVersion = '';
    if (entry.phpCgiBinary) {
      try {
        const result = await runCommand(entry.phpCgiBinary, ['-v'], { timeoutMs: 7000, maxBuffer: 4096 });
        const text = `${result.stdout}\n${result.stderr}`;
        cgiVersion = (text.match(/PHP\s+(\d+\.\d+\.\d+)/i) || [])[1] || '';
        if (!cgiVersion) error = 'Versi PHP-CGI tidak dapat dibaca.';
        else if (version && cgiVersion !== version) error = `PHP-CGI ${cgiVersion} tidak cocok dengan PHP CLI ${version}.`;
      } catch (err) { error = `PHP-CGI tidak dapat dijalankan: ${err.message}`; }
    }
    checked.push({ ...entry, version, cgiVersion, executable, error, selected: Boolean(detectedPhp && phpVersions.samePath(detectedPhp, entry.phpBinary)) });
  }
  return {
    root,
    selectedPath: detectedPhp,
    selectedCgiPath: configured.phpCgiBinary || process.env.SXL_PHP_CGI_PATH || '',
    versions: checked
  };
}
function prepareManagedPhpIni(entry, options = {}) {
  if (!entry || entry.source !== 'folder-sxl') return { created: false, updated: false, note: '' };
  const platform = options.platform || process.platform;
  const directory = path.dirname(entry.phpBinary);
  const phpIni = path.join(directory, 'php.ini');
  const extensionDir = path.join(directory, 'ext');
  if (platform === 'win32' && fs.existsSync(phpIni) && fs.existsSync(extensionDir)) {
    let current = fs.readFileSync(phpIni, 'utf8');
    if (current.includes('; SXL Localhost: extension_dir for this managed PHP folder')) return { created: false, updated: false, note: 'php.ini yang sudah ada dipertahankan; extension_dir sudah diarahkan ke folder PHP ini.' };
    const activeDir = [...current.matchAll(/^[\t ]*extension_dir[\t ]*=[\t ]*["']?([^\r\n"']+)["']?[\t ]*$/gim)].map(match => match[1].trim()).at(-1) || '';
    const normalizedActive = activeDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const normalizedLocal = extensionDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (normalizedActive && ['ext', './ext', '.\\ext'].includes(normalizedActive)) return { created: false, updated: false, note: 'php.ini yang sudah ada menggunakan folder ext relatif dan dipertahankan.' };
    if (!normalizedActive || normalizedActive !== normalizedLocal) {
      const backup = `${phpIni}.sxl-backup`;
      try { fs.copyFileSync(phpIni, backup, fs.constants.COPYFILE_EXCL); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const forwardExt = extensionDir.replace(/\\/g, '/');
      current += `\n\n; SXL Localhost: extension_dir for this managed PHP folder\nextension_dir = "${forwardExt}"\n`;
      fs.writeFileSync(phpIni, current, { mode: 0o600 });
      return { created: false, updated: true, note: `php.ini diperbarui agar ekstensi memakai folder lokal. Salinan sebelumnya disimpan sebagai ${path.basename(backup)}.` };
    }
    return { created: false, updated: false, note: 'php.ini yang sudah ada menggunakan folder ext lokal dan dipertahankan.' };
  }
  if (fs.existsSync(phpIni)) return { created: false, updated: false, note: 'php.ini yang sudah ada dipertahankan.' };
  if (platform !== 'win32') return { created: false, updated: false, note: 'Buat php.ini sesuai distribusi PHP ini jika diperlukan; SXL tidak mengubah konfigurasi PHP non-Windows secara otomatis.' };
  const template = ['php.ini-development', 'php.ini-production'].map(name => path.join(directory, name)).find(file => fs.existsSync(file));
  if (!template) return { created: false, updated: false, note: 'Template php.ini tidak ditemukan; PHP dapat berjalan, tetapi ekstensi mungkin perlu dikonfigurasi manual.' };
  let contents = fs.readFileSync(template, 'utf8');
  const enabledExtensions = [];
  const commonExtensions = ['curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'mysqli', 'openssl', 'pdo_mysql', 'pdo_sqlite', 'sqlite3', 'zip', 'exif', 'soap', 'sodium'];
  if (fs.existsSync(extensionDir)) {
    const forwardExt = extensionDir.replace(/\\/g, '/');
    contents += `\n\n; SXL Localhost: konfigurasi tambahan untuk distribusi PHP yang dikelola SXL\nextension_dir = "${forwardExt}"\n`;
    for (const name of commonExtensions) {
      const dll = path.join(extensionDir, `php_${name}.dll`);
      if (!fs.existsSync(dll)) continue;
      const line = new RegExp(`^[\\t ]*;?[\\t ]*extension[\\t ]*=[\\t ]*(?:php_)?${name}(?:\\.dll)?[\\t ]*$`, 'im');
      if (line.test(contents)) contents = contents.replace(line, `extension=${name}`);
      else contents += `extension=${name}\n`;
      enabledExtensions.push(name);
    }
  }
  try {
    fs.writeFileSync(phpIni, contents, { flag: 'wx', mode: 0o600 });
    return { created: true, updated: false, note: `SXL membuat php.ini dari ${path.basename(template)}${enabledExtensions.length ? ` dan mengaktifkan ekstensi yang tersedia: ${enabledExtensions.join(', ')}` : ''}.` };
  } catch (error) {
    if (fs.existsSync(phpIni)) return { created: false, updated: false, note: 'php.ini sudah dibuat oleh proses lain dan dipertahankan.' };
    throw new Error(`Gagal menyiapkan php.ini: ${error.message}`);
  }
}

async function selectPhpVersion(input) {
  const phpBinary = typeof input?.phpBinary === 'string' ? input.phpBinary.trim() : '';
  if (!phpBinary) throw new Error('Pilih versi PHP terlebih dahulu.');
  const listing = await getPhpVersions();
  const selected = listing.versions.find(item => phpVersions.samePath(item.phpBinary, phpBinary));
  if (!selected) throw new Error('Versi PHP tidak ada di folder koleksi SXL atau path manual aktif. Pindahkan folder versi ke folder yang ditampilkan lalu pindai ulang.');
  if (!selected.executable || !selected.version) throw new Error(selected.error || 'Binary PHP tidak dapat dijalankan.');
  if (selected.phpCgiBinary) {
    if (!selected.cgiVersion || selected.cgiVersion !== selected.version) throw new Error(`Versi PHP-CGI harus sama dengan PHP CLI. PHP CLI: ${selected.version}; PHP-CGI: ${selected.cgiVersion || 'tidak terbaca'}.`);
  }
  const iniSetup = prepareManagedPhpIni(selected);
  runtimePaths.saveRuntimePaths({ phpBinary: selected.phpBinary, phpCgiBinary: selected.phpCgiBinary || '' });
  const detail = selected.phpCgiBinary ? `PHP ${selected.version} aktif untuk proyek, Composer, dan CLI. PHP-CGI ${selected.cgiVersion} cocok.` : `PHP ${selected.version} aktif untuk CLI dan Composer. Folder ini tidak memiliki php-cgi; proyek Apache/FastCGI tidak dapat dijalankan sampai versi dengan php-cgi dipilih.`;
  return { message: `${detail}${iniSetup.note ? ` ${iniSetup.note}` : ''}`, ...(await getPhpVersions()) };
}

async function setProjectPhpVersion(input) {
  const slug = slugProjectName(input?.slug);
  const folder = projectDirectory(slug);
  const manifest = readProjectManifest(folder);
  if (!manifest || manifest.type !== 'php') throw new Error('Pengaturan versi PHP hanya tersedia untuk proyek PHP/Laravel.');
  if (state.projects.has(slug)) throw new Error('Hentikan proyek terlebih dahulu sebelum mengubah versi PHP.');
  const requested = typeof input?.phpBinary === 'string' ? input.phpBinary.trim() : '';
  if (!requested) {
    projectSettingsStore.saveProjectPhp(slug, { phpBinary: '', phpCgiBinary: '' });
    return { message: `Proyek ${slug} kembali menggunakan versi PHP global.`, project: listProjects().find(item => item.slug === slug) };
  }
  const listing = await getPhpVersions();
  const selected = listing.versions.find(item => phpVersions.samePath(item.phpBinary, requested));
  if (!selected) throw new Error('Versi PHP tidak ditemukan. Salin versi tersebut ke folder koleksi SXL, lalu pindai ulang.');
  if (!selected.executable || !selected.version || selected.error) throw new Error(selected.error || 'Versi PHP tidak dapat dijalankan.');
  if (!selected.phpCgiBinary) throw new Error(`PHP ${selected.version} hanya memiliki CLI. Pilih distribusi yang juga menyediakan php-cgi untuk Apache FastCGI.`);
  if (!selected.cgiVersion || selected.cgiVersion !== selected.version) throw new Error(`Versi PHP-CGI (${selected.cgiVersion || 'tidak terbaca'}) tidak cocok dengan PHP CLI (${selected.version}).`);
  const saved = projectSettingsStore.saveProjectPhp(slug, { phpBinary: selected.phpBinary, phpCgiBinary: selected.phpCgiBinary });
  return { message: `PHP ${selected.version} disimpan untuk proyek ${slug}. Versi global tidak berubah.`, settings: saved, project: listProjects().find(item => item.slug === slug) };
}

async function getProjectPhpRuntime(slug) {
  const saved = projectSettingsStore.getProjectSettings(slug);
  if (!saved.phpBinary) return activePhpRuntime();
  if (!fs.existsSync(saved.phpBinary) || !fs.statSync(saved.phpBinary).isFile()) {
    throw new Error(`PHP khusus proyek ${slug} tidak ditemukan di ${saved.phpBinary}. Pilih versi lain atau kembalikan ke versi global.`);
  }
  const result = await runCommand(saved.phpBinary, ['-r', 'echo PHP_VERSION;'], { timeoutMs: 10000, maxBuffer: 4096 });
  const version = result.stdout.trim();
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`Versi PHP proyek ${slug} tidak dapat diverifikasi.`);
  const cgi = saved.phpCgiBinary || phpCgiCandidates(saved.phpBinary);
  if (!cgi || !fs.existsSync(cgi)) throw new Error(`PHP-CGI untuk PHP ${version} proyek ${slug} tidak ditemukan. Pilih versi lengkap yang berisi php-cgi.`);
  const cgiInfo = await runCommand(cgi, ['-v'], { timeoutMs: 7000, maxBuffer: 4096 });
  const cgiVersion = (`${cgiInfo.stdout}\n${cgiInfo.stderr}`.match(/PHP\s+(\d+\.\d+\.\d+)/i) || [])[1] || '';
  if (cgiVersion !== version) throw new Error(`PHP-CGI ${cgiVersion || 'tidak terbaca'} tidak cocok dengan PHP CLI ${version} untuk proyek ${slug}.`);
  return { php: saved.phpBinary, version, phpCgiBinary: cgi };
}

async function openPhpVersionsFolder() {
  const folder = getPhpVersionsRoot();
  fs.mkdirSync(folder, { recursive: true });
  await openFolder(folder);
  return { message: 'Folder koleksi versi PHP dibuka.', root: folder };
}

function apacheStatus() {
  const paths = apachePaths();
  const pmaPath = configuredPhpMyAdminPath();
  const composerPath = configuredComposerPath();
  const phpPath = runtimeInstaller.getPhpPaths(DATA_ROOT).php;
  const systemPhp = runtimeInstaller.findOnPath('php') || (process.platform === 'darwin' ? ['/opt/homebrew/bin/php', '/usr/local/bin/php'].find(p => fs.existsSync(p)) : null);
  return {
    platform: process.platform,
    apache: { installed: Boolean(paths && paths.baseConfig), binaryFound: Boolean(paths), running: isApacheRunning(), path: paths?.binary || null, root: paths?.root || null, port: state.apache.port, url: `http://127.0.0.1:${state.apache.port}`, fastCgiModulesAvailable: Boolean(paths && ['dir_module', 'proxy_module', 'proxy_fcgi_module', 'rewrite_module'].every(name => apacheModulePath(paths, name))), lastError: state.apache.lastError, log: state.apache.log.slice(-1500), installSupported: process.platform === 'darwin' || (process.platform === 'win32' && process.arch === 'x64') },
    php: phpRuntimeStatus(),
    composer: { installed: fs.existsSync(composerPath), path: composerPath, manual: composerPath === runtimePaths.getRuntimePaths().composerPhar, installSupported: ['win32', 'darwin'].includes(process.platform) },
    database: database.status(),
    phpMyAdmin: { installed: fs.existsSync(path.join(pmaPath, 'index.php')), running: isPmaRunning(), path: pmaPath, version: PMA_VERSION, port: state.phpMyAdmin.port, url: `http://127.0.0.1:${state.phpMyAdmin.port}`, lastError: state.phpMyAdmin.lastError, log: state.phpMyAdmin.log.slice(-1500) },
    workspace: WWW_ROOT,
    projects: listProjects()
  };
}
function syncProjectApacheUrls() {
  for (const entry of state.projects.values()) {
    if (entry.type !== 'php' || !entry.fcgiPort) continue;
    if (isApacheRunning()) {
      entry.port = state.apache.port;
      entry.url = `http://${entry.slug}.localhost:${state.apache.port}`;
    } else {
      entry.url = null;
      entry.port = null;
    }
  }
}
function phpCgiCandidates(phpExecutable) {
  const directory = path.dirname(phpExecutable);
  const configured = runtimePaths.getRuntimePaths();
  const names = process.platform === 'win32' ? ['php-cgi.exe', 'php-cgi'] : ['php-cgi', 'php-cgi.exe'];
  // Keep php-cgi paired with the exact PHP installation selected by SXL.
  // A generic PATH fallback can silently launch a different PHP version (for
  // example, a Laragon PHP 8.5 CGI binary for an SXL PHP 8.3 CLI runtime).
  // Users with a non-sibling CGI binary can opt in explicitly via
  // SXL_PHP_CGI_PATH after confirming the versions match.
  const candidates = [
    ...names.map(name => path.join(directory, name)),
    configured.phpCgiBinary,
    process.env.SXL_PHP_CGI_PATH
  ].filter(Boolean);
  return candidates.find(candidate => { try { return fs.statSync(candidate).isFile(); } catch { return false; } }) || null;
}
function attachPhpCgiWorker(entry, child) {
  entry.process = child;
  child.__sxlLog = child.__sxlLog || '';
  let restartQueued = false;
  const append = chunk => {
    const text = chunk.toString();
    child.__sxlLog = (child.__sxlLog + text).slice(-8000);
    entry.log = (entry.log + text).slice(-12000);
  };
  const scheduleRestart = (reason) => {
    if (restartQueued || entry.stopping || state.projects.get(entry.slug) !== entry) return;
    restartQueued = true;
    if (entry.process === child) entry.process = null;
    const now = Date.now();
    entry.restartTimes = (entry.restartTimes || []).filter(time => now - time < 60_000);
    entry.restartTimes.push(now);
    entry.log = (entry.log + `\nPHP-CGI ${reason}; memulihkan FastCGI.`).slice(-12000);
    if (entry.restartTimes.length > 5) {
      entry.lastError = 'PHP-CGI berhenti lebih dari 5 kali dalam 60 detik. Periksa log PHP dan php.ini.';
      state.projects.delete(entry.slug);
      if (isApacheRunning()) {
        stopApache({ stopPhpBackends: false }).then(() => startApache()).catch(error => { state.apache.lastError = error.message; });
      }
      return;
    }
    entry.restartTimer = setTimeout(() => {
      entry.restartTimer = null;
      restartQueued = false;
      if (entry.stopping || state.projects.get(entry.slug) !== entry) return;
      try {
        const next = spawn(entry.phpCgiPath, ['-b', `127.0.0.1:${entry.fcgiPort}`], {
          cwd: path.dirname(entry.phpCgiPath), env: entry.phpEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
        });
        attachPhpCgiWorker(entry, next);
      } catch (error) {
        entry.log = (entry.log + `\nSpawn PHP-CGI gagal: ${error.message}`).slice(-12000);
        scheduleRestart(`gagal dijalankan (${error.message})`);
      }
    }, 500);
    entry.restartTimer.unref?.();
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.once('error', error => {
    entry.log = (entry.log + `\nPHP-CGI error: ${error.message}`).slice(-12000);
    scheduleRestart(`error: ${error.message}`);
  });
  child.once('exit', (code, signal) => scheduleRestart(`berhenti (code=${code}, signal=${signal || 'none'})`));
  // Reset repeated-crash accounting if this worker stays alive for a full minute.
  const stableTimer = setTimeout(() => {
    if (state.projects.get(entry.slug) === entry && entry.process === child) entry.restartTimes = [];
  }, 60_000);
  stableTimer.unref?.();
}

async function waitForTcpPort(port, child, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.__sxlSpawnError) throw new Error(`PHP-CGI gagal dijalankan: ${child.__sxlSpawnError.message}`);
    if (child.exitCode !== null) throw new Error(`PHP-CGI berhenti saat startup. ${child.__sxlLog || ''}`);
    if (await canConnect(port, 500)) return true;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`PHP-CGI tidak membuka FastCGI pada 127.0.0.1:${port} dalam ${Math.round(timeoutMs / 1000)} detik. ${child.__sxlLog || ''}`);
}
async function stopChildProcess(child, graceMs = 3000) {
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => {
    let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32' && child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else child.kill('SIGKILL');
      } catch {}
      finish();
    }, graceMs);
    child.once('exit', finish);
    try { child.kill('SIGTERM'); } catch { finish(); }
  });
}

async function startApache() {
  if (isApacheRunning()) return { message: 'Apache sudah berjalan.', status: apacheStatus() };
  ensureFolders();
  const paths = apachePaths();
  if (!paths) throw new Error('Apache belum terpasang. Tekan Pasang Apache terlebih dahulu.');
  if (!paths.baseConfig) throw new Error(`Konfigurasi httpd.conf tidak ditemukan untuk ${paths.binary}. Atur instalasi Apache atau SXL_APACHE_PATH ke binary pada paket Apache lengkap.`);
  await fs.promises.mkdir(WWW_ROOT, { recursive: true });
  const port = await choosePort(APACHE_PORT_DEFAULT);
  const config = buildApacheConfig(paths, port);
  await runCommand(paths.binary, ['-t', '-f', config], { timeoutMs: 15000 });
  const args = process.platform === 'win32' ? ['-f', config, '-w'] : ['-f', config, '-DFOREGROUND'];
  const child = spawn(paths.binary, args, { cwd: paths.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  state.apache.process = child; state.apache.config = config; state.apache.port = port; state.apache.log = ''; state.apache.lastError = null;
  const append = chunk => { state.apache.log = (state.apache.log + chunk.toString()).slice(-12000); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  child.once('error', err => { state.apache.lastError = `Apache gagal dijalankan: ${err.message}`; if (state.apache.process === child) state.apache.process = null; });
  child.once('exit', (code, signal) => {
    if (state.apache.process === child) state.apache.process = null;
    if (code !== 0 && code !== null) state.apache.lastError = `Apache berhenti (code=${code}, signal=${signal || 'none'}). ${state.apache.log.slice(-1500)}`;
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Apache keluar saat startup. ${state.apache.log.slice(-1800)}`);
    if (await canConnect(port)) { state.apache.startedAt = new Date().toISOString(); syncProjectApacheUrls(); return { message: `Apache aktif pada http://127.0.0.1:${port}.`, status: apacheStatus() }; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  try { child.kill(); } catch {}
  state.apache.process = null;
  throw new Error(`Apache tidak merespons pada port ${port}. ${state.apache.log.slice(-1500)}`);
}
async function stopApache({ stopPhpBackends = true } = {}) {
  if (stopPhpBackends) {
    const phpSlugs = [...state.projects.values()].filter(entry => entry.type === 'php' && entry.fcgiPort).map(entry => entry.slug);
    for (const slug of phpSlugs) {
      const entry = state.projects.get(slug);
      if (entry) { entry.stopping = true; if (entry.restartTimer) clearTimeout(entry.restartTimer); await stopChildProcess(entry.process); }
      state.projects.delete(slug);
    }
  }
  const child = state.apache.process;
  if (!child || child.exitCode !== null) {
    state.apache.process = null;
    state.apache.startedAt = null;
    syncProjectApacheUrls();
    return { message: 'Apache tidak sedang berjalan.', status: apacheStatus() };
  }
  await stopChildProcess(child, 3500);
  state.apache.process = null; state.apache.startedAt = null;
  syncProjectApacheUrls();
  return { message: 'Apache dihentikan.', status: apacheStatus() };
}

function phpCandidates() {
  const p = runtimeInstaller.getPhpPaths(DATA_ROOT);
  const configured = runtimePaths.getRuntimePaths();
  return [configured.phpBinary, process.env.SXL_PHP_PATH, p.php,
    ...(process.platform === 'darwin' ? ['/opt/homebrew/opt/php@8.3/bin/php', '/usr/local/opt/php@8.3/bin/php'] : []),
    runtimeInstaller.findOnPath('php')
  ].filter(candidate => candidate && fs.existsSync(candidate));
}
function phpRuntimeStatus() {
  const paths = runtimeInstaller.getPhpPaths(DATA_ROOT);
  const configured = runtimePaths.getRuntimePaths();
  const systemPhp = [configured.phpBinary, process.env.SXL_PHP_PATH, runtimeInstaller.findOnPath('php'), ...(process.platform === 'darwin' ? ['/opt/homebrew/opt/php@8.3/bin/php', '/usr/local/opt/php@8.3/bin/php'] : [])]
    .filter(candidate => candidate && fs.existsSync(candidate));
  const php83Candidates = process.platform === 'darwin' ? ['/opt/homebrew/opt/php@8.3/bin/php', '/usr/local/opt/php@8.3/bin/php'] : [];
  const recommendedInstalled = Boolean(configured.phpBinary && fs.existsSync(configured.phpBinary)) || fs.existsSync(paths.php) || php83Candidates.some(candidate => fs.existsSync(candidate));
  const activePath = configured.phpBinary || process.env.SXL_PHP_PATH || (fs.existsSync(paths.php) ? paths.php : systemPhp[0] || null);
  return {
    portableInstalled: fs.existsSync(paths.php), portablePath: fs.existsSync(paths.php) ? paths.php : null,
    systemPath: systemPhp[0] || null, activePath, recommendedVersion: runtimeInstaller.PHP_VERSION, recommendedInstalled,
    fastCgiPath: [...new Set([activePath, paths.php, ...systemPhp])].filter(Boolean).map(candidate => phpCgiCandidates(candidate)).find(Boolean) || null,
    installSupported: ['win32', 'darwin'].includes(process.platform)
  };
}
async function installPhpRuntime() {
  ensureFolders();
  const manualPhp = runtimePaths.getRuntimePaths().phpBinary;
  if (manualPhp && fs.existsSync(manualPhp)) {
    const result = await runCommand(manualPhp, ['-r', 'echo PHP_VERSION;'], { timeoutMs: 10000 });
    return { message: `PHP manual terdeteksi: ${result.stdout.trim()}. SXL akan menggunakan binary tersebut.`, php: phpRuntimeStatus() };
  }
  if (process.platform === 'win32') {
    const installed = await runtimeInstaller.ensurePhpRuntime(DATA_ROOT, { forcePortable: true });
    const result = await runCommand(installed.php, ['-r', 'echo PHP_VERSION;'], { timeoutMs: 10000 });
    return { message: `PHP ${result.stdout.trim()} berhasil disiapkan untuk SXL.`, php: phpRuntimeStatus() };
  }
  if (process.platform === 'darwin') {
    const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew', findOnPath('brew')].filter(Boolean).find(candidate => fs.existsSync(candidate));
    if (!brew) throw new Error('Homebrew belum ditemukan. Pasang dari https://brew.sh, lalu buka ulang SXL.');
    const phpPaths = ['/opt/homebrew/opt/php@8.3/bin/php', '/usr/local/opt/php@8.3/bin/php'];
    if (!phpPaths.some(candidate => fs.existsSync(candidate))) await runCommand(brew, ['install', 'php@8.3'], { timeoutMs: 20 * 60 * 1000 });
    const php = phpPaths.find(candidate => fs.existsSync(candidate));
    if (!php) throw new Error('PHP 8.3 belum ditemukan setelah Homebrew selesai. Jalankan `brew info php@8.3` untuk memeriksa instalasi.');
    const result = await runCommand(php, ['-r', 'echo PHP_VERSION;'], { timeoutMs: 10000 });
    return { message: `PHP ${result.stdout.trim()} siap digunakan.`, php: phpRuntimeStatus() };
  }
  throw new Error('Pemasangan PHP otomatis hanya didukung pada Windows x64 dan macOS. Pada Linux, pasang PHP melalui package manager distribusi.');
}
async function activePhpRuntime() {
  for (const candidate of [...new Set(phpCandidates())]) {
    try {
      const result = await runCommand(candidate, ['-r', 'echo PHP_VERSION;'], { timeoutMs: 10000 });
      const version = result.stdout.trim();
      if (/^\d+\.\d+\.\d+/.test(version)) return { php: candidate, version };
    } catch {}
  }
  await installPhpRuntime();
  for (const candidate of [...new Set(phpCandidates())]) {
    try {
      const result = await runCommand(candidate, ['-r', 'echo PHP_VERSION;'], { timeoutMs: 10000 });
      const version = result.stdout.trim();
      if (/^\d+\.\d+\.\d+/.test(version)) return { php: candidate, version };
    } catch {}
  }
  throw new Error('PHP aktif tidak dapat dijalankan. Periksa path pada Pengaturan Versi PHP.');
}
async function compatiblePhpForComposer(projectSlug = '') {
  if (projectSlug) return getProjectPhpRuntime(projectSlug);
  return activePhpRuntime();
}
async function installComposer() {
  ensureFolders();
  const manualComposer = runtimePaths.getRuntimePaths().composerPhar;
  if (manualComposer && fs.existsSync(manualComposer)) {
    const php = await compatiblePhpForComposer();
    const result = await runCommand(php.php, [manualComposer, '--version', '--no-ansi'], { timeoutMs: 30000 });
    return { message: `Composer manual terdeteksi: ${result.stdout.trim() || result.stderr.trim()}`, composer: apacheStatus().composer };
  }
  const php = await compatiblePhpForComposer();
  const shaResponse = await fetch(COMPOSER_SHA_URL, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
  const shaFinal = new URL(shaResponse.url);
  if (!shaResponse.ok || shaFinal.protocol !== 'https:' || shaFinal.hostname !== 'getcomposer.org') throw new Error('Checksum resmi Composer tidak dapat diverifikasi. Instalasi dibatalkan.');
  const expected = ((await shaResponse.text()).match(/[a-f0-9]{64}/i) || [])[0];
  if (!expected) throw new Error('Format checksum Composer tidak valid.');
  const bytes = await fetchBuffer(COMPOSER_URL, 30 * 1024 * 1024, ['getcomposer.org']);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error('Checksum Composer tidak cocok. File ditolak.');
  const root = path.join(RUNTIME_ROOT, 'composer');
  const destination = path.join(root, 'composer.phar');
  fs.mkdirSync(root, { recursive: true });
  const temp = `${destination}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
    await runCommand(php.php, [temp, '--version', '--no-ansi'], { timeoutMs: 30000 });
    await fs.promises.rename(temp, destination);
    await fs.promises.writeFile(path.join(root, 'runtime.json'), JSON.stringify({ source: COMPOSER_URL, sha256: actual, phpVersion: php.version, installedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  } finally { await fs.promises.rm(temp, { force: true }).catch(() => {}); }
  return { message: 'Composer berhasil dipasang dan checksum resmi cocok.', composer: apacheStatus().composer };
}
async function composerInstallProject({ slug } = {}) {
  const safeSlug = slugProjectName(slug);
  const folder = projectDirectory(safeSlug);
  const composerJson = path.join(folder, 'composer.json');
  if (!fs.existsSync(composerJson) || !fs.statSync(composerJson).isFile()) throw new Error('composer.json tidak ditemukan pada folder proyek.');
  const composerPhar = configuredComposerPath();
  if (!fs.existsSync(composerPhar)) throw new Error('Composer belum dipasang. Pilih composer.phar secara manual atau tekan Pasang Composer.');
  const php = await compatiblePhpForComposer(safeSlug);
  const home = path.join(RUNTIME_ROOT, 'composer', 'home');
  const cache = path.join(RUNTIME_ROOT, 'composer', 'cache');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 }); fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
  const result = await runCommand(php.php, [composerPhar, 'install', '--no-interaction', '--prefer-dist', '--no-ansi'], {
    cwd: folder, timeoutMs: 20 * 60 * 1000,
    env: { ...process.env, COMPOSER_HOME: home, COMPOSER_CACHE_DIR: cache, COMPOSER_ALLOW_SUPERUSER: '0' }
  });
  return { message: `Composer install selesai untuk ${safeSlug}.`, log: `${result.stdout}\n${result.stderr}`.trim().slice(-10000), project: safeSlug };
}
async function getLaravelMetadata() {
  if (laravelMetadataCache.value && laravelMetadataCache.expiresAt > Date.now()) return laravelMetadataCache.value;
  const packageEndpoint = packageName => `https://repo.packagist.org/p2/${packageName}.json`;
  const readPackage = async packageName => {
    const endpoint = packageEndpoint(packageName);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok || new URL(response.url).hostname !== 'repo.packagist.org') throw new Error(`Metadata resmi ${packageName} tidak dapat diverifikasi dari Packagist.`);
    const body = await response.json();
    const versions = body?.packages?.[packageName];
    if (!Array.isArray(versions)) throw new Error(`Format metadata ${packageName} tidak valid.`);
    return { endpoint, versions };
  };
  const skeletonPackage = await readPackage('laravel/laravel');
  const stable = skeletonPackage.versions.find(item => typeof item.version === 'string' && /^v?\d+\.\d+\.\d+$/.test(item.version));
  if (!stable) throw new Error('Rilis stabil Laravel tidak ditemukan pada metadata resmi.');
  const frameworkConstraint = stable.require?.['laravel/framework'];
  if (typeof frameworkConstraint !== 'string') throw new Error('Persyaratan framework Laravel tidak ditemukan pada metadata paket.');
  const frameworkPackage = await readPackage('laravel/framework');
  const frameworkRelease = frameworkPackage.versions.find(item => typeof item.version === 'string'
    && /^v?\d+\.\d+\.\d+$/.test(item.version)
    && versionSatisfiesConstraint(item.version.replace(/^v/, ''), frameworkConstraint));
  if (!frameworkRelease) throw new Error(`Rilis framework Laravel yang memenuhi ${frameworkConstraint} tidak ditemukan.`);
  const requiredExtensions = Object.keys(frameworkRelease.require || {}).filter(name => name.startsWith('ext-')).map(name => name.slice(4).toLowerCase());
  const release = {
    version: stable.version.replace(/^v/, ''),
    phpConstraint: [stable.require?.php, frameworkRelease.require?.php].filter(Boolean).join(', '),
    requiredExtensions,
    source: skeletonPackage.endpoint,
    checkedAt: new Date().toISOString()
  };
  laravelMetadataCache = { value: release, expiresAt: Date.now() + 5 * 60 * 1000 };
  return release;
}
function versionSatisfiesConstraint(version, constraint) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || typeof constraint !== 'string' || !constraint.trim()) return false;
  const current = version.split('.').map(Number);
  const alternatives = constraint.split(/\s*\|\|?\s*/).filter(Boolean);
  return alternatives.some(alternative => {
    const terms = alternative.split(/\s*,\s*|\s+(?=[<>~^=])/).filter(Boolean);
    return terms.length > 0 && terms.every(term => {
      const match = term.match(/^(>=|<=|>|<|~|\^|=)?\s*(\d+)\.(\d+)(?:\.(\d+))?/);
      if (!match) return false;
      const operator = match[1] || '^';
      const minimum = [Number(match[2]), Number(match[3]), Number(match[4] || 0)];
      const compare = (left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
      const order = compare(current, minimum);
      if (operator === '>=') return order >= 0;
      if (operator === '>') return order > 0;
      if (operator === '<=') return order <= 0;
      if (operator === '<') return order < 0;
      if (operator === '=') return order === 0;
      if (operator === '~') return order >= 0 && current[0] === minimum[0] && (match[4] === undefined || current[1] === minimum[1]);
      return order >= 0 && current[0] === minimum[0];
    });
  });
}
const phpSatisfiesConstraint = versionSatisfiesConstraint;
async function inspectPhpRuntime() {
  let lastError = 'PHP belum ditemukan. Pasang PHP dari Download Center atau pilih path runtime di Pengaturan.';
  for (const candidate of [...new Set(phpCandidates())]) {
    try {
      const [versionResult, modulesResult] = await Promise.all([
        runCommand(candidate, ['-r', 'echo PHP_VERSION;'], { timeoutMs: 10000, maxBuffer: 4096 }),
        runCommand(candidate, ['-m'], { timeoutMs: 10000, maxBuffer: 128 * 1024 })
      ]);
      const version = versionResult.stdout.trim();
      if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Versi PHP tidak dapat diverifikasi.');
      const modules = new Set(modulesResult.stdout.split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(Boolean));
      return { php: candidate, version, modules };
    } catch (error) { lastError = error.message; }
  }
  return { php: '', version: '', modules: new Set(), error: lastError };
}
async function inspectComposer(php) {
  const phar = configuredComposerPath();
  if (!php || !fs.existsSync(phar)) return { installed: false, error: 'Composer belum terpasang.' };
  try {
    const result = await runCommand(php, [phar, '--version', '--no-ansi'], { timeoutMs: 15000, maxBuffer: 4096 });
    const version = (`${result.stdout}\n${result.stderr}`).match(/Composer version\s+([^\s]+)/i)?.[1] || '';
    if (!version) throw new Error('Versi Composer tidak dapat diverifikasi.');
    return { installed: true, path: phar, version };
  } catch (error) { return { installed: false, path: phar, error: error.message }; }
}
async function checkProjectDependencies({ type = 'static', initializeGit = false } = {}) {
  if (!['static', 'php', 'node', 'laravel'].includes(type)) throw new Error('Jenis proyek tidak didukung.');
  const checks = [];
  let php = null;
  let composer = null;
  if (['php', 'laravel'].includes(type)) {
    php = await inspectPhpRuntime();
    checks.push({ id: 'php', name: 'PHP CLI', required: true, ok: Boolean(php.php), version: php.version || null, message: php.php ? `PHP ${php.version} berhasil dijalankan.` : php.error });
  }
  if (type === 'laravel') {
    let release = null;
    let releaseError = '';
    try { release = await getLaravelMetadata(); }
    catch (error) { releaseError = error.message; }
    const requiredExtensions = release?.requiredExtensions || [];
    const missing = php?.php ? requiredExtensions.filter(name => !php.modules.has(name)) : requiredExtensions;
    const extensionsVerified = requiredExtensions.length > 0;
    checks.push({ id: 'php-extensions', name: 'Ekstensi PHP Laravel', required: true, ok: extensionsVerified && missing.length === 0, message: !extensionsVerified ? 'Daftar ekstensi wajib tidak dapat diverifikasi dari metadata framework.' : missing.length ? `Ekstensi belum tersedia: ${missing.join(', ')}.` : 'Ekstensi PHP yang dibutuhkan Laravel tersedia.' });
    composer = await inspectComposer(php?.php);
    checks.push({ id: 'composer', name: 'Composer', required: true, ok: composer.installed, version: composer.version || null, message: composer.installed ? `Composer ${composer.version} berhasil dijalankan.` : composer.error });
    if (release) {
      const compatible = php?.version ? phpSatisfiesConstraint(php.version, release.phpConstraint) : false;
      checks.push({ id: 'laravel-version', name: 'Laravel stabil terbaru', required: true, ok: compatible, version: release.version, message: compatible ? `Laravel ${release.version} terverifikasi; PHP ${php.version} memenuhi ${release.phpConstraint}.` : `Laravel ${release.version} memerlukan PHP ${release.phpConstraint || 'yang belum dapat diverifikasi'}; PHP aktif ${php?.version || 'tidak tersedia'}.`, source: release.source, checkedAt: release.checkedAt });
    } else checks.push({ id: 'laravel-version', name: 'Metadata Laravel', required: true, ok: false, message: releaseError || 'Metadata rilis Laravel stabil gagal diperiksa dari Packagist.' });
    let writable = false;
    let freeBytes = null;
    try {
      ensureFolders();
      fs.accessSync(WWW_ROOT, fs.constants.W_OK);
      writable = true;
      const disk = fs.statfsSync(WWW_ROOT);
      freeBytes = Number(disk.bavail) * Number(disk.bsize);
    } catch (error) { checks.push({ id: 'project-location', name: 'Lokasi proyek', required: true, ok: false, message: `Folder workspace tidak dapat diperiksa: ${error.message}` }); }
    if (!checks.some(item => item.id === 'project-location')) {
      const enoughSpace = freeBytes === null || freeBytes >= 300 * 1024 * 1024;
      checks.push({ id: 'project-location', name: 'Lokasi dan ruang penyimpanan', required: true, ok: writable && enoughSpace, freeBytes, message: !writable ? 'Folder workspace tidak dapat ditulisi.' : freeBytes === null ? 'Folder dapat ditulisi; ruang disk tidak dapat dibaca oleh sistem.' : enoughSpace ? `Folder dapat ditulisi; ruang tersedia ${(freeBytes / (1024 ** 3)).toFixed(1)} GB.` : 'Ruang kosong kurang dari 300 MB.' });
    }
    checks.push({ id: 'internet', name: 'Koneksi metadata', required: true, ok: checks.some(item => item.id === 'laravel-version' && item.version), message: checks.some(item => item.id === 'laravel-version' && item.version) ? 'Metadata rilis stabil berhasil diperiksa.' : 'Metadata tidak tersedia; periksa koneksi internet.' });
  } else if (type === 'node') {
    const configured = runtimePaths.getRuntimePaths().nodeBinary;
    const portable = runtimeInstaller.getNodePaths(DATA_ROOT).node;
    const node = [configured, portable, findOnPath('node')].filter(Boolean).find(file => fs.existsSync(file));
    let version = '';
    if (node) {
      try { version = (await runCommand(node, ['--version'], { timeoutMs: 10000, maxBuffer: 4096 })).stdout.trim(); } catch {}
    }
    checks.push({ id: 'node', name: 'Node.js', required: true, ok: Boolean(version), version: version || null, message: version ? `Node.js ${version} berhasil dijalankan.` : 'Node.js belum ditemukan atau tidak dapat dijalankan.' });
  } else if (type === 'static') {
    checks.push({ id: 'template', name: 'Template statis', required: true, ok: true, message: 'Tidak membutuhkan runtime tambahan.' });
  }
  if (initializeGit) {
    const git = findOnPath('git');
    let version = '';
    if (git) {
      try { version = (await runCommand(git, ['--version'], { timeoutMs: 10000, maxBuffer: 4096 })).stdout.trim(); } catch {}
    }
    checks.push({ id: 'git', name: 'Git', required: true, ok: Boolean(version), version: version || null, message: version || 'Git belum ditemukan atau tidak dapat dijalankan.' });
  }
  return { type, checks, ready: checks.every(item => !item.required || item.ok), workspace: WWW_ROOT };
}
async function createLaravelProject({ name, initializeGit = false } = {}) {
  const slug = slugProjectName(name);
  if (activeProjectCreations.has(slug)) throw new Error(`Pembuatan proyek ${slug} sedang berlangsung.`);
  const target = projectDirectory(slug);
  if (fs.existsSync(target)) throw new Error(`Folder proyek ${slug} sudah ada.`);
  activeProjectCreations.add(slug);
  let staging = '';
  let preservedPath = '';
  try {
    const dependencies = await checkProjectDependencies({ type: 'laravel', initializeGit });
    const failed = dependencies.checks.filter(item => item.required && !item.ok);
    if (failed.length) throw new Error(`Prasyarat proyek belum terpenuhi:\n${failed.map(item => `• ${item.name}: ${item.message}`).join('\n')}`);
    const php = await inspectPhpRuntime();
    const composer = await inspectComposer(php.php);
    const release = await getLaravelMetadata();
    if (!phpSatisfiesConstraint(php.version, release.phpConstraint)) throw new Error(`PHP ${php.version} tidak memenuhi persyaratan Laravel ${release.version} (${release.phpConstraint}).`);
    const freeBytes = (() => { try { const disk = fs.statfsSync(WWW_ROOT); return Number(disk.bavail) * Number(disk.bsize); } catch { return null; } })();
    if (freeBytes !== null && freeBytes < 300 * 1024 * 1024) throw new Error('Ruang kosong kurang dari 300 MB; proyek belum dibuat.');
    if (fs.existsSync(target)) throw new Error(`Folder proyek ${slug} dibuat oleh proses lain; folder tersebut tidak diubah.`);
    staging = path.join(WWW_ROOT, `.sxl-create-${slug}-${crypto.randomBytes(6).toString('hex')}`);
    const composerHome = path.join(RUNTIME_ROOT, 'composer', 'home');
    const composerCache = path.join(RUNTIME_ROOT, 'composer', 'cache');
    fs.accessSync(WWW_ROOT, fs.constants.W_OK);
    fs.mkdirSync(composerHome, { recursive: true, mode: 0o700 });
    fs.mkdirSync(composerCache, { recursive: true, mode: 0o700 });
    const result = await runCommand(php.php, [composer.path, 'create-project', 'laravel/laravel', staging, release.version, '--no-interaction', '--prefer-dist', '--no-ansi'], {
      cwd: WWW_ROOT, timeoutMs: 30 * 60 * 1000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, COMPOSER_HOME: composerHome, COMPOSER_CACHE_DIR: composerCache, COMPOSER_ALLOW_SUPERUSER: '0' }
    });
    const requiredFiles = ['artisan', 'composer.json', path.join('vendor', 'autoload.php')];
    const missing = requiredFiles.filter(file => !fs.existsSync(path.join(staging, file)));
    if (missing.length) throw new Error(`Verifikasi Laravel gagal; file tidak ditemukan: ${missing.join(', ')}.`);
    const envFile = path.join(staging, '.env');
    if (!fs.existsSync(envFile)) {
      const envExample = path.join(staging, '.env.example');
      if (!fs.existsSync(envExample)) throw new Error('File .env dan .env.example tidak ditemukan; proyek tidak didaftarkan.');
      await fs.promises.copyFile(envExample, envFile, fs.constants.COPYFILE_EXCL);
    }
    let envContents = await fs.promises.readFile(envFile, 'utf8');
    if (/^DB_CONNECTION=.*$/m.test(envContents)) envContents = envContents.replace(/^DB_CONNECTION=.*$/m, 'DB_CONNECTION=sqlite');
    else envContents += `${envContents.endsWith('\n') ? '' : '\n'}DB_CONNECTION=sqlite\n`;
    if (/^DB_DATABASE=.*$/m.test(envContents)) envContents = envContents.replace(/^DB_DATABASE=.*$/m, 'DB_DATABASE=database/database.sqlite');
    else envContents += `${envContents.endsWith('\n') ? '' : '\n'}DB_DATABASE=database/database.sqlite\n`;
    await fs.promises.writeFile(envFile, envContents, { mode: 0o600 });
    await fs.promises.chmod(envFile, 0o600);
    const sqlitePath = path.join(staging, 'database', 'database.sqlite');
    if (!fs.existsSync(sqlitePath)) {
      await fs.promises.mkdir(path.dirname(sqlitePath), { recursive: true });
      await fs.promises.writeFile(sqlitePath, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    }
    const artisan = await runCommand(php.php, [path.join(staging, 'artisan'), '--version'], { cwd: staging, timeoutMs: 15000, maxBuffer: 4096 });
    const frameworkVersion = (`${artisan.stdout}\n${artisan.stderr}`).match(/Laravel Framework\s+(\d+\.\d+\.\d+)/i)?.[1];
    if (!frameworkVersion) throw new Error('artisan tidak dapat mengonfirmasi versi Laravel; proyek belum didaftarkan.');
    if (initializeGit) await runCommand(findOnPath('git'), ['init', staging], { cwd: WWW_ROOT, timeoutMs: 15000, maxBuffer: 4096 });
    if (fs.existsSync(target)) throw new Error(`Folder proyek ${slug} dibuat oleh proses lain; folder tersebut tidak diubah.`);
    const title = String(name).trim().replace(/[<>]/g, '').slice(0, 80) || slug;
    const manifest = { name: title, slug, type: 'php', framework: 'laravel', frameworkVersion, database: 'sqlite', createdAt: new Date().toISOString(), version: 1 };
    await fs.promises.writeFile(path.join(staging, 'sxl-project.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    await fs.promises.rename(staging, target);
    staging = '';
    return { message: `Laravel ${frameworkVersion} berhasil dibuat dan diverifikasi.`, project: { slug, name: title, type: 'php', framework: 'laravel', frameworkVersion, path: target, running: false }, log: `${result.stdout}\n${artisan.stdout}\n${result.stderr}\n${artisan.stderr}`.trim().slice(-10000) };
  } catch (error) {
    if (staging && fs.existsSync(staging)) preservedPath = staging;
    const details = error.message || 'Pembuatan proyek Laravel gagal.';
    throw new Error(`${details}${preservedPath ? ` File parsial dipertahankan untuk pemeriksaan: ${preservedPath}` : ''}`);
  } finally { activeProjectCreations.delete(slug); }
}
async function getDownloadCatalog() {
  const statuses = {};
  const metadataWarnings = [];
  try {
    const release = await getLaravelMetadata();
    statuses.laravel = { latestVersion: release.version, checkedAt: release.checkedAt };
  } catch (error) { metadataWarnings.push(`Laravel: ${error.message}`); }
  const detectedPhp = await inspectPhpRuntime();
  if (detectedPhp.php) statuses.php = { installed: true, version: detectedPhp.version, path: detectedPhp.php };
  const composer = await inspectComposer(detectedPhp.php);
  if (composer.installed) statuses.composer = { installed: true, version: composer.version, path: composer.path };
  const db = database.status();
  if (db.installed && db.versionVerified) statuses.mariadb = { installed: true, version: db.version || '', path: db.dataDirectory || '' };
  const apache = apacheStatus().apache;
  if (apache.installed && apache.binaryFound && apache.path) {
    try {
      const result = await runCommand(apache.path, ['-v'], { timeoutMs: 10000, maxBuffer: 4096 });
      const version = (`${result.stdout}\n${result.stderr}`).match(/Apache\/([\d.]+)/i)?.[1] || '';
      if (version) statuses.apache = { installed: true, version, path: apache.path };
    } catch {}
  }
  const nodePaths = runtimeInstaller.getNodePaths(DATA_ROOT);
  const configuredNode = runtimePaths.getRuntimePaths().nodeBinary;
  const node = [configuredNode, nodePaths.node, findOnPath('node')].filter(Boolean).find(file => fs.existsSync(file));
  if (node) {
    try { statuses.node = { installed: true, version: (await runCommand(node, ['--version'], { timeoutMs: 10000, maxBuffer: 4096 })).stdout.trim(), path: node }; } catch {}
  }
  for (const [id, command] of [['git', 'git'], ['bun', 'bun'], ['sqlite', 'sqlite3']]) {
    const binary = findOnPath(command);
    if (!binary) continue;
    try {
      const result = await runCommand(binary, ['--version'], { timeoutMs: 10000, maxBuffer: 4096 });
      statuses[id] = { installed: true, version: `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0], path: binary };
    } catch {}
  }
  const vscode = findOnPath('code');
  if (vscode) {
    try { statuses.vscode = { installed: true, version: (await runCommand(vscode, ['--version'], { timeoutMs: 10000, maxBuffer: 4096 })).stdout.split(/\r?\n/)[0], path: vscode }; } catch {}
  }
  return {
    items: downloadCenter.getCatalog(statuses, {
      apacheSupported: apache.installSupported,
      mariadbSupported: db.supported,
      platform: process.platform
    }),
    checkedAt: new Date().toISOString(),
    metadataWarnings,
    downloadsDirectory: path.join(DATA_ROOT, 'downloads'),
    runtimeDirectory: RUNTIME_ROOT
  };
}
async function installDownloadItem({ id } = {}) {
  if (!downloadCenter.getInstallAction(id)) throw new Error('Pemasangan otomatis tidak tersedia untuk item ini. Gunakan sumber resmi pada Detail.');
  if (id === 'php' && !['win32', 'darwin'].includes(process.platform)) throw new Error('Pemasangan PHP otomatis hanya didukung pada Windows x64 dan macOS.');
  if (id === 'apache' && !(['win32', 'darwin'].includes(process.platform) && (process.platform !== 'win32' || process.arch === 'x64'))) throw new Error('Pemasangan Apache otomatis tidak didukung pada platform ini.');
  if (id === 'mariadb' && !database.status().supported) throw new Error('Pemasangan MariaDB terkelola tidak didukung oleh platform atau versi yang dipilih.');
  if (activeManagedInstalls.has(id)) throw new Error('Pemasangan item ini sedang berlangsung.');
  activeManagedInstalls.add(id);
  try {
    if (id === 'php') await installPhpRuntime();
    else if (id === 'composer') await installComposer();
    else if (id === 'mariadb') await database.install();
    else if (id === 'apache') await installApache();
    const catalog = await getDownloadCatalog();
    const item = catalog.items.find(entry => entry.id === id);
    if (!item || item.status !== 'Installed') throw new Error(`Proses selesai, tetapi verifikasi ${id} belum berhasil.`);
    return { message: `${item.name} berhasil diverifikasi.`, item };
  } finally { activeManagedInstalls.delete(id); }
}
async function openProjectFolder({ slug } = {}) {
  const safeSlug = slugProjectName(slug);
  const folder = projectDirectory(safeSlug);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Folder proyek tidak ditemukan.');
  await openFolder(folder);
  return { message: `Folder proyek ${safeSlug} dibuka.`, path: folder };
}
function managedProjectPath(slug) {
  const safeSlug = slugProjectName(slug);
  const folder = projectDirectory(safeSlug);
  if (!fs.existsSync(folder) || !fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink()) {
    throw new Error('Folder proyek tidak ditemukan atau bukan direktori lokal.');
  }
  const realWorkspace = fs.realpathSync(WWW_ROOT);
  const realProject = fs.realpathSync(folder);
  if (path.dirname(realProject) !== realWorkspace) throw new Error('Lokasi asli proyek keluar dari workspace SXL.');
  if (!readProjectManifest(folder)) throw new Error('Proyek belum terdaftar atau formatnya tidak didukung.');
  return realProject;
}
async function previewProjectGitHub({ slug } = {}) {
  const projectPath = managedProjectPath(slug);
  return githubPublisher.previewProject({ projectPath });
}
async function publishProjectToGitHub({ slug, name, visibility, confirmFiles, confirmGitignore } = {}) {
  const projectPath = managedProjectPath(slug);
  return githubPublisher.publishProject({ projectPath, name, visibility, confirmFiles, confirmGitignore });
}
function registeredAppRecords() { return require('./lib/app-catalog').list({ dataRoot: DATA_ROOT }); }
function listRegisteredApps() {
  return registeredAppRecords().map(app => ({
    id: app.id, name: app.label, category: app.category, executable: app.executablePath,
    args: [...app.args], workingDirectory: app.cwd
  }));
}
function registerApp(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Informasi aplikasi harus berupa objek.');
  const label = input.name ?? input.label;
  if (typeof label !== 'string') throw new Error('Nama aplikasi harus berupa teks.');
  const generatedId = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').slice(0, 64);
  const executablePath = input.executable ?? input.executablePath;
  const cwd = input.workingDirectory ?? input.cwd ?? (typeof executablePath === 'string' ? path.dirname(executablePath) : '');
  const args = Array.isArray(input.args)
    ? input.args
    : typeof input.args === 'string' && input.args
      ? input.args.split(/\r?\n/)
      : [];
  const app = require('./lib/app-catalog').add({
    dataRoot: DATA_ROOT,
    input: {
      id: input.id || generatedId,
      label,
      category: input.category,
      executablePath,
      args,
      cwd
    }
  });
  return { id: app.id, name: app.label, category: app.category, executable: app.executablePath, args: app.args, workingDirectory: app.cwd };
}
function removeRegisteredApp(id) { return require('./lib/app-catalog').remove({ dataRoot: DATA_ROOT, id }); }
function launchRegisteredApp(id) {
  const selected = registeredAppRecords().find(app => app.id === id);
  if (!selected) throw new Error('Aplikasi tidak terdaftar.');
  const child = require('./lib/app-catalog').launch({ dataRoot: DATA_ROOT, id, spawnProcess: spawn });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({ message: `${selected.label} berhasil dibuka.`, app: selected.id });
    });
  });
}
async function openWorkspaceFolder() {
  ensureFolders();
  await openFolder(WWW_ROOT);
  return { message: 'Workspace SXL dibuka. Letakkan folder proyek di sini lalu klik Segarkan Project.', path: WWW_ROOT };
}

function shellQuote(value, platform = process.platform) {
  const text = String(value);
  if (platform === 'win32') return `'${text.replace(/'/g, "''")}'`;
  return `'${text.replace(/'/g, "'\\''")}'`;
}
function terminalLaunchSpec(folder, platform = process.platform) {
  const target = path.resolve(folder);
  if (platform === 'win32') return { command: process.env.SXL_POWERSHELL_PATH || 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', `Set-Location -LiteralPath ${shellQuote(target, platform)}`], cwd: target };
  if (platform === 'darwin') {
    const shellCommand = `cd ${shellQuote(target, platform)}`;
    const appleScriptString = `"${shellCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    return { command: 'osascript', args: ['-e', `tell application "Terminal" to do script ${appleScriptString}`], cwd: target };
  }
  return { command: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', `cd ${shellQuote(target, platform)}; exec bash -i`], cwd: target };
}
async function openTerminalFolder(folder) {
  ensureFolders();
  const target = path.resolve(folder);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error('Folder terminal tidak ditemukan.');
  const spec = terminalLaunchSpec(target);
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', error => reject(new Error(`Terminal tidak dapat dibuka: ${error.message}`)));
  });
  child.unref();
  return { message: `Terminal dibuka di ${target}.`, path: target };
}
function openProjectTerminal({ slug } = {}) {
  const safeSlug = slugProjectName(slug);
  const folder = projectDirectory(safeSlug);
  if (!fs.existsSync(folder)) throw new Error('Folder proyek tidak ditemukan.');
  return openTerminalFolder(folder);
}
function openWorkspaceTerminal() { return openTerminalFolder(WWW_ROOT); }

async function compatiblePhpForPhpMyAdmin() {
  for (const candidate of [...new Set(phpCandidates())]) {
    try {
      const result = await runCommand(candidate, ['-r', 'echo PHP_VERSION;'], { timeoutMs: 10000 });
      const version = result.stdout.trim();
      const match = version.match(/^(\d+)\.(\d+)/);
      if (match && Number(match[1]) >= 7 && (Number(match[1]) < 8 || (Number(match[1]) === 8 && Number(match[2]) < 4))) return { php: candidate, version };
    } catch {}
  }
  if (process.platform === 'win32') {
    const runtime = await runtimeInstaller.ensurePhpRuntime(DATA_ROOT, { forcePortable: true });
    const result = await runCommand(runtime.php, ['-r', 'echo PHP_VERSION;'], { timeoutMs: 10000 });
    const match = result.stdout.trim().match(/^(\d+)\.(\d+)/);
    if (match && Number(match[1]) === 8 && Number(match[2]) < 4) return { php: runtime.php, version: result.stdout.trim() };
  }
  throw new Error('phpMyAdmin 5.2.3 memerlukan PHP 7.2 sampai 8.3. Pada macOS, pasang PHP 8.3 (`brew install php@8.3`) dan atur SXL_PHP_PATH bila perlu.');
}
async function installPhpMyAdmin() {
  ensureFolders();
  const configured = runtimePaths.getRuntimePaths().phpMyAdminDir;
  if (configured && fs.existsSync(path.join(configured, 'index.php'))) {
    ensurePhpMyAdminConfig(configured);
    return { message: `phpMyAdmin manual terdeteksi di ${configured}.`, status: apacheStatus() };
  }
  const base = path.join(RUNTIME_ROOT, 'phpmyadmin');
  const appDir = path.join(base, 'app');
  if (fs.existsSync(path.join(appDir, 'index.php')) && fs.existsSync(path.join(appDir, 'config.inc.php'))) return { message: 'phpMyAdmin sudah terpasang.', status: apacheStatus() };
  const shaTextResponse = await fetch(`https://files.phpmyadmin.net/phpMyAdmin/${PMA_VERSION}/${PMA_FILENAME}.sha256`, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
  if (!shaTextResponse.ok) throw new Error(`Checksum resmi phpMyAdmin tidak dapat diunduh (HTTP ${shaTextResponse.status}). Instalasi dibatalkan.`);
  const shaFinal = new URL(shaTextResponse.url);
  if (shaFinal.hostname !== 'files.phpmyadmin.net' || shaFinal.protocol !== 'https:') throw new Error('Host checksum phpMyAdmin tidak tepercaya.');
  const expected = ((await shaTextResponse.text()).match(/[a-f0-9]{64}/i) || [])[0];
  if (!expected) throw new Error('Format checksum resmi phpMyAdmin tidak valid.');
  const archiveBytes = await fetchBuffer(PMA_URL, 50 * 1024 * 1024, ['files.phpmyadmin.net']);
  const actual = crypto.createHash('sha256').update(archiveBytes).digest('hex');
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error('Checksum phpMyAdmin tidak cocok. Arsip ditolak.');
  const downloads = path.join(RUNTIME_ROOT, 'downloads'); fs.mkdirSync(downloads, { recursive: true });
  const archivePath = path.join(downloads, PMA_FILENAME); fs.writeFileSync(archivePath, archiveBytes, { mode: 0o600 });
  const staging = `${base}.staging-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await extractZip(archivePath, staging);
    const extracted = path.join(staging, `phpMyAdmin-${PMA_VERSION}-all-languages`);
    if (!fs.existsSync(path.join(extracted, 'index.php'))) throw new Error('index.php tidak ditemukan di arsip phpMyAdmin.');
    const php = await compatiblePhpForPhpMyAdmin();
    const dbStatus = database.status();
    const port = Number(dbStatus.port || 3307);
    const blowfish = crypto.randomBytes(32).toString('hex');
    const config = `<?php\n$cfg['blowfish_secret'] = '${blowfish}';\n$i = 0;\n$i++;\n$cfg['Servers'][$i]['auth_type'] = 'cookie';\n$cfg['Servers'][$i]['host'] = '127.0.0.1';\n$cfg['Servers'][$i]['port'] = '${port}';\n$cfg['Servers'][$i]['connect_type'] = 'tcp';\n$cfg['Servers'][$i]['AllowNoPassword'] = true;\n$cfg['Servers'][$i]['compress'] = false;\n$cfg['UploadDir'] = '';\n$cfg['SaveDir'] = '';\n$cfg['TempDir'] = __DIR__ . '/tmp/';\n`;
    fs.mkdirSync(path.join(extracted, 'tmp'), { recursive: true });
    fs.writeFileSync(path.join(extracted, 'config.inc.php'), config, { mode: 0o600 });
    fs.chmodSync(path.join(extracted, 'config.inc.php'), 0o600);
    fs.mkdirSync(base, { recursive: true });
    await fs.promises.rm(appDir, { recursive: true, force: true });
    await fs.promises.rename(extracted, appDir);
    await fs.promises.writeFile(path.join(base, 'runtime.json'), JSON.stringify({ version: PMA_VERSION, phpVersion: php.version, installedAt: new Date().toISOString(), source: PMA_URL, sha256: actual }, null, 2), { mode: 0o600 });
    return { message: `phpMyAdmin ${PMA_VERSION} berhasil dipasang (PHP ${php.version}, SHA-256 cocok).`, status: apacheStatus() };
  } catch (error) {
    await fs.promises.rm(staging, { recursive: true, force: true });
    throw error;
  } finally { await fs.promises.rm(archivePath, { force: true }).catch(() => {}); }
}
function ensurePhpMyAdminConfig(appDir) {
  const configFile = path.join(appDir, 'config.inc.php');
  if (fs.existsSync(configFile)) {
    const existing = fs.readFileSync(configFile, 'utf8');
    const localCookieConfig = /\$cfg\[['"]Servers['"]\]\[\$i\]\[['"]host['"]\]\s*=\s*['"]127\.0\.0\.1['"]\s*;/.test(existing)
      && /\$cfg\[['"]Servers['"]\]\[\$i\]\[['"]auth_type['"]\]\s*=\s*['"]cookie['"]\s*;/.test(existing);
    if (localCookieConfig) {
      const updated = existing
        .replace(/(\$cfg\[['"]Servers['"]\]\[\$i\]\[['"]AllowNoPassword['"]\]\s*=\s*)false(\s*;)/, '$1true$2')
        .replace(/(\$cfg\[['"]Servers['"]\]\[\$i\]\[['"]connect_type['"]\]\s*=\s*['"]tcp['"]\s*;)(?![\s\S]*AllowNoPassword)/, "$1\n$cfg['Servers'][$i]['AllowNoPassword'] = true;");
      if (updated !== existing) {
        fs.writeFileSync(configFile, updated, { mode: 0o600 });
        try { fs.chmodSync(configFile, 0o600); } catch {}
      }
    }
    return;
  }
  if (!fs.existsSync(path.join(appDir, 'index.php'))) throw new Error('Folder phpMyAdmin manual harus berisi index.php.');
  const dbStatus = database.status();
  const secret = crypto.randomBytes(32).toString('hex');
  const contents = `<?php\n$cfg['blowfish_secret'] = '${secret}';\n$i = 0;\n$i++;\n$cfg['Servers'][$i]['auth_type'] = 'cookie';\n$cfg['Servers'][$i]['host'] = '127.0.0.1';\n$cfg['Servers'][$i]['port'] = '${Number(dbStatus.port || 3307)}';\n  $cfg['Servers'][$i]['connect_type'] = 'tcp';\n$cfg['Servers'][$i]['AllowNoPassword'] = true;\n$cfg['Servers'][$i]['compress'] = false;\n$cfg['UploadDir'] = '';\n$cfg['SaveDir'] = '';\n$cfg['TempDir'] = __DIR__ . '/tmp/';\n`;
  fs.mkdirSync(path.join(appDir, 'tmp'), { recursive: true });
  fs.writeFileSync(configFile, contents, { mode: 0o600 });
  try { fs.chmodSync(configFile, 0o600); } catch {}
}
async function startPhpMyAdmin() {
  if (isPmaRunning()) return { message: 'phpMyAdmin sudah berjalan.', status: apacheStatus() };
  const appDir = configuredPhpMyAdminPath();
  if (!fs.existsSync(path.join(appDir, 'index.php'))) throw new Error('Folder phpMyAdmin belum memiliki index.php. Isi path manual atau pasang phpMyAdmin.');
  ensurePhpMyAdminConfig(appDir);
  const dbStatus = database.status();
  if (!dbStatus.running) throw new Error('Jalankan MariaDB terlebih dahulu, lalu buka phpMyAdmin.');
  await database.enablePhpMyAdminRootNoPassword();
  ensurePhpMyAdminConfig(appDir);
  const php = await compatiblePhpForPhpMyAdmin();
  const port = await choosePort(8081);
  const child = spawn(php.php, ['-S', `127.0.0.1:${port}`, '-t', appDir], { cwd: appDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  state.phpMyAdmin.process = child; state.phpMyAdmin.port = port; state.phpMyAdmin.log = ''; state.phpMyAdmin.lastError = null;
  const append = chunk => { state.phpMyAdmin.log = (state.phpMyAdmin.log + chunk.toString()).slice(-10000); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  child.once('error', error => { state.phpMyAdmin.lastError = `phpMyAdmin gagal dijalankan: ${error.message}`; if (state.phpMyAdmin.process === child) state.phpMyAdmin.process = null; });
  child.once('exit', (code, signal) => { if (state.phpMyAdmin.process === child) state.phpMyAdmin.process = null; if (code !== 0 && code !== null) state.phpMyAdmin.lastError = `phpMyAdmin berhenti (code=${code}, signal=${signal || 'none'}). ${state.phpMyAdmin.log.slice(-1000)}`; });
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`phpMyAdmin berhenti saat startup. ${state.phpMyAdmin.log.slice(-1200)}`);
    if (await canConnect(port)) { state.phpMyAdmin.startedAt = new Date().toISOString(); return { message: `phpMyAdmin aktif di http://127.0.0.1:${port}. Login MariaDB: root tanpa password (khusus koneksi lokal).`, status: apacheStatus() }; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  try { child.kill(); } catch {} state.phpMyAdmin.process = null;
  throw new Error('phpMyAdmin tidak merespons pada port yang dipilih.');
}
async function stopPhpMyAdmin() {
  const child = state.phpMyAdmin.process;
  if (!child || child.exitCode !== null) { state.phpMyAdmin.process = null; return { message: 'phpMyAdmin tidak sedang berjalan.', status: apacheStatus() }; }
  try { child.kill(); } catch {}
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
  state.phpMyAdmin.process = null; state.phpMyAdmin.startedAt = null;
  return { message: 'phpMyAdmin dihentikan.', status: apacheStatus() };
}

async function diagnoseEnvironment() {
  const checks = [];
  const add = (key, label, status, message, details = '') => checks.push({ key, label, status, message, details: String(details || '').slice(0, 2400) });
  const runtime = runtimePaths.runtimePathStatus();
  for (const key of ['phpBinary', 'phpCgiBinary', 'apacheBinary', 'composerPhar', 'nodeBinary', 'npmCli', 'mariaDbBinDir', 'phpMyAdminDir', 'cloudflaredBinary']) {
    const row = runtime.status[key];
    if (!row.configured) continue;
    add(`path-${key}`, runtimePaths.FIELDS[key].label, row.exists ? 'ok' : 'fail', row.exists ? 'Path terkonfigurasi dan ditemukan.' : 'Path tersimpan tetapi tidak ditemukan atau tidak valid.', row.path);
  }

  const php = phpRuntimeStatus();
  if (php.activePath && fs.existsSync(php.activePath)) {
    try {
      const result = await runCommand(php.activePath, ['-r', 'echo PHP_VERSION . "\\n" . json_encode(["curl"=>extension_loaded("curl"),"mbstring"=>extension_loaded("mbstring"),"openssl"=>extension_loaded("openssl"),"pdo_mysql"=>extension_loaded("pdo_mysql"),"mysqli"=>extension_loaded("mysqli"),"zip"=>extension_loaded("zip")]);'], { timeoutMs: 10000, maxBuffer: 4096 });
      const lines = result.stdout.trim().split(/\r?\n/);
      let extensions = {};
      try { extensions = JSON.parse(lines.slice(1).join('\n')); } catch {}
      const missing = Object.entries(extensions).filter(([, enabled]) => !enabled).map(([name]) => name);
      add('php-cli', 'PHP CLI', 'ok', `PHP ${lines[0] || 'versi tidak diketahui'} dapat dijalankan.`, php.activePath);
      add('php-extensions', 'Ekstensi PHP', missing.length ? 'warn' : 'ok', missing.length ? `Ekstensi belum aktif: ${missing.join(', ')}.` : 'Ekstensi umum tersedia: curl, mbstring, openssl, PDO MySQL, mysqli, zip.', JSON.stringify(extensions));
    } catch (error) {
      add('php-cli', 'PHP CLI', 'fail', 'PHP yang dipilih tidak dapat dijalankan.', error.message);
    }
  } else add('php-cli', 'PHP CLI', 'warn', 'Belum ada PHP aktif. Pilih folder versi PHP atau pasang runtime.');

  const versions = await getPhpVersions().catch(error => ({ versions: [], error }));
  const executableVersions = (versions.versions || []).filter(item => item.executable && !item.error);
  add('php-versions', 'Koleksi versi PHP', versions.error ? 'warn' : executableVersions.length ? 'ok' : 'warn', versions.error ? 'Pemindaian versi PHP gagal.' : `${executableVersions.length} versi PHP dapat dijalankan dari koleksi SXL dan path manual.`, versions.error?.message || (versions.root || ''));
  for (const project of listProjects().filter(item => item.type === 'php' && item.phpBinary)) {
    try {
      const selected = await getProjectPhpRuntime(project.slug);
      add(`project-php-${project.slug}`, `PHP proyek ${project.slug}`, 'ok', `PHP ${selected.version} dan PHP-CGI cocok.`, selected.php);
    } catch (error) {
      add(`project-php-${project.slug}`, `PHP proyek ${project.slug}`, 'fail', 'Runtime PHP khusus proyek perlu diperbaiki.', error.message);
    }
  }

  const apache = apachePaths();
  if (!apache) add('apache', 'Apache HTTP Server', 'warn', 'Binary Apache tidak ditemukan.', 'Pilih httpd.exe/httpd di konfigurasi runtime manual atau pasang Apache.');
  else {
    let targetConfig = state.apache.config && fs.existsSync(state.apache.config) ? state.apache.config : apache.baseConfig;
    if (!targetConfig) add('apache-config', 'Konfigurasi Apache', 'fail', 'httpd.conf tidak ditemukan.', apache.root);
    else {
      try {
        const result = await runCommand(apache.binary, ['-t', '-f', targetConfig], { cwd: apache.root, timeoutMs: 15000, maxBuffer: 6000 });
        add('apache-config', 'Konfigurasi Apache', 'ok', result.stdout.trim() || result.stderr.trim() || 'Syntax OK', targetConfig);
      } catch (error) {
        add('apache-config', 'Konfigurasi Apache', 'fail', 'Pemeriksaan sintaks Apache gagal.', `${targetConfig}\n${error.message}`);
      }
    }
    add('apache-running', 'Status Apache', state.apache.process && state.apache.process.exitCode === null ? 'ok' : 'warn', state.apache.process && state.apache.process.exitCode === null ? `Apache berjalan pada port ${state.apache.port}.` : 'Apache sedang berhenti.', state.apache.lastError || apache.binary);
  }

  const db = database.status();
  const dbReachable = await canConnect(db.port, 700);
  add('database', 'MariaDB', db.running && dbReachable ? 'ok' : db.installed && db.initialized ? (dbReachable ? 'warn' : 'warn') : 'warn', db.running && dbReachable ? `MariaDB merespons pada ${db.host}:${db.port}.` : db.installed && db.initialized ? 'MariaDB terpasang tetapi belum terdeteksi aktif atau port tidak merespons.' : 'MariaDB belum terpasang dan diinisialisasi.', db.lastError || db.dataDirectory);

  const composer = configuredComposerPath();
  if (fs.existsSync(composer) && php.activePath) {
    try {
      const result = await runCommand(php.activePath, [composer, '--version', '--no-ansi'], { timeoutMs: 15000, maxBuffer: 4000 });
      add('composer', 'Composer', 'ok', result.stdout.trim().split(/\r?\n/)[0] || 'Composer dapat dijalankan.', composer);
    } catch (error) { add('composer', 'Composer', 'fail', 'Composer ditemukan tetapi tidak dapat dijalankan dengan PHP aktif.', error.message); }
  } else add('composer', 'Composer', 'warn', 'Composer belum ditemukan atau PHP aktif belum tersedia.', composer);

  const pma = configuredPhpMyAdminPath();
  add('phpmyadmin', 'phpMyAdmin', fs.existsSync(path.join(pma, 'index.php')) ? 'ok' : 'warn', fs.existsSync(path.join(pma, 'index.php')) ? (isPmaRunning() ? `phpMyAdmin aktif di port ${state.phpMyAdmin.port}.` : 'phpMyAdmin tersedia, tetapi belum dijalankan.') : 'phpMyAdmin belum dipasang.', pma);

  const failed = checks.filter(item => item.status === 'fail').length;
  const warning = checks.filter(item => item.status === 'warn').length;
  return { generatedAt: new Date().toISOString(), platform: process.platform, summary: { total: checks.length, ok: checks.filter(item => item.status === 'ok').length, warning, failed }, checks };
}

async function startAllServices() {
  const results = [];
  const db = database.status();
  if (db.installed && db.initialized && !db.running) {
    try { const result = await database.start(); results.push(`MariaDB: ${result.message}`); }
    catch (error) { results.push(`MariaDB gagal: ${error.message}`); }
  } else if (db.running) results.push('MariaDB: sudah aktif');
  else results.push('MariaDB: belum terpasang; tekan Pasang MariaDB');

  const apache = apacheStatus().apache;
  if (apache.installed && !apache.running) {
    try { const result = await startApache(); results.push(`Apache: ${result.message}`); }
    catch (error) { results.push(`Apache gagal: ${error.message}`); }
  } else if (apache.running) results.push('Apache: sudah aktif');
  else results.push('Apache: belum terpasang; tekan Pasang Apache');

  const pma = apacheStatus().phpMyAdmin;
  if (pma.installed && database.status().running && !pma.running) {
    try { const result = await startPhpMyAdmin(); results.push(`phpMyAdmin: ${result.message}`); }
    catch (error) { results.push(`phpMyAdmin gagal: ${error.message}`); }
  } else if (pma.running) results.push('phpMyAdmin: sudah aktif');
  else if (pma.installed) results.push('phpMyAdmin: tunggu MariaDB aktif untuk menjalankannya');
  else results.push('phpMyAdmin: belum terpasang; tekan Pasang phpMyAdmin');
  return { message: results.join('\n'), results, status: { ...apacheStatus(), database: database.status() } };
}
async function stopAllServices() {
  const results = [];
  for (const slug of [...state.projects.keys()]) {
    try { const result = await stopProject({ slug, refreshApache: false }); results.push(`Proyek ${slug}: ${result.message}`); }
    catch (error) { results.push(`Proyek ${slug} gagal dihentikan: ${error.message}`); }
  }
  for (const [name, action] of [['phpMyAdmin', stopPhpMyAdmin], ['Apache', stopApache], ['MariaDB', database.stop]]) {
    try { const result = await action(); results.push(`${name}: ${result.message}`); }
    catch (error) { results.push(`${name} gagal: ${error.message}`); }
  }
  return { message: results.join('\n'), results, status: { ...apacheStatus(), database: database.status() } };
}

function openBrowser(url) {
  if (!/^http:\/\/(?:127\.0\.0\.1|[a-z0-9-]+\.localhost):\d{1,5}\/?$/i.test(url)) throw new Error('URL hanya boleh membuka layanan lokal SXL.');
  let command, args;
  if (process.platform === 'win32') { command = 'cmd.exe'; args = ['/d', '/s', '/c', 'start', '""', url]; }
  else if (process.platform === 'darwin') { command = 'open'; args = [url]; }
  else { command = 'xdg-open'; args = [url]; }
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }); child.unref();
  return { message: `Membuka ${url}.` };
}
async function freePort(start = 9000) { return choosePort(start); }
async function waitHttp(port, child, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server proyek berhenti saat startup. ${state.projects.values().next().value?.log || ''}`);
    const ready = await new Promise(resolve => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/', timeout: 600 }, res => { res.resume(); resolve(true); });
      req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (ready) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Server proyek tidak merespons pada port ${port} dalam ${Math.round(timeoutMs / 1000)} detik.`);
}
function safeRelativePath(root, rawUrlPath) {
  let decoded;
  try { decoded = decodeURIComponent(rawUrlPath); } catch { return null; }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.includes(':')) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || part.startsWith('.') || PRIVATE_NAMES.has(part.toLowerCase()) || PRIVATE_EXTENSIONS.has(path.extname(part).toLowerCase()))) return null;
  const target = path.resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}
function createLocalStaticServer(root) {
  const rootReal = fs.realpathSync(root);
  return http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    let rawPath;
    try { rawPath = new URL(req.url || '/', 'http://127.0.0.1').pathname; } catch { res.writeHead(400); return res.end('Invalid URL'); }
    let target = safeRelativePath(rootReal, rawPath);
    if (!target) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end('Not found'); }
    try {
      let real = await fs.promises.realpath(target);
      if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw new Error('outside root');
      const stat = await fs.promises.stat(real);
      if (stat.isDirectory()) { real = path.join(real, 'index.html'); const indexReal = await fs.promises.realpath(real); if (!indexReal.startsWith(rootReal + path.sep)) throw new Error('outside root'); real = indexReal; }
      if (!fs.statSync(real).isFile()) throw new Error('not a file');
      const headers = { 'Content-Type': MIME[path.extname(real).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'" };
      res.writeHead(200, headers); if (req.method === 'HEAD') return res.end();
      fs.createReadStream(real).on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); }).pipe(res);
    } catch { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end('Not found'); }
  });
}
async function startProject({ slug, installDependencies = false } = {}) {
  const safeSlug = slugProjectName(slug);
  const folder = projectDirectory(safeSlug);
  const manifest = readProjectManifest(folder);
  if (!manifest) throw new Error('Proyek tidak ditemukan atau tidak memiliki tipe proyek yang dikenali.');
  const existing = state.projects.get(safeSlug);
  if (existing && ((existing.server && existing.server.listening) || (existing.process && existing.process.exitCode === null))) {
    if (existing.type === 'php' && isApacheRunning()) syncProjectApacheUrls();
    return { message: 'Proyek sudah berjalan.', project: { slug: safeSlug, url: existing.url, port: existing.port } };
  }

  let port = null, runtime = null, child = null, server = null;
  let entry = null;
  if (manifest.type === 'php') {
    ensureFolders();
    if (manifest.framework === 'laravel') {
      if (!fs.existsSync(path.join(folder, 'artisan')) || !fs.existsSync(path.join(folder, 'vendor', 'autoload.php')) || !fs.existsSync(path.join(folder, 'public', 'index.php'))) {
        throw new Error('Struktur Laravel atau dependensi vendor belum lengkap. Perbaiki proyek sebelum menjalankan server.');
      }
      const selectedPhp = projectSettingsStore.getProjectSettings(safeSlug).phpBinary;
      const php = selectedPhp
        ? { php: selectedPhp, version: (await runCommand(selectedPhp, ['-r', 'echo PHP_VERSION;'], { timeoutMs: 10000, maxBuffer: 4096 })).stdout.trim() }
        : await inspectPhpRuntime();
      if (!php.php || !/^\d+\.\d+\.\d+$/.test(php.version)) throw new Error('PHP CLI proyek tidak dapat diverifikasi. Pasang atau pilih versi PHP terlebih dahulu.');
      const versionCheck = await runCommand(php.php, [path.join(folder, 'artisan'), '--version'], { cwd: folder, timeoutMs: 15000, maxBuffer: 4096 });
      if (!/Laravel Framework\s+\d+\.\d+\.\d+/i.test(`${versionCheck.stdout}\n${versionCheck.stderr}`)) throw new Error('Versi Laravel proyek tidak dapat diverifikasi melalui artisan.');
      port = await freePort(8000);
      child = spawn(php.php, [path.join(folder, 'artisan'), 'serve', '--host=127.0.0.1', `--port=${port}`], {
        cwd: folder, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, APP_ENV: 'local', PATH: `${path.dirname(php.php)}${path.delimiter}${process.env.PATH || ''}` }
      });
      entry = { slug: safeSlug, type: 'php', framework: 'laravel', port, url: `http://127.0.0.1:${port}`, process: child, server: null, startedAt: new Date().toISOString(), log: '' };
      state.projects.set(safeSlug, entry);
      const append = chunk => { entry.log = (entry.log + chunk.toString()).slice(-12000); };
      child.stdout?.on('data', append); child.stderr?.on('data', append);
      child.once('exit', () => { if (state.projects.get(safeSlug) === entry) { entry.process = null; entry.url = null; } });
      child.once('error', error => { entry.log = `${entry.log}\n${error.message}`.slice(-12000); });
      try { await waitHttp(port, child); }
      catch (error) { await stopProject({ slug: safeSlug }); throw new Error(`${error.message} ${entry.log.slice(-1200)}`); }
      return {
        message: `Laravel ${safeSlug} berjalan di ${entry.url}.`,
        project: { slug: safeSlug, name: manifest.name, type: 'php', framework: 'laravel', frameworkVersion: manifest.frameworkVersion || null, port, url: entry.url, running: true }
      };
    }
    const install = apachePaths();
    if (!install?.baseConfig) throw new Error('Proyek PHP sekarang dijalankan melalui Apache + FastCGI. Pasang Apache terlebih dahulu, lalu jalankan ulang proyek.');

    const projectPhpSelection = projectSettingsStore.getProjectSettings(safeSlug);
    let php;
    if (projectPhpSelection.phpBinary) {
      php = await getProjectPhpRuntime(safeSlug);
    } else {
      try { php = await activePhpRuntime(); }
      catch { await installPhpRuntime(); php = await activePhpRuntime(); }
    }
    const cgi = php.phpCgiBinary || phpCgiCandidates(php.php);
    if (!cgi) throw new Error(`PHP CLI ditemukan (${php.php}), tetapi php-cgi tidak ditemukan pada folder versi aktif. Pilih distribusi PHP yang menyertakan php-cgi.exe atau gunakan versi itu untuk CLI/Composer saja.`);
    let cgiVersion = '';
    try {
      const cgiInfo = await runCommand(cgi, ['-v'], { timeoutMs: 7000, maxBuffer: 4096 });
      cgiVersion = (`${cgiInfo.stdout}\n${cgiInfo.stderr}`.match(/PHP\s+(\d+\.\d+\.\d+)/i) || [])[1] || '';
    } catch (error) { throw new Error(`PHP-CGI tidak dapat dijalankan: ${error.message}`); }
    if (!cgiVersion || cgiVersion !== php.version) throw new Error(`PHP-CGI harus sama versinya dengan PHP CLI. PHP CLI: ${php.version}; PHP-CGI: ${cgiVersion || 'versi tidak terbaca'}. Pilih folder versi yang benar.`);
    for (const moduleName of ['dir_module', 'proxy_module', 'proxy_fcgi_module', 'rewrite_module']) {
      if (!apacheModulePath(install, moduleName)) throw new Error(`Apache tidak memiliki mod_${moduleName}.so. Instal ulang Apache dengan paket lengkap sebelum menjalankan PHP.`);
    }

    if (fs.existsSync(path.join(folder, 'artisan')) && fs.existsSync(path.join(folder, 'public', 'index.php')) && !fs.existsSync(path.join(folder, 'vendor', 'autoload.php'))) {
      throw new Error('Laravel belum memiliki vendor/autoload.php. Jalankan Composer Install untuk proyek tepercaya terlebih dahulu.');
    }
    const docroot = projectDocumentRoot({ path: folder });
    if (!fs.existsSync(path.join(docroot, 'index.php')) && !fs.existsSync(path.join(docroot, 'index.html'))) {
      throw new Error('Document root proyek PHP harus memiliki index.php atau index.html. Untuk Laravel, gunakan public/index.php.');
    }
    const fcgiPort = await choosePort(9100);
    const phpEnv = { ...process.env, PHP_FCGI_MAX_REQUESTS: '10000', FCGI_WEB_SERVER_ADDRS: '127.0.0.1' };
    if (fs.existsSync(path.join(path.dirname(php.php), 'php.ini'))) phpEnv.PHPRC = path.dirname(php.php);
    child = spawn(cgi, ['-b', `127.0.0.1:${fcgiPort}`], {
      cwd: path.dirname(cgi), env: phpEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    child.__sxlLog = '';
    child.once('error', error => { child.__sxlSpawnError = error; });
    try { await waitForTcpPort(fcgiPort, child, 10000); }
    catch (error) { await stopChildProcess(child); throw error; }

    entry = {
      slug: safeSlug, type: 'php', fcgiPort, phpCgiPath: cgi, phpVersion: php.version, phpEnv,
      port: null, url: null, process: child, server: null, startedAt: new Date().toISOString(), log: '', restartTimes: []
    };
    const apacheWasRunning = isApacheRunning();
    state.projects.set(safeSlug, entry);
    attachPhpCgiWorker(entry, child);
    try {
      if (apacheWasRunning) await stopApache({ stopPhpBackends: false });
      await startApache();
      syncProjectApacheUrls();
    } catch (error) {
      // Prevent the PHP-CGI supervisor from respawning a worker while this
      // failed project startup is being rolled back.
      entry.stopping = true;
      if (entry.restartTimer) clearTimeout(entry.restartTimer);
      state.projects.delete(safeSlug);
      await stopChildProcess(child);
      if (apacheWasRunning && !isApacheRunning()) {
        try { await startApache(); } catch (recoveryError) { state.apache.lastError = `Apache gagal kembali aktif: ${recoveryError.message}`; }
      }
      throw new Error(`Tidak dapat menerbitkan virtual host PHP melalui Apache: ${error.message}`);
    }
    return {
      message: `Proyek PHP ${safeSlug} berjalan melalui Apache + FastCGI.`,
      project: { slug: safeSlug, name: manifest.name, type: 'php', port: state.apache.port, fcgiPort, url: entry.url, running: true }
    };
  }

  port = await freePort(9000);
  if (manifest.type === 'static') {
    server = createLocalStaticServer(folder);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } else if (manifest.type === 'node') {
    runtime = await runtimeInstaller.ensureNodeRuntime(DATA_ROOT);
    let packageJson;
    try { packageJson = JSON.parse(await fs.promises.readFile(path.join(folder, 'package.json'), 'utf8')); } catch { throw new Error('package.json tidak valid.'); }
    if (typeof packageJson.scripts?.start !== 'string' || !packageJson.scripts.start.trim()) throw new Error('package.json memerlukan scripts.start.');
    if (!fs.existsSync(path.join(folder, 'node_modules')) && Object.keys(packageJson.dependencies || {}).length) {
      if (!installDependencies) throw new Error('Dependensi npm belum terpasang. Jalankan lagi dan setujui npm install untuk proyek tepercaya.');
      await runCommand(runtime.node, [runtime.npmCli, 'install', '--no-audit', '--no-fund'], { cwd: folder, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PATH: `${runtime.binDir}${path.delimiter}${process.env.PATH || ''}` }, timeoutMs: 10 * 60 * 1000 });
    }
    child = spawn(runtime.node, [runtime.npmCli, 'run', 'start'], { cwd: folder, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', HOSTNAME: '127.0.0.1', BIND: '127.0.0.1', PATH: `${runtime.binDir}${path.delimiter}${process.env.PATH || ''}` } });
  }
  entry = { slug: safeSlug, type: manifest.type, port, url: `http://127.0.0.1:${port}`, process: child, server, startedAt: new Date().toISOString(), log: '' };
  state.projects.set(safeSlug, entry);
  if (child) {
    const append = chunk => { entry.log = (entry.log + chunk.toString()).slice(-12000); };
    child.stdout?.on('data', append); child.stderr?.on('data', append);
    child.once('exit', () => { if (state.projects.get(safeSlug) === entry) { entry.process = null; entry.url = null; } });
    child.once('error', err => { entry.log += `\n${err.message}`; });
  }
  try { if (child) await waitHttp(port, child); }
  catch (error) { await stopProject({ slug: safeSlug }); throw new Error(`${error.message} ${entry.log.slice(-1200)}`); }
  return { message: `Proyek ${safeSlug} aktif di ${entry.url}.`, project: { slug: safeSlug, name: manifest.name, type: manifest.type, port, url: entry.url, running: true } };
}
async function stopProject({ slug, refreshApache = true } = {}) {
  const safeSlug = slugProjectName(slug);
  const entry = state.projects.get(safeSlug);
  if (!entry) return { message: 'Proyek tidak sedang berjalan.' };
  const wasPhp = entry.type === 'php' && Boolean(entry.fcgiPort);
  entry.stopping = true;
  if (entry.restartTimer) clearTimeout(entry.restartTimer);
  await stopChildProcess(entry.process);
  if (entry.server?.listening) await new Promise(resolve => entry.server.close(() => resolve()));
  state.projects.delete(safeSlug);
  let extra = '';
  if (wasPhp && refreshApache && isApacheRunning()) {
    try {
      await stopApache({ stopPhpBackends: false });
      await startApache();
      syncProjectApacheUrls();
    } catch (error) {
      extra = ` Apache perlu diperiksa: ${error.message}`;
      state.apache.lastError = error.message;
    }
  }
  return { message: `Proyek ${safeSlug} dihentikan.${extra}` };
}

async function shutdown() {
  await Promise.allSettled([...state.projects.keys()].map(slug => stopProject({ slug, refreshApache: false })));
  await Promise.allSettled([stopApache(), stopPhpMyAdmin()]);
}

module.exports = {
  DATA_ROOT, WWW_ROOT, PMA_VERSION, slugProjectName, projectDirectory, readProjectManifest, listProjects, createProject,
  apacheCandidates, apachePaths, buildApacheConfig, projectVirtualHosts, projectDocumentRoot, renderPhpProjectVhost, apacheModulePath, ensureApacheModules, phpCgiCandidates, apacheStatus, installApache, startApache, stopApache, parseApacheManifestSha256, verifySha256, expectedApacheSha256, isAllowedHttpsUrl,
  installPhpMyAdmin, startPhpMyAdmin, stopPhpMyAdmin, compatiblePhpForPhpMyAdmin, openBrowser,
  installPhpRuntime, installComposer, composerInstallProject, openProjectFolder, openWorkspaceFolder, openProjectTerminal, openWorkspaceTerminal, terminalLaunchSpec, phpRuntimeStatus, getPhpVersions, selectPhpVersion, setProjectPhpVersion, getProjectPhpRuntime, diagnoseEnvironment, openPhpVersionsFolder, prepareManagedPhpIni, startAllServices, stopAllServices,
  startProject, stopProject, status: apacheStatus, shutdown, safeRelativePath, createLocalStaticServer,
  checkProjectDependencies, createLaravelProject, getDownloadCatalog, installDownloadItem,
  getManualRuntimePaths, saveManualRuntimePaths, previewProjectGitHub, publishProjectToGitHub,
  listRegisteredApps, registerApp, removeRegisteredApp, launchRegisteredApp
};
