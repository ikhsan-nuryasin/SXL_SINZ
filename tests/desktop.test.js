'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ASSETS, VERSION } = require('../lib/cloudflared');

const root = path.resolve(__dirname, '..');

test('desktop package defines Windows installer and macOS app installer targets', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.main, 'electron/main.js');
  assert.equal(pkg.name, 'sxl-localhost-website-sharing', 'the package identifier remains stable');
  assert.equal(pkg.productName, 'SINZ');
  assert.equal(pkg.build.productName, 'SINZ');
  assert.ok(pkg.build.files.includes('assets/icon.ico'), 'the branded Electron window icon is shipped at runtime');
  assert.equal(pkg.build.appId, 'com.youtsin.sxl-localhost', 'the stable application ID preserves upgrade compatibility');
  assert.equal(pkg.build.nsis.shortcutName, 'SINZ');
  assert.equal(pkg.build.nsis.uninstallDisplayName, 'SINZ');
  assert.equal(pkg.version, '0.14.13');
  assert.equal(pkg.dependencies.undici, '7.30.1', 'the pinned Undici dependency provides explicit proxy support');
  assert.match(pkg.scripts['build:win'], /electron-builder.*--win/);
  assert.match(pkg.scripts['build:mac'], /electron-builder.*--mac/);
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true, 'Windows users can choose the installation folder');
  assert.equal(pkg.build.nsis.perMachine, false, 'Windows installs are scoped to the current user');
  assert.equal(pkg.build.nsis.allowElevation, false, 'the installer must not request administrator elevation');
  assert.equal(pkg.build.nsis.runAfterFinish, true, 'the app opens after installation');
  assert.equal(pkg.build.nsis.include, 'assets/installer.nsh', 'uninstall removes the optional Windows startup entry');
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false, 'uninstall preserves user data');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /<title>SINZ/);
  assert.match(html, /src="\/sinz-mark\.svg"/);
  assert.doesNotMatch(html, /SXL Localhost|Panduan SXL/);
  const uninstaller = fs.readFileSync(path.join(root, 'assets', 'installer.nsh'), 'utf8');
  assert.match(uninstaller, /!macro customInit[\s\S]*?ReadRegStr \$0 HKCU "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation[\s\S]*?StrCpy \$INSTDIR "\$0\\\$\{APP_FILENAME\}"/, 'new installs default to the current user profile while upgrades retain their previous location');
  assert.match(preload, /getStartupSettings:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('desktop-startup:get'\)/);
  assert.match(preload, /setStartupOnLogin:\s*enabled\s*=>\s*ipcRenderer\.invoke\('desktop-startup:set',\s*enabled\)/);
  assert.match(main, /app\.setLoginItemSettings\(\{\s*openAtLogin:\s*enabled,\s*path:\s*app\.getPath\('exe'\)\s*\}\)/);
  assert.match(main, /app\.setName\('SINZ'\)/);
  assert.match(main, /app\.setPath\('userData',\s*path\.join\(app\.getPath\('appData'\),\s*'SXL Localhost'\)\)/, 'rebranding must keep the existing user-data directory');
  assert.match(main, /process\.platform === 'win32' && app\.isPackaged && !process\.env\.PORTABLE_EXECUTABLE_DIR/);
  assert.match(ui, /window\.sxlDesktop\.setStartupOnLogin\(enabled\)/);
  assert.match(html, /id="desktopStartupToggle"/);
  assert.match(uninstaller, /DeleteRegValue HKCU .* "SINZ"/);
  assert.match(uninstaller, /DeleteRegValue HKCU .* "SXL Localhost"/, 'legacy startup entry is removed on uninstall');
  assert.equal(pkg.build.mac.identity, null, 'source package is intentionally unsigned');
  assert.ok(fs.existsSync(path.join(root, 'assets', 'icon.ico')));
  assert.ok(fs.existsSync(path.join(root, 'assets', 'icon.icns')));
  const mark = fs.readFileSync(path.join(root, 'public', 'sinz-mark.svg'), 'utf8');
  assert.match(mark, /SINZ.*tikus bertopi/);
  const icon = fs.readFileSync(path.join(root, 'assets', 'icon.ico'));
  assert.equal(icon.readUInt16LE(2), 1, 'Windows icon is a valid ICO');
  assert.ok(icon.readUInt16LE(4) >= 1, 'Windows icon includes image sizes');
});

test('pinned Cloudflare releases have checksums for Windows and both macOS architectures', () => {
  assert.match(VERSION, /^\d{4}\.\d+\.\d+$/);
  for (const key of ['win32-x64', 'darwin-x64', 'darwin-arm64']) {
    assert.ok(ASSETS[key], `missing asset ${key}`);
    assert.match(ASSETS[key].sha256, /^[a-f0-9]{64}$/);
    assert.ok(ASSETS[key].urlName.startsWith('cloudflared-'));
  }
});

test('database data path follows desktop user data directory instead of app installation root', async () => {
  const customRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sxl-data-root-'));
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', "process.env.SXL_DATA_DIR && console.log(require('./database').getPaths().data)"], {
        cwd: root,
        env: { ...process.env, SXL_DATA_DIR: customRoot },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let out = '', err = '';
      child.stdout.on('data', chunk => out += chunk.toString());
      child.stderr.on('data', chunk => err += chunk.toString());
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve({ stdout: out.trim() }) : reject(new Error(err)));
    });
    assert.equal(stdout, path.join(customRoot, 'runtime', 'mariadb', 'data'));
  } finally {
    fs.rmSync(customRoot, { recursive: true, force: true });
  }
});


test('Electron URL policy rejects prefix-confusion, URL credentials, and dangerous schemes', () => {
  const { isTrustedAppUrl, isAllowedExternalUrl } = require('../lib/url-security');
  const base = 'http://127.0.0.1:4177';
  assert.equal(isTrustedAppUrl('http://127.0.0.1:4177/index.html', base), true);
  assert.equal(isTrustedAppUrl('http://127.0.0.1:41770/index.html', base), false);
  assert.equal(isTrustedAppUrl('http://127.0.0.1:4177@evil.example/', base), false);
  assert.equal(isTrustedAppUrl('javascript:alert(1)', base), false);
  assert.equal(isAllowedExternalUrl('https://example.com'), true);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedExternalUrl('https://user:pass@example.com'), false);
});

test('portable runtime installer pins supported LTS assets and validates checksums', () => {
  const runtime = require('../lib/runtime-installer');
  assert.equal(runtime.NODE_VERSION, 'v24.22.1');
  assert.equal(runtime.nodeAssetFor('win32', 'x64'), 'node-v24.22.1-win-x64.zip');
  assert.equal(runtime.nodeAssetFor('darwin', 'arm64'), 'node-v24.22.1-darwin-arm64.tar.gz');
  assert.equal(runtime.validSha256('a'.repeat(64), 'a'.repeat(64)), true);
  assert.equal(runtime.validSha256('b'.repeat(64), 'a'.repeat(64)), false);
  assert.equal(runtime.checksumForAsset(`${'a'.repeat(64)}  node-v24.22.1-win-x64.zip`, 'node-v24.22.1-win-x64.zip'), 'a'.repeat(64));
});


test('compatible system Node.js and npm are used before attempting metadata downloads', async t => {
  const runtime = require('../lib/runtime-installer');
  const os = require('node:os');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-runtime-system-'));
  const previousFetch = global.fetch;
  const previousNode = process.env.SXL_NODE_PATH;
  const previousNpm = process.env.SXL_NPM_CLI_PATH;
  process.env.SXL_NODE_PATH = process.execPath;
  const npmCli = runtime.findNpmCliForNode(process.execPath);
  if (!npmCli) {
    if (previousNode === undefined) delete process.env.SXL_NODE_PATH; else process.env.SXL_NODE_PATH = previousNode;
    if (previousNpm === undefined) delete process.env.SXL_NPM_CLI_PATH; else process.env.SXL_NPM_CLI_PATH = previousNpm;
    if (previousNpmNodeExecpath === undefined) delete process.env.npm_node_execpath; else process.env.npm_node_execpath = previousNpmNodeExecpath;
    if (previousNpmExecpath === undefined) delete process.env.npm_execpath; else process.env.npm_execpath = previousNpmExecpath;
    fs.rmSync(temp, { recursive: true, force: true });
    return t.skip('Node CLI npm tidak ditemukan di lingkungan tes.');
  }
  process.env.SXL_NPM_CLI_PATH = npmCli;
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; throw new TypeError('network should not be called'); };
  t.after(() => {
    global.fetch = previousFetch;
    if (previousNode === undefined) delete process.env.SXL_NODE_PATH; else process.env.SXL_NODE_PATH = previousNode;
    if (previousNpm === undefined) delete process.env.SXL_NPM_CLI_PATH; else process.env.SXL_NPM_CLI_PATH = previousNpm;
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const found = await runtime.ensureNodeRuntime(temp);
  assert.equal(found.source, 'system');
  assert.equal(found.node, process.execPath);
  assert.equal(found.npmCli, npmCli);
  assert.equal(fetchCalled, false, 'using local Node.js must avoid the metadata server');
});

test('portable runtime installer explains metadata network failures with actionable cause details', async t => {
  const runtime = require('../lib/runtime-installer');
  const os = require('node:os');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-runtime-offline-'));
  const previousFetch = global.fetch;
  const previousPath = process.env.PATH;
  const previousNode = process.env.SXL_NODE_PATH;
  const previousNpm = process.env.SXL_NPM_CLI_PATH;
  const previousNpmNodeExecpath = process.env.npm_node_execpath;
  const previousNpmExecpath = process.env.npm_execpath;
  const runtimePaths = require('../lib/runtime-paths');
  const previousGetRuntimePaths = runtimePaths.getRuntimePaths;
  const candidateEnvKeys = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA', 'NVM_SYMLINK', 'VOLTA_HOME', 'USERPROFILE', 'APPDATA', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];
  const previousCandidateEnv = Object.fromEntries(candidateEnvKeys.map(key => [key, process.env[key]]));
  runtimePaths.getRuntimePaths = () => runtimePaths.blankPaths();
  candidateEnvKeys.forEach(key => delete process.env[key]);
  process.env.PATH = temp;
  process.env.SXL_NODE_PATH = path.join(temp, 'missing-node');
  process.env.SXL_NPM_CLI_PATH = path.join(temp, 'missing-npm-cli.js');
  // `npm test` itself sets these variables; clear them so this test truly
  // simulates an offline environment without a discoverable system Node/npm pair.
  delete process.env.npm_node_execpath;
  delete process.env.npm_execpath;
  global.fetch = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND nodejs.org'), { code: 'ENOTFOUND' }) }); };
  t.after(() => {
    global.fetch = previousFetch;
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousNode === undefined) delete process.env.SXL_NODE_PATH; else process.env.SXL_NODE_PATH = previousNode;
    if (previousNpm === undefined) delete process.env.SXL_NPM_CLI_PATH; else process.env.SXL_NPM_CLI_PATH = previousNpm;
    if (previousNpmNodeExecpath === undefined) delete process.env.npm_node_execpath; else process.env.npm_node_execpath = previousNpmNodeExecpath;
    if (previousNpmExecpath === undefined) delete process.env.npm_execpath; else process.env.npm_execpath = previousNpmExecpath;
    runtimePaths.getRuntimePaths = previousGetRuntimePaths;
    for (const key of candidateEnvKeys) {
      if (previousCandidateEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousCandidateEnv[key];
    }
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await assert.rejects(runtime.ensureNodeRuntime(temp), error => {
    assert.match(error.message, /Tidak dapat mengambil checksum resmi Node\.js/);
    assert.match(error.message, /ENOTFOUND/);
    assert.match(error.message, /Node\.js 22\.12 atau lebih baru/);
    assert.match(error.message, /HTTPS_PROXY/);
    return true;
  });
});

test('npm-launched Electron can reuse the exact Node.js and npm paths from its parent process', () => {
  const runtime = require('../lib/runtime-installer');
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sxl-npm-env-'));
  try {
    const nodePath = path.join(temp, 'node.exe');
    const npmCli = path.join(temp, 'npm-cli.js');
    fs.writeFileSync(nodePath, 'test node placeholder');
    fs.writeFileSync(npmCli, '// npm cli placeholder');
    const env = {
      PATH: path.join(temp, 'empty-path'),
      PATHEXT: '.EXE;.CMD;.BAT',
      npm_node_execpath: nodePath,
      npm_execpath: npmCli,
      SXL_NODE_PATH: path.join(temp, 'missing-node.exe'),
      SXL_NPM_CLI_PATH: path.join(temp, 'missing-npm.js'),
      SXL_TEST_PLATFORM: 'win32'
    };
    const found = runtime.findSystemNodeRuntimePaths(env, 'win32');
    assert.ok(found);
    assert.equal(found.node, nodePath);
    assert.equal(found.npmCli, npmCli);
    assert.equal(found.source, 'system');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('runtime proxy settings respect HTTPS_PROXY and NO_PROXY without exposing proxy credentials', () => {
  const runtime = require('../lib/runtime-installer');
  const env = { HTTPS_PROXY: 'http://user:secret@proxy.example:8080', NO_PROXY: 'localhost,.nodejs.org' };
  assert.equal(runtime.proxyUrlFor('https://nodejs.org/dist/SHASUMS256.txt', env), null);
  assert.equal(runtime.proxyUrlFor('https://example.com/resource', env), 'http://user:secret@proxy.example:8080');
  assert.equal(runtime.isNoProxyTarget(new URL('http://localhost:3000'), 'localhost'), true);
  assert.equal(runtime.isNoProxyTarget(new URL('https://example.com'), '*'), true);
});

test('metadata fetch errors name the actual requested runtime source', async t => {
  const runtime = require('../lib/runtime-installer');
  const previousFetch = global.fetch;
  const proxyKeys = ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy','NO_PROXY','no_proxy'];
  const old = Object.fromEntries(proxyKeys.map(k => [k, process.env[k]]));
  proxyKeys.forEach(k => delete process.env[k]);
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  t.after(() => {
    global.fetch = previousFetch;
    for (const k of proxyKeys) old[k] === undefined ? delete process.env[k] : process.env[k] = old[k];
  });
  await assert.rejects(runtime.fetchText('https://windows.php.net/downloads/releases/php.sha256', 'checksum resmi PHP portable'), error => {
    assert.match(error.message, /checksum resmi PHP portable/);
    assert.match(error.message, /windows\.php\.net/);
    assert.match(error.message, /DNS, sertifikat HTTPS, dan firewall/);
    assert.doesNotMatch(error.message, /Node\.js/);
    return true;
  });
});

test('system Node.js versions below the app minimum are not accepted', () => {
  const runtime = require('../lib/runtime-installer');
  assert.equal(runtime.isSupportedNodeVersion('v20.19.0'), false);
  assert.equal(runtime.isSupportedNodeVersion('v22.11.0'), false);
  assert.equal(runtime.isSupportedNodeVersion('v22.12.0'), true);
  assert.equal(runtime.isSupportedNodeVersion('v24.0.0'), true);
});


test('release workflow shares one generated dependency lockfile across native build jobs', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build-desktop.yml'), 'utf8');
  assert.match(workflow, /prepare-dependencies:/);
  assert.match(workflow, /npm install --package-lock-only --ignore-scripts/);
  assert.equal((workflow.match(/npm ci --no-audit --no-fund/g) || []).length, 2);
  assert.match(workflow, /windows:[\s\S]*?needs: prepare-dependencies/);
  assert.match(workflow, /macos:[\s\S]*?needs: prepare-dependencies/);
});
