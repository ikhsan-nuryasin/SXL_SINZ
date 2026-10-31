'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('corrupt managed cloudflared is not selected when a separate local candidate exists', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-cloudflared-command-'));
  const data = path.join(root, 'data');
  const app = path.join(root, 'app');
  const managed = path.join(data, 'runtime', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  const alternative = path.join(app, 'tools', 'cloudflared.exe');
  fs.mkdirSync(path.dirname(managed), { recursive: true });
  fs.mkdirSync(path.dirname(alternative), { recursive: true });
  fs.writeFileSync(managed, 'corrupt managed binary');
  fs.writeFileSync(alternative, 'manual local binary');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const serverFile = path.resolve(__dirname, '..', 'server.js');
  const script = `process.stdout.write(require(${JSON.stringify(serverFile)}).getCloudflaredCommand())`;
  const env = { ...process.env, SXL_DATA_DIR: data, SXL_APP_ROOT: app };
  delete env.CLOUDFLARED_PATH;
  const selected = execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  assert.equal(path.resolve(selected), path.resolve(alternative));
  assert.equal(fs.readFileSync(managed, 'utf8'), 'corrupt managed binary', 'selection must not delete or rewrite unverified binary during lookup');
});

test('corrupt managed cloudflared is treated as unavailable so sharing can repair it', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-cloudflared-invalid-'));
  const data = path.join(root, 'data');
  const managed = path.join(data, 'runtime', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  fs.mkdirSync(path.dirname(managed), { recursive: true });
  fs.writeFileSync(managed, 'stale or corrupt managed binary');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const serverFile = path.resolve(__dirname, '..', 'server.js');
  const script = `const server=require(${JSON.stringify(serverFile)});process.stdout.write(String(server.isCloudflaredCommandAvailable(${JSON.stringify(managed)})))`;
  const env = { ...process.env, SXL_DATA_DIR: data };
  delete env.CLOUDFLARED_PATH;
  const available = execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  assert.equal(available, 'false', 'an unverified managed binary must trigger the verified downloader');
  assert.equal(fs.readFileSync(managed, 'utf8'), 'stale or corrupt managed binary', 'availability checks must not modify the existing file');
});
