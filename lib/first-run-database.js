'use strict';

// First-launch bootstrap for a fresh Windows x64 desktop install. It never
// relocates or repairs an existing database automatically. Existing explicit
// version selection is respected; only a truly fresh profile gets MariaDB 13.0.2.
const fs = require('node:fs');
const path = require('node:path');

const MARIADB_13_VERSION_ID = 'mariadb-13.0.2-winx64';

function getDatabaseLaunchPlan({ database, dataRoot, platform = process.platform, arch = process.arch }) {
  if (platform !== 'win32' || arch !== 'x64') {
    return { action: 'skip', reason: 'Bundled MariaDB 13.0.2 supports Windows x64 only.' };
  }
  const current = database.status();
  const allVersions = Array.isArray(current.versions) ? current.versions : database.versions();
  const modern = allVersions.find(item => item.id === MARIADB_13_VERSION_ID);
  const legacy = allVersions.find(item => item.id === 'mariadb-managed');
  if (!modern || !legacy) return { action: 'skip', reason: 'Database version inventory unavailable.' };

  const managerPath = path.join(path.resolve(dataRoot), 'runtime', 'mariadb', 'manager.json');
  const managerExists = fs.existsSync(managerPath);
  const archivePath = database.getBundledMariaDBArchivePath?.() || '';

  // Only first-run with no manager, no existing modern version, and no legacy
  // data/runtime is eligible for automatic installation.
  const pristineProfile = !managerExists && !modern.rootExists && !legacy.rootExists;
  if (pristineProfile) {
    return {
      action: 'install-and-start',
      versionId: MARIADB_13_VERSION_ID,
      archivePath,
      message: 'Menyiapkan MariaDB 13.0.2 untuk penggunaan pertama kali.'
    };
  }

  // An incomplete prior bootstrap is preserved in recovery before a new install.
  // The install script refuses to run if its configured port is still occupied,
  // and on failure restores the previous folder instead of deleting it.
  if (modern.rootExists && modern.healthState === 'partial' && archivePath && (!managerExists || current.versionId === MARIADB_13_VERSION_ID)) {
    return {
      action: 'repair-and-start',
      versionId: MARIADB_13_VERSION_ID,
      archivePath,
      message: 'Instalasi MariaDB parsial terdeteksi. Folder lama akan diamankan di recovery, tidak dihapus atau dipakai otomatis.'
    };
  }

  // If the user has previously selected the bundled version, start that exact
  // runtime on app launch. A partial installation is never auto-quarantined.
  if (current.versionId === MARIADB_13_VERSION_ID && modern.healthState === 'ready') {
    return {
      action: 'start',
      versionId: MARIADB_13_VERSION_ID,
      archivePath,
      message: 'Menyalakan MariaDB 13.0.2.'
    };
  }

  return { action: 'skip', reason: 'Existing database selection/runtime preserved.' };
}

async function prepareDatabaseForLaunch({ database, plan, onProgress = () => {} }) {
  if (!plan || plan.action === 'skip') return { ready: false, skipped: true, reason: plan?.reason || 'No bootstrap required.' };
  try {
    if (plan.action === 'install-and-start' || plan.action === 'repair-and-start') {
      if (!plan.archivePath) throw new Error('ZIP MariaDB bawaan tidak ditemukan. Paket aplikasi harus menyertakan runtime/packages/mariadb-13.0.2-winx64.zip.');
      onProgress('Memverifikasi paket MariaDB 13.0.2 dan menyiapkan data lokal...');
      await database.installVersionArchive({ archivePath: plan.archivePath, repairPartial: plan.action === 'repair-and-start' });
      database.selectVersion(MARIADB_13_VERSION_ID);
    }
    onProgress('Memulai server dan memverifikasi koneksi database...');
    await database.start();
    const status = database.status();
    if (status.versionId !== MARIADB_13_VERSION_ID || !status.initialized || !status.versionVerified || !status.running) {
      throw new Error('Server belum memenuhi pemeriksaan READY setelah startup. Instalasi tidak akan ditandai siap.');
    }
    onProgress('MariaDB 13.0.2 siap digunakan.');
    return { ready: true, installed: plan.action === 'install-and-start' || plan.action === 'repair-and-start', status };
  } catch (error) {
    database.recordBootstrapFailure?.(error);
    throw error;
  }
}

module.exports = { MARIADB_13_VERSION_ID, getDatabaseLaunchPlan, prepareDatabaseForLaunch };
