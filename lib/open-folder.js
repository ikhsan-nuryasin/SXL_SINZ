'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

async function openFolder(folder, { platform = process.platform, spawnProcess = spawn } = {}) {
  const target = path.resolve(folder);
  let command;
  let args;
  if (platform === 'win32') {
    const windowsDirectory = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    command = path.join(windowsDirectory, 'explorer.exe');
    args = [target];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [target];
  } else {
    command = 'xdg-open';
    args = [target];
  }

  const child = spawnProcess(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  await new Promise((resolve, reject) => {
    child.once('error', error => reject(new Error(`Folder tidak dapat dibuka: ${error.message}`)));
    child.once('spawn', resolve);
  });
  child.unref();
  return target;
}

module.exports = { openFolder };
