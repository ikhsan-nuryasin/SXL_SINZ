'use strict';

const CATALOG = [
  { id: 'php', name: 'PHP Runtime', category: 'php', description: 'Runtime PHP yang dikelola SINZ untuk menjalankan proyek dan Composer.', website: 'https://www.php.net/downloads.php', packageType: 'Arsip runtime', installSupported: true },
  { id: 'composer', name: 'Composer', category: 'php', description: 'Pengelola dependensi PHP; SINZ memverifikasi checksum resmi saat memasang PHAR.', website: 'https://getcomposer.org/download/', packageType: 'PHAR terverifikasi', installSupported: true },
  { id: 'laravel', name: 'Laravel', category: 'frameworks', description: 'Buat proyek Laravel baru melalui Composer dan metadata paket stabil.', website: 'https://laravel.com/docs/installation', packageType: 'Paket proyek', installSupported: false, projectWizardSupported: true },
  { id: 'mariadb', name: 'MariaDB', category: 'database', description: 'Server MariaDB lokal yang dikelola SINZ dengan data terpisah.', website: 'https://mariadb.org/download/', packageType: 'Arsip runtime', installSupported: true },
  { id: 'postgresql', name: 'PostgreSQL', category: 'database', description: 'Server PostgreSQL; unduh installer Windows dari distribusi resmi yang direkomendasikan proyek.', website: 'https://www.postgresql.org/download/windows/', packageType: 'Installer resmi', installSupported: false },
  { id: 'mysql', name: 'MySQL', category: 'database', description: 'Server MySQL resmi; pengelolaan runtime MySQL belum tersedia di SINZ.', website: 'https://dev.mysql.com/downloads/installer/', packageType: 'Installer resmi', installSupported: false },
  { id: 'sqlite', name: 'SQLite Tools', category: 'database', description: 'Utilitas command-line SQLite resmi untuk pengelolaan file database.', website: 'https://sqlite.org/download.html', packageType: 'Arsip portabel', installSupported: false },
  { id: 'node', name: 'Node.js', category: 'frontend', description: 'Runtime JavaScript untuk proyek Node.js dan tooling frontend.', website: 'https://nodejs.org/en/download', packageType: 'Installer / arsip', installSupported: false },
  { id: 'bun', name: 'Bun', category: 'frontend', description: 'Runtime dan package manager JavaScript dengan distribusi Windows resmi.', website: 'https://bun.sh/docs/installation', packageType: 'Installer resmi', installSupported: false },
  { id: 'git', name: 'Git for Windows', category: 'tools', description: 'Version control untuk proyek dan integrasi GitHub.', website: 'https://git-scm.com/download/win', packageType: 'Installer resmi', installSupported: false },
  { id: 'vscode', name: 'Visual Studio Code', category: 'tools', description: 'Editor kode lintas platform dari Microsoft.', website: 'https://code.visualstudio.com/Download', packageType: 'Installer resmi', installSupported: false },
  { id: 'apache', name: 'Apache HTTP Server', category: 'webserver', description: 'Web server yang dapat dipasang dan diverifikasi melalui SINZ.', website: 'https://httpd.apache.org/download.cgi', packageType: 'Arsip runtime', installSupported: true },
  { id: 'nginx', name: 'Nginx', category: 'webserver', description: 'Web server dengan distribusi Windows resmi; belum dikelola sebagai runtime SINZ.', website: 'https://nginx.org/en/download.html', packageType: 'Arsip portabel', installSupported: false },
  { id: 'redis', name: 'Redis untuk Windows', category: 'database', description: 'Redis tidak menyediakan server Windows native yang didukung proyek; pilih distribusi resmi yang kompatibel atau gunakan WSL.', website: 'https://redis.io/downloads/', packageType: 'Tidak didukung langsung', installSupported: false }
];

function getCatalog(statuses = {}, options = {}) {
  const platform = options.platform || process.platform;
  return CATALOG.map(item => {
    const detected = statuses[item.id] || {};
    const installed = detected.installed === true;
    const installSupported = item.installSupported
      && (item.id !== 'php' || ['win32', 'darwin'].includes(platform))
      && (item.id !== 'apache' || options.apacheSupported !== false)
      && (item.id !== 'mariadb' || options.mariadbSupported !== false);
    const projectWizardSupported = item.projectWizardSupported === true;
    return {
      ...item,
      installSupported,
      version: installed && detected.version ? String(detected.version) : detected.latestVersion ? String(detected.latestVersion) : null,
      versionLabel: installed && detected.version ? `Lokal: ${detected.version}` : detected.latestVersion ? `Stable terbaru terverifikasi: ${detected.latestVersion}` : 'Versi terbaru: periksa sumber resmi',
      localPath: installed && detected.path ? String(detected.path) : null,
      status: installed ? 'Installed' : installSupported || projectWizardSupported ? 'Not Installed' : 'Unsupported',
      statusDetail: installed ? 'Terdeteksi dan berhasil diverifikasi di perangkat ini.' : installSupported ? 'Pemasangan terkelola tersedia melalui SINZ.' : projectWizardSupported ? 'Pembuatan proyek tersedia melalui New Project Wizard.' : 'SINZ belum memasang atau memverifikasi paket ini secara otomatis.',
      action: installed ? 'Verify Installation' : installSupported ? 'Download & Install' : projectWizardSupported ? 'Create Project' : 'Open Website'
    };
  });
}

function getInstallAction(id) {
  return CATALOG.find(item => item.id === id && item.installSupported) || null;
}

module.exports = { CATALOG, getCatalog, getInstallAction };
