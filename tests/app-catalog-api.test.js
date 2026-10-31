'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('app catalog API is CSRF-protected and persists locally registered desktop tools', t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-app-api-'));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const script = String.raw`
    const server = require('./server');
    (async () => {
      try {
        const { url } = await server.startServer();
        const page = await fetch(url);
        const html = await page.text();
        const token = html.match(/<meta name="sxl-csrf" content="([a-f0-9]{64})">/)?.[1] || '';
        const headers = { Origin: url, 'Content-Type': 'application/json', 'X-SXL-CSRF': token };
        const listing = await fetch(url + '/api/apps');
        const initial = await listing.json();
        const add = await fetch(url + '/api/apps', {
          method: 'POST', headers,
          body: JSON.stringify({
            name: 'Editor Demo', category: 'coding', executable: process.execPath,
            args: ['--version'], workingDirectory: process.cwd()
          })
        });
        const added = await add.json();
        const afterAdd = await (await fetch(url + '/api/apps')).json();
        const noToken = await fetch(url + '/api/apps', {
          method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Blocked App' })
        });
        const remove = await fetch(url + '/api/apps/' + added.app.id, {
          method: 'DELETE', headers, body: JSON.stringify({})
        });
        const afterRemove = await (await fetch(url + '/api/apps')).json();
        const invalidGitPreview = await fetch(url + '/api/projects/github-preview', {
          method: 'POST', headers, body: JSON.stringify({ slug: '../outside' })
        });
        console.log(JSON.stringify({
          initialCount: initial.apps.length, addStatus: add.status, app: added.app,
          afterAddCount: afterAdd.apps.length, noTokenStatus: noToken.status,
          removeStatus: remove.status, afterRemoveCount: afterRemove.apps.length,
          invalidGitPreviewStatus: invalidGitPreview.status
        }));
      } finally { await server.shutdown({ exitProcess: false }); }
    })().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    env: { ...process.env, SXL_DATA_DIR: dataRoot, SXL_SHARING_PORT: '0' },
    encoding: 'utf8',
    timeout: 30000
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).pop());
  assert.equal(output.initialCount, 0);
  assert.equal(output.addStatus, 201);
  assert.equal(output.app.id, 'editor-demo');
  assert.deepEqual(output.app.args, ['--version']);
  assert.equal(output.afterAddCount, 1);
  assert.equal(output.noTokenStatus, 403);
  assert.equal(output.removeStatus, 200);
  assert.equal(output.afterRemoveCount, 0);
  assert.equal(output.invalidGitPreviewStatus, 400);
});
