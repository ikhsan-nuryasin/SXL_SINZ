'use strict';

// SXL Localhost Website Sharing
// Admin API and the database stay on loopback. The public Cloudflare Tunnel reaches only
// the selected preview service, optionally protected by an outer HTTP Basic authentication gate.

const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { URL } = require('node:url');
const database = require('./database');
const { DatabaseEngineManager } = require('./lib/database-engines');
const services = require('./services');
const runtimePaths = require('./lib/runtime-paths');
const { isValidSharePassword, isBasicAuthorized, basicChallengeHeaders, sendBasicChallenge } = require('./lib/basic-auth');
const { normalizeAllowedEmails, getProtectionMode, buildTunnelArgs, validatePublicAccess } = require('./lib/share-options');

const execFileAsync = promisify(execFile);
const HOST = '127.0.0.1';
const REQUESTED_ADMIN_PORT = Number(process.env.SXL_SHARING_PORT ?? 4177);
const DEFAULT_PREVIEW_PORT = Number(process.env.SXL_PREVIEW_PORT || 5180);
const WEB_ROOT = process.env.SXL_APP_ROOT || __dirname;
const DATA_ROOT = process.env.SXL_DATA_DIR || WEB_ROOT;
const RUNTIME_ROOT = path.join(DATA_ROOT, 'runtime');
const databaseEngines = new DatabaseEngineManager(DATA_ROOT);
const CSRF_TOKEN = crypto.randomBytes(32).toString('hex');
let ADMIN_PORT = REQUESTED_ADMIN_PORT;
let sharingStartInFlight = false;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4'
};

const BLOCKED_NAMES = new Set([
  'node_modules', 'vendor', '.git', '.svn', '.hg', '.idea', '.vscode',
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
  'composer.json', 'composer.lock', 'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  'web.config', 'thumbs.db', 'desktop.ini', 'config.json', 'config.local.json',
  'settings.json', 'settings.local.json', 'credentials.json', 'secrets.json', 'service-account.json',
  'database.sql', 'database.sqlite', 'database.db'
]);
const BLOCKED_EXTENSIONS = new Set([
  '.php', '.phtml', '.phar', '.asp', '.aspx', '.jsp', '.cgi', '.pl', '.py', '.rb',
  '.sql', '.sqlite', '.sqlite3', '.db', '.bak', '.backup', '.old', '.orig', '.tmp', '.temp',
  '.log', '.pem', '.key', '.p12', '.pfx', '.crt', '.cer', '.der', '.jks', '.keystore',
  '.env', '.swp', '.swo', '.ps1', '.bat', '.cmd', '.sh'
]);

const state = {
  previewServer: null,
  previewRoot: null,
  previewPort: null,
  previewType: null,
  accessProtected: false,
  runtimeProcess: null,
  runtimeLog: '',
  tunnelProcess: null,
  tunnelStartupTimer: null,
  publicUrl: null,
  tunnelLog: '',
  tunnelHomePath: null,
  protectionMode: 'public',
  startedAt: null,
  lastError: null
};

function isLoopbackAddress(address) {
  return Boolean(address) && (
    address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  );
}

function json(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
  });
  res.end(body);
}

function sendText(res, status, message) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(message);
}

function shouldAutoInstallCloudflared({ desktopApp, envPath, envPathExists, manualPath, manualExists }) {
  const usableEnvPath = Boolean(envPath && envPathExists);
  const usableManualPath = Boolean(manualPath && manualExists);
  // Quick Tunnel is also used by the standalone ZIP launcher, so auto-setup is
  // independent of Electron/desktop mode when no valid manual binary exists.
  return Boolean(!usableEnvPath && !usableManualPath);
}

function getCloudflaredCommand() {
  const managedFile = path.resolve(RUNTIME_ROOT, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  const isManaged = candidate => {
    try {
      const resolved = path.resolve(candidate);
      return process.platform === 'win32' ? resolved.toLowerCase() === managedFile.toLowerCase() : resolved === managedFile;
    } catch { return false; }
  };
  const verifiedManaged = candidate => {
    if (!isManaged(candidate)) return true;
    try {
      const { ASSETS, isVerifiedInstalledBinary } = require('./lib/cloudflared');
      const asset = ASSETS[`${process.platform}-${process.arch}`];
      return Boolean(asset && isVerifiedInstalledBinary(candidate, asset));
    } catch { return false; }
  };
  const manual = runtimePaths.getRuntimePaths().cloudflaredBinary;
  if (manual && fs.existsSync(manual) && verifiedManaged(manual)) return manual;
  const configured = process.env.CLOUDFLARED_PATH;
  if (configured && fs.existsSync(configured) && verifiedManaged(configured)) return configured;
  const localCandidates = [
    managedFile,
    path.join(RUNTIME_ROOT, 'cloudflared.exe'),
    path.join(WEB_ROOT, 'tools', 'cloudflared.exe'),
    path.join(WEB_ROOT, 'runtime', 'cloudflared.exe'),
    path.join(RUNTIME_ROOT, 'cloudflared')
  ];
  for (const candidate of [...new Set(localCandidates.map(value => path.resolve(value)))]) {
    if (fs.existsSync(candidate) && verifiedManaged(candidate)) return candidate;
  }
  // A system-installed cloudflared is a valid manual runtime; resolve it before attempting download.
  const fromPath = findCommand(process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (fromPath) return fromPath;
  // Return the expected managed path/name as a setup target; startSharing installs it only after validation.
  return managedFile;
}

function isCloudflaredCommandAvailable(command) {
  if (typeof command !== 'string' || !command.trim()) return false;
  const managedFile = path.resolve(RUNTIME_ROOT, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  const candidate = path.resolve(command);
  const isManaged = process.platform === 'win32'
    ? candidate.toLowerCase() === managedFile.toLowerCase()
    : candidate === managedFile;
  if (isManaged) {
    const { ASSETS, isVerifiedInstalledBinary } = require('./lib/cloudflared');
    const asset = ASSETS[`${process.platform}-${process.arch}`];
    return Boolean(asset && isVerifiedInstalledBinary(candidate, asset));
  }
  const commandLooksLikePath = path.isAbsolute(command) || command.includes(path.sep);
  return commandLooksLikePath ? fs.existsSync(command) : Boolean(findCommand(command));
}

function getStatus() {
  return {
    adminUrl: `http://${HOST}:${ADMIN_PORT}`,
    sharing: Boolean(state.tunnelProcess && state.publicUrl),
    tunnelStarting: Boolean(sharingStartInFlight || (state.tunnelProcess && !state.publicUrl)),
    publicUrl: state.publicUrl,
    tunnelLog: state.tunnelLog.slice(-2500),
    protectionMode: state.protectionMode,
    previewUrl: state.previewPort ? `http://${HOST}:${state.previewPort}` : null,
    previewPort: state.previewPort,
    previewRoot: state.previewRoot,
    previewType: state.previewType || 'static',
    accessProtected: Boolean(state.accessProtected),
    runtimeProcessRunning: Boolean(state.runtimeProcess && state.runtimeProcess.exitCode === null),
    runtimeLog: state.runtimeLog.slice(-2500),
    startedAt: state.startedAt,
    lastError: state.lastError,
    cloudflaredConfiguredPath: process.env.CLOUDFLARED_PATH || getCloudflaredCommand(),
    runtime: process.version,
    platform: process.platform
  };
}

function safeInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function isBlockedPublicPath(urlPath) {
  // Treat either slash as a separator even on non-Windows test hosts.
  const segments = urlPath.replace(/\\/g, '/').split('/').filter(Boolean);
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    // Hidden files/folders are denied, including .env variants and encoded backslash paths.
    if (segment.startsWith('.') || BLOCKED_NAMES.has(lower)) return true;
    // Windows alternate data streams and colon-based path tricks are not public paths.
    if (segment.includes(':') || /[\u0000-\u001f\u007f]/.test(segment)) return true;
    const ext = path.posix.extname(lower);
    if (BLOCKED_EXTENSIONS.has(ext) || /^\.php[0-9]+$/i.test(ext)) return true;
    if (/^\.env(?:\..*)?$/.test(lower)) return true;
    if (/^(?:id_rsa|id_ed25519|authorized_keys|known_hosts|credentials|secrets?)(?:\..*)?$/.test(lower)) return true;
  }
  return false;
}

function createStaticServer(root, options = {}) {
  const accessPassword = typeof options.accessPassword === 'string' ? options.accessPassword : '';
  // Pin the canonical root once so replacing the originally selected path with a symlink
  // while sharing is active cannot silently change the published root.
  const rootRealPinned = fs.realpathSync.native(root);
  return http.createServer(async (req, res) => {
    try {
      if (accessPassword && !isBasicAuthorized(req, accessPassword)) return sendBasicChallenge(res);
      if (!['GET', 'HEAD'].includes(req.method || '')) {
        res.setHeader('Allow', 'GET, HEAD');
        return sendText(res, 405, 'Method not allowed');
      }

      let requestUrl;
      try { requestUrl = new URL(req.url || '/', 'http://127.0.0.1'); }
      catch { return sendText(res, 400, 'Invalid URL'); }

      let decoded;
      try { decoded = decodeURIComponent(requestUrl.pathname); }
      catch { return sendText(res, 400, 'Invalid URL path'); }

      // URL paths are encoded with '/', but Windows also treats '\\' as a separator.
      const normalizedUrlPath = decoded.replace(/\\/g, '/');
      if (isBlockedPublicPath(normalizedUrlPath)) return sendText(res, 404, 'Not found');

      const rootReal = rootRealPinned;
      let relativePath = normalizedUrlPath.replace(/^\/+/, '');
      if (!relativePath || relativePath.endsWith('/')) relativePath += 'index.html';

      let target = path.resolve(rootReal, ...relativePath.split('/'));
      if (!safeInsideRoot(rootReal, target)) return sendText(res, 403, 'Forbidden');

      let targetReal;
      try { targetReal = await fs.promises.realpath(target); }
      catch {
        // SPA fallback: extensionless routes may be handled by index.html. Missing assets stay 404.
        const lastSegment = path.posix.basename(normalizedUrlPath);
        if (lastSegment && !path.posix.extname(lastSegment)) {
          targetReal = path.join(rootReal, 'index.html');
          try { targetReal = await fs.promises.realpath(targetReal); }
          catch { return sendText(res, 404, 'Not found'); }
        } else {
          return sendText(res, 404, 'Not found');
        }
      }

      // Resolve symlinks before reading; never allow files outside the selected folder.
      if (!safeInsideRoot(rootReal, targetReal)) return sendText(res, 403, 'Forbidden');
      if (isBlockedPublicPath(path.relative(rootReal, targetReal))) return sendText(res, 404, 'Not found');

      const stat = await fs.promises.stat(targetReal);
      if (!stat.isFile()) return sendText(res, 404, 'Not found');
      const ext = path.extname(targetReal).toLowerCase();
      const mime = MIME[ext];
      if (!mime) return sendText(res, 415, 'File type is not allowed for public preview');

      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': stat.size,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer-when-downgrade',
        'Cache-Control': 'no-cache'
      });
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(targetReal);
      stream.on('error', () => {
        if (!res.headersSent) sendText(res, 500, 'Preview server error');
        else res.destroy();
      });
      stream.pipe(res);
    } catch {
      if (!res.headersSent) sendText(res, 500, 'Preview server error');
      else res.destroy();
    }
  });
}


function createAuthenticatedProxyServer(targetPort, accessPassword) {
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535 || !isValidSharePassword(accessPassword)) {
    throw new Error('Konfigurasi proxy berbagi dengan autentikasi tidak valid.');
  }
  const server = http.createServer((req, res) => {
    if (!isBasicAuthorized(req, accessPassword)) return sendBasicChallenge(res);
    const headers = { ...req.headers, host: `${HOST}:${targetPort}` };
    // Basic credentials are only for SXL's outer access gate; do not forward
    // them to the development application.
    delete headers.authorization;
    delete headers['proxy-authorization'];
    const upstream = http.request({ hostname: HOST, port: targetPort, method: req.method, path: req.url, headers, timeout: 30000 }, upstreamRes => {
      const responseHeaders = { ...upstreamRes.headers, 'X-Content-Type-Options': 'nosniff' };
      res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
      upstreamRes.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Batas waktu upstream terlampaui.')));
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Cache-Control': 'no-store' }); res.end('Aplikasi lokal tidak merespons.'); });
    req.pipe(upstream);
  });
  // Preserve websocket upgrades for development tools while requiring the same Basic gate.
  server.on('upgrade', (req, clientSocket, head) => {
    if (!isBasicAuthorized(req, accessPassword)) {
      clientSocket.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="SXL Website", charset="UTF-8"\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const upstreamSocket = net.connect(targetPort, HOST, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i];
        if (['authorization', 'proxy-authorization'].includes(name.toLowerCase())) continue;
        lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
      }
      upstreamSocket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) upstreamSocket.write(head);
      clientSocket.pipe(upstreamSocket).pipe(clientSocket);
    });
    upstreamSocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstreamSocket.destroy());
  });
  return server;
}

function listenOn(server, preferredPort) {
  return new Promise((resolve, reject) => {
    const onError = err => { server.removeListener('listening', onListening); reject(err); };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(preferredPort, HOST);
  });
}

async function getFreePort(server, preferredPort) {
  try { return await listenOn(server, preferredPort); }
  catch (error) {
    if (preferredPort === 0) throw error;
    // Fall back to an ephemeral local port if the preferred preview port is occupied.
    return listenOn(server, 0);
  }
}

function signalProcessTree(proc, signal) {
  if (!proc?.pid) return;
  if (process.platform === 'win32') {
    if (signal === 'SIGKILL') {
      try { spawn('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
    } else {
      // taskkill /T handles npm's shell and web-server child processes as a tree.
      try { spawn('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
      catch { try { proc.kill(); } catch {} }
    }
    return;
  }
  try { process.kill(-proc.pid, signal); }
  catch { try { proc.kill(signal); } catch {} }
}

async function stopRuntimeProcess() {
  const proc = state.runtimeProcess;
  state.runtimeProcess = null;
  if (!proc || proc.exitCode !== null) return;
  await new Promise(resolve => {
    const hardTimer = setTimeout(() => { signalProcessTree(proc, 'SIGKILL'); resolve(); }, 3000);
    proc.once('exit', () => { clearTimeout(hardTimer); resolve(); });
    signalProcessTree(proc, 'SIGTERM');
  });
}

async function closePreviewServer() {
  const server = state.previewServer;
  state.previewServer = null;
  state.previewRoot = null;
  state.previewPort = null;
  state.previewType = null;
  state.accessProtected = false;
  state.protectionMode = 'public';
  await stopRuntimeProcess();
  if (server) {
    await new Promise(resolve => {
      try { server.close(() => resolve()); }
      catch { resolve(); }
    });
  }
}

function clearTunnelTimer() {
  if (state.tunnelStartupTimer) clearTimeout(state.tunnelStartupTimer);
  state.tunnelStartupTimer = null;
}

async function cleanupTunnelHome(home) {
  if (!home || typeof home !== 'string') return;
  const base = path.resolve(RUNTIME_ROOT, 'cloudflared-home');
  const candidate = path.resolve(home);
  try {
    // Refuse cleanup if the root/session directory became a symlink or a path outside
    // the canonical managed runtime; do not recursively delete an unexpected target.
    const baseStat = await fs.promises.lstat(base);
    const sessionStat = await fs.promises.lstat(candidate);
    if (!baseStat.isDirectory() || baseStat.isSymbolicLink() || !sessionStat.isDirectory() || sessionStat.isSymbolicLink()) return;
    const baseReal = await fs.promises.realpath(base);
    const candidateReal = await fs.promises.realpath(candidate);
    if (path.dirname(candidateReal) !== baseReal || !safeInsideRoot(baseReal, candidateReal) || candidateReal === baseReal) return;
    await fs.promises.rm(candidateReal, { recursive: true, force: true });
    if (state.tunnelHomePath === candidate) state.tunnelHomePath = null;
  } catch { /* Preserve unexpected locations for manual inspection rather than deleting them. */ }
}

async function stopTunnel() {
  clearTunnelTimer();
  const proc = state.tunnelProcess;
  const home = state.tunnelHomePath;
  state.tunnelProcess = null;
  state.publicUrl = null;
  state.startedAt = null;
  if (proc && proc.exitCode === null && !proc.killed) {
    await new Promise(resolve => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; clearTimeout(timeout); resolve(); };
      const timeout = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
        finish();
      }, 3500);
      proc.once('exit', finish);
      try { proc.kill('SIGTERM'); }
      catch { finish(); }
    });
  }
  await cleanupTunnelHome(home);
}

async function stopSharing() {
  if (sharingStartInFlight && !state.tunnelProcess && !state.previewServer && !state.runtimeProcess) {
    throw new Error('Cloudflare Tunnel masih disiapkan. Tunggu sampai proses mulai atau gagal, lalu hentikan sesi.');
  }
  await stopTunnel();
  await closePreviewServer();
  state.lastError = null;
}

function findCommand(command) {
  if (process.env[`SXL_${command.toUpperCase()}_PATH`] && fs.existsSync(process.env[`SXL_${command.toUpperCase()}_PATH`])) {
    return process.env[`SXL_${command.toUpperCase()}_PATH`];
  }
  const extList = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const folder of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of extList) {
      const candidate = path.join(folder, command + (ext && !command.toLowerCase().endsWith(ext.toLowerCase()) ? ext : ''));
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

function reservePort(preferredPort) {
  const server = net.createServer();
  return getFreePort(server, preferredPort).then(port => new Promise(resolve => server.close(() => resolve(port))));
}

function waitForHttp(port, child, timeoutMs = 35_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (child.exitCode !== null || state.runtimeProcess !== child) return reject(new Error(`Runtime keluar sebelum siap. ${state.runtimeLog.slice(-1800)} ${state.lastError || ''}`));
      const request = http.get({ hostname: HOST, port, path: '/', timeout: 700 }, response => {
        response.resume();
        resolve(true);
      });
      request.on('error', () => {
        if (Date.now() - started > timeoutMs) return reject(new Error(`Runtime tidak merespons pada port ${port} dalam ${Math.round(timeoutMs / 1000)} detik. ${state.runtimeLog.slice(-1800)}`));
        setTimeout(tick, 300);
      });
      request.on('timeout', () => request.destroy());
    };
    tick();
  });
}

async function ensureNodeProjectRuntime(root, port, installDependencies) {
  const installer = require('./lib/runtime-installer');
  const runtime = await installer.ensureNodeRuntime(DATA_ROOT);
  const manifestPath = path.join(root, 'package.json');
  let manifest;
  try { manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')); }
  catch { throw new Error('Mode Node.js memerlukan package.json yang valid di folder proyek.'); }
  if (!manifest.scripts || typeof manifest.scripts.start !== 'string' || !manifest.scripts.start.trim()) {
    throw new Error('package.json belum memiliki scripts.start. Tambahkan skrip start yang menjalankan server web proyek.');
  }
  const nodeModules = path.join(root, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    if (installDependencies !== true) throw new Error('Folder node_modules belum tersedia. Tekan Start lagi dan setujui pemasangan dependensi npm untuk proyek ini.');
    state.runtimeLog = 'Menjalankan npm install. Skrip lifecycle paket dapat mengeksekusi kode proyek; lanjutkan hanya untuk proyek tepercaya.\n';
    await runNpm(runtime, ['install', '--no-audit', '--no-fund'], root, { PORT: String(port), HOST: HOST }, 10 * 60 * 1000);
    if (!fs.existsSync(nodeModules)) throw new Error('npm install selesai tetapi node_modules tidak ditemukan.');
  }
  return { command: runtime.node, args: [runtime.npmCli, 'run', 'start'], cwd: root, env: { ...process.env, PATH: `${runtime.binDir}${path.delimiter}${process.env.PATH || ''}`, PORT: String(port), HOST, HOSTNAME: HOST, BIND: HOST, NODE_ENV: process.env.NODE_ENV || 'production' } };
}

function runNpm(runtime, args, cwd, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.node, [runtime.npmCli, ...args], { cwd, env: { ...process.env, ...env, PATH: `${runtime.binDir}${path.delimiter}${process.env.PATH || ''}` }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '', settled = false;
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(new Error('npm install melewati batas waktu 10 menit.')); }, timeoutMs);
    const finish = (err, result) => { if (settled) return; settled = true; clearTimeout(timer); if (err) reject(err); else resolve(result); };
    const append = chunk => { log = (log + chunk.toString()).slice(-12000); state.runtimeLog = log; };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.once('error', err => finish(err));
    child.once('close', code => code === 0 ? finish(null, { log }) : finish(new Error(`npm install gagal (exit code ${code}). ${log.slice(-2500)}`)));
  });
}

function phpRouterSource() {
  return `<?php
$root = realpath($_SERVER['DOCUMENT_ROOT'] ?? getcwd());
$raw = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = rawurldecode($raw);
$parts = preg_split('~[\\\\/]+~', $path, -1, PREG_SPLIT_NO_EMPTY);
$blockedNames = ['.git','.svn','.hg','.env','node_modules','vendor','composer.json','composer.lock','package.json','package-lock.json','settings.json','credentials.json','secrets.json','config.php','configuration.php','db.php','database.php','connect.php','connection.php','credentials.php','secrets.php','wp-config.php','install.php','setup.php','phpinfo.php'];
$blockedExt = ['.sql','.sqlite','.sqlite3','.db','.bak','.backup','.old','.orig','.log','.pem','.key','.p12','.pfx','.ps1','.bat','.cmd','.sh','.swp','.swo','.ini','.conf'];
foreach ($parts as $part) {
  $lower = strtolower($part);
  if ($part === '.' || $part === '..' || str_starts_with($part, '.') || str_contains($part, ':') || in_array($lower, $blockedNames, true) || in_array(strtolower(pathinfo($lower, PATHINFO_EXTENSION)), array_map(fn($e) => ltrim($e,'.'), $blockedExt), true)) { http_response_code(404); exit; }
}
$target = realpath($root . DIRECTORY_SEPARATOR . ltrim(str_replace(['/', '\\\\'], DIRECTORY_SEPARATOR, $path), DIRECTORY_SEPARATOR));
if ($target !== false && $target !== $root && !str_starts_with($target, $root . DIRECTORY_SEPARATOR)) { http_response_code(404); exit; }
if ($target && is_file($target)) return false;
if ($target && is_dir($target) && (is_file($target . DIRECTORY_SEPARATOR . 'index.php') || is_file($target . DIRECTORY_SEPARATOR . 'index.html'))) return false;
if (is_file($root . DIRECTORY_SEPARATOR . 'index.php')) { $_SERVER['SCRIPT_FILENAME'] = $root . DIRECTORY_SEPARATOR . 'index.php'; include $_SERVER['SCRIPT_FILENAME']; return true; }
http_response_code(404); echo 'Not found';
`;
}

async function ensurePhpProjectRuntime(root, port) {
  const installer = require('./lib/runtime-installer');
  const runtime = await installer.ensurePhpRuntime(DATA_ROOT);
  const artisan = path.join(root, 'artisan');
  if (fs.existsSync(artisan) && fs.existsSync(path.join(root, 'public', 'index.php'))) {
    if (!fs.existsSync(path.join(root, 'vendor', 'autoload.php'))) throw new Error('Proyek Laravel belum memiliki vendor/autoload.php. Jalankan composer install di proyek terlebih dahulu.');
    return { command: runtime.php, args: [artisan, 'serve', '--host=127.0.0.1', `--port=${port}`], cwd: root, env: { ...process.env, APP_ENV: process.env.APP_ENV || 'local' } };
  }
  if (!fs.existsSync(path.join(root, 'index.php')) && !fs.existsSync(path.join(root, 'index.html'))) {
    throw new Error('Mode PHP memerlukan index.php atau index.html di root; proyek Laravel dapat memakai artisan + public/index.php.');
  }
  const router = path.join(RUNTIME_ROOT, 'php-router.php');
  await fs.promises.mkdir(RUNTIME_ROOT, { recursive: true });
  await fs.promises.writeFile(router, phpRouterSource(), { mode: 0o600 });
  return { command: runtime.php, args: ['-S', `${HOST}:${port}`, '-t', root, router], cwd: root, env: { ...process.env, PHP_CLI_SERVER_WORKERS: '1' } };
}

async function startDynamicRuntime(type, root, input) {
  const port = await reservePort(DEFAULT_PREVIEW_PORT);
  let spec;
  if (type === 'php') spec = await ensurePhpProjectRuntime(root, port);
  else if (type === 'node') spec = await ensureNodeProjectRuntime(root, port, input.installDependencies === true);
  else throw new Error('Jenis runtime tidak dikenal.');

  state.runtimeLog = '';
  let proc;
  try {
    proc = spawn(spec.command, spec.args, { cwd: spec.cwd, env: { ...spec.env, PORT: String(port), HOST, HOSTNAME: HOST }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) { throw new Error(`Runtime proyek gagal dijalankan: ${error.message}`); }
  state.runtimeProcess = proc;
  const append = chunk => { state.runtimeLog = (state.runtimeLog + chunk.toString()).slice(-12000); };
  proc.stdout?.on('data', append); proc.stderr?.on('data', append);
  proc.once('error', error => {
    if (state.runtimeProcess !== proc) return;
    state.lastError = `Runtime ${type} gagal dijalankan: ${error.message}`;
    state.runtimeProcess = null;
  });
  proc.once('exit', (code, signal) => {
    if (state.runtimeProcess !== proc) return;
    state.runtimeProcess = null;
    if (code !== 0 && code !== null) state.lastError = `Runtime ${type} berhenti (code=${code}, signal=${signal || 'none'}). ${state.runtimeLog.slice(-1500)}`;
    if (process.platform !== 'win32') signalProcessTree(proc, 'SIGTERM');
    if (state.tunnelProcess) { stopTunnel().then(() => closePreviewServer()).catch(() => {}); }
  });
  try { await waitForHttp(port, proc); }
  catch (error) { await stopRuntimeProcess(); throw error; }
  state.previewPort = port;
  state.previewRoot = root;
  state.previewType = type;
  return port;
}

async function startSharingImpl(input) {
  if (state.tunnelProcess || state.previewServer || state.runtimeProcess) {
    throw new Error('Berbagi website sedang aktif. Tekan Hentikan Berbagi sebelum memulai ulang.');
  }
  if (!input || typeof input.folder !== 'string' || !input.folder.trim()) {
    throw new Error('Pilih folder website terlebih dahulu.');
  }
  const runtimeType = ['static', 'php', 'node'].includes(input.runtimeType) ? input.runtimeType : 'static';
  const accessPassword = typeof input.accessPassword === 'string' ? input.accessPassword : '';
  if (accessPassword && !isValidSharePassword(accessPassword)) throw new Error('Kata sandi sharing harus 10–128 karakter dan tidak boleh berisi karakter kontrol.');
  const { allowedEmails, protectionMode } = validatePublicAccess({
    accessPassword,
    allowedEmails: input.allowedEmails,
    confirmPublicAccess: input.confirmPublicAccess
  });
  const root = path.resolve(input.folder.trim().replace(/^"|"$/g, ''));
  let rootReal;
  try { rootReal = await fs.promises.realpath(root); }
  catch { throw new Error('Folder website tidak ditemukan atau tidak dapat diakses. Periksa path folder.'); }

  const stat = await fs.promises.stat(rootReal);
  if (!stat.isDirectory()) throw new Error('Lokasi yang dipilih bukan folder.');
  const rootNames = await fs.promises.readdir(rootReal).catch(() => []);
  let runtimeRoot = rootReal;

  if (runtimeType === 'static') {
    const indexPath = path.join(rootReal, 'index.html');
    try {
      const indexStat = await fs.promises.stat(indexPath);
      if (!indexStat.isFile()) throw new Error();
    } catch {
      throw new Error('Folder website statis harus memiliki file index.html di folder utama. Untuk React/Vue, pilih folder hasil build seperti dist atau build.');
    }

    const dangerousRootItems = rootNames.filter(name => {
      const n = name.toLowerCase();
      return n === '.env' || n.startsWith('.env.') || n === '.git' || n === 'node_modules' ||
        n === 'vendor' || n === 'composer.json' || n === 'composer.lock' ||
        n === 'package.json' || n === 'package-lock.json' || n === 'database.sql' || n.endsWith('.sql');
    });
    if (dangerousRootItems.length) {
      throw new Error(`Folder ini tampaknya folder sumber, bukan folder publik. Item yang perlu dikeluarkan: ${dangerousRootItems.slice(0, 5).join(', ')}. Pilih folder dist/build/public hasil ekspor website.`);
    }
  } else if (runtimeType === 'php') {
    const publicIndex = path.join(rootReal, 'public', 'index.php');
    let publicRootReal = null;
    try {
      const candidate = await fs.promises.realpath(path.join(rootReal, 'public'));
      if (!safeInsideRoot(rootReal, candidate)) throw new Error('Folder public mengarah ke luar folder proyek. Pilih direktori publik yang berada di dalam proyek.');
      if ((await fs.promises.stat(path.join(candidate, 'index.php'))).isFile()) publicRootReal = candidate;
    } catch (error) {
      if (error.message.includes('mengarah ke luar')) throw error;
    }
    const rootNamesLower = new Set(rootNames.map(name => name.toLowerCase()));
    if (!rootNamesLower.has('index.php') && !publicRootReal) {
      throw new Error('Mode PHP memerlukan index.php, atau folder public/index.php. Untuk Laravel, pilih folder root proyek; SXL akan menerbitkan folder public saja.');
    }
    if (publicRootReal) {
      runtimeRoot = publicRootReal;
    } else {
      const privateRootItems = rootNames.filter(name => {
        const n = name.toLowerCase();
        return n.startsWith('.env') || ['.git', 'vendor', 'node_modules', 'composer.json', 'composer.lock', 'package.json', 'package-lock.json', 'settings.json', 'credentials.json', 'secrets.json', 'database.sql'].includes(n) || /\.(?:sql|sqlite|sqlite3|db|bak|backup|pem|key|p12|pfx)$/i.test(n);
      });
      if (privateRootItems.length) {
        throw new Error(`Folder PHP memuat berkas sumber/rahasia (${privateRootItems.slice(0, 5).join(', ')}). Pilih folder public/ jika tersedia atau pindahkan rahasia di luar document root sebelum sharing.`);
      }
    }
  } else if (runtimeType === 'node') {
    if (!rootNames.includes('package.json')) throw new Error('Mode Node.js memerlukan package.json.');
  }

  let command = getCloudflaredCommand();
  // ZIP/portable mode and desktop mode use the same verified downloader when no binary exists.
  if (!isCloudflaredCommandAvailable(command)) {
    try {
      const ensureCloudflared = require('./lib/cloudflared').ensureCloudflared;
      command = await ensureCloudflared(RUNTIME_ROOT);
    } catch (err) {
      throw new Error(`Gagal menyiapkan Cloudflare Tunnel: ${err.message}`);
    }
  }
  if (!isCloudflaredCommandAvailable(command)) {
    throw new Error(`cloudflared tidak ditemukan di ${command}. Periksa runtime SXL atau koneksi internet saat setup pertama.`);
  }
  if (allowedEmails.length) {
    try {
      const cloudflared = require('./lib/cloudflared');
      const detected = await cloudflared.getCloudflaredVersion(command);
      if (!cloudflared.supportsEmailAccess(detected.version)) {
        throw new Error(`Versi cloudflared ${detected.version} belum mendukung allow-list email SXL. Gunakan ${cloudflared.VERSION} atau lebih baru.`);
      }
    } catch (error) {
      throw new Error(`Autentikasi email Cloudflare tidak dapat diverifikasi: ${error.message}. Gunakan cloudflared ${require('./lib/cloudflared').VERSION} atau lindungi dengan kata sandi SXL.`);
    }
  }

  let previewPort;
  if (runtimeType === 'static') {
    const preview = createStaticServer(rootReal, { accessPassword });
    try { previewPort = await getFreePort(preview, DEFAULT_PREVIEW_PORT); }
    catch (error) { throw new Error(`Preview statis gagal dijalankan: ${error.message}`); }
    state.previewServer = preview;
    state.previewRoot = rootReal;
    state.previewPort = previewPort;
    state.previewType = 'static';
    state.accessProtected = Boolean(accessPassword || allowedEmails.length);
  } else {
    previewPort = await startDynamicRuntime(runtimeType, runtimeRoot, input);
    if (accessPassword) {
      const targetPort = previewPort;
      const proxy = createAuthenticatedProxyServer(targetPort, accessPassword);
      try { previewPort = await getFreePort(proxy, 0); }
      catch (error) {
        try { proxy.close(); } catch {}
        await stopRuntimeProcess();
        state.previewPort = null; state.previewRoot = null; state.previewType = null; state.accessProtected = false; state.protectionMode = 'public';
        throw new Error(`Proxy autentikasi sharing gagal dijalankan: ${error.message}`);
      }
      state.previewServer = proxy;
      state.previewRoot = runtimeRoot;
      state.previewPort = previewPort;
      state.previewType = runtimeType;
      state.accessProtected = true;
    }
  }
  state.accessProtected = Boolean(accessPassword || allowedEmails.length);
  state.protectionMode = protectionMode;

  state.lastError = null;
  state.tunnelLog = '';
  let proc;
  let tunnelHome;
  try {
    const cloudflared = require('./lib/cloudflared');
    tunnelHome = cloudflared.createIsolatedTunnelHome(RUNTIME_ROOT);
    if (process.platform === 'win32') {
      // Do not inherit the user's real .cloudflared/config.yml; Quick Tunnels are unsupported when one is discovered.
      require('./lib/secure-settings').applyWindowsTreeAcl(tunnelHome);
    }
    state.tunnelHomePath = tunnelHome;
    const tunnelEnv = {
      ...process.env,
      HOME: tunnelHome,
      USERPROFILE: tunnelHome,
      XDG_CONFIG_HOME: path.join(tunnelHome, '.config'),
      APPDATA: path.join(tunnelHome, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(tunnelHome, 'AppData', 'Local')
    };
    if (process.platform === 'win32') {
      const parsedHome = path.win32.parse(tunnelHome);
      tunnelEnv.HOMEDRIVE = parsedHome.root.slice(0, 2);
      tunnelEnv.HOMEPATH = `${path.win32.sep}${path.win32.relative(parsedHome.root, tunnelHome)}`;
    }
    for (const configDir of [tunnelEnv.XDG_CONFIG_HOME, tunnelEnv.APPDATA, tunnelEnv.LOCALAPPDATA]) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    proc = spawn(command, buildTunnelArgs(previewPort, allowedEmails), {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: tunnelEnv
    });
  } catch (err) {
    await cleanupTunnelHome(tunnelHome);
    await closePreviewServer();
    throw new Error(`Gagal menjalankan cloudflared: ${err.message}`);
  }

  state.tunnelProcess = proc;
  const onData = chunk => {
    const output = chunk.toString();
    state.tunnelLog = (state.tunnelLog + output).slice(-12000);
    const match = state.tunnelLog.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match && !state.publicUrl && state.tunnelProcess === proc) {
      state.publicUrl = match[0];
      state.startedAt = new Date().toISOString();
      clearTunnelTimer();
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.once('error', async err => {
    if (state.tunnelProcess !== proc) return;
    clearTunnelTimer();
    state.lastError = `cloudflared tidak dapat dijalankan: ${err.message}. Periksa koneksi internet dan izin aplikasi.`;
    state.tunnelProcess = null;
    state.publicUrl = null;
    state.startedAt = null;
    await cleanupTunnelHome(state.tunnelHomePath);
    await closePreviewServer();
  });

  proc.once('exit', async (code, signal) => {
    if (state.tunnelProcess !== proc) return;
    clearTunnelTimer();
    const detail = state.tunnelLog.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
    state.lastError = `Tunnel berhenti (code=${code}, signal=${signal || 'none'}). ${detail}`.trim();
    state.tunnelProcess = null;
    state.publicUrl = null;
    state.startedAt = null;
    await cleanupTunnelHome(state.tunnelHomePath);
    await closePreviewServer();
  });

  state.tunnelStartupTimer = setTimeout(async () => {
    if (state.tunnelProcess !== proc || state.publicUrl) return;
    const log = state.tunnelLog.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
    state.lastError = `Cloudflare Quick Tunnel tidak siap dalam 45 detik. Periksa koneksi internet, firewall, atau coba ulang. ${log}`.trim();
    await stopTunnel();
    await closePreviewServer();
  }, 45_000);
  state.tunnelStartupTimer.unref?.();

  return { accepted: true, previewUrl: `http://${HOST}:${previewPort}`, runtimeType };
}

// Only one sharing setup can run at once. Setup includes path validation and a
// potentially long binary download; without this gate two requests could race before
// state.previewServer/state.tunnelProcess have been assigned.
async function startSharing(input) {
  if (sharingStartInFlight) {
    throw new Error('SXL sedang menyiapkan Cloudflare Tunnel. Tunggu hasilnya sebelum memulai sesi lain.');
  }
  sharingStartInFlight = true;
  try {
    return await startSharingImpl(input);
  } finally {
    sharingStartInFlight = false;
  }
}

function getRuntimeStatus() {
  const installer = require('./lib/runtime-installer');
  const nodePaths = installer.getNodePaths(DATA_ROOT);
  const phpPaths = installer.getPhpPaths(DATA_ROOT);
  const manual = require('./lib/runtime-paths').getRuntimePaths();
  const systemNode = installer.findSystemNodeRuntimePaths();
  const systemPhp = manual.phpBinary || installer.findOnPath('php') || (process.platform === 'darwin' ? ['/opt/homebrew/bin/php', '/usr/local/bin/php'].find(candidate => fs.existsSync(candidate)) : null);
  return {
    platform: process.platform,
    node: { available: Boolean(systemNode || (fs.existsSync(nodePaths.node) && fs.existsSync(nodePaths.npmCli))), portableInstalled: fs.existsSync(nodePaths.node) && fs.existsSync(nodePaths.npmCli), systemAvailable: Boolean(systemNode), version: installer.NODE_VERSION, path: fs.existsSync(nodePaths.node) ? nodePaths.node : systemNode?.node || null, npmPath: systemNode?.npmCli || nodePaths.npmCli },
    php: { available: Boolean(systemPhp || fs.existsSync(phpPaths.php)), portableInstalled: fs.existsSync(phpPaths.php), version: installer.PHP_VERSION, path: fs.existsSync(phpPaths.php) ? phpPaths.php : systemPhp },
    supportedModes: ['static', 'php', 'node']
  };
}

function checkAdminRequest(req, res) {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    sendText(res, 403, 'Forbidden');
    return false;
  }

  // Reject Host-header tricks and DNS-rebinding style requests. The dashboard always
  // uses the exact loopback origin returned by startServer().
  let requestHost;
  try { requestHost = new URL(`http://${req.headers.host || ''}`); }
  catch { sendText(res, 400, 'Invalid Host header'); return false; }
  if (requestHost.hostname !== HOST || Number(requestHost.port) !== ADMIN_PORT || requestHost.username || requestHost.password) {
    sendText(res, 403, 'Host rejected');
    return false;
  }

  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    // For a browser-originated state change, require exact same-origin + a random
    // per-process token rendered only into the local dashboard document.
    const origin = req.headers.origin;
    if (origin !== `http://${HOST}:${ADMIN_PORT}`) {
      sendText(res, 403, 'Origin rejected');
      return false;
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      sendText(res, 415, 'Content-Type must be application/json');
      return false;
    }
    const supplied = Buffer.from(String(req.headers['x-sxl-csrf'] || ''));
    const expected = Buffer.from(CSRF_TOKEN);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      sendText(res, 403, 'CSRF token rejected');
      return false;
    }
  }
  return true;
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw, 'utf8') > 256 * 1024) throw new Error('Request terlalu besar (maksimum 256 KiB).');
  }
  try { return JSON.parse(raw || '{}'); }
  catch { throw new Error('JSON request tidak valid.'); }
}

async function browseForFolder() {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', 'POSIX path of (choose folder with prompt \"Pilih folder hasil website statis\")'], { timeout: 120_000, maxBuffer: 1024 * 1024 });
      const selected = stdout.trim();
      return selected.endsWith('/') && selected !== '/' ? selected.slice(0, -1) : selected || null;
    } catch (error) {
      if (error.code === 1 || /User canceled|(-128)/i.test(error.message || '')) return null;
      throw new Error(`Tidak dapat membuka pemilih folder macOS: ${error.message}`);
    }
  }
  if (process.platform !== 'win32') throw new Error('Pemilih folder otomatis belum tersedia pada sistem ini. Masukkan path folder secara manual.');
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$dialog.Description = "Pilih folder hasil website statis"',
    '$dialog.ShowNewFolderButton = $false',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($dialog.SelectedPath) }'
  ].join('; ');
  const powershell = process.env.SXL_POWERSHELL_PATH || 'powershell.exe';
  try {
    const { stdout } = await execFileAsync(powershell, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim().split(/\r?\n/).filter(Boolean).pop() || null;
  } catch (error) {
    if (error.killed) throw new Error('Pemilih folder dibatalkan atau melewati batas waktu.');
    throw new Error(`Tidak dapat membuka pemilih folder: ${error.message}`);
  }
}

async function browseForDatabaseArchive() {
  if (process.platform !== 'win32') throw new Error('Impor MariaDB 13.0.2 hanya tersedia pada Windows x64.');
  // Prefer the verified package folder embedded in the source/build pack. If this
  // pack has not been populated yet, retain the existing manual file picker.
  const bundledArchive = database.getBundledMariaDBArchivePath?.();
  if (bundledArchive) return bundledArchive;
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    '$dialog.Title = "Pilih arsip MariaDB 13.0.2 Windows x64"',
    '$dialog.Filter = "MariaDB 13.0.2 (mariadb-13.0.2-winx64.zip)|mariadb-13.0.2-winx64.zip|ZIP files (*.zip)|*.zip"',
    '$dialog.CheckFileExists = $true',
    '$dialog.Multiselect = $false',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($dialog.FileName) }'
  ].join('; ');
  const powershell = process.env.SXL_POWERSHELL_PATH || 'powershell.exe';
  try {
    const { stdout } = await execFileAsync(powershell, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024
    });
    return stdout.trim().split(/\r?\n/).filter(Boolean).pop() || null;
  } catch (error) {
    if (error.killed) throw new Error('Pemilih arsip dibatalkan atau melewati batas waktu.');
    if (/User canceled|cancelled|(-2147023673)/i.test(error.message || '')) return null;
    throw new Error(`Tidak dapat membuka pemilih arsip: ${error.message}`);
  }
}

const admin = http.createServer(async (req, res) => {
  if (!checkAdminRequest(req, res)) return;
  let url;
  try { url = new URL(req.url || '/', `http://${HOST}:${ADMIN_PORT}`); }
  catch { return sendText(res, 400, 'Invalid URL'); }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    return json(res, 200, getStatus());
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/status') {
    return json(res, 200, getRuntimeStatus());
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/paths') {
    try { return json(res, 200, services.getManualRuntimePaths()); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Gagal membaca jalur runtime.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/paths') {
    try { const input = await readJson(req); return json(res, 200, { ok: true, ...services.saveManualRuntimePaths(input) }); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Jalur runtime tidak valid.' }); }
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/php-versions') {
    try { return json(res, 200, await services.getPhpVersions()); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Gagal memindai versi PHP.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/php-versions/select') {
    try { const input = await readJson(req); return json(res, 200, { ok: true, ...(await services.selectPhpVersion(input)) }); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Tidak dapat memilih versi PHP.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/php-versions/open-folder') {
    try { await readJson(req); return json(res, 200, { ok: true, ...await services.openPhpVersionsFolder() }); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Tidak dapat membuka folder versi PHP.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/start') {
    try {
      const input = await readJson(req);
      const result = await startSharing(input);
      return json(res, 202, { ok: true, ...result });
    } catch (err) {
      state.lastError = err.message || 'Gagal memulai sharing.';
      return json(res, 400, { ok: false, error: state.lastError });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    try {
      await stopSharing();
      return json(res, 200, { ok: true, status: getStatus() });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/browse') {
    try {
      const folder = await browseForFolder();
      return json(res, 200, { ok: true, folder });
    } catch (err) {
      return json(res, 501, { ok: false, error: err.message || 'Pemilih folder tidak tersedia.' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/engines/status') {
    try { return json(res, 200, { ok: true, postgresql: await databaseEngines.postgresStatus(), sqlite: databaseEngines.sqliteStatus() }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Gagal membaca status database tambahan.' }); }
  }

  if (req.method === 'GET' && url.pathname === '/api/engines/postgresql/log') {
    try {
      const file = path.join(DATA_ROOT, 'logs', 'database-engines', 'postgresql.log');
      const log = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').slice(-40_000) : 'Log PostgreSQL belum tersedia.';
      return json(res, 200, { ok: true, log });
    } catch (err) { return json(res, 500, { ok: false, error: err.message || 'Gagal membaca log PostgreSQL.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/engines/postgresql/configure') {
    try { const input = await readJson(req); return json(res, 200, await databaseEngines.configurePostgres(input)); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Konfigurasi PostgreSQL gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/engines/postgresql/initialize') {
    try { await readJson(req); return json(res, 200, await databaseEngines.initializePostgres()); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Inisialisasi PostgreSQL gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/engines/postgresql/start') {
    try { await readJson(req); return json(res, 200, await databaseEngines.startPostgres()); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'PostgreSQL gagal dijalankan.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/engines/postgresql/stop') {
    try { await readJson(req); return json(res, 200, await databaseEngines.stopPostgres()); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'PostgreSQL gagal dihentikan.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/engines/postgresql/query') {
    try { const input = await readJson(req); return json(res, 200, await databaseEngines.queryPostgres(input)); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Query PostgreSQL gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/engines/postgresql/databases') {
    try { await readJson(req); return json(res, 200, { ok: true, databases: await databaseEngines.listPostgresDatabases() }); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Gagal memuat database PostgreSQL.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/engines/postgresql/create-database') {
    try { const input = await readJson(req); return json(res, 201, await databaseEngines.createPostgresDatabase(input)); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Pembuatan database PostgreSQL gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/engines/postgresql/backup') {
    try { const input = await readJson(req); return json(res, 200, await databaseEngines.backupPostgres(input)); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Backup PostgreSQL gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/engines/postgresql/credentials') {
    try { await readJson(req); return json(res, 200, await databaseEngines.postgresCredentials()); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Kredensial PostgreSQL tidak dapat dibaca.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/engines/sqlite/configure') {
    try { const input = await readJson(req); return json(res, 200, await databaseEngines.configureSqlite(input)); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Konfigurasi SQLite gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/engines/sqlite/create') {
    try { const input = await readJson(req); return json(res, 201, await databaseEngines.createSqlite(input)); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Pembuatan SQLite gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/engines/sqlite/query') {
    try { const input = await readJson(req); return json(res, 200, await databaseEngines.querySqlite(input)); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Query SQLite gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/engines/sqlite/backup') {
    try { const input = await readJson(req); return json(res, 200, await databaseEngines.backupSqlite(input)); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Backup SQLite gagal.' }); }
  }

  if (req.method === 'GET' && url.pathname === '/api/database/status') {
    return json(res, 200, database.status());
  }

  if (req.method === 'POST' && url.pathname === '/api/database/verify-version') {
    try {
      const input = await readJson(req);
      const versionId = typeof input.versionId === 'string' ? input.versionId : database.status().versionId;
      const result = database.recheckRuntimeVersion(versionId);
      return json(res, 200, { ...result, status: database.status(), versions: database.versions() });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Versi binary MariaDB gagal diverifikasi.' }); }
  }

  if (req.method === 'GET' && url.pathname === '/api/database/log') {
    try { return json(res, 200, { ok: true, versionId: database.status().versionId, log: database.readLog() }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Gagal membaca log database.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/credentials') {
    try { await readJson(req); return json(res, 200, database.credentials()); }
    catch (err) { return json(res, 400, { ok: false, error: err.message }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/project-user') {
    try {
      const input = await readJson(req);
      const result = await database.createProjectUser(input);
      return json(res, 201, { ok: true, ...result });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Akun aplikasi gagal dibuat.' }); }
  }

  if (req.method === 'GET' && url.pathname === '/api/database/databases') {
    try { return json(res, 200, { databases: await database.listDatabases() }); }
    catch (err) { return json(res, 400, { ok: false, error: err.message }); }
  }

  if (req.method === 'GET' && url.pathname === '/api/database/backups') {
    try { return json(res, 200, { backups: await database.listBackups() }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/backup') {
    try {
      const input = await readJson(req);
      const result = await database.createBackup(input);
      return json(res, 200, { ok: true, ...result });
    } catch (err) { return json(res, 500, { ok: false, error: err.message || 'Backup gagal.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/restore') {
    try {
      const input = await readJson(req);
      const result = await database.restoreBackup(input);
      return json(res, 200, { ok: true, ...result });
    } catch (err) { return json(res, 500, { ok: false, error: err.message || 'Pemulihan backup gagal.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/browse-archive') {
    try {
      await readJson(req);
      const archivePath = await browseForDatabaseArchive();
      return json(res, 200, { ok: true, archivePath });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Pemilih arsip MariaDB gagal.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/install-version') {
    try {
      const input = await readJson(req);
      const result = await database.installVersionArchive(input);
      return json(res, 200, { ok: true, ...result });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Pemasangan versi database gagal.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/select-version') {
    try {
      const input = await readJson(req);
      const result = database.selectVersion(input.versionId);
      return json(res, 200, { ok: true, ...result });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Pemilihan versi database gagal.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/set-port') {
    try {
      const input = await readJson(req);
      const result = await database.setPort(input.port);
      return json(res, 200, { ok: true, ...result });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Port database gagal diubah.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/install') {
    try {
      const result = await database.install();
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || 'Pemasangan MariaDB gagal.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/start') {
    try {
      const result = await database.start();
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || 'MariaDB gagal dijalankan.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/stop') {
    try {
      const result = await database.stop();
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || 'MariaDB gagal dihentikan.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/query') {
    try {
      const input = await readJson(req);
      const result = await database.query(input);
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 400, {
        ok: false,
        error: err.message || 'SQL gagal dijalankan.',
        ...(Array.isArray(err.partialResults) ? {
          partialResults: err.partialResults,
          failedStatementIndex: err.failedStatementIndex
        } : {})
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/create') {
    try {
      const input = await readJson(req);
      const result = await database.createDatabase(input.name);
      return json(res, 201, { ok: true, ...result });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Database gagal dibuat.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/database/drop') {
    try {
      const input = await readJson(req);
      const result = await database.dropDatabase(input.name);
      return json(res, 200, { ok: true, ...result });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Database gagal dihapus.' }); }
  }

  if (req.method === 'GET' && url.pathname === '/api/services/status') {
    try { return json(res, 200, services.status()); }
    catch (err) { return json(res, 500, { ok: false, error: err.message }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/services/start-all') {
    try { const result = await services.startAllServices(); return json(res, 200, { ok: true, ...result }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Gagal menjalankan layanan.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/services/stop-all') {
    try { const result = await services.stopAllServices(); return json(res, 200, { ok: true, ...result }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Gagal menghentikan layanan.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/services/php/install') {
    try { const result = await services.installPhpRuntime(); return json(res, 200, { ok: true, ...result }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Pemasangan PHP gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/services/composer/install') {
    try { const result = await services.installComposer(); return json(res, 200, { ok: true, ...result }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Pemasangan Composer gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/services/apache/install') {
    try { const result = await services.installApache(); return json(res, 200, { ok: true, ...result }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Pemasangan Apache gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/services/apache/start') {
    try { const result = await services.startApache(); return json(res, 200, { ok: true, ...result }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Apache gagal dijalankan.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/services/apache/open') {
    try {
      const status = services.status().apache;
      if (!status.running) throw new Error('Jalankan Apache terlebih dahulu.');
      return json(res, 200, { ok: true, ...services.openBrowser(status.url) });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Browser tidak dapat dibuka.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/services/apache/stop') {
    try { const result = await services.stopApache(); return json(res, 200, { ok: true, ...result }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Apache gagal dihentikan.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/services/phpmyadmin/install') {
    try { const result = await services.installPhpMyAdmin(); return json(res, 200, { ok: true, ...result }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Pemasangan phpMyAdmin gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/services/phpmyadmin/start') {
    try { const result = await services.startPhpMyAdmin(); return json(res, 200, { ok: true, ...result }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'phpMyAdmin gagal dijalankan.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/services/phpmyadmin/stop') {
    try { const result = await services.stopPhpMyAdmin(); return json(res, 200, { ok: true, ...result }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'phpMyAdmin gagal dihentikan.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/services/phpmyadmin/open') {
    try {
      const status = services.status().phpMyAdmin;
      if (!status.running) throw new Error('Jalankan phpMyAdmin terlebih dahulu.');
      return json(res, 200, { ok: true, ...services.openBrowser(status.url) });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Browser tidak dapat dibuka.' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
    try { return json(res, 200, await services.diagnoseEnvironment()); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Diagnostik gagal dijalankan.' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/apps') {
    try { return json(res, 200, { apps: services.listRegisteredApps() }); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Direktori aplikasi tidak dapat dibaca.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/apps') {
    try {
      const input = await readJson(req);
      return json(res, 201, { ok: true, app: services.registerApp(input) });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Aplikasi gagal ditambahkan.' }); }
  }
  const appLaunchMatch = url.pathname.match(/^\/api\/apps\/([a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?)\/launch$/);
  if (req.method === 'POST' && appLaunchMatch) {
    try {
      await readJson(req);
      return json(res, 200, { ok: true, ...await services.launchRegisteredApp(appLaunchMatch[1]) });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Aplikasi gagal dibuka.' }); }
  }
  const appRemoveMatch = url.pathname.match(/^\/api\/apps\/([a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?)$/);
  if (req.method === 'DELETE' && appRemoveMatch) {
    try {
      const removed = services.removeRegisteredApp(appRemoveMatch[1]);
      if (!removed) return json(res, 404, { ok: false, error: 'Aplikasi tidak terdaftar.' });
      return json(res, 200, { ok: true, removed: true });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Aplikasi gagal dihapus.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/github-preview') {
    try {
      const input = await readJson(req);
      return json(res, 200, { ok: true, ...await services.previewProjectGitHub(input) });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Pratinjau GitHub gagal dibuat.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/publish-to-github') {
    try {
      const input = await readJson(req);
      return json(res, 200, { ok: true, ...await services.publishProjectToGitHub(input) });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Proyek gagal diterbitkan ke GitHub.' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/download-center/catalog') {
    try { return json(res, 200, await services.getDownloadCatalog()); }
    catch (err) { return json(res, 500, { ok: false, error: err.message || 'Katalog Download Center gagal diperiksa.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/download-center/install') {
    try {
      const input = await readJson(req);
      return json(res, 200, { ok: true, ...await services.installDownloadItem(input) });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Pemasangan gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/dependencies') {
    try {
      const input = await readJson(req);
      return json(res, 200, { ok: true, ...await services.checkProjectDependencies(input) });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Pemeriksaan dependensi gagal.' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/projects/list') {
    return json(res, 200, { projects: services.listProjects(), workspace: services.WWW_ROOT });
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/php-version') {
    try { const input = await readJson(req); return json(res, 200, { ok: true, ...await services.setProjectPhpVersion(input) }); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Versi PHP proyek gagal disimpan.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/create') {
    try {
      const input = await readJson(req);
      const result = input.type === 'laravel' ? await services.createLaravelProject(input) : services.createProject(input);
      return json(res, 201, { ok: true, ...result });
    }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Proyek gagal dibuat.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/start') {
    try { const input = await readJson(req); const result = await services.startProject(input); return json(res, 200, { ok: true, ...result }); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Proyek gagal dijalankan.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/composer-install') {
    try {
      const input = await readJson(req);
      const result = await services.composerInstallProject(input);
      return json(res, 200, { ok: true, ...result });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Composer install gagal.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/open-workspace') {
    try { await readJson(req); return json(res, 200, { ok: true, ...await services.openWorkspaceFolder() }); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Workspace tidak bisa dibuka.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/open-folder') {
    try { const input = await readJson(req); return json(res, 200, { ok: true, ...await services.openProjectFolder(input) }); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Folder proyek tidak bisa dibuka.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/open-terminal') {
    try { const input = await readJson(req); return json(res, 200, { ok: true, ...await services.openProjectTerminal(input) }); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Terminal proyek tidak bisa dibuka.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/open-workspace-terminal') {
    try { await readJson(req); return json(res, 200, { ok: true, ...await services.openWorkspaceTerminal() }); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Terminal workspace tidak bisa dibuka.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/open') {
    try {
      const input = await readJson(req);
      const slug = services.slugProjectName(input.slug);
      const project = services.listProjects().find(item => item.slug === slug);
      if (!project) throw new Error('Proyek tidak ditemukan.');
      const running = services.status().projects.find(item => item.slug === slug && item.running);
      const urlToOpen = running?.url || (project.type === 'static' && services.status().apache.running ? `http://${slug}.localhost:${services.status().apache.port}` : null);
      if (!urlToOpen) throw new Error('Jalankan project terlebih dahulu. Untuk virtual host static, mulai Apache dahulu.');
      return json(res, 200, { ok: true, ...services.openBrowser(urlToOpen) });
    } catch (err) { return json(res, 400, { ok: false, error: err.message || 'Tidak dapat membuka project.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/stop') {
    try { const input = await readJson(req); return json(res, 200, { ok: true, ...await services.stopProject(input) }); }
    catch (err) { return json(res, 400, { ok: false, error: err.message || 'Proyek gagal dihentikan.' }); }
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    });
    const html = await fs.promises.readFile(path.join(WEB_ROOT, 'public', 'index.html'), 'utf8');
    res.end(html.replace('__SXL_CSRF_TOKEN__', CSRF_TOKEN));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/sql-terminal.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    });
    const html = await fs.promises.readFile(path.join(WEB_ROOT, 'public', 'sql-terminal.html'), 'utf8');
    res.end(html.replace('__SXL_CSRF_TOKEN__', CSRF_TOKEN));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/styles.css') {
    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    return fs.createReadStream(path.join(WEB_ROOT, 'public', 'styles.css')).pipe(res);
  }

  if (req.method === 'GET' && url.pathname === '/sinz-mark.svg') {
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    return fs.createReadStream(path.join(WEB_ROOT, 'public', 'sinz-mark.svg')).pipe(res);
  }

  if (req.method === 'GET' && url.pathname === '/app.js') {
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    return fs.createReadStream(path.join(WEB_ROOT, 'public', 'app.js')).pipe(res);
  }

  if (req.method === 'GET' && url.pathname === '/sql-terminal.js') {
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    return fs.createReadStream(path.join(WEB_ROOT, 'public', 'sql-terminal.js')).pipe(res);
  }

  return sendText(res, 404, 'Not found');
});

async function shutdown(options = {}) {
  const exitProcess = options.exitProcess !== false;
  await stopSharing();
  await services.shutdown();
  await database.shutdown();
  if (admin.listening) {
    await new Promise(resolve => admin.close(() => resolve()));
  }
  if (exitProcess) process.exit(0);
}

function startServer() {
  if (admin.listening) {
    const port = admin.address().port;
    ADMIN_PORT = port;
    return Promise.resolve({ port, url: `http://${HOST}:${port}` });
  }
  return new Promise((resolve, reject) => {
    let triedFallbackPort = false;
    const onError = err => {
      if (err.code === 'EADDRINUSE' && REQUESTED_ADMIN_PORT !== 0 && !triedFallbackPort) {
        triedFallbackPort = true;
        console.warn(`Port ${REQUESTED_ADMIN_PORT} sedang dipakai; mencoba port lokal acak.`);
        admin.listen(0, HOST);
        return;
      }
      admin.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      admin.off('error', onError);
      ADMIN_PORT = admin.address().port;
      const url = `http://${HOST}:${ADMIN_PORT}`;
      console.log(`SXL Localhost Website Sharing: ${url}`);
      console.log('Panel admin hanya mendengarkan di loopback; jangan ubah HOST menjadi 0.0.0.0.');
      if (process.env.SXL_AUTO_OPEN_BROWSER === '1' && process.env.SXL_DESKTOP_APP !== '1') {
        if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', url], { windowsHide: true, stdio: 'ignore' });
        else if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
        else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
      }
      resolve({ port: ADMIN_PORT, url });
    };
    admin.on('error', onError);
    admin.once('listening', onListening);
    admin.listen(REQUESTED_ADMIN_PORT, HOST);
  });
}

async function bootstrapMariaDBForPortableLaunch() {
  if (process.env.SXL_AUTO_BOOTSTRAP_MARIADB !== '1') return { skipped: true, reason: 'Auto-bootstrap tidak diminta.' };
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Paket MariaDB 13.0.2 bawaan membutuhkan Windows x64. Gunakan runtime yang sesuai untuk platform ini.');
  }

  const firstRun = require('./lib/first-run-database');
  const dataRoot = process.env.SXL_DATA_DIR || DATA_ROOT;
  const plan = firstRun.getDatabaseLaunchPlan({ database, dataRoot, platform: process.platform, arch: process.arch });
  if (plan.action === 'skip') {
    // Existing user-selected runtimes are preserved. Do not silently switch databases.
    console.log(`[SXL] Database otomatis tidak mengubah runtime terpilih: ${plan.reason}`);
    return { skipped: true, reason: plan.reason, status: database.status() };
  }

  console.log(`[SXL] ${plan.message || 'Menyiapkan MariaDB lokal...'}`);
  try {
    const result = await firstRun.prepareDatabaseForLaunch({
      database,
      plan,
      onProgress: message => console.log(`[SXL][MariaDB] ${message}`)
    });
    if (!result.ready) throw new Error(result.reason || 'MariaDB belum melewati pemeriksaan READY.');
    console.log(`[SXL] MariaDB siap di 127.0.0.1:${result.status.port}; versi=${result.status.version}.`);
    return result;
  } catch (error) {
    database.recordBootstrapFailure?.(error);
    // Fail closed: portable launch must not pretend a broken database is ready.
    throw new Error(`Penyiapan otomatis MariaDB gagal. SXL tidak akan menampilkan aplikasi seolah database siap. ${error.message}`);
  }
}

if (require.main === module) {
  (async () => {
    await bootstrapMariaDBForPortableLaunch();
    await startServer();
  })().catch(err => {
    console.error(`SXL Sharing admin server error: ${err?.stack || err?.message || err}`);
    process.exitCode = 1;
  });
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
}

module.exports = { createStaticServer, createAuthenticatedProxyServer, safeInsideRoot, isBlockedPublicPath, phpRouterSource, listenOn, startSharing, stopSharing, getStatus, getRuntimeStatus, checkAdminRequest, shouldAutoInstallCloudflared, getCloudflaredCommand, isCloudflaredCommandAvailable, startServer, shutdown, bootstrapMariaDBForPortableLaunch, admin, database, databaseEngines, services };
