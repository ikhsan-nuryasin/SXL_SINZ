'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const runtimePaths = require('./runtime-paths');

// Pin a supported LTS runtime. Downloads are verified against the official
// Node.js SHASUMS256 file before an archive is extracted or executed.
const NODE_VERSION = 'v24.22.1';
// phpMyAdmin 5.2.x supports PHP < 8.4. Pin to the latest stable 8.3 security line.
const PHP_VERSION = '8.3.36';
const PHP_WINDOWS_FILENAME = `php-${PHP_VERSION}-1-nts-Win32-vs16-x64.zip`;
// Pinned against the SHA-256 published on the official PHP for Windows downloads page.
const PHP_WINDOWS_SHA256 = '1a097d52b7a68622cdc723073b61cc70caf79c941218ff65b2d8441dbc6b10d4';
const PHP_WINDOWS_URL = `https://downloads.php.net/~windows/releases/archives/${PHP_WINDOWS_FILENAME}`;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

function nodeAssetFor(platform = process.platform, arch = process.arch) {
  const names = {
    'win32-x64': `node-${NODE_VERSION}-win-x64.zip`,
    'darwin-x64': `node-${NODE_VERSION}-darwin-x64.tar.gz`,
    'darwin-arm64': `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
    'linux-x64': `node-${NODE_VERSION}-linux-x64.tar.xz`,
    'linux-arm64': `node-${NODE_VERSION}-linux-arm64.tar.xz`
  };
  const filename = names[`${platform}-${arch}`];
  if (!filename) throw new Error(`Runtime Node.js portable belum tersedia untuk ${platform}/${arch}.`);
  return filename;
}

function validSha256(actual, expected) {
  return /^[a-f0-9]{64}$/i.test(expected || '') && actual.toLowerCase() === expected.toLowerCase();
}

function checksumForAsset(text, filename) {
  const line = String(text).split(/\r?\n/).find(item => {
    const match = item.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    return match && match[2].trim() === filename;
  });
  return line ? line.match(/^([a-f0-9]{64})/i)[1].toLowerCase() : null;
}

function describeNetworkError(error) {
  const details = [];
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    const code = typeof current.code === 'string' ? current.code : '';
    const message = typeof current.message === 'string' ? current.message : '';
    if (code && !details.includes(code)) details.push(code);
    if (message && !['fetch failed', 'fetch failed.'].includes(message.toLowerCase()) && !details.includes(message)) details.push(message);
    current = current.cause;
  }
  if (!details.length && error?.message) details.push(`${error.name || 'Error'}: ${error.message}`);
  return details.length ? details.join(' → ') : 'penyebab jaringan tidak dilaporkan oleh runtime';
}

function proxyUrlFor(url, env = process.env) {
  let target;
  try { target = new URL(url); } catch { return null; }
  if (isNoProxyTarget(target, env.NO_PROXY || env.no_proxy || '')) return null;
  const candidates = target.protocol === 'https:'
    ? [env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy, env.ALL_PROXY, env.all_proxy]
    : [env.HTTP_PROXY, env.http_proxy, env.ALL_PROXY, env.all_proxy];
  return candidates.find(value => typeof value === 'string' && value.trim())?.trim() || null;
}

function isNoProxyTarget(target, noProxyValue = '') {
  const entries = String(noProxyValue || '').split(/[;,\s]+/).filter(Boolean);
  const host = String(target.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  const port = target.port || (target.protocol === 'https:' ? '443' : target.protocol === 'http:' ? '80' : '');
  return entries.some(raw => {
    const entry = raw.toLowerCase().trim();
    if (!entry) return false;
    if (entry === '*') return true;
    let ruleHost = entry;
    let rulePort = '';
    if (entry.startsWith('[')) {
      const end = entry.indexOf(']');
      if (end >= 0) {
        ruleHost = entry.slice(1, end);
        if (entry.slice(end + 1).startsWith(':')) rulePort = entry.slice(end + 2);
      }
    } else if ((entry.match(/:/g) || []).length === 1) {
      const splitAt = entry.lastIndexOf(':');
      ruleHost = entry.slice(0, splitAt);
      rulePort = entry.slice(splitAt + 1);
    }
    ruleHost = ruleHost.replace(/^\./, '');
    if (rulePort && rulePort !== port) return false;
    return host === ruleHost || host.endsWith(`.${ruleHost}`);
  });
}

const proxyAgents = new Map();
function fetchWithConfiguredProxy(url, options = {}) {
  const proxyUrl = proxyUrlFor(url);
  if (!proxyUrl) return fetch(url, options);
  let parsedProxy;
  try { parsedProxy = new URL(proxyUrl); }
  catch { throw new Error('Variabel proxy HTTPS_PROXY/HTTP_PROXY tidak berisi URL yang valid. Gunakan format seperti http://proxy.example:8080.'); }
  if (!['http:', 'https:'].includes(parsedProxy.protocol) || !parsedProxy.hostname) {
    throw new Error('URL proxy harus menggunakan protokol http:// atau https:// dengan hostname yang valid.');
  }
  let ProxyAgent;
  try { ({ ProxyAgent } = require('undici')); }
  catch {
    // Do not silently pretend a configured proxy was used. The direct request
    // may still work in environments whose built-in fetch has proxy support.
    if (process.env.NODE_USE_ENV_PROXY === '1' || process.env.NODE_USE_ENV_PROXY === 'true') return fetch(url, options);
    throw new Error('Proxy terdeteksi di variabel lingkungan, tetapi modul proxy tidak tersedia. Jalankan `npm install` ulang, atau mulai SXL dengan koneksi langsung / NODE_USE_ENV_PROXY=1 jika runtime mendukungnya.');
  }
  let agent = proxyAgents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    proxyAgents.set(proxyUrl, agent);
  }
  // Use fetch from the same Undici package as ProxyAgent to avoid dispatcher
  // compatibility mismatches with the version embedded inside Node/Electron.
  const undici = require('undici');
  return undici.fetch(url, { ...options, dispatcher: agent });
}

function networkFailureMessage(url, purpose, error, timeoutMs) {
  const host = (() => { try { return new URL(url).hostname; } catch { return 'sumber runtime'; } })();
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return `Pengambilan ${purpose} dari ${host} melewati batas waktu ${Math.round(timeoutMs / 1000)} detik. Periksa koneksi internet, DNS, proxy, atau firewall.`;
  }
  const proxyConfigured = Boolean(proxyUrlFor(url));
  const detail = describeNetworkError(error);
  const proxyHint = proxyConfigured
    ? 'Proxy lingkungan terdeteksi; pastikan HTTPS_PROXY/HTTP_PROXY dapat diakses dan tidak memerlukan autentikasi yang belum dikonfigurasi.'
    : 'Jika jaringan memakai proxy, atur HTTPS_PROXY atau HTTP_PROXY sebelum membuka SXL. Periksa juga DNS, sertifikat HTTPS, dan firewall.';
  return `Tidak dapat mengambil ${purpose} dari ${host}. Detail jaringan: ${detail}. ${proxyHint} Jika jaringan membatasi nodejs.org/windows.php.net, gunakan koneksi lain atau pasang runtime yang diperlukan secara lokal.`;
}

async function fetchText(url, purpose = 'metadata runtime') {
  const timeoutMs = 60_000;
  let response;
  try { response = await fetchWithConfiguredProxy(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }); }
  catch (error) {
    throw new Error(networkFailureMessage(url, purpose, error, timeoutMs));
  }
  if (!response.ok) throw new Error(`Pengambilan ${purpose} gagal (HTTP ${response.status}) dari ${new URL(url).hostname}.`);
  return response.text();
}

async function downloadToFile(url, destination, purpose = 'runtime') {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const timeoutMs = DOWNLOAD_TIMEOUT_MS;
  let response;
  try { response = await fetchWithConfiguredProxy(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }); }
  catch (error) {
    await fs.promises.rm(destination, { force: true }).catch(() => {});
    throw new Error(networkFailureMessage(url, `unduhan ${purpose}`, error, timeoutMs));
  }
  if (!response.ok || !response.body) throw new Error(`Unduhan ${purpose} gagal (HTTP ${response.status}) dari ${new URL(url).hostname}.`);
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination, { flags: 'w', mode: 0o600 }));
  } catch (error) {
    await fs.promises.rm(destination, { force: true }).catch(() => {});
    throw new Error(`File ${purpose} tidak selesai diunduh: ${error.message}`);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, options.timeoutMs || DOWNLOAD_TIMEOUT_MS);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-10000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-10000); });
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error((stderr || stdout || `${command} keluar dengan kode ${code}`).trim()));
      else resolve({ stdout, stderr });
    });
  });
}

function getNodePaths(dataRoot) {
  const folder = path.join(dataRoot, 'runtime', 'node', `${NODE_VERSION}-${process.platform}-${process.arch}`);
  const binDir = process.platform === 'win32' ? folder : path.join(folder, 'bin');
  const node = path.join(binDir, process.platform === 'win32' ? 'node.exe' : 'node');
  const npmCliCandidates = process.platform === 'win32'
    ? [path.join(folder, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    : [path.join(folder, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  return { folder, binDir, node, npmCli: npmCliCandidates.find(file => fs.existsSync(file)) || npmCliCandidates[0], source: 'sxl-portable', version: NODE_VERSION };
}

function isFile(file) {
  if (!file || typeof file !== 'string') return false;
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function commonNodeCandidates(env = process.env, platform = process.platform) {
  const configuredNode = runtimePaths.getRuntimePaths().nodeBinary;
  const candidates = [configuredNode, env.SXL_NODE_PATH, env.npm_node_execpath, findOnPath('node', env)];
  if (!env.SXL_NODE_PATH && process.release?.name === 'node' && isFile(process.execPath)) candidates.push(process.execPath);
  if (platform === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.NVM_SYMLINK].filter(Boolean);
    for (const root of roots) candidates.push(path.join(root, 'nodejs', 'node.exe'));
    if (env.NVM_SYMLINK) candidates.push(path.join(env.NVM_SYMLINK, 'node.exe'));
    if (env.VOLTA_HOME) candidates.push(path.join(env.VOLTA_HOME, 'bin', 'node.exe'));
    if (env.USERPROFILE) candidates.push(path.join(env.USERPROFILE, 'scoop', 'apps', 'nodejs-lts', 'current', 'node.exe'));
  } else {
    candidates.push('/usr/local/bin/node', '/usr/bin/node');
    if (platform === 'darwin') candidates.push('/opt/homebrew/bin/node', '/usr/local/opt/node/bin/node');
    if (env.NVM_BIN) candidates.push(path.join(env.NVM_BIN, 'node'));
    if (env.VOLTA_HOME) candidates.push(path.join(env.VOLTA_HOME, 'bin', 'node'));
  }
  return [...new Set(candidates.filter(Boolean))];
}

function findNpmCliForNode(nodePath, env = process.env) {
  if (!nodePath) return null;
  const configured = runtimePaths.getRuntimePaths();
  const candidates = [];
  if (configured.nodeBinary && path.resolve(configured.nodeBinary) === path.resolve(nodePath) && configured.npmCli) candidates.push(configured.npmCli);
  // npm sets these variables for child processes launched with `npm run`.
  // Electron inherits them during development, even when Node.js is not on the
  // PATH visible to the packaged application process.
  if (env.SXL_NPM_CLI_PATH) candidates.push(env.SXL_NPM_CLI_PATH);
  if (env.npm_execpath && /(?:^|[\\/])npm-cli\.js$/i.test(env.npm_execpath)) candidates.push(env.npm_execpath);
  const dir = path.dirname(nodePath);
  candidates.push(
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(dir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(dir, '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  );
  const npmLauncher = findOnPath('npm', env);
  if (npmLauncher) {
    const npmDir = path.dirname(npmLauncher);
    candidates.push(
      path.join(npmDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.resolve(npmDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    );
  }
  for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.APPDATA]) {
    if (root) candidates.push(path.join(root, 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  }
  try {
    const realNode = fs.realpathSync(nodePath);
    const realDir = path.dirname(realNode);
    candidates.push(
      path.join(realDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.resolve(realDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.resolve(realDir, '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    );
  } catch {}
  return [...new Set(candidates)].find(isFile) || null;
}

function findSystemNodeRuntimePaths(env = process.env, platform = process.platform) {
  const configured = runtimePaths.getRuntimePaths();
  if (configured.nodeBinary && isFile(configured.nodeBinary)) {
    const npmCli = configured.npmCli && isFile(configured.npmCli) ? configured.npmCli : findNpmCliForNode(configured.nodeBinary, env);
    if (npmCli && isFile(npmCli)) return { node: configured.nodeBinary, npmCli, binDir: path.dirname(configured.nodeBinary), folder: path.dirname(configured.nodeBinary), source: 'manual', version: null };
  }
  for (const node of commonNodeCandidates(env, platform)) {
    if (!isFile(node)) continue;
    const npmCli = findNpmCliForNode(node, env);
    if (!npmCli) continue;
    return { node, npmCli, binDir: path.dirname(node), folder: path.dirname(node), source: 'system', version: null };
  }
  return null;
}

function isSupportedNodeVersion(version) {
  const match = String(version || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 12);
}

async function inspectSystemNodeRuntime() {
  const runtime = findSystemNodeRuntimePaths();
  if (!runtime) return { runtime: null, reason: 'Node.js sistem tidak ditemukan bersama npm-cli.js.' };
  try {
    const result = await run(runtime.node, ['--version'], { timeoutMs: 5000 });
    const version = result.stdout.trim();
    if (!isSupportedNodeVersion(version)) {
      return { runtime: null, reason: `Node.js sistem ${version || '(versi tidak diketahui)'} ditemukan, tetapi SXL memerlukan Node.js 22.12 atau lebih baru.` };
    }
    return { runtime: { ...runtime, version } , reason: null };
  } catch (error) {
    return { runtime: null, reason: `Node.js sistem ditemukan tetapi tidak dapat dijalankan: ${error.message}` };
  }
}

async function ensureNodeRuntime(dataRoot, options = {}) {
  const installed = getNodePaths(dataRoot);
  if (fs.existsSync(installed.node) && fs.existsSync(installed.npmCli)) return installed;

  // Prefer an already-installed compatible Node.js/npm pair. This avoids a
  // metadata download entirely on developer machines with Node.js installed.
  const inspectSystem = options.inspectSystemNodeRuntime || inspectSystemNodeRuntime;
  const system = await inspectSystem();
  if (system.runtime) return system.runtime;

  const filename = nodeAssetFor();
  const baseUrl = `https://nodejs.org/dist/${NODE_VERSION}`;
  const downloads = path.join(dataRoot, 'runtime', 'downloads');
  const archive = path.join(downloads, filename);
  let checksumText;
  try { checksumText = await fetchText(`${baseUrl}/SHASUMS256.txt`, 'checksum resmi Node.js'); }
  catch (error) {
    if (system.reason) error.message += `\nPemeriksaan runtime lokal: ${system.reason}`;
    error.message += '\nUntuk mode Node.js, pasang Node.js 22.12 atau lebih baru beserta npm, lalu buka ulang SXL. Jika Node.js sudah terpasang, pastikan PATH tersedia untuk aplikasi atau atur SXL_NODE_PATH dan SXL_NPM_CLI_PATH.';
    throw error;
  }
  const expected = checksumForAsset(checksumText, filename);
  if (!expected) throw new Error(`Checksum resmi Node.js tidak memuat ${filename}. Runtime tidak dipasang.`);

  await downloadToFile(`${baseUrl}/${filename}`, archive, `Node.js ${NODE_VERSION}`);
  const digest = crypto.createHash('sha256').update(await fs.promises.readFile(archive)).digest('hex');
  if (!validSha256(digest, expected)) {
    await fs.promises.rm(archive, { force: true });
    throw new Error('Checksum Node.js tidak cocok. Arsip ditolak dan tidak dieksekusi.');
  }

  const staging = `${installed.folder}.staging-${crypto.randomBytes(4).toString('hex')}`;
  await fs.promises.rm(staging, { recursive: true, force: true });
  await fs.promises.mkdir(staging, { recursive: true });
  try {
    if (process.platform === 'win32') {
      const escapedArchive = archive.replace(/'/g, "''");
      const escapedStage = staging.replace(/'/g, "''");
      await run(process.env.SXL_POWERSHELL_PATH || 'powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedStage}' -Force`
      ]);
      const extracted = path.join(staging, `node-${NODE_VERSION}-win-x64`);
      if (!fs.existsSync(path.join(extracted, 'node.exe'))) throw new Error('node.exe tidak ditemukan di arsip resmi.');
      await fs.promises.rm(installed.folder, { recursive: true, force: true });
      await fs.promises.mkdir(path.dirname(installed.folder), { recursive: true });
      await fs.promises.rename(extracted, installed.folder);
      await fs.promises.rm(staging, { recursive: true, force: true });
    } else {
      const tarArgs = filename.endsWith('.xz') ? ['-xJf', archive, '-C', staging, '--strip-components=1'] : ['-xzf', archive, '-C', staging, '--strip-components=1'];
      await run('tar', tarArgs);
      if (!fs.existsSync(path.join(staging, 'bin', 'node')) || !fs.existsSync(path.join(staging, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))) {
        throw new Error('Runtime node/npm tidak ditemukan setelah ekstraksi.');
      }
      await fs.promises.rm(installed.folder, { recursive: true, force: true });
      await fs.promises.mkdir(path.dirname(installed.folder), { recursive: true });
      await fs.promises.rename(staging, installed.folder);
    }
  } catch (error) {
    await fs.promises.rm(staging, { recursive: true, force: true });
    throw new Error(`Runtime Node.js gagal dipasang: ${error.message}`);
  } finally {
    await fs.promises.rm(archive, { force: true }).catch(() => {});
  }

  const ready = getNodePaths(dataRoot);
  if (!fs.existsSync(ready.node) || !fs.existsSync(ready.npmCli)) throw new Error('Node.js terunduh tetapi pemeriksaan akhir gagal.');
  if (process.platform !== 'win32') await fs.promises.chmod(ready.node, 0o700).catch(() => {});
  return ready;
}

function findOnPath(command, env = process.env) {
  const platform = env.SXL_TEST_PLATFORM || process.platform;
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  const extensions = platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const rawDir of (env.PATH || '').split(delimiter).filter(Boolean)) {
    const dir = rawDir.replace(/^\"|\"$/g, '').trim();
    if (!dir) continue;
    for (const extension of extensions) {
      const suffix = extension && !command.toLowerCase().endsWith(extension.toLowerCase()) ? extension : '';
      const candidate = path.join(dir, `${command}${suffix}`);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

function findBundledRuntimePackage(filename, dataRoot) {
  const candidates = [
    process.env.SXL_RUNTIME_PACKAGES_DIR ? path.join(process.env.SXL_RUNTIME_PACKAGES_DIR, filename) : '',
    path.join(process.env.SXL_APP_ROOT || path.resolve(__dirname, '..'), 'runtime', 'packages', filename),
    path.join(dataRoot, 'runtime', 'packages', filename)
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && !stat.isSymbolicLink()) return candidate;
    } catch {}
  }
  return '';
}

function getPhpPaths(dataRoot) {
  const folder = path.join(dataRoot, 'runtime', 'php', PHP_VERSION);
  return { folder, php: path.join(folder, process.platform === 'win32' ? 'php.exe' : 'php') };
}

async function ensurePhpRuntime(dataRoot, options = {}) {
  const configured = runtimePaths.getRuntimePaths();
  const pathSetting = process.env.SXL_PHP_PATH;
  const systemCandidates = [
    configured.phpBinary, pathSetting,
    findOnPath('php'),
    ...(process.platform === 'darwin' ? [
      '/opt/homebrew/opt/php@8.3/bin/php', '/usr/local/opt/php@8.3/bin/php',
      '/opt/homebrew/bin/php', '/usr/local/bin/php'
    ] : [])
  ].filter(Boolean);
  if (!options.forcePortable) {
    const systemPhp = systemCandidates.find(candidate => fs.existsSync(candidate));
    if (systemPhp) return { php: systemPhp, source: 'system' };
  }

  if (process.platform === 'darwin') {
    const brewPhp83 = systemCandidates.find(candidate => /php@8\.3/.test(candidate) && fs.existsSync(candidate));
    if (brewPhp83) return { php: brewPhp83, source: 'homebrew-php83' };
    throw new Error('SXL memerlukan PHP 8.3 untuk phpMyAdmin yang stabil. Pasang dengan `brew install php@8.3`, lalu arahkan SXL_PHP_PATH ke binary PHP 8.3.');
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Runtime PHP portable otomatis hanya disediakan untuk Windows x64. Pada sistem lain, pasang PHP 8.3 dan atur SXL_PHP_PATH.');
  }

  const installed = getPhpPaths(dataRoot);
  if (fs.existsSync(installed.php)) return { ...installed, source: 'sxl-portable' };
  const downloads = path.join(dataRoot, 'runtime', 'downloads');
  const archive = path.join(downloads, PHP_WINDOWS_FILENAME);
  const bundledArchive = findBundledRuntimePackage(PHP_WINDOWS_FILENAME, dataRoot);
  await fs.promises.mkdir(downloads, { recursive: true });
  if (bundledArchive) {
    await fs.promises.copyFile(bundledArchive, archive);
  } else {
    await downloadToFile(PHP_WINDOWS_URL, archive, `PHP ${PHP_VERSION}`);
  }
  const digest = crypto.createHash('sha256').update(await fs.promises.readFile(archive)).digest('hex');
  if (!validSha256(digest, PHP_WINDOWS_SHA256)) {
    await fs.promises.rm(archive, { force: true });
    throw new Error(`Checksum PHP ${PHP_VERSION} tidak cocok. Arsip ditolak (SHA-256: ${digest}).`);
  }
  const staging = `${installed.folder}.staging-${crypto.randomBytes(4).toString('hex')}`;
  await fs.promises.mkdir(staging, { recursive: true });
  try {
    const escapedArchive = archive.replace(/'/g, "''");
    const escapedStage = staging.replace(/'/g, "''");
    await run(process.env.SXL_POWERSHELL_PATH || 'powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedStage}' -Force`
    ]);
    const phpExe = path.join(staging, 'php.exe');
    if (!fs.existsSync(phpExe)) throw new Error('php.exe tidak ditemukan dalam arsip PHP resmi.');
    const iniSample = path.join(staging, 'php.ini-production');
    if (fs.existsSync(iniSample)) await fs.promises.copyFile(iniSample, path.join(staging, 'php.ini'));
    const iniPath = path.join(staging, 'php.ini');
    let ini = await fs.promises.readFile(iniPath, 'utf8').catch(() => '');
    ini = ini.replace(/^;\s*extension_dir\s*=\s*"?ext"?/m, 'extension_dir = "ext"');
    for (const extension of ['curl', 'fileinfo', 'mbstring', 'mysqli', 'openssl', 'pdo_mysql', 'zip', 'gd', 'intl', 'exif']) {
      const re = new RegExp(`^;\\s*extension=${extension.replace('-', '\\-')}\\s*$`, 'm');
      ini = ini.replace(re, `extension=${extension}`);
    }
    await fs.promises.writeFile(iniPath, ini, 'utf8');
    await fs.promises.mkdir(path.dirname(installed.folder), { recursive: true });
    await fs.promises.rm(installed.folder, { recursive: true, force: true });
    await fs.promises.rename(staging, installed.folder);
  } catch (error) {
    await fs.promises.rm(staging, { recursive: true, force: true });
    throw new Error(`PHP portable gagal dipasang: ${error.message}. Pastikan Microsoft Visual C++ Redistributable x64 tersedia.`);
  } finally {
    await fs.promises.rm(archive, { force: true }).catch(() => {});
  }
  const ready = getPhpPaths(dataRoot);
  if (!fs.existsSync(ready.php)) throw new Error('Instalasi PHP selesai tetapi php.exe tidak ditemukan.');
  return { ...ready, source: 'sxl-portable' };
}

module.exports = {
  NODE_VERSION, PHP_VERSION, PHP_WINDOWS_FILENAME, PHP_WINDOWS_SHA256, PHP_WINDOWS_URL, nodeAssetFor, validSha256, checksumForAsset,
  ensureNodeRuntime, ensurePhpRuntime, getNodePaths, getPhpPaths, findOnPath, findBundledRuntimePackage,
  findNpmCliForNode, findSystemNodeRuntimePaths, isSupportedNodeVersion, describeNetworkError,
  fetchText, proxyUrlFor, isNoProxyTarget, commonNodeCandidates
};
