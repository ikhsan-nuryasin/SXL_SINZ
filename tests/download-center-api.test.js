'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('Download Center and project dependency APIs are loopback-CSRF protected and report supported actions', t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sinz-download-api-'));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const script = String.raw`
    const server = require('./server');
    (async () => {
      try {
        const { url } = await server.startServer();
        const html = await (await fetch(url)).text();
        const token = html.match(/<meta name="sxl-csrf" content="([a-f0-9]{64})">/)?.[1] || '';
        const headers = { Origin: url, 'Content-Type': 'application/json', 'X-SXL-CSRF': token };
        require('node:fs').mkdirSync(require('node:path').join(process.env.SXL_DATA_DIR, 'www', 'taken-project'), { recursive: true });
        const catalogResponse = await fetch(url + '/api/download-center/catalog');
        const catalog = await catalogResponse.json();
        const checkResponse = await fetch(url + '/api/projects/dependencies', { method: 'POST', headers, body: JSON.stringify({ type: 'static' }) });
        const check = await checkResponse.json();
        const duplicateProject = await fetch(url + '/api/projects/create', { method: 'POST', headers, body: JSON.stringify({ name: 'taken-project', type: 'laravel' }) });
        const noToken = await fetch(url + '/api/download-center/install', {
          method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'composer' })
        });
        const unsupported = await fetch(url + '/api/download-center/install', { method: 'POST', headers, body: JSON.stringify({ id: 'postgresql' }) });
        const invalidType = await fetch(url + '/api/projects/dependencies', { method: 'POST', headers, body: JSON.stringify({ type: 'unknown' }) });
        console.log(JSON.stringify({
          catalogStatus: catalogResponse.status, catalogCount: catalog.items?.length,
          postgresStatus: catalog.items?.find(item => item.id === 'postgresql')?.status,
          phpInstallSupported: catalog.items?.find(item => item.id === 'php')?.installSupported,
          checkStatus: checkResponse.status, checkReady: check.ready, checkName: check.checks?.[0]?.name,
          duplicateProjectStatus: duplicateProject.status,
          noTokenStatus: noToken.status, unsupportedStatus: unsupported.status, invalidTypeStatus: invalidType.status
        }));
      } finally { await server.shutdown({ exitProcess: false }); }
    })().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    env: { ...process.env, SXL_DATA_DIR: dataRoot, SXL_SHARING_PORT: '0' },
    encoding: 'utf8',
    timeout: 60000
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).pop());
  assert.equal(output.catalogStatus, 200);
  assert.ok(output.catalogCount >= 10);
  assert.equal(output.postgresStatus, 'Unsupported');
  assert.equal(output.phpInstallSupported, true);
  assert.equal(output.checkStatus, 200);
  assert.equal(output.checkReady, true);
  assert.equal(output.checkName, 'Template statis');
  assert.equal(output.duplicateProjectStatus, 400);
  assert.equal(output.noTokenStatus, 403);
  assert.equal(output.unsupportedStatus, 400);
  assert.equal(output.invalidTypeStatus, 400);
});
