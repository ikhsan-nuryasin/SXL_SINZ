'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discoverPhpVersions, addCurrentExternalPhp, getPhpVersionsRoot } = require('../lib/php-versions');

function write(file, contents = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

test('PHP version folder scanner finds several Windows distributions and pairs sibling PHP-CGI', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-php-versions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const php83 = path.join(root, 'php-8.3.30');
  const php85 = path.join(root, 'php-8.5.11-nts-Win32-vs17-x64');
  write(path.join(php83, 'php.exe'));
  write(path.join(php83, 'php-cgi.exe'));
  write(path.join(php85, 'php.exe'));
  write(path.join(php85, 'php-cgi.exe'));
  write(path.join(php85, 'php.ini-development'));
  fs.mkdirSync(path.join(php85, 'ext'));
  const found = discoverPhpVersions(root, { platform: 'win32' });
  assert.equal(found.length, 2);
  assert.ok(found.some(item => item.label === 'php-8.3.30' && item.phpCgiBinary.endsWith('php-cgi.exe')));
  assert.ok(found.some(item => item.label === 'php-8.5.11-nts-Win32-vs17-x64' && item.hasIniTemplate && item.hasExtensions));
});

test('PHP scanner supports nested Laragon-style collections and root-level PHP folders', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-php-nested-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'runtime', 'php-versions');
  write(path.join(root, 'php', 'php-8.4.2', 'php.exe'));
  write(path.join(root, 'php', 'php-8.4.2', 'php-cgi.exe'));
  write(path.join(root, 'php-8.2.28', 'bin', 'php'));
  write(path.join(root, 'php-8.2.28', 'bin', 'php-cgi'));
  const found = discoverPhpVersions(root, { platform: 'linux' });
  assert.equal(found.length, 2);
  assert.ok(found.some(item => item.phpBinary.endsWith(path.join('php-8.4.2', 'php.exe'))));
  assert.ok(found.some(item => item.phpBinary.endsWith(path.join('bin', 'php'))));
  assert.equal(getPhpVersionsRoot(parent), root);
});

test('external active PHP is listed but does not duplicate a folder-managed PHP', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-php-external-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'versions');
  const managed = write(path.join(root, 'php-8.3.30', process.platform === 'win32' ? 'php.exe' : 'php'));
  const external = write(path.join(parent, 'system-php', process.platform === 'win32' ? 'php.exe' : 'php'));
  const listed = discoverPhpVersions(root);
  assert.equal(addCurrentExternalPhp(listed, managed, '', root).length, 1);
  const withExternal = addCurrentExternalPhp(listed, external, '', root);
  assert.equal(withExternal.length, 2);
  assert.equal(withExternal[1].source, 'manual');
});

test('external PHP auto-discovers a sibling PHP-CGI if the version is paired', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-php-external-cgi-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'versions');
  const phpName = process.platform === 'win32' ? 'php.exe' : 'php';
  const cgiName = process.platform === 'win32' ? 'php-cgi.exe' : 'php-cgi';
  const binary = write(path.join(parent, 'system-php', phpName));
  const cgi = write(path.join(parent, 'system-php', cgiName));
  const result = addCurrentExternalPhp([], binary, '', root);
  assert.equal(result[0].phpCgiBinary, cgi);
});

test('SXL creates an initial Windows php.ini from a template without overwriting existing configuration', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-php-ini-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const directory = path.join(parent, 'php-8.3.30');
  const php = write(path.join(directory, process.platform === 'win32' ? 'php.exe' : 'php'));
  write(path.join(directory, 'php.ini-development'), ';extension=curl\n;extension=pdo_mysql\n');
  write(path.join(directory, 'ext', 'php_curl.dll'));
  write(path.join(directory, 'ext', 'php_pdo_mysql.dll'));
  const services = require('../services');
  const entry = { source: 'folder-sxl', phpBinary: php };
  const first = services.prepareManagedPhpIni(entry, { platform: 'win32' });
  assert.equal(first.created, true);
  const ini = fs.readFileSync(path.join(directory, 'php.ini'), 'utf8');
  assert.match(ini, /extension_dir = .*ext/);
  assert.match(ini, /^extension=curl$/m);
  assert.match(ini, /^extension=pdo_mysql$/m);
  const second = services.prepareManagedPhpIni(entry, { platform: 'win32' });
  assert.equal(second.created, false);
  assert.match(second.note, /dipertahankan/i);
});


test('scanner does not list a symlinked copy of the active system PHP twice', t => {
  if (process.platform === 'win32') { t.skip('Symlink creation can require Windows Developer Mode or elevated rights.'); return; }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-php-symlink-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'versions');
  const sourceDir = path.join(parent, 'system');
  const source = write(path.join(sourceDir, 'php'));
  fs.mkdirSync(path.join(root, 'php-copied'), { recursive: true });
  fs.symlinkSync(source, path.join(root, 'php-copied', 'php'));
  const list = discoverPhpVersions(root);
  const withCurrent = addCurrentExternalPhp(list, source, '', root);
  assert.equal(withCurrent.length, 1);
});

test('SXL rebases a copied PHP folder extension_dir and keeps the original ini backup', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-php-rebase-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const directory = path.join(parent, 'php-8.3.30');
  const php = write(path.join(directory, process.platform === 'win32' ? 'php.exe' : 'php'));
  fs.mkdirSync(path.join(directory, 'ext'), { recursive: true });
  const oldContents = 'extension_dir = "C:/laragon/bin/php/php-8.3.30/ext"\nextension=curl\n';
  write(path.join(directory, 'php.ini'), oldContents);
  const services = require('../services');
  const result = services.prepareManagedPhpIni({ source: 'folder-sxl', phpBinary: php }, { platform: 'win32' });
  assert.equal(result.updated, true);
  assert.equal(fs.readFileSync(path.join(directory, 'php.ini.sxl-backup'), 'utf8'), oldContents);
  assert.match(fs.readFileSync(path.join(directory, 'php.ini'), 'utf8'), new RegExp(path.join(directory, 'ext').replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(services.prepareManagedPhpIni({ source: 'folder-sxl', phpBinary: php }, { platform: 'win32' }).updated, false);
});
