'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = () => path.join(process.env.SXL_DATA_DIR || process.env.SXL_APP_ROOT || path.resolve(__dirname, '..'), 'config');
const FILE = () => path.join(ROOT(), 'project-settings.json');
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE(), 'utf8').replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const safe = {};
    for (const [slug, value] of Object.entries(parsed)) {
      if (!SLUG.test(slug) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const phpBinary = typeof value.phpBinary === 'string' ? value.phpBinary.trim() : '';
      const phpCgiBinary = typeof value.phpCgiBinary === 'string' ? value.phpCgiBinary.trim() : '';
      if (phpBinary && path.isAbsolute(phpBinary)) safe[slug] = { phpBinary: path.resolve(phpBinary), phpCgiBinary: phpCgiBinary && path.isAbsolute(phpCgiBinary) ? path.resolve(phpCgiBinary) : '', updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null };
    }
    return safe;
  } catch { return {}; }
}
function writeAll(value) {
  fs.mkdirSync(ROOT(), { recursive: true });
  const file = FILE();
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'w' });
  try { fs.chmodSync(temp, 0o600); } catch {}
  fs.renameSync(temp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
  return value;
}
function getProjectSettings(slug) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new Error('Nama proyek tidak valid.');
  return readAll()[slug] || { phpBinary: '', phpCgiBinary: '', updatedAt: null };
}
function saveProjectPhp(slug, { phpBinary = '', phpCgiBinary = '' } = {}) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new Error('Nama proyek tidak valid.');
  for (const [label, value] of [['PHP', phpBinary], ['PHP-CGI', phpCgiBinary]]) {
    if (value && (typeof value !== 'string' || !path.isAbsolute(value))) throw new Error(`${label}: path harus absolut.`);
  }
  const all = readAll();
  if (!phpBinary) delete all[slug];
  else all[slug] = { phpBinary: path.resolve(phpBinary), phpCgiBinary: phpCgiBinary ? path.resolve(phpCgiBinary) : '', updatedAt: new Date().toISOString() };
  writeAll(all);
  return getProjectSettings(slug);
}
function allProjectSettings() { return readAll(); }
function filePath() { return FILE(); }
module.exports = { getProjectSettings, saveProjectPhp, allProjectSettings, filePath, readAll, writeAll };
