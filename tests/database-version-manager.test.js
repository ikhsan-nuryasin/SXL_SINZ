'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createDatabaseVersionManager, LEGACY_VERSION_ID, MARIADB_13_VERSION_ID,
  MARIADB_13_VERSION, MARIADB_13_SHA256
} = require('../lib/database-version-manager');

test('legacy database paths remain byte-for-byte compatible with the pre-manager layout', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-db-layout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = createDatabaseVersionManager(root);
  const legacy = manager.getLayout(LEGACY_VERSION_ID);
  assert.equal(legacy.root, path.join(root, 'runtime', 'mariadb'));
  assert.equal(legacy.serverRoot, path.join(root, 'runtime', 'mariadb', 'server'));
  assert.equal(legacy.data, path.join(root, 'runtime', 'mariadb', 'data'));
  assert.equal(legacy.settings, path.join(root, 'runtime', 'mariadb', 'settings.json'));
  assert.equal(legacy.log, path.join(root, 'runtime', 'mariadb', 'mariadbd.log'));
  assert.equal(manager.getSelectedVersionId(), LEGACY_VERSION_ID);
});

test('MariaDB 13.0.2 receives an isolated root, data, config, logs, temp and backup directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-db-layout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = createDatabaseVersionManager(root);
  const legacy = manager.getLayout(LEGACY_VERSION_ID);
  const modern = manager.getLayout(MARIADB_13_VERSION_ID);
  assert.equal(modern.root, path.join(root, 'runtime', 'mariadb', 'versions', MARIADB_13_VERSION_ID));
  for (const key of ['root','serverRoot','data','backups','settings','log','ini','tmp','pid']) {
    assert.notEqual(modern[key], legacy[key], `${key} must not alias the legacy path`);
  }
  assert.equal(modern.data, path.join(modern.root, 'data'));
  assert.equal(modern.ini, path.join(modern.root, 'config', 'my.ini'));
  assert.equal(modern.log, path.join(modern.root, 'logs', 'mariadbd.log'));
  assert.equal(modern.tmp, path.join(modern.root, 'tmp'));
  assert.equal(modern.backups, path.join(modern.root, 'backups'));
});

test('database version selection persists atomically and refuses unknown ids', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-db-selection-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = createDatabaseVersionManager(root);
  assert.equal(manager.setSelectedVersionId(MARIADB_13_VERSION_ID), MARIADB_13_VERSION_ID);
  assert.equal(createDatabaseVersionManager(root).getSelectedVersionId(), MARIADB_13_VERSION_ID);
  assert.throws(() => manager.setSelectedVersionId('../../other'), /tidak dikenal/);
  assert.equal(manager.getSelectedVersionId(), MARIADB_13_VERSION_ID);
  const state = JSON.parse(fs.readFileSync(manager.managerPath, 'utf8'));
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.selectedVersionId, MARIADB_13_VERSION_ID);
});

test('MariaDB 13.0.2 manifest constants are pinned to a SHA-256 and explicit version id', () => {
  assert.equal(MARIADB_13_VERSION, '13.0.2');
  assert.equal(MARIADB_13_VERSION_ID, 'mariadb-13.0.2-winx64');
  assert.match(MARIADB_13_SHA256, /^[a-f0-9]{64}$/);
});
