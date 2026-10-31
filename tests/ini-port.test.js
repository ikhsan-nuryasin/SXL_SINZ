'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { updateDatabaseIniPort } = require('../lib/ini-port');

test('INI port update changes only database client/server sections and preserves unrelated options', () => {
  const source = '[client]\r\nhost=127.0.0.1\r\nport=3307\r\n\r\n[mysqld]\r\nbind-address=127.0.0.1\r\nport = 3307 # managed port\r\ntmpdir=C:/tmp\r\n\r\n[mysqldump]\r\nport=1234\r\n';
  const result = updateDatabaseIniPort(source, 3310);
  assert.match(result, /\[client\]\r\nhost=127\.0\.0\.1\r\nport=3310/);
  assert.match(result, /\[mysqld\]\r\nbind-address=127\.0\.0\.1\r\nport = 3310 # managed port\r\ntmpdir=C:\/tmp/);
  assert.match(result, /\[mysqldump\]\r\nport=1234/);
  assert.ok(result.endsWith('\r\n'));
});

test('INI port update adds a server port when no server section exists and preserves a UTF-8 BOM', () => {
  const result = updateDatabaseIniPort('\uFEFF[client]\nhost=127.0.0.1\n', 3400);
  assert.ok(result.startsWith('\uFEFF[client]'));
  assert.match(result, /\[mysqld\]\nport=3400/);
});

test('INI port update rejects invalid ports', () => {
  assert.throws(() => updateDatabaseIniPort('[mysqld]\nport=3306\n', 100), /1024/);
});
