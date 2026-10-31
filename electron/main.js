'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { isTrustedAppUrl, isAllowedExternalUrl } = require('../lib/url-security');
const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');

app.setName('SINZ');
app.setPath('userData', path.join(app.getPath('appData'), 'SXL Localhost'));
app.setAppUserModelId('com.youtsin.sxl-localhost');

const supportsWindowsStartup = process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;

ipcMain.handle('desktop-startup:get', () => ({
  available: supportsWindowsStartup,
  enabled: supportsWindowsStartup && app.getLoginItemSettings().openAtLogin
}));
ipcMain.handle('desktop-startup:set', (_event, enabled) => {
  if (!supportsWindowsStartup) {
    throw new Error('Pengaturan startup Windows hanya tersedia di aplikasi desktop Windows yang sudah dipasang.');
  }
  if (typeof enabled !== 'boolean') throw new TypeError('Status startup harus berupa pilihan aktif/nonaktif.');
  app.setLoginItemSettings({ openAtLogin: enabled, path: app.getPath('exe') });
  const actual = app.getLoginItemSettings().openAtLogin;
  if (actual !== enabled) throw new Error('Windows tidak mengonfirmasi perubahan pengaturan startup.');
  return { enabled: actual };
});

let mainWindow = null;
let startupWindow = null;
let serverModule = null;
let isCleaning = false;
let serverUrl = null;
let sqlTerminalWindow = null;

ipcMain.handle('desktop-sql-terminal:open', async () => {
  if (!serverUrl) throw new Error('Server lokal SINZ belum siap. Coba buka terminal SQL lagi.');
  if (sqlTerminalWindow && !sqlTerminalWindow.isDestroyed()) {
    if (sqlTerminalWindow.isMinimized()) sqlTerminalWindow.restore();
    sqlTerminalWindow.focus();
    return { opened: true, reused: true };
  }

  const terminal = new BrowserWindow({
    title: 'Terminal SQL · SINZ',
    width: 1160,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    show: false,
    backgroundColor: '#f5f7fa',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  sqlTerminalWindow = terminal;
  terminal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  terminal.webContents.on('will-navigate', (event, rawUrl) => {
    if (!isTrustedAppUrl(rawUrl, serverUrl)) event.preventDefault();
  });
  terminal.webContents.on('will-redirect', (event, rawUrl) => {
    if (!isTrustedAppUrl(rawUrl, serverUrl)) event.preventDefault();
  });
  terminal.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  terminal.webContents.session.setPermissionCheckHandler(() => false);
  terminal.once('ready-to-show', () => terminal.show());
  terminal.once('closed', () => { if (sqlTerminalWindow === terminal) sqlTerminalWindow = null; });
  try {
    await terminal.loadURL(new URL('/sql-terminal.html', serverUrl).toString());
    return { opened: true, reused: false };
  } catch (error) {
    if (sqlTerminalWindow === terminal) sqlTerminalWindow = null;
    if (!terminal.isDestroyed()) terminal.close();
    throw new Error(`Jendela terminal SQL tidak dapat dibuka: ${error.message}`);
  }
});

async function showStartupSplash(message) {
  if (startupWindow && !startupWindow.isDestroyed()) return;
  startupWindow = new BrowserWindow({
    width: 470,
    height: 205,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    backgroundColor: '#f5f7fa',
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  const html = `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SINZ</title><style>
body{margin:0;background:#f5f7fa;color:#182433;font-family:Segoe UI,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}main{width:100%;padding:28px 34px;box-sizing:border-box}h1{font-size:21px;margin:0 0 8px}p{font-size:13px;line-height:1.55;color:#59697b;margin:0} .bar{height:4px;background:#e0e7f1;border-radius:4px;overflow:hidden;margin-top:20px}.bar span{display:block;width:42%;height:100%;background:#1769d2;border-radius:4px;animation:run 1.3s ease-in-out infinite alternate}@keyframes run{from{transform:translateX(-60%)}to{transform:translateX(180%)}}</style><main><h1>SINZ</h1><p id="message">${String(message).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</p><div class="bar"><span></span></div></main></html>`;
  await startupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  startupWindow.show();
}

function updateStartupSplash(message) {
  if (!startupWindow || startupWindow.isDestroyed()) return;
  startupWindow.webContents.executeJavaScript(
    `document.getElementById('message').textContent = ${JSON.stringify(String(message))};`
  ).catch(() => {});
}

function closeStartupSplash() {
  if (startupWindow && !startupWindow.isDestroyed()) startupWindow.close();
  startupWindow = null;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const appRoot = app.getAppPath();
      const dataRoot = app.getPath('userData');
      const runtimeRoot = path.join(dataRoot, 'runtime');
      fs.mkdirSync(runtimeRoot, { recursive: true });

      // The app bundle is read-only on macOS; databases and downloads live in user data.
      process.env.SXL_DESKTOP_APP = '1';
      process.env.SXL_APP_ROOT = appRoot;
      process.env.SXL_DATA_DIR = dataRoot;
      process.env.SXL_RUNTIME_PACKAGES_DIR = app.isPackaged
        ? path.join(process.resourcesPath, 'runtime-packages')
        : path.join(appRoot, 'runtime', 'packages');
      process.env.SXL_SHARING_PORT = process.env.SXL_SHARING_PORT || '0';
      process.env.SXL_INSTALL_SCRIPT_PATH = app.isPackaged
        ? path.join(process.resourcesPath, 'Install-SXL-MariaDB.ps1')
        : path.join(appRoot, 'Install-SXL-MariaDB.ps1');
      process.env.SXL_INSTALL_VERSION_SCRIPT_PATH = app.isPackaged
        ? path.join(process.resourcesPath, 'Install-SXL-MariaDB-Version.ps1')
        : path.join(appRoot, 'Install-SXL-MariaDB-Version.ps1');

      // Load the same database module instance that server.js will use and prepare
      // MariaDB before the UI opens. A pristine Windows x64 profile is installed
      // from the bundled, checksum-pinned ZIP with no network download required.
      const database = require(path.join(appRoot, 'database.js'));
      const firstRunDatabase = require(path.join(appRoot, 'lib', 'first-run-database.js'));
      const launchPlan = firstRunDatabase.getDatabaseLaunchPlan({
        database,
        dataRoot,
        platform: process.platform,
        arch: process.arch
      });

      if (launchPlan.action !== 'skip') {
        await showStartupSplash(launchPlan.message || 'Memeriksa runtime database lokal...');
        try {
          await firstRunDatabase.prepareDatabaseForLaunch({
            database,
            plan: launchPlan,
            onProgress: updateStartupSplash
          });
        } catch (bootstrapError) {
          database.recordBootstrapFailure?.(bootstrapError);
          console.error(`Penyiapan otomatis MariaDB gagal: ${bootstrapError?.stack || bootstrapError}`);
          updateStartupSplash('MariaDB belum siap. SINZ tetap dibuka agar status dan log dapat diperiksa.');
        }
      }

      serverModule = require(path.join(appRoot, 'server.js'));
      const server = await serverModule.startServer();
      serverUrl = server.url;
      await createWindow();
    } catch (error) {
      closeStartupSplash();
      await dialog.showMessageBox({
        type: 'error',
        title: 'SINZ gagal dijalankan',
        message: 'SINZ tidak dapat memulai server lokal.',
        detail: error?.stack || String(error),
        buttons: ['Keluar']
      });
      app.quit();
    }
  });

  async function createWindow() {
    if (!serverUrl) return;
    mainWindow = new BrowserWindow({
      title: 'SINZ',
      width: 1440,
      height: 960,
      minWidth: 960,
      minHeight: 700,
      show: false,
      backgroundColor: '#f5f7fa',
      icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, rawUrl) => {
      if (!isTrustedAppUrl(rawUrl, serverUrl)) {
        event.preventDefault();
        if (isAllowedExternalUrl(rawUrl)) shell.openExternal(rawUrl).catch(() => {});
      }
    });
    mainWindow.webContents.on('will-redirect', (event, rawUrl) => {
      if (!isTrustedAppUrl(rawUrl, serverUrl)) event.preventDefault();
    });
    mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    mainWindow.webContents.session.setPermissionCheckHandler(() => false);

    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.on('closed', () => { mainWindow = null; });
    await mainWindow.loadURL(serverUrl);
    closeStartupSplash();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(err => dialog.showErrorBox('SINZ', err.message));
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', event => {
    if (isCleaning || !serverModule) return;
    event.preventDefault();
    isCleaning = true;
    serverModule.shutdown({ exitProcess: false })
      .catch(() => {})
      .finally(() => app.quit());
  });
}
