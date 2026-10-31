'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { openFolder } = require('../lib/open-folder');

test('Windows folder opener launches visible Explorer with the resolved folder', async () => {
  let spawnArgs;
  const child = new EventEmitter();
  child.unref = () => {};
  const opening = openFolder('C:\\Users\\User\\SINZ\\www', {
    platform: 'win32',
    spawnProcess: (...args) => {
      spawnArgs = args;
      process.nextTick(() => child.emit('spawn'));
      return child;
    }
  });

  assert.equal(await opening, path.resolve('C:\\Users\\User\\SINZ\\www'));
  assert.equal(spawnArgs[0], path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'explorer.exe'));
  assert.deepEqual(spawnArgs[1], [path.resolve('C:\\Users\\User\\SINZ\\www')]);
  assert.equal(spawnArgs[2].windowsHide, false);
});

test('folder opener reports a process launch failure instead of returning success', async () => {
  const child = new EventEmitter();
  child.unref = () => {};
  const opening = openFolder('C:\\Users\\User\\SINZ\\www', {
    platform: 'win32',
    spawnProcess: () => {
      process.nextTick(() => child.emit('error', new Error('Explorer not found')));
      return child;
    }
  });

  await assert.rejects(opening, /Folder tidak dapat dibuka: Explorer not found/);
});
