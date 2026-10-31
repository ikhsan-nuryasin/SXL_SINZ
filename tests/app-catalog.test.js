'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const appCatalog = require('../lib/app-catalog');
const { createAppCatalog } = appCatalog;

function setup(t, overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-app-catalog-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const existing = new Set();
  const calls = [];
  const catalog = createAppCatalog({
    dataDir,
    existsImpl: (candidate, kind) => existing.has(`${kind}:${candidate}`),
    spawnImpl: (...args) => {
      calls.push(args);
      return { started: true };
    },
    ...overrides
  });
  const app = {
    id: 'mariadb-workbench',
    label: 'Database Workbench',
    category: 'database',
    executablePath: path.join(dataDir, 'tools', 'workbench.exe'),
    args: ['--profile', 'dev space', '--port=3307'],
    cwd: path.join(dataDir, 'workspace')
  };
  existing.add(`file:${app.executablePath}`);
  existing.add(`directory:${app.cwd}`);
  return { dataDir, catalog, app, existing, calls };
}

test('catalog adds, lists, and removes validated apps with stable IDs', t => {
  const { catalog, app } = setup(t);
  assert.deepEqual(catalog.list(), []);
  assert.deepEqual(catalog.add(app), app);
  assert.deepEqual(catalog.list(), [app]);
  assert.equal(JSON.parse(fs.readFileSync(catalog.filePath, 'utf8')).version, 1);
  assert.throws(() => catalog.add(app), { code: 'ERR_APP_CATALOG_DUPLICATE' });
  const listed = catalog.list();
  listed[0].args.push('mutated');
  assert.deepEqual(catalog.list()[0].args, app.args);
  assert.equal(catalog.remove(app.id), true);
  assert.equal(catalog.remove(app.id), false);
  assert.deepEqual(catalog.list(), []);
});

test('rejects traversal, relative paths, malformed schema, and unsafe arguments', t => {
  const { catalog, app, dataDir } = setup(t);
  assert.throws(() => createAppCatalog({ dataDir: `${dataDir}${path.sep}..${path.sep}outside` }),
    /traversal/);
  assert.throws(() => catalog.add({ ...app, executablePath: 'relative/tool.exe' }), /absolute path/);
  assert.throws(() => catalog.add({
    ...app,
    executablePath: `${dataDir}${path.sep}..${path.sep}outside.exe`
  }), /traversal/);
  assert.throws(() => catalog.add({ ...app, cwd: `${dataDir}${path.sep}..${path.sep}outside` }),
    /traversal/);
  assert.throws(() => catalog.add({ ...app, category: 'web' }), /category/);
  assert.throws(() => catalog.add({ ...app, args: '--open' }), /args must be an array/);
  assert.throws(() => catalog.add({ ...app, args: ['--value\u0000bad'] }), /NUL/);
  assert.throws(() => catalog.add({ ...app, url: 'https://example.test' }), /unknown fields/);
  assert.throws(() => catalog.add({ ...app, label: '  padded  ' }), /label/);
  assert.throws(() => catalog.add({ ...app, label: 'x'.repeat(81) }), /label/);
  assert.throws(() => catalog.add({ ...app, cwd: undefined }), /absolute path/);
  const missingExecutable = { ...app, id: 'missing-tool', executablePath: path.join(dataDir, 'missing.exe') };
  assert.throws(() => catalog.add(missingExecutable), { code: 'ERR_APP_CATALOG_PATH' });
});

test('accepts each category offered by the application directory form', t => {
  const { catalog, app } = setup(t);
  for (const category of ['database', 'coding', 'terminal', 'other']) {
    const added = catalog.add({ ...app, id: `tool-${category}`, category });
    assert.equal(added.category, category);
  }
});

test('launch passes exact argv and explicit safe options without a shell', t => {
  const { catalog, app, calls } = setup(t);
  catalog.add(app);
  assert.deepEqual(catalog.launch(app.id), { started: true });
  assert.deepEqual(calls, [[app.executablePath, app.args, {
    cwd: app.cwd,
    shell: false,
    windowsHide: true
  }]]);
});

test('exports the dataRoot/input/spawnProcess integration API', t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-app-catalog-api-'));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const executablePath = path.join(dataRoot, 'tools', 'editor.exe');
  const cwd = path.join(dataRoot, 'workspace');
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.mkdirSync(cwd);
  fs.writeFileSync(executablePath, 'fake executable');
  const input = {
    id: 'editor',
    label: 'Editor',
    category: 'coding',
    executablePath,
    args: ['--open', 'project path'],
    cwd
  };
  assert.deepEqual(appCatalog.list({ dataRoot }), []);
  assert.deepEqual(appCatalog.add({ dataRoot, input }), input);
  assert.deepEqual(appCatalog.list({ dataRoot }), [input]);
  const spawnCalls = [];
  appCatalog.launch({
    dataRoot,
    id: input.id,
    spawnProcess: (...args) => {
      spawnCalls.push(args);
      return 'fake child process';
    }
  });
  assert.deepEqual(spawnCalls, [[executablePath, input.args, {
    cwd,
    shell: false,
    windowsHide: true
  }]]);
  assert.equal(appCatalog.remove({ dataRoot, id: input.id }), true);
  assert.deepEqual(appCatalog.list({ dataRoot }), []);
});

test('validates paths again at launch and surfaces registry parse and schema errors', t => {
  const { catalog, app, dataDir, existing } = setup(t);
  catalog.add(app);
  existing.delete(`file:${app.executablePath}`);
  assert.throws(() => catalog.launch(app.id), { code: 'ERR_APP_CATALOG_PATH' });

  fs.writeFileSync(catalog.filePath, '{invalid', 'utf8');
  assert.throws(() => catalog.list(), { code: 'ERR_APP_CATALOG_PARSE' });
  fs.writeFileSync(catalog.filePath, JSON.stringify({ version: 99, apps: [] }), 'utf8');
  assert.throws(() => catalog.list(), { code: 'ERR_APP_CATALOG_VERSION' });
  fs.writeFileSync(catalog.filePath, JSON.stringify({
    version: 1,
    apps: [{ ...app, futureField: true }]
  }), 'utf8');
  assert.throws(() => catalog.list(), { code: 'ERR_APP_CATALOG_VALIDATION' });
});

test('surfaces registry write failures instead of silently dropping changes', t => {
  const { catalog, app, dataDir } = setup(t);
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.writeFileSync(dataDir, 'not a directory', 'utf8');
  assert.throws(() => catalog.add(app), { code: 'ERR_APP_CATALOG_WRITE' });
});
