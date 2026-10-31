'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cloudflared = require('../lib/cloudflared');
const share = require('../lib/share-options');

 test('cloudflared pins the latest official Windows/macOS assets and published SHA-256 values', () => {
  assert.equal(cloudflared.VERSION, '2026.10.4');
  assert.equal(cloudflared.ASSETS['win32-x64'].sha256, '411b16d40c8d872243efeb52c550053d00af0a8a97fbb32e730fb8aba429eaa8');
  assert.equal(cloudflared.ASSETS['darwin-x64'].sha256, 'f11fbef4207d715892331917dafd437f032cf4b7137ed64dea3008338c1c613d');
  assert.equal(cloudflared.ASSETS['darwin-arm64'].sha256, '68b6bc4080ac1330234db2a9002d07f98b000537a1bd531a687b660d4160fa7f');
  for (const asset of Object.values(cloudflared.ASSETS)) assert.match(asset.sha256, /^[a-f0-9]{64}$/);
});

test('Cloudflare downloader accepts only HTTPS and official GitHub release hosts for redirects', () => {
  assert.equal(cloudflared.allowedDownloadHost('github.com'), true);
  assert.equal(cloudflared.allowedDownloadHost('release-assets.githubusercontent.com'), true);
  assert.equal(cloudflared.allowedDownloadHost('githubusercontent.com'), false, 'parent host is not an asset host');
  assert.equal(cloudflared.allowedDownloadHost('evil.githubusercontent.com'), false, 'unknown upload hosts are not trusted');
  assert.equal(cloudflared.allowedDownloadHost('github.evil.example'), false);
  assert.equal(cloudflared.allowedDownloadHost('example.com'), false);
});

test('email allow-list normalizes, deduplicates, and validates exact/wildcard email entries', () => {
  assert.deepEqual(share.normalizeAllowedEmails('Alice@example.com\nalice@example.com; *@example.org'), ['alice@example.com', '*@example.org']);
  assert.throws(() => share.normalizeAllowedEmails('not-an-email'), /Format email/);
  assert.throws(() => share.normalizeAllowedEmails('person@example.com\n\n bad @example.com'), /Format email/);
  assert.throws(() => share.normalizeAllowedEmails(Array.from({length: 21}, (_, i) => `u${i}@example.com`)), /Maksimal 20/);
});

test('sharing requires explicit confirmation before starting a public unauthenticated tunnel', () => {
  assert.throws(() => share.validatePublicAccess({}), /belum dikonfirmasi/);
  assert.deepEqual(share.validatePublicAccess({ confirmPublicAccess: true }), { allowedEmails: [], protectionMode: 'public' });
  assert.deepEqual(share.validatePublicAccess({ allowedEmails: ['dev@example.com'] }), { allowedEmails: ['dev@example.com'], protectionMode: 'email' });
  assert.equal(share.validatePublicAccess({ accessPassword: 'safe-password-123', allowedEmails: ['dev@example.com'] }).protectionMode, 'email+password');
});

test('tunnel args only publish loopback preview and append repeated allowed-mail flags', () => {
  assert.deepEqual(share.buildTunnelArgs(5180, ['a@example.com', 'b@example.org']), [
    'tunnel', '--url', 'http://127.0.0.1:5180', '--no-autoupdate', '--allowed-mail', 'a@example.com', '--allowed-mail', 'b@example.org'
  ]);
  assert.throws(() => share.buildTunnelArgs(70000), /Port preview/);
});

test('email allow-list requires the currently verified cloudflared release floor', () => {
  assert.equal(cloudflared.supportsEmailAccess('2026.10.4'), true);
  assert.equal(cloudflared.supportsEmailAccess('2026.11.0'), true);
  assert.equal(cloudflared.supportsEmailAccess('2026.10.3'), false);
  assert.equal(cloudflared.supportsEmailAccess('2026.9.9'), false);
});

test('isolated Quick Tunnel home is unique and kept separate from the real user profile', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-cloudflared-test-'));
  const runtimeRoot = path.join(root, 'runtime');
  const first = cloudflared.createIsolatedTunnelHome(runtimeRoot);
  const second = cloudflared.createIsolatedTunnelHome(runtimeRoot);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.notEqual(first, second);
  assert.equal(fs.existsSync(first), true);
  assert.equal(fs.existsSync(second), true);
  assert.equal(first.startsWith(path.join(runtimeRoot, 'cloudflared-home')), true);
});

test('macOS archive runtime reuses only a binary whose SHA matches its verified archive sidecar', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-cloudflared-sidecar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'cloudflared');
  fs.writeFileSync(file, 'verified mock binary');
  assert.equal(cloudflared.isVerifiedInstalledBinary(file, cloudflared.ASSETS['darwin-arm64']), false);
  const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  cloudflared.writeVerificationSidecar(file, cloudflared.ASSETS['darwin-arm64'], digest);
  assert.equal(cloudflared.isVerifiedInstalledBinary(file, cloudflared.ASSETS['darwin-arm64']), true);
  fs.writeFileSync(file, 'changed');
  assert.equal(cloudflared.isVerifiedInstalledBinary(file, cloudflared.ASSETS['darwin-arm64']), false);
});

test('managed Cloudflare executable installation validates version and environment-specific configuration isolation helpers', () => {
  assert.equal(cloudflared.VERSION, '2026.10.4');
  assert.equal(typeof cloudflared.isVerifiedInstalledBinary, 'function');
  assert.equal(typeof cloudflared.createIsolatedTunnelHome, 'function');
});

test('isolated tunnel home refuses a symlinked cloudflared-home that points outside the managed runtime', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-cloudflared-symlink-'));
  const runtime = path.join(root, 'runtime');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(runtime, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  try { fs.symlinkSync(outside, path.join(runtime, 'cloudflared-home'), 'dir'); }
  catch (error) { return t.skip(`OS/filesystem does not permit test directory symlinks: ${error.message}`); }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => cloudflared.createIsolatedTunnelHome(runtime), /symbolic link|reparse point|keluar dari direktori/i);
  assert.equal(fs.readdirSync(outside).length, 0, 'outside location remains untouched');
});
