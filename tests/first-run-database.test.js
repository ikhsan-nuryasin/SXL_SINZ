'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDatabaseLaunchPlan, prepareDatabaseForLaunch, MARIADB_13_VERSION_ID } = require('../lib/first-run-database');

function inventory({ manager = false, legacyRoot = false, modernRoot = false, modernHealth = 'not-installed', selected = 'mariadb-managed' } = {}) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-first-run-'));
  const managerPath = path.join(dataRoot, 'runtime', 'mariadb', 'manager.json');
  if (manager) {
    fs.mkdirSync(path.dirname(managerPath), { recursive: true });
    fs.writeFileSync(managerPath, JSON.stringify({ selectedVersionId: selected }));
  }
  const database = {
    status: () => ({
      versionId: selected,
      versions: [
        { id: 'mariadb-managed', rootExists: legacyRoot, healthState: legacyRoot ? 'partial' : 'not-installed' },
        { id: MARIADB_13_VERSION_ID, rootExists: modernRoot, healthState: modernHealth }
      ]
    }),
    versions: () => database.status().versions,
    getBundledMariaDBArchivePath: () => '/bundle/mariadb-13.0.2-winx64.zip'
  };
  return { dataRoot, database, cleanup: () => fs.rmSync(dataRoot, { recursive: true, force: true }) };
}

test('fresh Windows x64 profile plans bundled MariaDB installation without network access', t => {
  const ctx = inventory(); t.after(ctx.cleanup);
  const plan = getDatabaseLaunchPlan({ database: ctx.database, dataRoot: ctx.dataRoot, platform: 'win32', arch: 'x64' });
  assert.equal(plan.action, 'install-and-start');
  assert.equal(plan.versionId, MARIADB_13_VERSION_ID);
  assert.match(plan.archivePath, /mariadb-13\.0\.2-winx64\.zip$/);
});

test('existing selection or legacy runtime is never silently moved or replaced', t => {
  const ctx = inventory({ manager: true, legacyRoot: true }); t.after(ctx.cleanup);
  const plan = getDatabaseLaunchPlan({ database: ctx.database, dataRoot: ctx.dataRoot, platform: 'win32', arch: 'x64' });
  assert.equal(plan.action, 'skip');
  assert.match(plan.reason, /preserved/i);
});

test('selected healthy MariaDB 13 is automatically started on later launches', t => {
  const ctx = inventory({ manager: true, modernRoot: true, modernHealth: 'ready', selected: MARIADB_13_VERSION_ID }); t.after(ctx.cleanup);
  const plan = getDatabaseLaunchPlan({ database: ctx.database, dataRoot: ctx.dataRoot, platform: 'win32', arch: 'x64' });
  assert.equal(plan.action, 'start');
});

test('partial bundled MariaDB is repaired non-destructively through recovery on Windows x64', t => {
  const ctx = inventory({ modernRoot: true, modernHealth: 'partial' }); t.after(ctx.cleanup);
  const plan = getDatabaseLaunchPlan({ database: ctx.database, dataRoot: ctx.dataRoot, platform: 'win32', arch: 'x64' });
  assert.equal(plan.action, 'repair-and-start');
  assert.match(plan.message, /recovery/);
});

test('partial bundled MariaDB is not auto-replaced when a persisted manager explicitly selects the legacy runtime', t => {
  const ctx = inventory({ manager: true, legacyRoot: true, modernRoot: true, modernHealth: 'partial', selected: 'mariadb-managed' }); t.after(ctx.cleanup);
  const plan = getDatabaseLaunchPlan({ database: ctx.database, dataRoot: ctx.dataRoot, platform: 'win32', arch: 'x64' });
  assert.equal(plan.action, 'skip');
  assert.match(plan.reason, /preserved/i);
});

test('bootstrap propagates startup failure and records diagnostic without reporting ready', async t => {
  const ctx = inventory(); t.after(ctx.cleanup);
  const calls = [];
  const database = {
    installVersionArchive: async args => { calls.push(['install', args]); },
    selectVersion: id => { calls.push(['select', id]); },
    start: async () => { throw new Error('Access is denied'); },
    status: () => ({ versionId: MARIADB_13_VERSION_ID, initialized: true, versionVerified: true, running: false }),
    recordBootstrapFailure: error => calls.push(['failure', error.message])
  };
  const plan = getDatabaseLaunchPlan({ database: ctx.database, dataRoot: ctx.dataRoot, platform: 'win32', arch: 'x64' });
  await assert.rejects(prepareDatabaseForLaunch({ database, plan }), /Access is denied/);
  assert.equal(calls.some(call => call[0] === 'failure'), true);
});

test('non-Windows and non-x64 platforms do not attempt the Windows runtime', t => {
  const ctx = inventory(); t.after(ctx.cleanup);
  assert.equal(getDatabaseLaunchPlan({ database: ctx.database, dataRoot: ctx.dataRoot, platform: 'darwin', arch: 'arm64' }).action, 'skip');
  assert.equal(getDatabaseLaunchPlan({ database: ctx.database, dataRoot: ctx.dataRoot, platform: 'win32', arch: 'arm64' }).action, 'skip');
});
