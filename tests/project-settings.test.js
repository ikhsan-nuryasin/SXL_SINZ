'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../lib/project-settings');

test('per-project PHP settings persist safely and reset to global PHP', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-project-settings-'));
  const original = process.env.SXL_DATA_DIR;
  process.env.SXL_DATA_DIR = temp;
  t.after(() => {
    if (original === undefined) delete process.env.SXL_DATA_DIR; else process.env.SXL_DATA_DIR = original;
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const php = path.resolve(temp, 'php-8.3', process.platform === 'win32' ? 'php.exe' : 'php');
  const cgi = path.resolve(temp, 'php-8.3', process.platform === 'win32' ? 'php-cgi.exe' : 'php-cgi');
  fs.mkdirSync(path.dirname(php), { recursive: true });
  fs.writeFileSync(php, 'php-test');
  fs.writeFileSync(cgi, 'cgi-test');
  const saved = store.saveProjectPhp('clinic-app', { phpBinary: php, phpCgiBinary: cgi });
  assert.equal(saved.phpBinary, php);
  assert.equal(saved.phpCgiBinary, cgi);
  assert.equal(store.getProjectSettings('clinic-app').phpBinary, php);
  assert.equal(store.getProjectSettings('another-app').phpBinary, '');
  assert.equal(JSON.parse(fs.readFileSync(store.filePath(), 'utf8'))['clinic-app'].phpBinary, php);
  assert.throws(() => store.saveProjectPhp('../escape', { phpBinary: php }), /Nama proyek tidak valid/);
  assert.throws(() => store.saveProjectPhp('clinic-app', { phpBinary: 'relative/php' }), /path harus absolut/);
  const reset = store.saveProjectPhp('clinic-app', { phpBinary: '', phpCgiBinary: '' });
  assert.equal(reset.phpBinary, '');
  assert.equal(store.getProjectSettings('clinic-app').phpBinary, '');
});
