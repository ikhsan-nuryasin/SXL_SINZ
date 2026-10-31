'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG, getCatalog, getInstallAction } = require('../lib/download-center');

test('download catalog uses official HTTPS sources and honest installation support states', () => {
  const items = getCatalog();
  assert.ok(items.length >= 10);
  for (const item of items) {
    assert.equal(new URL(item.website).protocol, 'https:');
    assert.ok(item.name);
    assert.ok(item.description);
    assert.ok(['Not Installed', 'Unsupported'].includes(item.status));
    assert.equal(item.version, null);
    assert.ok(item.statusDetail.length > 0);
  }
  assert.equal(getInstallAction('composer').id, 'composer');
  assert.equal(getInstallAction('postgresql'), null);
  assert.equal(getInstallAction('redis'), null);
  assert.equal(CATALOG.find(item => item.id === 'redis').installSupported, false);
});

test('catalog marks only successfully detected local installations as installed', () => {
  const items = getCatalog({ php: { installed: true, version: '8.4.2', path: 'C:\\tools\\php.exe' } });
  const php = items.find(item => item.id === 'php');
  const composer = items.find(item => item.id === 'composer');
  assert.equal(php.status, 'Installed');
  assert.equal(php.version, '8.4.2');
  assert.equal(php.localPath, 'C:\\tools\\php.exe');
  assert.equal(composer.status, 'Not Installed');
});

test('managed installers are not offered on unsupported host platforms', () => {
  const items = getCatalog({}, { platform: 'linux', apacheSupported: false, mariadbSupported: false });
  assert.equal(items.find(item => item.id === 'php').status, 'Unsupported');
  assert.equal(items.find(item => item.id === 'apache').status, 'Unsupported');
  assert.equal(items.find(item => item.id === 'mariadb').status, 'Unsupported');
});
