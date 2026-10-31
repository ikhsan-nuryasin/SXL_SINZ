'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { quarantineDirectory, restoreQuarantinedDirectory } = require('../lib/runtime-recovery');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-recovery-'));
  const target = path.join(root, 'versions', 'mariadb-13');
  const recovery = path.join(root, 'versions', 'recovery');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'settings.json'), 'preserve-me');
  return { root, target, recovery };
}

test('quarantine uses a same-volume move and preserves every original file', t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const moved = quarantineDirectory(f.target, f.recovery, 'mariadb-13', 'test-time');
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(fs.readFileSync(path.join(moved, 'settings.json'), 'utf8'), 'preserve-me');
  assert.equal(fs.readdirSync(f.recovery).length, 1);
});

test('quarantine never overwrites an existing recovery folder', t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  fs.mkdirSync(f.recovery, { recursive: true });
  fs.mkdirSync(path.join(f.recovery, 'mariadb-13-test-time'));
  fs.writeFileSync(path.join(f.recovery, 'mariadb-13-test-time', 'keep.txt'), 'older recovery');
  const moved = quarantineDirectory(f.target, f.recovery, 'mariadb-13', 'test-time');
  assert.notEqual(moved, path.join(f.recovery, 'mariadb-13-test-time'));
  assert.equal(fs.readFileSync(path.join(f.recovery, 'mariadb-13-test-time', 'keep.txt'), 'utf8'), 'older recovery');
});

test('failed repair preserves attempted files separately and restores original folder', t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const recoveryPath = quarantineDirectory(f.target, f.recovery, 'original', 'test-time');
  fs.mkdirSync(f.target, { recursive: true });
  fs.writeFileSync(path.join(f.target, 'failed.txt'), 'failed attempt');
  const failed = restoreQuarantinedDirectory(f.target, recoveryPath, f.recovery, 'failed', 'test-time');
  assert.ok(failed && fs.existsSync(failed));
  assert.equal(fs.readFileSync(path.join(failed, 'failed.txt'), 'utf8'), 'failed attempt');
  assert.equal(fs.readFileSync(path.join(f.target, 'settings.json'), 'utf8'), 'preserve-me');
});

test('quarantine refuses a symbolic-link source', t => {
  if (process.platform === 'win32') return t.skip('Membuat symlink dapat membutuhkan hak khusus di Windows.');
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const elsewhere = path.join(f.root, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, 'important.txt'), 'do-not-move');
  fs.rmSync(f.target, { recursive: true });
  fs.symlinkSync(elsewhere, f.target, 'dir');
  assert.throws(() => quarantineDirectory(f.target, f.recovery, 'mariadb-13', 'test-time'), /symbolic link/);
  assert.equal(fs.readFileSync(path.join(elsewhere, 'important.txt'), 'utf8'), 'do-not-move');
});
