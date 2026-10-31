'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set(['ext', 'extras', 'include', 'lib', 'pear', 'tests', 'tmp', 'dev', 'node_modules', '.git']);

function getPhpVersionsRoot(dataRoot) {
  return path.join(dataRoot, 'runtime', 'php-versions');
}

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}
function isDir(file) {
  try { return fs.statSync(file).isDirectory(); } catch { return false; }
}
function samePath(a, b, platform = process.platform) {
  const canonical = value => {
    try { return fs.realpathSync(value); } catch { return path.resolve(value); }
  };
  const left = canonical(a);
  const right = canonical(b);
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}
function candidateAt(directory, root, platform) {
  const names = platform === 'win32' ? ['php.exe', 'php'] : ['php', 'php.exe'];
  const binary = names.map(name => path.join(directory, name)).find(isFile);
  if (!binary) return null;
  const binDir = path.dirname(binary);
  const cgiNames = platform === 'win32' ? ['php-cgi.exe', 'php-cgi'] : ['php-cgi', 'php-cgi.exe'];
  const phpCgiBinary = cgiNames.map(name => path.join(binDir, name)).find(isFile) || '';
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, binary);
  const id = relative.split(path.sep).join('/') || path.basename(binary);
  let label = path.basename(directory);
  if (samePath(directory, root, platform)) label = 'PHP (folder utama)';
  else if (path.basename(directory).toLowerCase() === 'bin') label = path.basename(path.dirname(directory));
  return {
    id,
    label,
    phpBinary: path.resolve(binary),
    phpCgiBinary: phpCgiBinary ? path.resolve(phpCgiBinary) : '',
    directory: path.resolve(directory),
    source: 'folder-sxl',
    hasPhpIni: isFile(path.join(binDir, 'php.ini')),
    hasIniTemplate: isFile(path.join(binDir, 'php.ini-development')) || isFile(path.join(binDir, 'php.ini-production')),
    hasExtensions: isDir(path.join(binDir, 'ext'))
  };
}

function discoverPhpVersions(root, options = {}) {
  const platform = options.platform || process.platform;
  fs.mkdirSync(root, { recursive: true });
  const normalizedRoot = path.resolve(root);
  const queue = [{ directory: normalizedRoot, depth: 0 }];
  const candidates = [];
  const visited = new Set();
  while (queue.length && visited.size < 400) {
    const current = queue.shift();
    let real;
    try { real = fs.realpathSync(current.directory); } catch { continue; }
    const identity = platform === 'win32' ? real.toLowerCase() : real;
    if (visited.has(identity)) continue;
    visited.add(identity);

    const candidate = candidateAt(current.directory, normalizedRoot, platform);
    if (candidate) candidates.push(candidate);
    if (current.depth >= 3) continue;
    let entries = [];
    try { entries = fs.readdirSync(current.directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
    }
  }
  const unique = new Map();
  for (const item of candidates) {
    const key = platform === 'win32' ? item.phpBinary.toLowerCase() : item.phpBinary;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
}

function addCurrentExternalPhp(versions, phpBinary, phpCgiBinary = '', root, platform = process.platform) {
  if (!phpBinary || !isFile(phpBinary)) return versions;
  if (versions.some(item => samePath(item.phpBinary, phpBinary, platform))) return versions;
  let inside = false;
  const relative = path.relative(path.resolve(root), path.resolve(phpBinary));
  inside = relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  if (inside) return versions;
  const dir = path.dirname(phpBinary);
  const cgiNames = platform === 'win32' ? ['php-cgi.exe', 'php-cgi'] : ['php-cgi', 'php-cgi.exe'];
  const detectedCgi = (phpCgiBinary && isFile(phpCgiBinary) ? phpCgiBinary : cgiNames.map(name => path.join(dir, name)).find(isFile)) || '';
  const next = [...versions, {
    id: `manual:${path.resolve(phpBinary)}`,
    label: `PHP manual · ${path.basename(dir)}`,
    phpBinary: path.resolve(phpBinary),
    phpCgiBinary: detectedCgi ? path.resolve(detectedCgi) : '',
    directory: dir,
    source: 'manual',
    hasPhpIni: isFile(path.join(dir, 'php.ini')),
    hasIniTemplate: isFile(path.join(dir, 'php.ini-development')) || isFile(path.join(dir, 'php.ini-production')),
    hasExtensions: isDir(path.join(dir, 'ext'))
  }];
  return next;
}

module.exports = { getPhpVersionsRoot, discoverPhpVersions, addCurrentExternalPhp, samePath };
