'use strict';

// Persistent selector and isolated filesystem layouts for SXL-managed database runtimes.
// The historical layout is deliberately kept in place for backward compatibility.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEGACY_VERSION_ID = 'mariadb-managed';
const MARIADB_13_VERSION_ID = 'mariadb-13.0.2-winx64';
const MARIADB_13_VERSION = '13.0.2';
const MARIADB_13_SHA256 = 'ba9cefd6674b3f2f7bc67334c05305dc7c919643d76836e10767e70db0b5fb74';

function createDatabaseVersionManager(dataRoot) {
  const root = path.join(path.resolve(dataRoot), 'runtime', 'mariadb');
  const versionsRoot = path.join(root, 'versions');
  const managerPath = path.join(root, 'manager.json');

  function getLayout(versionId = LEGACY_VERSION_ID) {
    if (versionId === LEGACY_VERSION_ID) {
      // Do not move these paths: pre-version-manager SXL installations use them.
      return {
        id: LEGACY_VERSION_ID,
        root,
        serverRoot: path.join(root, 'server'),
        data: path.join(root, 'data'),
        backups: path.join(root, 'backups'),
        settings: path.join(root, 'settings.json'),
        log: path.join(root, 'mariadbd.log'),
        ini: path.join(root, 'data', 'my.ini'),
        tmp: path.join(root, 'tmp'),
        pid: path.join(root, 'mariadbd.pid'),
        metadata: null
      };
    }
    if (versionId === MARIADB_13_VERSION_ID) {
      const versionRoot = path.join(versionsRoot, MARIADB_13_VERSION_ID);
      return {
        id: MARIADB_13_VERSION_ID,
        root: versionRoot,
        serverRoot: path.join(versionRoot, 'server'),
        data: path.join(versionRoot, 'data'),
        backups: path.join(versionRoot, 'backups'),
        settings: path.join(versionRoot, 'settings.json'),
        log: path.join(versionRoot, 'logs', 'mariadbd.log'),
        ini: path.join(versionRoot, 'config', 'my.ini'),
        tmp: path.join(versionRoot, 'tmp'),
        pid: path.join(versionRoot, 'mariadbd.pid'),
        metadata: path.join(versionRoot, 'version.json')
      };
    }
    throw new Error(`Versi database tidak dikenal: ${versionId}`);
  }

  function getState() {
    try {
      const raw = fs.readFileSync(managerPath, 'utf8').replace(/^\uFEFF/, '');
      const state = JSON.parse(raw);
      if (state && [LEGACY_VERSION_ID, MARIADB_13_VERSION_ID].includes(state.selectedVersionId)) return state;
    } catch {}
    return { schemaVersion: 1, selectedVersionId: LEGACY_VERSION_ID };
  }

  function getSelectedVersionId() {
    return getState().selectedVersionId;
  }

  function setSelectedVersionId(versionId) {
    if (![LEGACY_VERSION_ID, MARIADB_13_VERSION_ID].includes(versionId)) {
      throw new Error(`Versi database tidak dikenal: ${versionId}`);
    }
    fs.mkdirSync(root, { recursive: true });
    const temp = `${managerPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const payload = JSON.stringify({
      schemaVersion: 1,
      selectedVersionId: versionId,
      updatedAt: new Date().toISOString()
    }, null, 2) + '\n';
    fs.writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { fs.chmodSync(temp, 0o600); } catch {}
    try {
      fs.renameSync(temp, managerPath);
      try { fs.chmodSync(managerPath, 0o600); } catch {}
    } finally {
      try { fs.rmSync(temp, { force: true }); } catch {}
    }
    return getSelectedVersionId();
  }

  return { root, versionsRoot, managerPath, getLayout, getState, getSelectedVersionId, setSelectedVersionId };
}

module.exports = {
  createDatabaseVersionManager,
  LEGACY_VERSION_ID,
  MARIADB_13_VERSION_ID,
  MARIADB_13_VERSION,
  MARIADB_13_SHA256
};
