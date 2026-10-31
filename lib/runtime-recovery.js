'use strict';

// Safe directory quarantine/restore helpers. No operation recursively deletes data.
const fs = require('node:fs');
const path = require('node:path');

function assertOrdinaryDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} harus berupa direktori biasa, bukan symbolic link/reparse point.`);
}

function uniquePath(root, name) {
  let candidate = path.join(root, name);
  if (!fs.existsSync(candidate)) return candidate;
  for (let i = 1; i < 1000; i++) {
    candidate = path.join(root, `${name}-${i}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Tidak dapat menemukan nama folder recovery yang unik. Folder yang ada tidak diubah.');
}

function quarantineDirectory(targetRoot, recoveryRoot, label, timestamp, beforeMove) {
  if (!path.isAbsolute(targetRoot) || !path.isAbsolute(recoveryRoot)) throw new Error('Path recovery harus absolut.');
  assertOrdinaryDirectory(targetRoot, 'Folder sumber');
  fs.mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
  assertOrdinaryDirectory(recoveryRoot, 'Folder recovery');
  if (typeof beforeMove === 'function') beforeMove(targetRoot);
  const destination = uniquePath(recoveryRoot, `${label}-${timestamp}`);
  // Same-volume rename avoids copying and never merges with a pre-existing folder.
  fs.renameSync(targetRoot, destination);
  return destination;
}

function restoreQuarantinedDirectory(targetRoot, recoveryPath, recoveryRoot, failedLabel, timestamp, beforeMove) {
  if (!path.isAbsolute(targetRoot) || !path.isAbsolute(recoveryPath) || !path.isAbsolute(recoveryRoot)) {
    throw new Error('Path pemulihan harus absolut.');
  }
  if (!fs.existsSync(recoveryPath)) throw new Error(`Folder recovery tidak ditemukan: ${recoveryPath}`);
  assertOrdinaryDirectory(recoveryPath, 'Folder recovery');
  let failedCandidate = null;
  if (fs.existsSync(targetRoot)) {
    assertOrdinaryDirectory(targetRoot, 'Folder hasil percobaan');
    if (typeof beforeMove === 'function') beforeMove(targetRoot);
    failedCandidate = uniquePath(recoveryRoot, `${failedLabel}-${timestamp}`);
    fs.renameSync(targetRoot, failedCandidate);
  }
  if (fs.existsSync(targetRoot)) throw new Error(`Target pemulihan masih ada; tidak menimpa: ${targetRoot}`);
  fs.renameSync(recoveryPath, targetRoot);
  return failedCandidate;
}

module.exports = { quarantineDirectory, restoreQuarantinedDirectory };
