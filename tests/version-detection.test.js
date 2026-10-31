'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Give the module a fresh isolated data root; don't inspect or touch any real user runtime.
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-version-detection-'));
process.env.SXL_APP_ROOT = testRoot;
process.env.SXL_DATA_DIR = testRoot;
const database = require('../database');

function writeLegacySettings(settings) {
  const filename = path.join(testRoot, 'runtime', 'mariadb', 'settings.json');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(settings));
}

test('unverified or missing runtime metadata never claims MariaDB 11.4.13 LTS', t => {
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  writeLegacySettings({ version: '11.4.13 LTS', versionVerified: false, port: 3307, password: '' });
  const legacy = database.versions().find(version => version.id === 'mariadb-managed');
  assert.equal(legacy.versionVerified, false);
  assert.equal(legacy.version, 'Versi belum terverifikasi');
});


test('a MariaDB 13 folder alone does not mark the legacy MariaDB runtime as partial', t => {
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(testRoot, 'runtime', 'mariadb', 'versions', 'mariadb-13.0.2-winx64'), { recursive: true });
  const legacy = database.versions().find(version => version.id === 'mariadb-managed');
  assert.equal(legacy.rootExists, false);
  assert.equal(legacy.repairable, false);
  assert.equal(legacy.healthState, 'not-installed');
});

test('legacy data without a complete runtime is explicitly repairable and not ready', t => {
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(testRoot, 'runtime', 'mariadb', 'data', 'mysql'), { recursive: true });
  const legacy = database.versions().find(version => version.id === 'mariadb-managed');
  assert.equal(legacy.repairable, true);
  assert.equal(legacy.healthState, 'partial');
  assert.equal(legacy.canSelect, false);
  assert.match(legacy.issueReason, /Executable runtime belum lengkap/);
  assert.ok(legacy.missingExecutables.some(item => item.role === 'server'));
});

test('managed manual MariaDB paths are contained while sibling paths are rejected', () => {
  const root = path.join(testRoot, 'runtime', 'mariadb');
  assert.equal(database.isPathWithinDirectory(root, path.join(root, 'server', 'bin')), true);
  assert.equal(database.isPathWithinDirectory(root, path.join(root, 'data')), true);
  assert.equal(database.isPathWithinDirectory(root, path.join(testRoot, 'runtime', 'mariadb-other', 'bin')), false);
  assert.equal(database.isPathWithinDirectory(root, ''), false);
});
