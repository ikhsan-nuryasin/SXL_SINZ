'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withRuntimeData(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-manual-runtime-'));
  const previous = process.env.SXL_DATA_DIR;
  process.env.SXL_DATA_DIR = folder;
  t.after(() => {
    if (previous === undefined) delete process.env.SXL_DATA_DIR;
    else process.env.SXL_DATA_DIR = previous;
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}
function writeFile(folder, name, contents = '') {
  const file = path.join(folder, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

test('manual runtime path configuration validates known files/folders and persists only allowlisted paths', t => {
  const data = withRuntimeData(t);
  const settings = require('../lib/runtime-paths');
  const bin = path.join(data, 'fake-bin');
  fs.mkdirSync(bin);
  const paths = {
    apacheBinary: writeFile(bin, process.platform === 'win32' ? 'httpd.exe' : 'httpd'),
    phpBinary: writeFile(bin, process.platform === 'win32' ? 'php.exe' : 'php'),
    phpCgiBinary: writeFile(bin, process.platform === 'win32' ? 'php-cgi.exe' : 'php-cgi'),
    composerPhar: writeFile(bin, 'composer.phar'),
    nodeBinary: writeFile(bin, process.platform === 'win32' ? 'node.exe' : 'node'),
    npmCli: writeFile(bin, 'npm-cli.js'),
    cloudflaredBinary: writeFile(bin, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'),
    phpMyAdminDir: path.join(data, 'phpmyadmin'),
    mariaDbBinDir: path.join(data, 'mariadb-bin')
  };
  fs.mkdirSync(paths.phpMyAdminDir, { recursive: true });
  writeFile(paths.phpMyAdminDir, 'index.php', '<?php');
  fs.mkdirSync(paths.mariaDbBinDir, { recursive: true });
  const dbTools = process.platform === 'win32'
    ? ['mariadbd.exe', 'mariadb-install-db.exe', 'mariadb.exe', 'mariadb-admin.exe', 'mariadb-dump.exe']
    : ['mariadbd', 'mariadb-install-db', 'mariadb', 'mariadb-admin', 'mariadb-dump'];
  for (const name of dbTools) writeFile(paths.mariaDbBinDir, name);

  const saved = settings.saveRuntimePaths(paths);
  for (const [key, value] of Object.entries(paths)) assert.equal(saved[key], value);
  assert.equal(Object.keys(saved).length, 9);
  const file = settings.settingsFile();
  assert.ok(fs.existsSync(file));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0);
  assert.equal(settings.runtimePathStatus().status.phpBinary.exists, true);
  assert.equal(settings.runtimePathStatus().status.phpMyAdminDir.exists, true);
});

test('manual runtime paths reject relative paths and wrong executable names', t => {
  const data = withRuntimeData(t);
  const settings = require('../lib/runtime-paths');
  const folder = path.join(data, 'bin');
  fs.mkdirSync(folder);
  const fake = writeFile(folder, 'php-not-real.exe');
  assert.throws(() => settings.saveRuntimePaths({ phpBinary: 'php.exe' }), /path absolut/i);
  assert.throws(() => settings.saveRuntimePaths({ phpBinary: fake }), /bernama/i);
});

test('runtime installer reuses manually selected Node.js and npm CLI without metadata fetch', t => {
  const data = withRuntimeData(t);
  const settings = require('../lib/runtime-paths');
  const bin = path.join(data, 'node-bin');
  const node = writeFile(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  const npm = writeFile(bin, 'npm-cli.js');
  settings.saveRuntimePaths({ nodeBinary: node, npmCli: npm });
  const runtime = require('../lib/runtime-installer');
  const found = runtime.findSystemNodeRuntimePaths({ PATH: '', PATHEXT: process.env.PATHEXT || '.EXE;.CMD;.BAT' }, process.platform);
  assert.ok(found);
  assert.equal(found.node, node);
  assert.equal(found.npmCli, npm);
  assert.equal(found.source, 'manual');
});

test('manual Apache path is preferred to auto-detection', t => {
  const data = withRuntimeData(t);
  const settings = require('../lib/runtime-paths');
  const root = path.join(data, 'apache');
  const binary = writeFile(path.join(root, 'bin'), process.platform === 'win32' ? 'httpd.exe' : 'httpd');
  writeFile(path.join(root, 'conf'), 'httpd.conf', 'ServerRoot "${SRVROOT}"\nListen 8080\n');
  settings.saveRuntimePaths({ apacheBinary: binary });
  const services = require('../services');
  assert.equal(services.apacheCandidates(), binary);
  assert.equal(services.apachePaths().baseConfig, path.join(root, 'conf', 'httpd.conf'));
});


test('manual Cloudflare Tunnel path is selected and suppresses desktop auto-download', t => {
  const data = withRuntimeData(t);
  const settings = require('../lib/runtime-paths');
  const tunnel = writeFile(path.join(data, 'tools'), process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  settings.saveRuntimePaths({ cloudflaredBinary: tunnel });
  const server = require('../server');
  const oldDesktop = process.env.SXL_DESKTOP_APP;
  const oldCloudflared = process.env.CLOUDFLARED_PATH;
  process.env.SXL_DESKTOP_APP = '1';
  delete process.env.CLOUDFLARED_PATH;
  try {
    assert.equal(server.getStatus().cloudflaredConfiguredPath, tunnel);
    assert.equal(server.shouldAutoInstallCloudflared({ desktopApp: true, envPath: '', envPathExists: false, manualPath: tunnel, manualExists: true }), false);
    assert.equal(server.shouldAutoInstallCloudflared({ desktopApp: true, envPath: '', envPathExists: false, manualPath: '', manualExists: false }), true);
    assert.equal(server.shouldAutoInstallCloudflared({ desktopApp: true, envPath: 'C:/tools/cloudflared.exe', envPathExists: true, manualPath: '', manualExists: false }), false);
    assert.equal(server.shouldAutoInstallCloudflared({ desktopApp: true, envPath: 'C:/missing/cloudflared.exe', envPathExists: false, manualPath: '', manualExists: false }), true);
    assert.equal(server.shouldAutoInstallCloudflared({ desktopApp: false, envPath: '', envPathExists: false, manualPath: '', manualExists: false }), true, 'portable/server mode also auto-installs the verified binary');
  } finally {
    if (oldDesktop === undefined) delete process.env.SXL_DESKTOP_APP; else process.env.SXL_DESKTOP_APP = oldDesktop;
    if (oldCloudflared === undefined) delete process.env.CLOUDFLARED_PATH; else process.env.CLOUDFLARED_PATH = oldCloudflared;
    server.shutdown().catch(() => {});
  }
});


test('manual MariaDB binary directory must contain matching server, installer, client, admin, and dump tools', t => {
  const data = withRuntimeData(t);
  const settings = require('../lib/runtime-paths');
  const bin = path.join(data, 'partial-mariadb-bin');
  fs.mkdirSync(bin);
  writeFile(bin, process.platform === 'win32' ? 'mariadbd.exe' : 'mariadbd');
  assert.throws(() => settings.saveRuntimePaths({ mariaDbBinDir: bin }), /folder belum lengkap/i);
});
