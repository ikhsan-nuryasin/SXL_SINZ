'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const REGISTRY_VERSION = 1;
const CATEGORIES = new Set(['database', 'coding', 'terminal', 'other']);
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const MAX_LABEL_LENGTH = 80;
const MAX_ARGUMENTS = 128;
const MAX_ARGUMENT_LENGTH = 2048;
const MAX_ARGUMENTS_LENGTH = 16384;
const MAX_PATH_LENGTH = 4096;

class AppCatalogError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppCatalogError';
    this.code = code;
  }
}

function fail(message, code = 'ERR_APP_CATALOG_VALIDATION', cause) {
  throw new AppCatalogError(message, code, cause);
}

function validateId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    fail('App ID must be a stable lowercase identifier (1–64 letters, digits, "_" or "-").');
  }
  return id;
}

function validateLabel(label) {
  if (typeof label !== 'string' || label.trim() !== label || label.length < 1 ||
      label.length > MAX_LABEL_LENGTH || /[\u0000-\u001f\u007f]/.test(label)) {
    fail(`App label must be 1–${MAX_LABEL_LENGTH} printable characters.`);
  }
  return label;
}

function validatePath(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH ||
      value.trim() !== value || value.includes('\0') || !path.isAbsolute(value)) {
    fail(`${field} must be an absolute path.`);
  }
  if (process.platform === 'win32') {
    const drivePath = /^[a-z]:[\\/]/i.test(value);
    const uncPath = /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value);
    if ((!drivePath && !uncPath) || /^\\\\[?.][\\/]/.test(value)) {
      fail(`${field} must be a fully qualified Windows path.`);
    }
  }
  if (value.split(/[\\/]+/).includes('..')) {
    fail(`${field} must not contain parent-directory traversal.`);
  }
  return path.normalize(value);
}

function validateArgs(args) {
  if (!Array.isArray(args) || args.length > MAX_ARGUMENTS) {
    fail(`args must be an array of at most ${MAX_ARGUMENTS} strings.`);
  }
  let totalLength = 0;
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length > MAX_ARGUMENT_LENGTH || arg.includes('\0')) {
      fail(`Each argument must be a string of at most ${MAX_ARGUMENT_LENGTH} characters without NUL.`);
    }
    totalLength += arg.length;
  }
  if (totalLength > MAX_ARGUMENTS_LENGTH) {
    fail(`Combined argument length must not exceed ${MAX_ARGUMENTS_LENGTH} characters.`);
  }
  return [...args];
}

function validateApp(app, { requireAllFields = true } = {}) {
  if (!app || typeof app !== 'object' || Array.isArray(app)) {
    fail('Each app entry must be an object.');
  }
  const keys = ['id', 'label', 'category', 'executablePath', 'args', 'cwd'];
  const actualKeys = Object.keys(app);
  if (actualKeys.some(key => !keys.includes(key)) ||
      (requireAllFields && keys.some(key => !Object.hasOwn(app, key)))) {
    fail('App entry has missing or unknown fields.');
  }
  if (!CATEGORIES.has(app.category)) {
    fail('App category must be "database", "coding", "terminal", or "other".');
  }
  return {
    id: validateId(app.id),
    label: validateLabel(app.label),
    category: app.category,
    executablePath: validatePath(app.executablePath, 'executablePath'),
    args: validateArgs(app.args),
    cwd: validatePath(app.cwd, 'cwd')
  };
}

function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry) ||
      Object.keys(registry).some(key => !['version', 'apps'].includes(key)) ||
      !Object.hasOwn(registry, 'version') || !Object.hasOwn(registry, 'apps')) {
    fail('App catalog registry has missing or unknown data.', 'ERR_APP_CATALOG_SCHEMA');
  }
  if (registry.version !== REGISTRY_VERSION) {
    fail(`Unsupported app catalog registry version: ${String(registry.version)}.`,
      'ERR_APP_CATALOG_VERSION');
  }
  if (!Array.isArray(registry.apps)) {
    fail('App catalog registry "apps" must be an array.', 'ERR_APP_CATALOG_SCHEMA');
  }
  const apps = registry.apps.map(app => validateApp(app));
  const seen = new Set();
  for (const app of apps) {
    if (seen.has(app.id)) fail(`Duplicate app ID in registry: ${app.id}.`, 'ERR_APP_CATALOG_SCHEMA');
    seen.add(app.id);
  }
  return { version: REGISTRY_VERSION, apps };
}

function pathExists(candidate, kind) {
  try {
    const stats = fs.statSync(candidate);
    return kind === 'directory' ? stats.isDirectory() : stats.isFile();
  } catch {
    return false;
  }
}

function createAppCatalog({ dataDir, spawnImpl = spawn, existsImpl = pathExists } = {}) {
  const absoluteDataDir = validatePath(dataDir, 'dataDir');
  if (typeof spawnImpl !== 'function' || typeof existsImpl !== 'function') {
    fail('spawnImpl and existsImpl must be functions.');
  }
  const registryPath = path.join(absoluteDataDir, 'app-catalog.json');

  function readRegistry() {
    let fileStats;
    try {
      fileStats = fs.lstatSync(registryPath);
    } catch (error) {
      if (error.code === 'ENOENT') return { version: REGISTRY_VERSION, apps: [] };
      fail(`Unable to inspect app catalog registry: ${error.message}`,
        'ERR_APP_CATALOG_READ', error);
    }
    if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
      fail('App catalog registry must be a regular file.', 'ERR_APP_CATALOG_READ');
    }
    let text;
    try {
      text = fs.readFileSync(registryPath, 'utf8');
    } catch (error) {
      fail(`Unable to read app catalog registry: ${error.message}`, 'ERR_APP_CATALOG_READ', error);
    }
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (error) {
      fail(`Unable to parse app catalog registry: ${error.message}`, 'ERR_APP_CATALOG_PARSE', error);
    }
    return validateRegistry(parsed);
  }

  function writeRegistry(registry) {
    const data = `${JSON.stringify(validateRegistry(registry), null, 2)}\n`;
    const tempPath = `${registryPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(absoluteDataDir, { recursive: true });
      try {
        if (fs.lstatSync(registryPath).isSymbolicLink()) {
          fail('App catalog registry must not be a symbolic link.', 'ERR_APP_CATALOG_WRITE');
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      fs.writeFileSync(tempPath, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(tempPath, registryPath);
      try { fs.chmodSync(registryPath, 0o600); } catch (error) {
        if (process.platform !== 'win32') throw error;
      }
    } catch (error) {
      try { fs.unlinkSync(tempPath); } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') error.cleanupError = cleanupError;
      }
      if (error instanceof AppCatalogError) throw error;
      fail(`Unable to write app catalog registry: ${error.message}`, 'ERR_APP_CATALOG_WRITE', error);
    }
  }

  function assertLaunchPaths(app) {
    if (!existsImpl(app.executablePath, 'file')) {
      fail(`Executable does not exist or is not a file: ${app.executablePath}`,
        'ERR_APP_CATALOG_PATH');
    }
    if (!existsImpl(app.cwd, 'directory')) {
      fail(`Working directory does not exist or is not a directory: ${app.cwd}`,
        'ERR_APP_CATALOG_PATH');
    }
  }

  return Object.freeze({
    filePath: registryPath,

    list() {
      return readRegistry().apps.map(app => ({ ...app, args: [...app.args] }));
    },

    add(appInput) {
      const app = validateApp(appInput);
      assertLaunchPaths(app);
      const registry = readRegistry();
      if (registry.apps.some(existing => existing.id === app.id)) {
        fail(`An app with ID "${app.id}" is already registered.`, 'ERR_APP_CATALOG_DUPLICATE');
      }
      registry.apps.push(app);
      writeRegistry(registry);
      return { ...app, args: [...app.args] };
    },

    remove(id) {
      validateId(id);
      const registry = readRegistry();
      const index = registry.apps.findIndex(app => app.id === id);
      if (index === -1) return false;
      registry.apps.splice(index, 1);
      writeRegistry(registry);
      return true;
    },

    launch(id, spawnProcess = spawnImpl) {
      validateId(id);
      if (typeof spawnProcess !== 'function') fail('spawnProcess must be a function.');
      const app = readRegistry().apps.find(entry => entry.id === id);
      if (!app) fail(`No app is registered with ID "${id}".`, 'ERR_APP_CATALOG_NOT_FOUND');
      assertLaunchPaths(app);
      if (process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(app.executablePath)) {
        fail('Batch files cannot be launched safely without a shell.', 'ERR_APP_CATALOG_PATH');
      }
      return spawnProcess(app.executablePath, [...app.args], {
        cwd: app.cwd,
        shell: false,
        windowsHide: true
      });
    }
  });
}

function getCatalog(dataRoot) {
  return createAppCatalog({ dataDir: dataRoot });
}

function list({ dataRoot } = {}) {
  return getCatalog(dataRoot).list();
}

function add({ dataRoot, input } = {}) {
  return getCatalog(dataRoot).add(input);
}

function remove({ dataRoot, id } = {}) {
  return getCatalog(dataRoot).remove(id);
}

function launch({ dataRoot, id, spawnProcess = spawn } = {}) {
  return getCatalog(dataRoot).launch(id, spawnProcess);
}

module.exports = {
  list,
  add,
  remove,
  launch,
  createAppCatalog,
  AppCatalogError,
  REGISTRY_VERSION
};
