'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('service registers and lists locally installed applications using UI field names', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-app-service-'));
  const previous = process.env.SXL_DATA_DIR;
  process.env.SXL_DATA_DIR = dataRoot;
  const servicePath = require.resolve('../services');
  delete require.cache[servicePath];
  try {
    const services = require('../services');
    const app = services.registerApp({
      name: 'Editor Database',
      category: 'coding',
      executable: process.execPath,
      args: '--title\nExample Project',
      workingDirectory: process.cwd()
    });
    assert.equal(app.id, 'editor-database');
    assert.equal(app.name, 'Editor Database');
    assert.deepEqual(app.args, ['--title', 'Example Project']);
    assert.deepEqual(services.listRegisteredApps(), [app]);
    assert.equal(services.removeRegisteredApp(app.id), true);
    assert.deepEqual(services.listRegisteredApps(), []);
    assert.throws(() => services.registerApp({ name: 'Invalid cwd', category: 'coding', executable: process.execPath, workingDirectory: 'relative' }), /absolute path/);
  } finally {
    delete require.cache[servicePath];
    if (previous === undefined) delete process.env.SXL_DATA_DIR;
    else process.env.SXL_DATA_DIR = previous;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
