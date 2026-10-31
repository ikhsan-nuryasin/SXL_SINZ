'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createStaticServer, createAuthenticatedProxyServer, isBlockedPublicPath, safeInsideRoot, startSharing, stopSharing, getStatus } = require('../server');
const { isValidSharePassword } = require('../lib/basic-auth');

function request(port, route, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function listenPreview(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('admin server starts on loopback, reports its actual port, and exposes database-engine status API', async t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-admin-data-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, SXL_DATA_DIR: dataRoot, SXL_SHARING_PORT: '0', SXL_AUTO_OPEN_BROWSER: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => { try { child.kill('SIGTERM'); } catch {} fs.rmSync(dataRoot, { recursive: true, force: true }); });

  let output = '';
  let errors = '';
  child.stdout.on('data', chunk => output += chunk.toString());
  child.stderr.on('data', chunk => errors += chunk.toString());
  const started = Date.now();
  while (!output.includes('SXL Localhost Website Sharing:')) {
    if (child.exitCode !== null) throw new Error(`Server exited early: ${errors}`);
    if (Date.now() - started > 5000) throw new Error(`Server did not start. stdout=${output}; stderr=${errors}`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  assert.ok(match, output);
  const port = Number(match[1]);
  assert.ok(port > 0, 'port 0 should be replaced by the OS-assigned port');

  const home = await request(port, '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Berbagi Website/);
  assert.match(home.body, /<title>SINZ/);
  const engineStatus = await request(port, '/api/engines/status');
  assert.equal(engineStatus.status, 200);
  const enginePayload = JSON.parse(engineStatus.body);
  assert.equal(enginePayload.ok, true);
  assert.equal(enginePayload.postgresql.configured, false);
  assert.equal(enginePayload.sqlite.configured, false);
  const csrfMatch = home.body.match(/name="sxl-csrf" content="([a-f0-9]{64})"/);
  assert.ok(csrfMatch, 'dashboard should receive a per-process CSRF token');
  const noCsrf = await request(port, '/api/stop', 'POST', {
    origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json'
  });
  assert.equal(noCsrf.status, 403, 'state-changing API requests require CSRF token');
  const wrongContentType = await request(port, '/api/stop', 'POST', {
    origin: `http://127.0.0.1:${port}`, 'x-sxl-csrf': csrfMatch[1], 'content-type': 'text/plain'
  });
  assert.equal(wrongContentType.status, 415, 'state-changing requests must use JSON content type');
  const wrongHost = await request(port, '/api/status', 'GET', { host: '127.0.0.1.attacker.example' });
  assert.equal(wrongHost.status, 403, 'admin API rejects non-loopback Host headers');

  const styles = await request(port, '/styles.css');
  assert.equal(styles.status, 200, 'new interface stylesheet must be served by the local panel');
  assert.match(styles.headers['content-type'] || '', /text\/css/);
  assert.match(styles.body, /\.sidebar/);
  assert.match(styles.body, /--card-radius:11px/);
  assert.match(styles.body, /--accent:#1769d2/);

  const logo = await request(port, '/sinz-mark.svg');
  assert.equal(logo.status, 200, 'the desktop brand mark must be served by the local panel');
  assert.match(logo.headers['content-type'] || '', /image\/svg\+xml/);
  assert.match(logo.body, /SINZ.*tikus bertopi/);

  const appJs = await request(port, '/app.js');
  assert.equal(appJs.status, 200);
  assert.match(appJs.headers['content-type'], /javascript/);

  assert.match(home.body, /Pengelola MariaDB/);
  const databaseStatusResponse = await request(port, '/api/database/status');
  assert.equal(databaseStatusResponse.status, 200);
  const databaseStatus = JSON.parse(databaseStatusResponse.body);
  assert.equal(databaseStatus.host, '127.0.0.1');
  assert.equal(databaseStatus.port, 3307);
  assert.equal(typeof databaseStatus.supported, 'boolean');

  const stackResponse = await request(port, '/api/services/status');
  assert.equal(stackResponse.status, 200);
  const stack = JSON.parse(stackResponse.body);
  assert.equal(typeof stack.apache.installed, 'boolean');
  assert.equal(typeof stack.php.installSupported, 'boolean');
  assert.equal(typeof stack.composer.installed, 'boolean');
  assert.equal(stack.phpMyAdmin.version, '5.2.3');
  assert.ok(stack.database);

  const forgedOrigin = await request(port, '/api/stop', 'POST', {
    origin: 'https://attacker.example', 'content-type': 'application/json', 'x-sxl-csrf': csrfMatch[1]
  });
  assert.equal(forgedOrigin.status, 403, 'admin API rejects cross-origin browser requests');

  const acceptedLocalPost = await request(port, '/api/stop', 'POST', {
    origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'x-sxl-csrf': csrfMatch[1]
  });
  assert.equal(acceptedLocalPost.status, 200, 'dashboard can make authorized local state-changing requests');

  const response = await request(port, '/api/status');
  assert.equal(response.status, 200);
  const status = JSON.parse(response.body);
  assert.equal(status.sharing, false);
  assert.equal(status.adminUrl, `http://127.0.0.1:${port}`);
});

test('static preview serves approved assets and SPA routes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-site-'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>OK</title>');
  fs.writeFileSync(path.join(root, 'assets', 'site.css'), 'body{color:green}');
  const server = createStaticServer(root);
  const port = await listenPreview(server);
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  const home = await request(port, '/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-type'], /text\/html/);
  assert.match(home.body, /<title>OK<\/title>/);

  const asset = await request(port, '/assets/site.css');
  assert.equal(asset.status, 200);
  assert.match(asset.headers['content-type'], /text\/css/);

  const spa = await request(port, '/dashboard/profile');
  assert.equal(spa.status, 200);
  assert.match(spa.body, /<title>OK<\/title>/);

  const head = await request(port, '/assets/site.css', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');

  const post = await request(port, '/', 'POST');
  assert.equal(post.status, 405);
  assert.match(post.headers.allow, /GET/);
});


test('optional static sharing password challenges unauthorized visitors and allows correct credentials', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-auth-static-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>protected site</h1>');
  const password = 'sxl-safe-password-42';
  const server = createStaticServer(root, { accessPassword: password });
  const port = await listenPreview(server);
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  assert.equal(isValidSharePassword(password), true);
  assert.equal(isValidSharePassword('short'), false);
  const noAuth = await request(port, '/');
  assert.equal(noAuth.status, 401);
  assert.match(noAuth.headers['www-authenticate'] || '', /Basic realm/);
  const noUsername = await request(port, '/', 'GET', { authorization: `Basic ${Buffer.from(`:${password}`).toString('base64')}` });
  assert.equal(noUsername.status, 401);
  const unexpectedUsername = await request(port, '/', 'GET', { authorization: `Basic ${Buffer.from(`viewer:${password}`).toString('base64')}` });
  assert.equal(unexpectedUsername.status, 401, 'username must match the SXL UI guidance');
  const badAuth = await request(port, '/', 'GET', { authorization: `Basic ${Buffer.from('sxl:wrong-password').toString('base64')}` });
  assert.equal(badAuth.status, 401);
  const goodAuth = await request(port, '/', 'GET', { authorization: `Basic ${Buffer.from(`sxl:${password}`).toString('base64')}` });
  assert.equal(goodAuth.status, 200);
  assert.match(goodAuth.body, /protected site/);
});

test('authenticated dynamic proxy removes user authorization before forwarding to the app', async t => {
  const seenHeaders = [];
  const upstream = http.createServer((req, res) => {
    seenHeaders.push({ authorization: req.headers.authorization, url: req.url });
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('upstream ok');
  });
  const targetPort = await listenPreview(upstream);
  const proxy = createAuthenticatedProxyServer(targetPort, 'protect-this-site-987');
  const proxyPort = await listenPreview(proxy);
  t.after(async () => {
    proxy.closeAllConnections?.(); upstream.closeAllConnections?.();
    await new Promise(resolve => proxy.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
  });
  const denied = await request(proxyPort, '/health');
  assert.equal(denied.status, 401);
  const allowed = await request(proxyPort, '/health', 'GET', { authorization: `Basic ${Buffer.from('sxl:protect-this-site-987').toString('base64')}` });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body, 'upstream ok');
  assert.equal(seenHeaders.length, 1);
  assert.equal(seenHeaders[0].authorization, undefined, 'Basic credentials must not reach the app itself');
  assert.equal(seenHeaders[0].url, '/health');
});

test('static preview blocks hidden files, backend files, traversal and unknown types', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-secure-site-'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>public</h1>');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=do-not-share');
  fs.writeFileSync(path.join(root, '.git', 'config'), '[secret]');
  fs.writeFileSync(path.join(root, 'backup.sql'), 'CREATE TABLE secrets');
  fs.writeFileSync(path.join(root, 'index.php'), '<?php echo "secret";');
  fs.writeFileSync(path.join(root, 'legacy.php5'), '<?php echo "secret";');
  fs.writeFileSync(path.join(root, 'unknown.dat'), 'private?');
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
  fs.writeFileSync(outside, 'outside');
  try { fs.symlinkSync(outside, path.join(root, 'linked.txt')); } catch { /* some Windows environments require extra symlink permission */ }

  const server = createStaticServer(root);
  const port = await listenPreview(server);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  });

  for (const route of ['/.env', '/.git/config', '/backup.sql', '/index.php', '/legacy.php5', '/unknown.dat', '/secret%5c..%5c.env', '/%2e%2e/sxl-should-not-leak.txt']) {
    const response = await request(port, route);
    assert.notEqual(response.status, 200, `${route} must not be exposed`);
  }
  const symlink = await request(port, '/linked.txt');
  if (fs.existsSync(path.join(root, 'linked.txt'))) assert.notEqual(symlink.status, 200, 'symlink outside root must be denied');
});

test('security helpers recognize Windows separators and root containment', () => {
  assert.equal(isBlockedPublicPath('assets\\.env'), true);
  assert.equal(isBlockedPublicPath('assets/../private.txt'), true, 'decoded dot-segments are blocked');
  assert.equal(isBlockedPublicPath('assets\\node_modules\\package.js'), true);
  assert.equal(safeInsideRoot(path.resolve('public'), path.resolve('public', 'index.html')), true);
  assert.equal(safeInsideRoot(path.resolve('public'), path.resolve('private', 'secret.txt')), false);
});


test('sharing lifecycle starts preview, detects a tunnel URL, and stops cleanly', { skip: process.platform === 'win32' }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-lifecycle-site-'));
  const fakeTunnel = path.join(root, '..', `${path.basename(root)}-fake-cloudflared.js`);
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>lifecycle test</h1>');
  fs.writeFileSync(fakeTunnel, '#!/usr/bin/env node\nconsole.log("https://sxl-test.trycloudflare.com");\nprocess.on("SIGTERM", () => process.exit(0));\nsetInterval(() => {}, 1000);\n');
  fs.chmodSync(fakeTunnel, 0o755);
  const previousPath = process.env.CLOUDFLARED_PATH;
  process.env.CLOUDFLARED_PATH = fakeTunnel;
  t.after(async () => {
    await stopSharing();
    if (previousPath === undefined) delete process.env.CLOUDFLARED_PATH;
    else process.env.CLOUDFLARED_PATH = previousPath;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(fakeTunnel, { force: true });
  });

  await startSharing({ folder: root, confirmPublicAccess: true });
  const deadline = Date.now() + 3000;
  while (!getStatus().publicUrl && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(getStatus().publicUrl, 'https://sxl-test.trycloudflare.com');
  assert.equal(getStatus().sharing, true);
  const local = await request(getStatus().previewPort, '/');
  assert.equal(local.status, 200);
  assert.match(local.body, /lifecycle test/);

  await stopSharing();
  assert.equal(getStatus().sharing, false);
  assert.equal(getStatus().previewUrl, null);
  assert.equal(getStatus().publicUrl, null);
});


test('PHP runtime mode serves application code while denying dotfiles', {
  skip: process.platform === 'win32' || !require('../lib/runtime-installer').findOnPath('php')
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-php-lifecycle-'));
  const fakeTunnel = path.join(root, '..', `${path.basename(root)}-fake-cloudflared.js`);
  fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'public', 'index.php'), '<?php echo "SXL PHP runtime OK";');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=must-not-be-public');
  fs.writeFileSync(path.join(root, 'config.php'), '<?php echo "PRIVATE_CONFIG_WAS_EXECUTED";');
  fs.writeFileSync(fakeTunnel, '#!/usr/bin/env node\nconsole.log("https://sxl-php-test.trycloudflare.com");\nprocess.on("SIGTERM", () => process.exit(0));\nsetInterval(() => {}, 1000);\n');
  fs.chmodSync(fakeTunnel, 0o755);
  const previousPath = process.env.CLOUDFLARED_PATH;
  process.env.CLOUDFLARED_PATH = fakeTunnel;
  t.after(async () => {
    await stopSharing();
    if (previousPath === undefined) delete process.env.CLOUDFLARED_PATH;
    else process.env.CLOUDFLARED_PATH = previousPath;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(fakeTunnel, { force: true });
  });

  await startSharing({ folder: root, runtimeType: 'php', confirmPublicAccess: true });
  const deadline = Date.now() + 5000;
  while (!getStatus().publicUrl && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(getStatus().previewType, 'php');
  assert.equal(getStatus().previewRoot, await fs.promises.realpath(path.join(root, 'public')), 'PHP sharing automatically restricts document root to public/');
  const home = await request(getStatus().previewPort, '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /SXL PHP runtime OK/);
  const secret = await request(getStatus().previewPort, '/.env');
  assert.equal(secret.status, 404);
  const config = await request(getStatus().previewPort, '/config.php');
  assert.equal(config.status, 404, 'direct requests to sensitive PHP config files must be denied');
  await stopSharing();
  assert.equal(getStatus().runtimeProcessRunning, false);
});


test('PHP sharing refuses to publish a source root with .env when no public directory exists', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-php-private-root-'));
  fs.writeFileSync(path.join(root, 'index.php'), '<?php echo "unsafe root";');
  fs.writeFileSync(path.join(root, '.env'), 'DB_PASSWORD=do-not-publish');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(startSharing({ folder: root, runtimeType: 'php', confirmPublicAccess: true }), /memuat berkas sumber\/rahasia|Pilih folder public/i);
  assert.equal(getStatus().previewUrl, null);
});

test('sharing rejects source-project roots that contain private/server metadata', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-source-root-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>not enough to trust this folder</h1>');
  fs.writeFileSync(path.join(root, 'package.json'), '{"scripts":{"start":"node server.js"}}');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(startSharing({ folder: root, confirmPublicAccess: true }), /bukan folder publik|folder sumber/i);
  assert.equal(getStatus().previewUrl, null, 'rejection happens before opening a preview server');
});

test('sharing setup is single-flight and Stop warns rather than silently missing an in-progress setup', async () => {
  const missing = path.join(os.tmpdir(), `sxl-no-such-share-${process.pid}-${Date.now()}`);
  const first = startSharing({ folder: missing, runtimeType: 'static', confirmPublicAccess: true });
  assert.equal(getStatus().tunnelStarting, true, 'status should expose the preparation phase before cloudflared starts');
  await assert.rejects(
    startSharing({ folder: missing, runtimeType: 'static', confirmPublicAccess: true }),
    /sedang menyiapkan Cloudflare Tunnel/i
  );
  await assert.rejects(stopSharing(), /masih disiapkan/i);
  await assert.rejects(first, /Folder website tidak ditemukan/i);
  assert.equal(getStatus().tunnelStarting, false, 'preparation flag should always clear after a validation failure');
});
