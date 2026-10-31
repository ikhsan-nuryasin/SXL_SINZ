'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  WINDOWS_DPAPI, prepareSettingsForStorage, decodeSettings, writeSettingsAtomic
} = require('../lib/secure-settings');

test('Windows settings never persist plaintext when DPAPI protector is injected', () => {
  const prepared = prepareSettingsForStorage({ version: '13.0.2', password: 'not-a-real-secret', port: 3308 }, {
    platform: 'win32', protect: password => `dpapi:${Buffer.from(password).toString('base64')}`
  });
  assert.equal(prepared.passwordProtection, WINDOWS_DPAPI);
  assert.notEqual(prepared.password, 'not-a-real-secret');
  assert.equal(JSON.stringify(prepared).includes('not-a-real-secret'), false);
});

test('DPAPI config is decoded only through the account-bound unprotector', () => {
  const decoded = decodeSettings({ version: '13.0.2', password: 'ciphertext', passwordProtection: WINDOWS_DPAPI, port: 3308 }, {
    platform: 'win32', unprotect: value => {
      assert.equal(value, 'ciphertext');
      return 'recovered-secret';
    }
  });
  assert.equal(decoded.password, 'recovered-secret');
  assert.equal(decoded._credentialProtection, WINDOWS_DPAPI);
});

test('legacy Windows plaintext config is flagged for one-time migration', () => {
  const decoded = decodeSettings({ version: '10.4.32', password: 'legacy-secret', port: 3307 }, { platform: 'win32' });
  assert.equal(decoded.password, 'legacy-secret');
  assert.equal(decoded._credentialProtection, 'legacy-plaintext');
});

test('DPAPI-protected settings refuse to decrypt on another OS', () => {
  assert.throws(() => decodeSettings({ password: 'ciphertext', passwordProtection: WINDOWS_DPAPI }, { platform: 'linux' }), /hanya dapat dibaca/);
});

test('empty root password is explicitly marked and remains readable without DPAPI', () => {
  const prepared = prepareSettingsForStorage({ version: '13.0.2', password: '', port: 3308 }, { platform: 'win32' });
  assert.equal(prepared.password, '');
  assert.equal(prepared.passwordProtection, 'no-password-v1');
  const decoded = decodeSettings(prepared, { platform: 'win32' });
  assert.equal(decoded.password, '');
  assert.equal(decoded._credentialProtection, 'no-password-v1');
  assert.throws(() => decodeSettings({ password: 'not-empty', passwordProtection: 'no-password-v1' }, { platform: 'win32' }), /password kosong/);
});

test('settings writes are atomic and private on POSIX systems', t => {
  if (process.platform === 'win32') return t.skip('Pemeriksaan mode izin POSIX tidak berlaku di Windows; ACL Windows diuji lewat jalur DPAPI/ACL.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-settings-secure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'settings.json');
  writeSettingsAtomic(filename, { version: 'test', password: 'test-password', port: 3307 }, { platform: 'linux' });
  const stored = JSON.parse(fs.readFileSync(filename, 'utf8'));
  assert.equal(stored.password, 'test-password');
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.tmp')), false);
});


test('Windows runtime tree ACL is DACL-only and avoids Set-Acl security-privilege failure', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'secure-settings.js'), 'utf8');
  const treeAcl = source.slice(source.indexOf('function applyWindowsTreeAcl'), source.indexOf('function writeSettingsAtomic'));
  assert.match(treeAcl, /icacls\.exe/);
  assert.match(treeAcl, /\/inheritance:r/);
  assert.match(treeAcl, /\/grant:r/);
  assert.match(treeAcl, /ReparsePoint/);
  assert.doesNotMatch(treeAcl, /\bSet-Acl\b/);
  assert.match(treeAcl, /SeSecurityPrivilege/);
});
