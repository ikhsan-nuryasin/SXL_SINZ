'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('local development stack exposes Apache, PHP, Composer, MariaDB and phpMyAdmin managers', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  for (const id of ['startAllServices', 'stopAllServices', 'apacheStart', 'apacheStop', 'phpInstall', 'composerInstall', 'pmaInstall', 'pmaStart', 'dbInstall', 'dbVersionSelect', 'dbUseVersion', 'dbInstall13', 'dbPortInput', 'dbSavePort', 'dbCreateDatabase', 'openWorkspaceTerminal', 'manualApacheBinary', 'manualPhpBinary', 'manualPhpCgiBinary', 'manualComposerPhar', 'manualNodeBinary', 'manualNpmCli', 'manualCloudflaredBinary', 'manualPhpMyAdminDir', 'manualMariaDbBinDir', 'saveManualRuntimePaths', 'phpVersionSelect', 'scanPhpVersions', 'openPhpVersionsFolder', 'usePhpVersion', 'phpVersionsRoot']) {
    assert.match(source, new RegExp(`id="${id}"`), `missing UI control ${id}`);
  }
  const services = require('../services');
  assert.equal(services.PMA_VERSION, '5.2.3');
  const serviceSource = fs.readFileSync(path.join(root, 'services.js'), 'utf8');
  const databaseSource = fs.readFileSync(path.join(root, 'database.js'), 'utf8');
  assert.match(serviceSource, /\$cfg\['Servers'\]\[\$i\]\['AllowNoPassword'\] = true;/);
  assert.match(serviceSource, /AllowNoPassword.*false.*\$1true/);
  assert.match(serviceSource, /await database\.enablePhpMyAdminRootNoPassword\(\)/);
  assert.match(databaseSource, /async function enablePhpMyAdminRootNoPassword\(/);
  assert.match(databaseSource, /ALTER USER \$\{accountName\} IDENTIFIED BY/);
  for (const fn of ['installPhpRuntime', 'installComposer', 'composerInstallProject', 'startAllServices', 'stopAllServices', 'openProjectFolder', 'openWorkspaceFolder', 'openProjectTerminal', 'openWorkspaceTerminal', 'renderPhpProjectVhost', 'ensureApacheModules', 'getManualRuntimePaths', 'saveManualRuntimePaths', 'getPhpVersions', 'selectPhpVersion', 'openPhpVersionsFolder', 'prepareManagedPhpIni', 'setProjectPhpVersion', 'getProjectPhpRuntime', 'diagnoseEnvironment']) {
    assert.equal(typeof services[fn], 'function', `missing service ${fn}`);
  }
});

test('terminal API routes exist for both project and workspace folders', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /\/api\/projects\/open-terminal/);
  assert.match(server, /\/api\/projects\/open-workspace-terminal/);
  assert.match(server, /\/api\/runtime\/paths/);
  assert.match(server, /\/api\/runtime\/php-versions/);
  assert.match(server, /\/api\/runtime\/php-versions\/select/);
  assert.match(server, /\/api\/database\/install-version/);
  assert.match(server, /\/api\/database\/verify-version/);
  assert.match(server, /\/api\/database\/select-version/);
  assert.match(server, /\/api\/database\/set-port/);
  assert.match(server, /\/api\/database\/browse-archive/);
  assert.match(server, /\/api\/database\/log/);
  assert.match(server, /\/api\/diagnostics/);
  assert.match(server, /\/api\/projects\/php-version/);
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /openWorkspaceTerminal/);
  assert.match(app, /\/api\/projects\/open-terminal/);
});

test('standalone Terminal and phpMyAdmin launch shortcuts are exposed in the UI', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(html, /id="launchTerminalApp"/);
  assert.match(html, /id="launchPhpMyAdminWeb"/);
  assert.match(html, /Web di browser terpisah/);
  assert.match(app, /launchStandaloneTerminal/);
  assert.match(app, /launchPhpMyAdminStandalone/);
  assert.match(app, /\/api\/services\/phpmyadmin\/start/);
  assert.match(app, /\/api\/services\/phpmyadmin\/open/);
  assert.match(app, /\/api\/projects\/open-workspace-terminal/);
});

test('project manager can create a PHP project and recognize Composer projects safely', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-stack-test-'));
  try {
    const script = String.raw`
      const fs = require('node:fs');
      const path = require('node:path');
      const svc = require('./services');
      const created = svc.createProject({name:'Laravel Demo',type:'php'});
      const folder = created.project.path;
      const before = svc.listProjects().find(p => p.slug === 'laravel-demo');
      fs.writeFileSync(path.join(folder,'composer.json'), JSON.stringify({name:'demo/laravel',require:{}}));
      const after = svc.listProjects().find(p => p.slug === 'laravel-demo');
      console.log(JSON.stringify({before:before.composerAvailable,after:after.composerAvailable,type:after.type,slug:after.slug}));
    `;
    const run = spawnSync(process.execPath, ['-e', script], { cwd: root, env: { ...process.env, SXL_DATA_DIR: temp }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.before, false);
    assert.equal(result.after, true);
    assert.equal(result.type, 'php');
    assert.equal(result.slug, 'laravel-demo');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('project and workspace terminal launchers use the selected folder safely', () => {
  const services = require('../services');
  assert.equal(typeof services.openProjectTerminal, 'function');
  assert.equal(typeof services.openWorkspaceTerminal, 'function');
  const win = services.terminalLaunchSpec('C:\\Dev\\my project', 'win32');
  assert.equal(win.command, 'powershell.exe');
  assert.ok(win.args.includes('-NoExit'));
  assert.match(win.args.join(' '), /Set-Location -LiteralPath/);
  const mac = services.terminalLaunchSpec('/Users/demo/My Project', 'darwin');
  assert.equal(mac.command, 'osascript');
  assert.match(mac.args.join(' '), /Terminal/);
});

test('PHP runtime pin matches phpMyAdmin supported compatibility range', () => {
  const runtime = require('../lib/runtime-installer');
  assert.equal(runtime.PHP_VERSION, '8.3.36');
  assert.match(runtime.getPhpPaths(os.tmpdir()).php, /8\.3\.36/);
});

test('existing PHP and static folders in the SXL workspace are discovered without a manifest', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-existing-project-'));
  try {
    const script = String.raw`
      const fs = require('node:fs');
      const path = require('node:path');
      const svc = require('./services');
      const www = svc.WWW_ROOT;
      fs.mkdirSync(path.join(www,'existing-static'),{recursive:true});
      fs.writeFileSync(path.join(www,'existing-static','index.html'),'<h1>Static</h1>');
      fs.mkdirSync(path.join(www,'existing-php'),{recursive:true});
      fs.writeFileSync(path.join(www,'existing-php','index.php'),'<?php echo "PHP";');
      const found = svc.listProjects().filter(p=>p.slug.startsWith('existing-')).map(p=>({slug:p.slug,type:p.type,discovered:p.createdAt===null}));
      console.log(JSON.stringify(found));
    `;
    const run = spawnSync(process.execPath, ['-e', script], { cwd: root, env: { ...process.env, SXL_DATA_DIR: temp }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const found = JSON.parse(run.stdout.trim());
    assert.deepEqual(found, [
      { slug: 'existing-php', type: 'php', discovered: true },
      { slug: 'existing-static', type: 'static', discovered: true }
    ]);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});


test('PHP project virtual host routes scripts to loopback FastCGI and uses Laravel public root', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-fastcgi-vhost-'));
  try {
    const project = path.join(temp, 'shop-app');
    fs.mkdirSync(path.join(project, 'public'), { recursive: true });
    fs.writeFileSync(path.join(project, 'artisan'), '#!/usr/bin/env php');
    fs.writeFileSync(path.join(project, 'public', 'index.php'), '<?php echo "ok";');
    const services = require('../services');
    const vhost = services.renderPhpProjectVhost({ slug: 'shop-app', path: project }, 8080, 9123);
    assert.match(vhost, /ServerName shop-app\.localhost/);
    assert.match(vhost, /DocumentRoot ".*shop-app\/public"/);
    assert.match(vhost, /ProxyFCGIBackendType GENERIC/);
    assert.match(vhost, /SetHandler "proxy:fcgi:\/\/127\.0\.0\.1:9123"/);
    const phpHandler = vhost.match(/<FilesMatch "\(\?i\)\\\.php\$">([\s\S]*?)<\/FilesMatch>/);
    assert.ok(phpHandler, 'PHP FastCGI handler is configured');
    assert.doesNotMatch(phpHandler[1], /Require all granted/, 'sensitive PHP filenames must not conflict with a broad allow rule');
    assert.match(vhost, /Require all denied/);
    assert.match(vhost, /AllowOverride FileInfo Options=Indexes,MultiViews/);
    assert.doesNotMatch(vhost, /AllowOverride All/);
    assert.match(vhost, /FilesMatch.*composer/);
    assert.ok(vhost.includes(String.raw`<FilesMatch "(?i)^\.">`));
    assert.doesNotMatch(vhost, /0\.0\.0\.0/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Apache FastCGI module loader enables dependencies in correct order using absolute module paths', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-apache-modules-'));
  try {
    const modules = path.join(temp, 'modules');
    fs.mkdirSync(modules, { recursive: true });
    for (const name of ['dir', 'proxy', 'proxy_fcgi', 'rewrite']) fs.writeFileSync(path.join(modules, `mod_${name}.so`), 'test-module');
    const services = require('../services');
    const base = '# ServerRoot comment\nServerRoot "${SRVROOT}"\nListen 80\n#LoadModule proxy_module modules/mod_proxy.so\n';
    const generated = services.ensureApacheModules(base, { root: temp, binary: path.join(temp, 'bin', 'httpd') }, ['dir_module', 'proxy_module', 'proxy_fcgi_module', 'rewrite_module']);
    const dirIndex = generated.indexOf('LoadModule dir_module');
    const proxyIndex = generated.indexOf('LoadModule proxy_module');
    const fcgiIndex = generated.indexOf('LoadModule proxy_fcgi_module');
    const rewriteIndex = generated.indexOf('LoadModule rewrite_module');
    assert.ok(dirIndex >= 0 && dirIndex < proxyIndex && proxyIndex < fcgiIndex && fcgiIndex < rewriteIndex);
    const expectedModulePath = path.join(temp, 'modules', 'mod_proxy_fcgi.so').replace(/\\/g, '/');
    assert.ok(generated.includes(expectedModulePath), `expected absolute module path ${expectedModulePath}`);
    assert.doesNotMatch(generated, /#LoadModule proxy_module/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('PHP CGI executable discovery stays paired with the selected PHP runtime', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-php-cgi-'));
  const originalPath = process.env.PATH;
  const originalCgiOverride = process.env.SXL_PHP_CGI_PATH;
  try {
    // Keep this test deterministic even when the developer has Laragon/PHP on PATH.
    process.env.PATH = temp;
    delete process.env.SXL_PHP_CGI_PATH;
    const php = path.join(temp, process.platform === 'win32' ? 'php.exe' : 'php');
    fs.writeFileSync(php, 'test');
    assert.equal(require('../services').phpCgiCandidates(php), null);
    const cgi = path.join(temp, process.platform === 'win32' ? 'php-cgi.exe' : 'php-cgi');
    fs.writeFileSync(cgi, 'test');
    assert.equal(require('../services').phpCgiCandidates(php), cgi);
    process.env.SXL_PHP_CGI_PATH = path.join(temp, 'explicit-php-cgi-not-found');
    assert.equal(require('../services').phpCgiCandidates(php), cgi, 'a valid sibling binary takes priority over an invalid override');
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    if (originalCgiOverride === undefined) delete process.env.SXL_PHP_CGI_PATH; else process.env.SXL_PHP_CGI_PATH = originalCgiOverride;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


test('UI exposes central settings, application directory, SQL launcher, and GitHub publishing', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
  for (const page of ['dashboard', 'database', 'projects', 'apps', 'settings']) {
    assert.match(html, new RegExp(`data-page-view="${page}"`), `missing ${page} page`);
    assert.match(html, new RegExp(`data-nav="${page}"`), `missing ${page} navigation item`);
  }
  assert.match(html, /href="\/styles\.css"/, 'styles live in a separate stylesheet');
  assert.match(html, /id="sidebarBackdrop"/, 'mobile navigation backdrop exists');
  assert.match(html, /id="mobileNavToggle"/, 'mobile navigation toggle exists');
  assert.match(html, /<span>Database<\/span>/, 'primary navigation includes Database');
  assert.match(html, /id="launchSqlTerminal"/, 'SQL terminal has a separate-window launcher');
  for (const id of ['dashboardCreateProject', 'dashboardStartDatabase', 'dashboardOpenSql', 'dbStartShortcut', 'dbStopShortcut', 'dbSqlShortcut']) {
    assert.ok(html.includes(`id="${id}"`), `missing direct workspace action ${id}`);
  }
  for (const group of ['sharing', 'database', 'runtime']) {
    assert.ok(html.includes(`data-settings-tab="${group}"`), `missing settings category tab ${group}`);
    assert.ok(html.includes(`data-settings-category="${group}"`), `missing settings category panel ${group}`);
  }
  assert.match(app, /function setSettingsTab\(value\)/, 'settings categories are switchable');
  assert.match(app, /dashboardCreateProject'\)\?\.addEventListener/, 'dashboard starts project creation directly');
  assert.match(html, /id="launchTerminalApp"[\s\S]*id="launchPhpMyAdminWeb"/, 'existing standalone launchers remain in Aplikasi');
  assert.match(html, /id="appAddDialog"[\s\S]*id="appAddForm"[\s\S]*id="appCategory"[\s\S]*id="appExecutable"[^>]*required[\s\S]*id="appWorkingDirectory"[^>]*required/, 'App form requires category, executable and working directory in a dialog');
  assert.match(html, /id="openAppAddDialog"/, 'application registration opens from a compact action');
  assert.match(html, /id="appDirectoryList"/, 'registered applications remain visible in the directory');
  assert.match(html, /id="appArgs"[^>]*placeholder="--new-window&#10;--reuse-window"/, 'App arguments are entered one per line');
  assert.ok(html.includes('https://mariadb.org/'), 'curated vendor links are official');
  for (const id of ['projectPublishDialog', 'publishPreviewFiles', 'publishConfirmFiles', 'publishGithub']) {
    assert.ok(html.includes(`id="${id}"`), `missing project publishing dialog control ${id}`);
  }
  assert.match(app, /textContent = 'Push ke GitHub'/, 'each project has a GitHub publishing action');
  assert.match(app, /projectActionsDialog'\)\.showModal\(\)/, 'project management actions open in a dialog');
  assert.match(html, /id="view-settings"[\s\S]*id="manualRuntimePanel"/, 'legacy runtime configuration is reachable in Pengaturan');
  assert.match(html, /id="dbVersionManager"[\s\S]*id="dbPortInput"/, 'database version and port controls are in Pengaturan');
  assert.match(html, /id="runtimeType"[\s\S]*id="shareAllowedEmails"/, 'sharing configuration is in Pengaturan');
  assert.match(html, /id="globalToast"[^>]*aria-live="assertive"[^>]*aria-atomic="true"/, 'global toast has an accessible live announcement');
  assert.match(html, /id="confirmDialog"/, 'custom confirmation dialog exists');
  assert.match(html, /id="manualRuntimePanel"/, 'manual runtime configuration panel exists');
  assert.match(html, /runtime-path-help/, 'manual runtime path discovery guidance exists');
  for (const id of ['manualApacheBinary','manualPhpBinary','manualPhpCgiBinary','manualComposerPhar','manualNodeBinary','manualNpmCli','manualCloudflaredBinary','manualPhpMyAdminDir','manualMariaDbBinDir']) assert.match(html, new RegExp(`id="${id}"`), `missing manual runtime field ${id}`);
  assert.match(html, /id="runDiagnostics"/, 'runtime diagnostics button exists');
  assert.match(html, /id="sharePassword"/, 'optional protected sharing password exists');
  assert.match(html, /id="toggleSharePassword"/, 'password reveal control exists');
  assert.match(html, /id="shareAllowedEmails"/, 'Cloudflare email allow-list exists');
  assert.match(html, /2026\.10\.4/, 'UI documents the minimum cloudflared version for email OTP');
  assert.match(html, /200 permintaan in-flight/i, 'UI exposes Quick Tunnel request limit');
  assert.match(html, /id="additionalDatabaseEngines"/, 'PostgreSQL/SQLite panel exists');
  for (const id of ['pgBinDir','pgPort','pgInitialize','pgStart','pgStop','pgRunQuery','pgBackup','sqliteExecutable','sqliteCreate','sqliteRunQuery','sqliteBackup']) {
    assert.match(html, new RegExp(`id=\"${id}\"`), `missing database engine control ${id}`);
  }
  assert.match(app, /\/api\/projects\/php-version/);
  assert.match(app, /accessPassword/);
  assert.match(app, /select\.disabled = !\(result\.rows \|\| \[\]\)\.length/, 'table selector enables after loading query results');
  assert.match(app, /Dilindungi kata sandi|dilindungi kata sandi/);
  assert.match(app, /function navigateSxlPage/);
  assert.match(app, /api\('\/api\/apps'/);
  assert.match(app, /\/api\/apps\/\$\{encodeURIComponent\(app\.id\)\}\/launch/);
  assert.match(app, /method: 'DELETE'/);
  assert.match(app, /appArgs'\)\.value\.split\(/, 'newline arguments serialize to an array');
  assert.match(app, /api\('\/api\/projects\/github-preview'/);
  assert.match(app, /api\('\/api\/projects\/publish-to-github'/);
  assert.match(app, /const confirmFiles = publishPreviewFiles/);
  assert.match(app, /typeof file\.path === 'string'[\s\S]*Number\.isSafeInteger\(file\.size\)[\s\S]*file\.sha256/);
  assert.match(app, /item\.textContent = file\.path/);
  assert.match(app, /const excluded = Array\.isArray\(result\.excluded\)/);
  assert.match(app, /result\.totalBytes/);
  assert.match(app, /result\.gitRepository/);
  assert.match(app, /JSON\.stringify\(\{ name, category, executable, args, workingDirectory \}\)/);
  assert.match(app, /!name \|\| !category \|\| !executable \|\| !workingDirectory/, 'all required app fields are validated');
  assert.match(app, /split\(\/\\r\?\\n\/\)/);
  assert.doesNotMatch(app, /confirmFiles = \$\('publishConfirmFiles'\)\.checked/);
  assert.match(app, /window\.sxlDesktop\.openSqlTerminal/);
  assert.match(css, /\.global-toast \{[^}]*position: fixed[^}]*top:/, 'global toast is fixed at the top');
  assert.match(app, /syncOverviewMetrics/);
  assert.match(app, /hashchange/);
  assert.match(app, /event\.metaKey/);
  assert.match(css, /\.sidebar\.open/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.diagnostic-fail/, 'diagnostic failures have a matching visible style');
  assert.match(css, /\.db-table-tools/, 'database table explorer has a responsive layout');
  // Each operational section sits inside its own page and the original action IDs remain.
  for (const id of ['databasePanel', 'environmentPanel', 'projectsPanel', 'start', 'stop', 'sqlInput', 'dbShowTables', 'dbTableSelect', 'dbDescribeTable']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing original control ${id}`);
  }
});


test('Apache installer verifies the exact x64 archive against an independent manifest', () => {
  const services = require('../services');
  const url = 'https://www.apachelounge.com/download/VS18/binaries/httpd-2.4.69-261002-Win64-VS18.zip';
  const sha = '9B47A2363A71FEF6209C88E79743DB81311E1753C4564E007141934123132C10';
  const manifest = `PackageIdentifier: ApacheLounge.httpd\nPackageVersion: 2.4.69\nInstallers:\n- Architecture: x86\n  InstallerUrl: https://www.apachelounge.com/download/VS18/binaries/httpd-2.4.69-261002-win32-vs18.zip\n  InstallerSha256: 9245F3EEE23C5DCCBB4EF89D885C7CEE7060FF8102112AC268B007647A31557B\n- Architecture: x64\n  InstallerUrl: ${url}\n  InstallerSha256: ${sha}\nManifestType: installer\n`;
  assert.equal(services.parseApacheManifestSha256(manifest, url), sha.toLowerCase());
  assert.equal(services.verifySha256(Buffer.from('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'), true);
  assert.equal(services.verifySha256(Buffer.from('abc'), '0'.repeat(64)), false);
  assert.throws(() => services.parseApacheManifestSha256(manifest, url.replace('2.4.69-261002', '2.4.68-260610')), /URL arsip Apache|Versi|Version|checksum|SHA-256/i);
  assert.throws(() => services.parseApacheManifestSha256(manifest.replace(sha, 'not-a-hash'), url), /SHA-256/i);
});

test('runtime downloads require HTTPS and an exact trusted host allowlist', () => {
  const { isAllowedHttpsUrl } = require('../services');
  assert.equal(isAllowedHttpsUrl('https://getcomposer.org/download/latest-stable/composer.phar', ['getcomposer.org']), true);
  assert.equal(isAllowedHttpsUrl('https://files.phpmyadmin.net/phpMyAdmin/5.2.3/phpMyAdmin.zip', ['files.phpmyadmin.net']), true);
  assert.equal(isAllowedHttpsUrl('https://www.apachelounge.com/download/VS18/binaries/httpd.zip', ['www.apachelounge.com', 'apachelounge.com']), true);
  assert.equal(isAllowedHttpsUrl('http://getcomposer.org/composer.phar', ['getcomposer.org']), false);
  assert.equal(isAllowedHttpsUrl('https://getcomposer.org.evil.example/composer.phar', ['getcomposer.org']), false);
  assert.equal(isAllowedHttpsUrl('https://evil.example/composer.phar', ['getcomposer.org']), false);
  assert.equal(isAllowedHttpsUrl('not a url', ['getcomposer.org']), false);
});

test('Apache virtual hosts deny unknown hostnames, disable broad overrides, and constrain symlinks', () => {
  const services = require('../services');
  const conf = services.projectVirtualHosts(8080);
  assert.match(conf, /ServerName sxl\.localhost[\s\S]*?Require all denied/);
  assert.match(conf, /Options -Indexes -FollowSymLinks -SymLinksIfOwnerMatch/);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sxl-secure-vhost-'));
  const phpProject = { slug: 'secure-app', path: path.join(projectRoot, 'secure-app'), type: 'php' };
  try {
    fs.mkdirSync(path.join(phpProject.path, 'public'), { recursive: true });
    fs.writeFileSync(path.join(phpProject.path, 'artisan'), '');
    fs.writeFileSync(path.join(phpProject.path, 'public', 'index.php'), '<?php');
    const php = services.renderPhpProjectVhost(phpProject, 8080, 9001);
    assert.match(php, /AllowOverride FileInfo/);
    assert.doesNotMatch(php, /AllowOverride All/);
    assert.match(php, /SymLinksIfOwnerMatch/);
    assert.match(php, /Require all denied/);
  } finally { fs.rmSync(projectRoot, { recursive: true, force: true }); }
});


test('database and runtime features are separated into lightweight accessible tabs', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  for (const tab of ['data-db-engine-tab="mariadb"', 'data-db-engine-tab="other"', 'data-db-subtab="runtime"', 'data-db-subtab="data"', 'data-db-subtab="sql"', 'data-extra-engine-tab="postgresql"', 'data-extra-engine-tab="sqlite"', 'data-service-tab="services"', 'data-service-tab="diagnostics"']) {
    assert.ok(html.includes(tab), `missing tab ${tab}`);
  }
  for (const panel of ['data-db-engine-panel="mariadb"', 'data-db-engine-panel="other"', 'data-db-subpanel="runtime"', 'data-db-subpanel="data"', 'data-db-subpanel="sql"', 'data-service-panel="services"', 'data-service-panel="diagnostics"', 'data-settings-panel="runtime-paths"']) {
    assert.ok(html.includes(panel), `missing panel ${panel}`);
  }
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'HTML ids must remain unique after wrapping the panels');
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /function setDatabaseEngine/);
  assert.match(app, /function setMariaDbTab/);
  assert.match(app, /function setServiceTab/);
});
