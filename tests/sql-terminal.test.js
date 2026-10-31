'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('SQL terminal has Indonesian mode, safe results, and keyboard execution', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'sql-terminal.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'sql-terminal.js'), 'utf8');
  assert.match(html, /<html lang="id">/);
  assert.match(html, /meta name="sxl-csrf" content="__SXL_CSRF_TOKEN__"/);
  assert.match(html, /<option value="id" selected>Bahasa Indonesia<\/option>/);
  assert.match(html, /<option value="native">SQL standar<\/option>/);
  assert.match(html, /id="databaseName"/);
  assert.match(html, /id="sqlInput"/);
  assert.match(html, /Ctrl\+Enter/);
  assert.match(html, /Maksimal 50 perintah/);
  assert.match(html, /id="sqlExample"/);
  assert.match(html, /id="insertSqlExample"/);
  assert.match(html, /id="glossarySearch"/);
  assert.match(html, /Materi singkat MariaDB/);
  assert.match(script, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(script, /cell\.textContent =/);
  assert.match(script, /function renderBatchResults/);
  assert.match(script, /SQL_EXAMPLES/);
  assert.match(script, /\/api\/database\/query/);
  assert.match(script, /X-SXL-CSRF/);
});

test('SQL terminal is exposed only through a constrained Electron IPC and explicit local server routes', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(preload, /openSqlTerminal:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('desktop-sql-terminal:open'\)/);
  assert.match(main, /ipcMain\.handle\('desktop-sql-terminal:open'/);
  assert.match(main, /new URL\('\/sql-terminal\.html', serverUrl\)/);
  assert.match(main, /nodeIntegration: false,[\s\S]*contextIsolation: true,[\s\S]*sandbox: true/);
  assert.match(main, /terminal\.webContents\.setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(server, /url\.pathname === '\/sql-terminal\.html'/);
  assert.match(server, /html\.replace\('__SXL_CSRF_TOKEN__', CSRF_TOKEN\)/);
  assert.match(server, /url\.pathname === '\/sql-terminal\.js'/);
});

test('SQL page receives the real per-process CSRF token and keeps API writes protected', t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-sql-terminal-http-'));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const script = String.raw`
    const server = require('./server');
    (async () => {
      try {
        const { url } = await server.startServer();
        const page = await fetch(url + '/sql-terminal.html');
        const html = await page.text();
        const token = html.match(/<meta name="sxl-csrf" content="([a-f0-9]{64})">/)?.[1] || '';
        const js = await fetch(url + '/sql-terminal.js');
        const rejected = await fetch(url + '/api/database/query', {
          method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: 'SELECT 1', language: 'native' })
        });
        const checked = await fetch(url + '/api/database/query', {
          method: 'POST',
          headers: { Origin: url, 'Content-Type': 'application/json', 'X-SXL-CSRF': token },
          body: JSON.stringify({ sql: 'SELECT 1', language: 'native' })
        });
        console.log(JSON.stringify({
          htmlStatus: page.status, hasToken: Boolean(token), placeholderGone: !html.includes('__SXL_CSRF_TOKEN__'),
          jsStatus: js.status, jsNoStore: js.headers.get('cache-control') === 'no-cache',
          rejectedStatus: rejected.status, checkedStatus: checked.status
        }));
      } finally {
        await server.shutdown({ exitProcess: false });
      }
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
  assert.equal(output.htmlStatus, 200);
  assert.equal(output.hasToken, true);
  assert.equal(output.placeholderGone, true);
  assert.equal(output.jsStatus, 200);
  assert.equal(output.jsNoStore, true);
  assert.equal(output.rejectedStatus, 403);
  assert.equal(output.checkedStatus, 400, 'valid CSRF reaches the query route, which rejects because this isolated server has no running database');
});
