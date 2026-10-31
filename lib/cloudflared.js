'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

// Pin artifacts to the official Cloudflare cloudflared 2026.10.4 release.
// SHA-256 values are published in the GitHub release page.
const VERSION = '2026.10.4';
const ASSETS = Object.freeze({
  'win32-x64': {
    file: 'cloudflared.exe', urlName: 'cloudflared-windows-amd64.exe',
    sha256: '411b16d40c8d872243efeb52c550053d00af0a8a97fbb32e730fb8aba429eaa8', archive: false
  },
  'darwin-x64': {
    file: 'cloudflared', urlName: 'cloudflared-darwin-amd64.tgz',
    sha256: 'f11fbef4207d715892331917dafd437f032cf4b7137ed64dea3008338c1c613d', archive: true
  },
  'darwin-arm64': {
    file: 'cloudflared', urlName: 'cloudflared-darwin-arm64.tgz',
    sha256: '68b6bc4080ac1330234db2a9002d07f98b000537a1bd531a687b660d4160fa7f', archive: true
  }
});
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function allowedDownloadHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'github.com' || host === 'objects.githubusercontent.com' ||
    host === 'release-assets.githubusercontent.com';
}

function download(url, destination, redirects = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); }
    catch { reject(new Error('URL unduhan cloudflared tidak valid.')); return; }
    if (parsed.protocol !== 'https:' || !allowedDownloadHost(parsed.hostname)) {
      reject(new Error('Unduhan cloudflared hanya diizinkan dari HTTPS GitHub resmi.'));
      return;
    }
    const req = https.get(parsed, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects <= 0) { reject(new Error('Terlalu banyak redirect unduhan cloudflared.')); return; }
        let next;
        try { next = new URL(response.headers.location, parsed); }
        catch { reject(new Error('Redirect unduhan cloudflared berisi URL tidak valid.')); return; }
        if (next.protocol !== 'https:' || !allowedDownloadHost(next.hostname)) {
          reject(new Error('Redirect unduhan cloudflared ke host yang tidak tepercaya ditolak.'));
          return;
        }
        resolve(download(next.toString(), destination, redirects - 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Unduhan cloudflared gagal dengan HTTP ${response.statusCode}.`));
        return;
      }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared > MAX_DOWNLOAD_BYTES) {
        response.destroy();
        reject(new Error('Ukuran unduhan cloudflared melampaui batas keamanan 100 MB.'));
        return;
      }
      let received = 0;
      const limiter = new Transform({
        transform(chunk, encoding, callback) {
          received += chunk.length;
          if (received > MAX_DOWNLOAD_BYTES) callback(new Error('Ukuran unduhan cloudflared melampaui batas keamanan 100 MB.'));
          else callback(null, chunk);
        }
      });
      const output = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
      pipeline(response, limiter, output).then(() => resolve(), reject);
    });
    req.setTimeout(120_000, () => req.destroy(new Error('Unduhan Cloudflare Tunnel melewati batas waktu.')));
    req.once('error', reject);
  });
}

function runCapture(command, args, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      done(new Error('Pemeriksaan versi cloudflared melewati batas waktu.'));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-4000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once('error', error => done(error));
    child.once('close', code => code === 0
      ? done(null, `${stdout}\n${stderr}`.trim())
      : done(new Error((stderr || stdout || `cloudflared keluar dengan kode ${code}`).trim())));
  });
}

async function getCloudflaredVersion(command) {
  const output = await runCapture(command, ['version']);
  const match = output.match(/\bversion\s+(\d{4})\.(\d{1,2})\.(\d+)\b/i);
  if (!match) throw new Error('Versi cloudflared tidak dapat diverifikasi dari output --version.');
  return { version: `${match[1]}.${match[2]}.${match[3]}`, output };
}

function compareCalendarVersions(a, b) {
  const left = String(a).split('.').map(Number);
  const right = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

function supportsEmailAccess(version) {
  // Require the current verified release floor for the newer Quick Tunnel email allow-list.
  return compareCalendarVersions(version, '2026.10.4') >= 0;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function findNamedFile(root, name) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const current = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return current;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const found = findNamedFile(current, name);
      if (found) return found;
    }
  }
  return null;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr || `${command} keluar dengan kode ${code}`)));
  });
}

function quarantineExistingBinary(file) {
  if (!fs.existsSync(file)) return null;
  const suffix = `${Date.now()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const quarantine = `${file}.unverified-${suffix}`;
  fs.renameSync(file, quarantine);
  return quarantine;
}

function isVerifiedInstalledBinary(file, asset) {
  try {
    if (!fs.existsSync(file)) return false;
    if (!asset.archive) return sha256File(file) === asset.sha256;
    const metadata = JSON.parse(fs.readFileSync(`${file}.verified.json`, 'utf8'));
    return metadata.version === VERSION && metadata.assetSha256 === asset.sha256 && metadata.binarySha256 === sha256File(file);
  } catch { return false; }
}

function writeVerificationSidecar(file, asset, binarySha256) {
  const target = `${file}.verified.json`;
  const temp = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify({ version: VERSION, assetSha256: asset.sha256, binarySha256 }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try { fs.chmodSync(temp, 0o600); } catch {}
    // On macOS/POSIX rename replaces the old sidecar atomically; do not create a gap.
    fs.renameSync(temp, target);
  } finally { try { fs.rmSync(temp, { force: true }); } catch {} }
}

async function ensureCloudflared(runtimeRoot) {
  if (typeof runtimeRoot !== 'string' || !path.isAbsolute(runtimeRoot)) {
    throw new Error('Folder runtime SXL untuk cloudflared harus berupa path absolut.');
  }
  const key = `${process.platform}-${process.arch}`;
  const asset = ASSETS[key];
  if (!asset) throw new Error(`Cloudflare Tunnel otomatis belum disiapkan untuk platform ${key}. Gunakan binary cloudflared resmi yang sesuai atau konfigurasikan path manual.`);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const file = path.join(runtimeRoot, asset.file);
  if (fs.existsSync(file) && isVerifiedInstalledBinary(file, asset)) return file;

  const downloads = path.join(runtimeRoot, 'cloudflared-downloads');
  fs.mkdirSync(downloads, { recursive: true });
  const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const archivePath = path.join(downloads, `${token}-${asset.urlName}`);
  const stageDir = path.join(downloads, `stage-${token}`);
  const stagedBinary = path.join(downloads, `${token}-${asset.file}`);
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${asset.urlName}`;
  let quarantined = null;
  try {
    await download(url, archivePath);
    const hash = sha256File(archivePath);
    if (hash !== asset.sha256) throw new Error(`Verifikasi SHA-256 cloudflared gagal (diterima ${hash}); file ditolak.`);

    if (asset.archive) {
      fs.mkdirSync(stageDir, { recursive: true });
      const tarCandidates = ['/usr/bin/tar', '/bin/tar', 'tar'].filter((candidate, index, values) => values.indexOf(candidate) === index);
      let extracted = false;
      let lastError;
      for (const tar of tarCandidates) {
        try { await run(tar, ['-xzf', archivePath, '-C', stageDir]); extracted = true; break; }
        catch (error) { lastError = error; }
      }
      if (!extracted) throw new Error(`Tidak dapat mengekstrak arsip cloudflared: ${lastError?.message || 'tar tidak tersedia'}`);
      const found = findNamedFile(stageDir, 'cloudflared');
      if (!found) throw new Error('Binary cloudflared tidak ditemukan dalam arsip resmi.');
      fs.copyFileSync(found, stagedBinary, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(stagedBinary, 0o700);
    } else {
      fs.copyFileSync(archivePath, stagedBinary, fs.constants.COPYFILE_EXCL);
    }

    // Verify the installed executable bytes, then quarantine any prior binary instead of deleting it.
    if (sha256File(stagedBinary) !== asset.sha256 && !asset.archive) throw new Error('Checksum binary cloudflared hasil staging tidak cocok.');
    if (fs.existsSync(file)) quarantined = quarantineExistingBinary(file);
    try {
      fs.renameSync(stagedBinary, file);
      if (asset.archive) writeVerificationSidecar(file, asset, sha256File(file));
    } catch (error) {
      if (quarantined && !fs.existsSync(file)) {
        try { fs.renameSync(quarantined, file); quarantined = null; } catch {}
      }
      throw error;
    }
    if (process.platform !== 'win32') fs.chmodSync(file, 0o700);
    return file;
  } finally {
    for (const candidate of [archivePath, stagedBinary, stageDir]) {
      try { fs.rmSync(candidate, { recursive: true, force: true }); } catch {}
    }
  }
}

function pathIsWithin(parent, candidate) {
  const rel = path.relative(path.resolve(parent), path.resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function createIsolatedTunnelHome(runtimeRoot) {
  if (typeof runtimeRoot !== 'string' || !path.isAbsolute(runtimeRoot)) {
    throw new Error('Folder runtime SXL untuk konfigurasi tunnel harus berupa path absolut.');
  }
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const runtimeReal = fs.realpathSync(runtimeRoot);
  const base = path.join(runtimeReal, 'cloudflared-home');
  try {
    const existing = fs.lstatSync(base);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error('Folder cloudflared-home bukan direktori nyata atau merupakan symbolic link/reparse point.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    fs.mkdirSync(base, { recursive: false });
  }
  const baseReal = fs.realpathSync(base);
  if (!pathIsWithin(runtimeReal, baseReal) || baseReal === runtimeReal) {
    throw new Error('Lokasi konfigurasi tunnel keluar dari direktori runtime SXL; operasi ditolak.');
  }
  const home = fs.mkdtempSync(path.join(baseReal, 'quick-tunnel-'));
  const homeStat = fs.lstatSync(home);
  if (!homeStat.isDirectory() || homeStat.isSymbolicLink() || !pathIsWithin(baseReal, home)) {
    throw new Error('Direktori konfigurasi tunnel terisolasi tidak valid.');
  }
  try { if (process.platform !== 'win32') fs.chmodSync(home, 0o700); } catch {}
  return home;
}

module.exports = {
  ensureCloudflared, getCloudflaredVersion, supportsEmailAccess, compareCalendarVersions,
  createIsolatedTunnelHome, pathIsWithin, allowedDownloadHost, isVerifiedInstalledBinary, writeVerificationSidecar, VERSION, ASSETS
};
