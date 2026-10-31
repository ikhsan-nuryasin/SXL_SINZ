'use strict';
const $ = id => document.getElementById(id);
let lastStatus = null;
let refreshTimer = null;

async function api(path, options = {}) {
  const csrfToken = document.querySelector('meta[name="sxl-csrf"]')?.content || '';
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if ((options.method || 'GET').toUpperCase() !== 'GET') headers['X-SXL-CSRF'] = csrfToken;
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request gagal (${response.status})`);
  return data;
}

let globalToastTimer = null;
function showGlobalToast(message, isError = false) {
  const toast = $('globalToast');
  if (!toast) return;
  toast.textContent = String(message || 'Selesai.');
  toast.classList.toggle('is-error', Boolean(isError));
  toast.hidden = false;
  if (globalToastTimer) window.clearTimeout(globalToastTimer);
  globalToastTimer = window.setTimeout(() => { toast.hidden = true; }, isError ? 7000 : 4200);
}

async function launchStandaloneTerminal() {
  const button = $('launchTerminalApp');
  if (!button || button.disabled) return;
  const original = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-launching');
  try {
    const result = await api('/api/projects/open-workspace-terminal', { method: 'POST', body: '{}' });
    showGlobalToast(`Terminal dibuka di aplikasi terpisah. Folder: ${result.path || 'workspace SINZ'}`);
    setServiceMessage('projectMessage', result.message || 'Terminal terpisah dibuka.');
  } catch (error) {
    showGlobalToast(`Terminal tidak dapat dibuka: ${error.message}`, true);
    setServiceMessage('projectMessage', error.message, true);
  } finally {
    button.disabled = false;
    button.classList.remove('is-launching');
    // Keep the accessible inner markup stable even after repeated clicks.
    if (button.innerHTML !== original && !button.querySelector('.app-launch-copy')) button.innerHTML = original;
  }
}

async function launchPhpMyAdminStandalone() {
  const button = $('launchPhpMyAdminWeb');
  if (!button || button.disabled) return;
  button.disabled = true;
  button.classList.add('is-launching');
  const originalStrong = button.querySelector('.app-launch-copy strong')?.textContent || 'phpMyAdmin';
  const label = button.querySelector('.app-launch-copy strong');
  if (label) label.textContent = 'Menyiapkan…';
  try {
    let status = await api('/api/services/status');
    let pma = status.phpMyAdmin || {};
    if (!pma.installed) {
      const approved = await askConfirm('phpMyAdmin belum terpasang. SINZ akan mengunduh versi resmi, memeriksa SHA-256, lalu memasangnya untuk penggunaan lokal. Lanjutkan?', 'Pasang phpMyAdmin', 'Unduh & pasang');
      if (!approved) return;
      showGlobalToast('Mengunduh dan memasang phpMyAdmin…');
      await api('/api/services/phpmyadmin/install', { method: 'POST', body: '{}' });
      status = await api('/api/services/status');
      pma = status.phpMyAdmin || {};
      if (!pma.installed) throw new Error('Pemasangan selesai tetapi file index.php belum ditemukan. Buka Web & Runtime → Diagnostik.');
    }
    if (!pma.running) {
      showGlobalToast('Menjalankan web phpMyAdmin…');
      await api('/api/services/phpmyadmin/start', { method: 'POST', body: '{}' });
    }
    status = await api('/api/services/status');
    pma = status.phpMyAdmin || pma;
    const opened = await api('/api/services/phpmyadmin/open', { method: 'POST', body: '{}' });
    await refreshServices();
    showGlobalToast(`phpMyAdmin dibuka di browser terpisah. ${pma.url || opened.message || ''}`.trim());
    setServiceMessage('pmaMessage', opened.message || 'phpMyAdmin dibuka di browser default.');
  } catch (error) {
    showGlobalToast(`phpMyAdmin tidak dapat dibuka: ${error.message}`, true);
    setServiceMessage('pmaMessage', error.message, true);
    await refreshServices();
  } finally {
    button.disabled = false;
    button.classList.remove('is-launching');
    const strong = button.querySelector('.app-launch-copy strong');
    if (strong) strong.textContent = originalStrong;
  }
}

$('launchTerminalApp')?.addEventListener('click', launchStandaloneTerminal);
$('launchPhpMyAdminWeb')?.addEventListener('click', launchPhpMyAdminStandalone);

async function launchSqlTerminal() {
  try {
    if (window.sxlDesktop && typeof window.sxlDesktop.openSqlTerminal === 'function') {
      await window.sxlDesktop.openSqlTerminal();
    } else {
      window.open('/sql-terminal.html', '_blank', 'noopener,noreferrer');
    }
  } catch (error) {
    showGlobalToast(`SQL terminal tidak dapat dibuka: ${error.message}`, true);
  }
}
$('launchSqlTerminal')?.addEventListener('click', launchSqlTerminal);

function setAppDirectoryMessage(message, isError = false) {
  const node = $('appDirectoryMessage');
  if (node) { node.textContent = message || ''; node.style.color = isError ? 'var(--bad)' : 'var(--muted)'; }
}
function renderApps(apps) {
  const host = $('appDirectoryList');
  if (!host) return;
  host.replaceChildren();
  if (!apps.length) {
    const empty = document.createElement('div'); empty.className = 'db-result-empty';
    empty.textContent = 'Belum ada aplikasi terdaftar. Tambahkan executable lokal di atas.'; host.appendChild(empty); return;
  }
  for (const app of apps) {
    const row = document.createElement('article'); row.className = 'registered-app-row';
    const info = document.createElement('div'); info.className = 'registered-app-info';
    const title = document.createElement('strong'); title.textContent = app.name || 'Aplikasi';
    const path = document.createElement('small'); path.textContent = [app.category, app.executable, app.workingDirectory].filter(Boolean).join(' | ');
    info.append(title, path);
    const actions = document.createElement('div'); actions.className = 'project-actions';
    const launch = document.createElement('button'); launch.type = 'button'; launch.className = 'btn'; launch.textContent = 'Jalankan';
    launch.addEventListener('click', async () => {
      launch.disabled = true;
      try { const result = await api(`/api/apps/${encodeURIComponent(app.id)}/launch`, { method: 'POST', body: '{}' }); setAppDirectoryMessage(result.message || `${app.name} berhasil dijalankan.`); showGlobalToast(result.message || `${app.name} berhasil dijalankan.`); }
      catch (error) { setAppDirectoryMessage(error.message, true); showGlobalToast(`Aplikasi tidak dapat dijalankan: ${error.message}`, true); }
      finally { launch.disabled = false; }
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn danger'; remove.textContent = 'Hapus';
    remove.addEventListener('click', async () => {
      if (!await askConfirm(`Hapus ${app.name} dari direktori aplikasi SINZ? Ini tidak menghapus aplikasinya dari perangkat.`,'Hapus aplikasi','Hapus dari daftar')) return;
      remove.disabled = true;
      try { const result = await api(`/api/apps/${encodeURIComponent(app.id)}`, { method: 'DELETE' }); setAppDirectoryMessage(result.message || `${app.name} dihapus dari daftar.`); await loadApps(); }
      catch (error) { setAppDirectoryMessage(error.message, true); }
      finally { remove.disabled = false; }
    });
    actions.append(launch, remove); row.append(info, actions); host.appendChild(row);
  }
}
async function loadApps() {
  const host = $('appDirectoryList');
  if (!host) return;
  try { const result = await api('/api/apps'); renderApps(Array.isArray(result.apps) ? result.apps : []); }
  catch (error) { renderApps([]); setAppDirectoryMessage(`Direktori aplikasi tidak dapat dimuat: ${error.message}`, true); }
}
let downloadCatalogItems = [];
let downloadFilter = 'all';
let downloadActivities = [];
function renderDownloadHistory() {
  const host = $('downloadHistoryList');
  if (!host) return;
  host.replaceChildren();
  if (!downloadActivities.length) {
    const empty = document.createElement('div'); empty.className = 'db-result-empty'; empty.textContent = 'Belum ada aktivitas pada sesi ini.'; host.appendChild(empty); return;
  }
  for (const activity of [...downloadActivities].reverse()) {
    const row = document.createElement('article'); row.className = 'download-history-row';
    const title = document.createElement('strong'); title.textContent = activity.name;
    const detail = document.createElement('small'); detail.textContent = `${activity.status} · ${activity.time}${activity.message ? ` · ${activity.message}` : ''}`;
    row.append(title, detail); host.appendChild(row);
  }
}
function addDownloadActivity(item, status, message = '') {
  downloadActivities.push({ name: item.name, status, message, time: new Date().toLocaleString() });
  if (downloadActivities.length > 30) downloadActivities.shift();
  renderDownloadHistory();
}
function downloadCategoryName(category) {
  return ({ php: 'PHP Development', database: 'Database', frontend: 'JavaScript & Frontend', tools: 'Development Tools', webserver: 'Web Server', frameworks: 'Framework & Project Tools' })[category] || category;
}
function renderDownloadDetails(item) {
  const title = $('downloadDetailsTitle');
  const host = $('downloadDetailsContent');
  if (!title || !host) return;
  title.textContent = item.name;
  host.replaceChildren();
  const details = [
    ['Deskripsi', item.description],
    ['Kategori', downloadCategoryName(item.category)],
    ['Versi terverifikasi', item.versionLabel || 'Belum terpasang atau versinya tidak tersedia'],
    ['Jenis paket', item.packageType],
    ['Status', `${item.status}. ${item.statusDetail}`],
    ['Lokasi', item.localPath || 'Belum terdeteksi'],
    ['Sumber resmi', item.website],
    ['Pemeriksaan', item.installSupported ? 'SINZ mendukung pemasangan terkelola dan verifikasi lokal.' : 'Pemasangan dari SINZ belum didukung; gunakan situs resmi untuk instruksi dan paket yang sesuai.']
  ];
  for (const [label, value] of details) {
    const section = document.createElement('div'); section.className = 'download-detail-row';
    const heading = document.createElement('strong'); heading.textContent = label;
    const text = document.createElement('p'); text.textContent = value || 'Tidak tersedia';
    section.append(heading, text); host.appendChild(section);
  }
  const source = document.createElement('a'); source.href = item.website; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 'Buka sumber resmi';
  host.appendChild(source);
  $('downloadDetailsDialog').showModal();
}
function renderDownloadCatalog() {
  const host = $('downloadCatalogList');
  if (!host) return;
  const search = ($('downloadSearch')?.value || '').trim().toLowerCase();
  const items = downloadCatalogItems.filter(item => (downloadFilter === 'all' || item.category === downloadFilter)
    && (!search || `${item.name} ${item.description} ${downloadCategoryName(item.category)}`.toLowerCase().includes(search)));
  host.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'db-result-empty'; empty.textContent = 'Tidak ada software yang cocok dengan pencarian ini.'; host.appendChild(empty); return;
  }
  for (const item of items) {
    const card = document.createElement('article'); card.className = 'download-card';
    const top = document.createElement('div'); top.className = 'download-card-top';
    const logo = document.createElement('span'); logo.className = 'download-logo'; logo.textContent = item.name.slice(0, 2).toUpperCase(); logo.setAttribute('aria-hidden', 'true');
    const status = document.createElement('span'); status.className = `download-status ${item.status === 'Installed' ? 'is-installed' : item.status === 'Unsupported' ? 'is-unsupported' : 'is-not-installed'}`; status.textContent = item.status;
    top.append(logo, status);
    const heading = document.createElement('h3'); heading.textContent = item.name;
    const category = document.createElement('small'); category.className = 'download-category'; category.textContent = downloadCategoryName(item.category);
    const description = document.createElement('p'); description.textContent = item.description;
    const version = document.createElement('div'); version.className = 'download-version'; version.textContent = item.versionLabel || 'Versi terbaru: periksa sumber resmi';
    const actions = document.createElement('div'); actions.className = 'download-card-actions';
    const details = document.createElement('button'); details.type = 'button'; details.className = 'btn secondary'; details.textContent = 'Detail'; details.addEventListener('click', () => renderDownloadDetails(item));
    actions.appendChild(details);
    if (item.projectWizardSupported) {
      const create = document.createElement('button'); create.type = 'button'; create.className = 'btn'; create.textContent = 'Buat Proyek'; create.addEventListener('click', () => {
        navigateSxlPage('projects');
        $('projectCreate').click();
        $('projectType').value = 'laravel';
        checkProjectWizardDependencies();
      }); actions.appendChild(create);
    } else if (item.installSupported && item.status !== 'Installed') {
      const install = document.createElement('button'); install.type = 'button'; install.className = 'btn'; install.textContent = item.action; install.addEventListener('click', () => installDownloadItem(item, install)); actions.appendChild(install);
    } else if (item.status === 'Installed') {
      const verify = document.createElement('button'); verify.type = 'button'; verify.className = 'btn secondary'; verify.textContent = 'Verifikasi'; verify.addEventListener('click', () => loadDownloadCatalog(true)); actions.appendChild(verify);
    } else {
      const source = document.createElement('a'); source.className = 'btn secondary download-source'; source.href = item.website; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 'Sumber resmi'; actions.appendChild(source);
    }
    const note = document.createElement('small'); note.className = 'download-status-detail'; note.textContent = item.statusDetail;
    card.append(top, heading, category, description, version, note, actions); host.appendChild(card);
  }
}
async function loadDownloadCatalog(quiet = false) {
  const message = $('downloadCatalogMessage');
  const refresh = $('downloadRefresh');
  if (refresh) refresh.disabled = true;
  if (message && !quiet) message.textContent = 'Memeriksa instalasi lokal…';
  try {
    const result = await api('/api/download-center/catalog');
    downloadCatalogItems = Array.isArray(result.items) ? result.items : [];
    renderDownloadCatalog();
    const warnings = Array.isArray(result.metadataWarnings) ? result.metadataWarnings.join(' ') : '';
    if (message) message.textContent = `Status lokal diperiksa ${result.checkedAt ? new Date(result.checkedAt).toLocaleString() : 'sekarang'}. Versi tanpa metadata terverifikasi tidak diberi label terbaru.${warnings ? ` ${warnings}` : ''}`;
  } catch (error) {
    if (message) message.textContent = `Katalog gagal diperiksa: ${error.message}`;
    showGlobalToast(`Download Center gagal dimuat: ${error.message}`, true);
  } finally { if (refresh) refresh.disabled = false; }
}
async function installDownloadItem(item, button) {
  if (!await askConfirm(`SINZ akan memasang ${item.name} melalui mekanisme terkelola dan memverifikasi hasilnya. Pemasangan memerlukan koneksi internet. Lanjutkan?`, `Pasang ${item.name}`, 'Download & Install')) return;
  button.disabled = true;
  button.textContent = 'Installing…';
  addDownloadActivity(item, 'Installing', 'Progres unduhan tidak disediakan oleh installer ini.');
  try {
    const result = await api('/api/download-center/install', { method: 'POST', body: JSON.stringify({ id: item.id }) });
    addDownloadActivity(item, 'Installed', result.message || 'Paket telah diverifikasi.');
    showGlobalToast(result.message || `${item.name} berhasil diverifikasi.`);
    await loadDownloadCatalog(true);
  } catch (error) {
    addDownloadActivity(item, 'Error', error.message);
    showGlobalToast(`${item.name} gagal dipasang: ${error.message}`, true);
    if ($('downloadCatalogMessage')) $('downloadCatalogMessage').textContent = error.message;
  } finally { button.disabled = false; button.textContent = item.action; }
}
document.querySelectorAll('[data-download-filter]').forEach(button => button.addEventListener('click', () => {
  downloadFilter = button.dataset.downloadFilter;
  document.querySelectorAll('[data-download-filter]').forEach(filter => filter.classList.toggle('active', filter === button));
  renderDownloadCatalog();
}));
$('downloadSearch')?.addEventListener('input', renderDownloadCatalog);
$('downloadRefresh')?.addEventListener('click', () => loadDownloadCatalog());
$('downloadHistoryClear')?.addEventListener('click', () => { downloadActivities = []; renderDownloadHistory(); });
$('closeDownloadDetails')?.addEventListener('click', () => $('downloadDetailsDialog').close());
$('appAddForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('appName').value.trim();
  const category = $('appCategory').value;
  const executable = $('appExecutable').value.trim();
  const workingDirectory = $('appWorkingDirectory').value.trim();
  if (!name || !category || !executable || !workingDirectory) { setAppDirectoryMessage('Nama, kategori, path executable, dan working directory wajib diisi.', true); return; }
  const args = $('appArgs').value.split(/\r?\n/).map(argument => argument.trim()).filter(Boolean);
  const button = $('appAddSubmit'); button.disabled = true; setAppDirectoryMessage('Menyimpan aplikasi...');
  try {
    const result = await api('/api/apps', { method: 'POST', body: JSON.stringify({ name, category, executable, args, workingDirectory }) });
    $('appAddForm').reset();
    await loadApps();
    $('appAddDialog').close();
    showGlobalToast(result.message || 'Aplikasi ditambahkan.');
  } catch (error) { setAppDirectoryMessage(error.message, true); }
  finally { button.disabled = false; }
});
$('appDirectoryRefresh')?.addEventListener('click', loadApps);
$('openAppAddDialog')?.addEventListener('click', () => {
  setAppDirectoryMessage('');
  $('appAddDialog').showModal();
  $('appName').focus();
});
$('closeAppAddDialog')?.addEventListener('click', () => $('appAddDialog').close());
$('cancelAppAddDialog')?.addEventListener('click', () => $('appAddDialog').close());
loadApps();

function setError(message) {
  $('error').textContent = message || '';
  $('error').hidden = !message;
}

function askConfirm(message, title = 'Konfirmasi tindakan', acceptLabel = 'Ya, lanjutkan') {
  const dialog = $('confirmDialog');
  if (!dialog || typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(message));
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = String(message || 'Pastikan tindakan ini memang ingin dilakukan.');
  $('confirmAccept').textContent = acceptLabel;
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
    $('confirmCancel').focus();
  });
}

function render(s) {
  lastStatus = s;
  const active = Boolean(s.sharing);
  const starting = Boolean(s.tunnelStarting);
  $('dot').className = `dot ${active ? 'good' : starting ? 'warn' : ''}`;
  const protectionLabels = { public: 'tanpa autentikasi', password: 'dilindungi kata sandi SINZ', email: 'dibatasi email Cloudflare', 'email+password': 'dilindungi email + kata sandi SINZ' };
  $('statusText').textContent = active ? `Sharing aktif · ${protectionLabels[s.protectionMode] || (s.accessProtected ? 'dilindungi akses' : 'tanpa autentikasi')}` : starting ? 'Menghubungkan tunnel…' : 'Tidak sedang sharing';
  $('start').disabled = active || starting;
  $('browse').disabled = active || starting;
  $('folder').disabled = active || starting;
  if ($('sharePassword')) $('sharePassword').disabled = active || starting;
  if ($('shareAllowedEmails')) $('shareAllowedEmails').disabled = active || starting;
  if ($('toggleSharePassword')) $('toggleSharePassword').disabled = active || starting;
  $('stop').disabled = !active && !starting && !s.previewUrl;
  $('publicUrl').replaceChildren();
  if (s.publicUrl) {
    const a = document.createElement('a');
    a.href = s.publicUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = s.publicUrl;
    $('publicUrl').appendChild(a);
  } else {
    $('publicUrl').textContent = starting ? 'Menunggu URL dari Cloudflare…' : 'Belum ada URL publik.';
  }
  $('copy').disabled = !s.publicUrl;
  $('previewUrl').textContent = s.previewUrl || '—';
  $('port').textContent = s.previewPort || '—';
  $('root').textContent = s.previewRoot || '—';
  if ($('previewType')) $('previewType').textContent = s.previewType || '—';
  $('started').textContent = s.startedAt ? new Date(s.startedAt).toLocaleString() : '—';
  if ($('tunnelLog')) $('tunnelLog').textContent = s.tunnelLog || 'Belum ada log.';
  if (s.lastError) setError(s.lastError);
}

async function refresh() {
  try {
    render(await api('/api/status'));
  } catch (e) {
    setError(`${e.message}. Pastikan server SINZ masih berjalan.`);
  }
}

$('browse').addEventListener('click', async () => {
  setError('');
  $('browse').disabled = true;
  $('browse').textContent = 'Membuka…';
  try {
    const result = await api('/api/browse', { method: 'POST', body: '{}' });
    if (result.folder) $('folder').value = result.folder;
  } catch (e) {
    setError(e.message);
  } finally {
    $('browse').textContent = 'Pilih Folder';
    $('browse').disabled = Boolean(lastStatus?.sharing || lastStatus?.tunnelStarting);
  }
});

$('start').addEventListener('click', async () => {
  setError('');
  $('start').disabled = true;
  try {
    const runtimeType = $('runtimeType')?.value || 'static';
    let installDependencies = false;
    if (runtimeType === 'php' || runtimeType === 'node') {
      const warning = runtimeType === 'node'
        ? 'Mode Node.js akan menjalankan kode proyek dan, bila node_modules belum ada, memasang dependensi npm yang dapat menjalankan skrip pihak ketiga. Lanjutkan hanya untuk proyek tepercaya. Setelah aktif, aplikasi dapat diakses publik melalui URL tunnel.'
        : 'Mode PHP akan menjalankan kode PHP/Laravel yang dipilih dan mengekspos aplikasi tersebut ke internet melalui URL tunnel. Pastikan file rahasia tidak berada di document root dan hanya lanjutkan untuk proyek tepercaya.';
      if (!await askConfirm(warning)) return;
      installDependencies = runtimeType === 'node';
    }
    const accessPassword = $('sharePassword')?.value || '';
    const allowedEmails = ($('shareAllowedEmails')?.value || '').split(/[\r\n,;]+/).map(value => value.trim()).filter(Boolean);
    let confirmPublicAccess = false;
    if (accessPassword && accessPassword.length < 10) throw new Error('Kata sandi sharing minimal 10 karakter.');
    if (allowedEmails.length && !await askConfirm('Cloudflare akan meminta OTP email bagi pengunjung. Email dibatasi maksimal 20 alamat dan memerlukan cloudflared 2026.10.4 atau yang lebih baru. Lanjutkan?')) return;
    if (accessPassword && !await askConfirm('Website publik akan meminta username sxl dan kata sandi. Bagikan kata sandi hanya kepada orang tepercaya. Lanjutkan?')) return;
    if (!accessPassword && !allowedEmails.length) {
      const confirmed = await askConfirm('PERINGATAN: siapa pun yang memiliki URL trycloudflare.com dapat membuka website ini. Jangan gunakan untuk dashboard admin, data pribadi, atau kredensial. Lanjutkan tanpa autentikasi?');
      if (!confirmed) return;
      confirmPublicAccess = true;
    }
    await api('/api/start', { method: 'POST', body: JSON.stringify({ folder: $('folder').value, runtimeType, installDependencies, accessPassword, allowedEmails, confirmPublicAccess }) });
    await refresh();
    await refreshRuntimeStatus();
  } catch (e) {
    setError(e.message);
    await refreshRuntimeStatus();
  } finally {
    $('start').disabled = Boolean(lastStatus?.sharing || lastStatus?.tunnelStarting);
  }
  window.setTimeout(refresh, 500);
});

$('toggleSharePassword')?.addEventListener('click', () => {
  const field = $('sharePassword'); const button = $('toggleSharePassword');
  if (!field || !button) return;
  const reveal = field.type === 'password';
  field.type = reveal ? 'text' : 'password';
  button.textContent = reveal ? 'Sembunyikan' : 'Tampilkan';
  button.setAttribute('aria-pressed', String(reveal));
});

$('stop').addEventListener('click', async () => {
  setError('');
  $('stop').disabled = true;
  try {
    await api('/api/stop', { method: 'POST', body: '{}' });
    await refresh();
  } catch (e) {
    setError(e.message);
  }
});

$('copy').addEventListener('click', async () => {
  if (!lastStatus?.publicUrl) return;
  try {
    await navigator.clipboard.writeText(lastStatus.publicUrl);
    $('copy').textContent = 'URL tersalin';
    window.setTimeout(() => $('copy').textContent = 'Salin URL', 1600);
  } catch {
    setError('Clipboard tidak tersedia. Klik URL lalu salin secara manual.');
  }
});

refresh();
refreshTimer = window.setInterval(refresh, 1500);
window.addEventListener('pagehide', () => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});

function updateRuntimeHint() {
  const hints = {
    static: 'Mode statis hanya membagikan file publik. Untuk React/Vue, pilih folder dist/build yang memiliki index.html.',
    php: 'Mode sharing PHP mendukung aplikasi PHP/Laravel tepercaya. Untuk alamat project lokal .localhost, jalankan project dari Project Manager agar SINZ mengonfigurasikan Apache + PHP-CGI FastCGI.',
    node: 'SINZ memakai Node.js sistem yang kompatibel jika sudah terpasang. Jika tidak tersedia, SINZ mengunduh Node.js LTS dan memverifikasi checksum. package.json harus memiliki scripts.start; bila node_modules belum ada, SINZ meminta izin sebelum npm install.'
  };
  $('runtimeHint').textContent = hints[$('runtimeType').value] || hints.static;
}
async function refreshRuntimeStatus() {
  try {
    const s = await api('/api/runtime/status');
    const nodeText = s.node.portableInstalled ? `Node.js ${s.node.version} portable siap` : s.node.systemAvailable ? 'Node.js sistem terdeteksi; versi dan npm akan diverifikasi saat runtime dijalankan' : `Node.js ${s.node.version} akan diunduh dan diverifikasi saat mode Node dipilih`;
    const phpText = s.php.available
      ? `PHP tersedia (${s.php.portableInstalled ? 'portable SINZ' : 'sistem'}).`
      : (s.platform === 'win32' ? 'PHP portable akan disiapkan otomatis pada mode PHP.' : 'PHP belum ditemukan; macOS memerlukan PHP dari Homebrew atau SXL_PHP_PATH.');
    $('runtimeAvailability').textContent = `${nodeText}. ${phpText}`;
  } catch (e) { $('runtimeAvailability').textContent = `Status runtime belum tersedia: ${e.message}`; }
}
$('runtimeType').addEventListener('change', updateRuntimeHint);
updateRuntimeHint();
refreshRuntimeStatus();

let databaseStatus = null;
let databaseBusy = false;
let credentialsVisible = false;
let dbRefreshTimer = null;

function setDbError(message) {
  const node = $('dbQueryError');
  node.textContent = message || '';
  node.hidden = !message;
}

function renderDbStatus(s) {
  databaseStatus = s;
  const supported = Boolean(s.supported);
  const versions = Array.isArray(s.versions) ? s.versions : [];
  const active = versions.find(v => v.id === s.versionId) || null;
  const legacy = versions.find(v => v.id === 'mariadb-managed') || null;
  const mariadb13 = versions.find(v => v.id === 'mariadb-13.0.2-winx64') || null;
  const installed = Boolean(s.installed && s.initialized);
  const legacyInstalled = Boolean(legacy?.installed && legacy?.initialized);
  const legacyNeedsRepair = Boolean(legacy?.repairable);
  const running = Boolean(s.running);
  $('dbDot').className = `dot ${running ? 'good' : s.repairable ? 'bad' : installed ? 'warn' : ''}`;
  $('dbStatusText').textContent = !supported ? 'Database otomatis tidak didukung di sistem ini' : running ? `${s.version || 'MariaDB'} aktif` : s.repairable ? 'Instalasi parsial · perlu pemulihan' : installed ? `${s.version || 'MariaDB'} terpasang, berhenti` : 'Runtime database belum siap';
  $('dbVersion').textContent = s.version || '—';
  $('dbHost').textContent = s.host || '127.0.0.1';
  $('dbPort').textContent = s.port || 3307;
  $('dbDataDir').textContent = s.dataDirectory || 'runtime/mariadb/data';
  $('dbInstall').disabled = !supported || databaseBusy || legacyInstalled;
  $('dbInstall').textContent = databaseBusy ? 'Memproses…' : legacyInstalled ? (legacy?.versionVerified === false ? 'Runtime terpasang · perlu verifikasi' : 'Runtime bawaan siap') : legacyNeedsRepair ? 'Pulihkan Instalasi Parsial' : 'Pasang MariaDB';
  $('dbVerifyVersion').hidden = !active || active.versionVerified !== false;
  $('dbVerifyVersion').disabled = databaseBusy || !supported;
  $('dbStart').disabled = !supported || databaseBusy || !installed || s.versionVerified === false || running;
  $('dbStop').disabled = !supported || databaseBusy || !running;
  const startLabel = running ? 'MariaDB berjalan'
    : installed && s.versionVerified === false ? 'Verifikasi MariaDB'
      : installed ? 'Jalankan MariaDB' : 'Atur MariaDB';
  if ($('dbStartShortcut')) {
    $('dbStartShortcut').textContent = startLabel;
    $('dbStartShortcut').disabled = !supported || databaseBusy || running;
  }
  if ($('dbStopShortcut')) $('dbStopShortcut').disabled = $('dbStop').disabled;
  if ($('dashboardStartDatabase')) {
    $('dashboardStartDatabase').querySelector('.dashboard-db-label').textContent = startLabel;
    $('dashboardStartDatabase').disabled = !supported || databaseBusy;
  }
  $('dbCredentials').disabled = !supported || !installed || s.versionVerified === false;
  $('dbRunQuery').disabled = !supported || !running || databaseBusy;
  $('dbShowDatabases').disabled = !supported || !running || databaseBusy;
  if ($('dbShowTables')) $('dbShowTables').disabled = !supported || !running || databaseBusy || !$('dbContext')?.value;
  if ($('dbTableSelect')) $('dbTableSelect').disabled = !running || $('dbTableSelect').options.length <= 1;
  if ($('dbDescribeTable')) $('dbDescribeTable').disabled = !supported || !running || databaseBusy || !$('dbTableSelect')?.value;
  $('dbRefreshList').disabled = !supported || !running || databaseBusy;
  if ($('dbBackup')) $('dbBackup').disabled = !supported || !running || databaseBusy;
  if ($('dbCreateProjectUser')) $('dbCreateProjectUser').disabled = !supported || !running || databaseBusy || !$('dbContext').value;
  if ($('dbCreateDatabase')) $('dbCreateDatabase').disabled = !supported || !running || databaseBusy;
  if ($('dbDropDatabase')) $('dbDropDatabase').disabled = !supported || !running || databaseBusy || !$('dbContext').value;
  if ($('dbRestore')) $('dbRestore').disabled = !supported || !running || databaseBusy || !$('dbBackupList').value;
  if ($('dbRefreshBackups')) $('dbRefreshBackups').disabled = databaseBusy;

  const select = $('dbVersionSelect');
  if (select && document.activeElement !== select) {
    const next = document.createDocumentFragment();
    for (const v of versions) {
      const option = document.createElement('option');
      option.value = v.id;
      const detail = v.initialized ? `port ${v.port}` : v.repairable ? 'instalasi parsial · perlu pemulihan' : v.installed ? 'data belum terinisialisasi' : 'belum terpasang';
      option.textContent = `${v.label} — ${detail}`;
      option.disabled = !v.canSelect && !v.selected;
      option.selected = v.id === s.versionId;
      next.appendChild(option);
    }
    select.replaceChildren(next);
    select.value = s.versionId || 'mariadb-managed';
  }
  if ($('dbVersionSelect')) $('dbVersionSelect').disabled = databaseBusy || !supported;
  if ($('dbUseVersion')) $('dbUseVersion').disabled = databaseBusy || !supported || running || !versions.some(v => v.id === $('dbVersionSelect').value && v.canSelect && !v.selected);
  if ($('dbInstall13')) {
    const mariadb13Healthy = Boolean(mariadb13?.installed && mariadb13?.initialized);
    $('dbInstall13').disabled = databaseBusy || !supported || !mariadb13?.supported || mariadb13Healthy;
    $('dbInstall13').textContent = databaseBusy ? 'Memproses…' : mariadb13Healthy ? 'MariaDB 13.0.2 Terpasang' : mariadb13?.repairable ? 'Pulihkan Instalasi Parsial' : 'Pasang MariaDB 13.0.2 dari ZIP';
  }
  if ($('dbPortInput') && document.activeElement !== $('dbPortInput')) $('dbPortInput').value = Number(s.port || 3307);
  if ($('dbPortInput')) $('dbPortInput').disabled = databaseBusy || !supported || running || !installed;
  if ($('dbSavePort')) $('dbSavePort').disabled = databaseBusy || !supported || running || !installed;
  if ($('dbVersionMessage') && active) {
    const activeStatus = active.initialized ? (running ? 'berjalan' : 'siap, sedang berhenti') : active.repairable ? 'instalasi parsial' : active.installed ? 'data belum terinisialisasi' : 'belum terpasang';
    const lines = [
      `${active.label} - status: ${activeStatus}.`,
      `Host: 127.0.0.1 - port: ${active.port}.`,
      `Data: ${active.dataDirectory}.`
    ];
    if (active.issueReason) lines.push(`Penyebab: ${active.issueReason}`);
    if (active.installerFailureReason) lines.push(`Kegagalan pemasangan terakhir: ${active.installerFailureReason}`);
    if (active.versionVerified === false) lines.push('Versi binary belum terverifikasi. Tombol Jalankan dinonaktifkan sampai pemeriksaan berhasil.');
    if (active.credentialProtection === 'windows-dpapi-v1') lines.push('Kredensial diproteksi DPAPI untuk akun Windows ini.');
    else if (active.credentialWarning) lines.push(active.credentialWarning);
    else if (active.credentialProtection === 'legacy-plaintext') lines.push('Password tersimpan belum diproteksi DPAPI.');
    if (active.settingsError) lines.push(`Konfigurasi bermasalah: ${active.settingsError}`);
    if (active.installerLogPath) lines.push(`Log diagnostik installer: ${active.installerLogPath}`);
    if (active.repairable) lines.push('Pemulihan mengamankan folder lama ke recovery dan membuat data runtime baru. Data lama tidak dipakai otomatis.');
    $('dbVersionMessage').textContent = lines.join('\n');
  }
  if (s.lastError) setDbError(s.lastError);
}

async function refreshDatabase() {
  try {
    const s = await api('/api/database/status');
    renderDbStatus(s);
  } catch (e) {
    setDbError(`Gagal memeriksa MariaDB: ${e.message}`);
  }
}

async function dbAction(button, label, path, body = {}) {
  databaseBusy = true;
  const originalLabel = button.textContent;
  button.textContent = label;
  button.disabled = true;
  setDbError('');
  try {
    const response = await api(path, { method: 'POST', body: JSON.stringify(body) });
    if (response.message) showDbMessage(response.message);
    await refreshDatabase();
    if (path === '/api/database/start' && response.status?.running) await loadDatabaseList();
    return response;
  } catch (e) {
    setDbError(e.message);
    return null;
  } finally {
    databaseBusy = false;
    button.textContent = originalLabel;
    await refreshDatabase();
  }
}

function showDbMessage(message) {
  $('dbResults').replaceChildren();
  const box = document.createElement('div');
  box.className = 'db-result-empty';
  box.textContent = message;
  $('dbResults').appendChild(box);
}

function renderQueryResults(result) {
  $('dbTranslated').textContent = result.translatedSql ? `SQL yang dikirim ke MariaDB: ${result.translatedSql}` : '';
  const host = $('dbResults');
  host.replaceChildren();
  if (!result.columns?.length) {
    showDbMessage(result.message || 'Perintah berhasil dijalankan.');
    return;
  }
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const column of result.columns) {
    const th = document.createElement('th');
    th.textContent = String(column);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of (result.rows || [])) {
    const tr = document.createElement('tr');
    for (const value of row) {
      const td = document.createElement('td');
      td.textContent = value === null ? 'NULL' : String(value);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  host.appendChild(table);
  if (result.truncated) {
    const notice = document.createElement('div');
    notice.className = 'db-result-empty';
    notice.textContent = 'Hasil ditampilkan maksimal 500 baris. Tambahkan LIMIT untuk memperkecil hasil.';
    host.appendChild(notice);
  } else if (!result.rows?.length) {
    const notice = document.createElement('div');
    notice.className = 'db-result-empty';
    notice.textContent = result.message || 'Tidak ada baris hasil.';
    host.appendChild(notice);
  } else {
    const notice = document.createElement('div');
    notice.className = 'db-result-empty';
    notice.textContent = result.message || `${result.rows.length} baris hasil.`;
    host.appendChild(notice);
  }
}

async function runDatabaseQuery() {
  const button = $('dbRunQuery');
  databaseBusy = true;
  button.disabled = true;
  button.textContent = 'Menjalankan…';
  setDbError('');
  $('dbTranslated').textContent = '';
  try {
    const result = await api('/api/database/query', {
      method: 'POST',
      body: JSON.stringify({ sql: $('sqlInput').value, language: $('sqlLanguage').value, database: $('dbContext').value })
    });
    renderQueryResults(result);
    const useMatch = result.translatedSql?.match(/^\s*USE\s+`?([^`\s;]+)`?\s*$/i);
    if (useMatch) {
      await loadDatabaseList();
      const target = useMatch[1];
      if ([...$('dbContext').options].some(option => option.value === target)) $('dbContext').value = target;
    }
    if (/^\s*(?:CREATE|DROP)\s+DATABASE\b/i.test(result.translatedSql || '')) await loadDatabaseList();
  } catch (e) {
    setDbError(e.message);
  } finally {
    databaseBusy = false;
    button.textContent = 'Jalankan SQL';
    await refreshDatabase();
  }
}

$('dbInstall').addEventListener('click', async () => {
  const legacy = (databaseStatus?.versions || []).find(v => v.id === 'mariadb-managed');
  const repairing = Boolean(legacy?.repairable);
  const prompt = repairing
    ? `Pulihkan instalasi MariaDB yang parsial? SINZ akan memindahkan komponen runtime lama ke folder recovery tanpa menghapusnya, lalu mencoba membuat runtime dan data baru. Data lama tidak akan dipakai otomatis.

Lokasi data saat ini: ${legacy.dataDirectory}
Folder recovery berada di dalam runtime/mariadb/versions/recovery.`
    : 'Pasang runtime MariaDB LTS di area data SINZ. Instalasi hanya berjalan lokal; database tidak dibagikan ke internet. Data eksternal tidak diadopsi otomatis.';
  if (!await askConfirm(prompt)) return;
  await dbAction($('dbInstall'), repairing ? 'Mengamankan & memulihkan…' : 'Memasang runtime…', '/api/database/install');
});
$('dbVerifyVersion').addEventListener('click', async () => {
  databaseBusy = true;
  $('dbVerifyVersion').disabled = true;
  $('dbVersionMessage').textContent = 'Memeriksa versi executable tanpa mengubah data…';
  setDbError('');
  try {
    const result = await api('/api/database/verify-version', { method: 'POST', body: JSON.stringify({ versionId: databaseStatus?.versionId }) });
    $('dbVersionMessage').textContent = result.message || `Binary MariaDB ${result.version} telah diverifikasi.`;
  } catch (e) {
    $('dbVersionMessage').textContent = e.message;
    setDbError(e.message);
  } finally { databaseBusy = false; await refreshDatabase(); }
});
$('dbStart').addEventListener('click', async () => { await dbAction($('dbStart'), 'Menjalankan…', '/api/database/start'); });
$('dbStop').addEventListener('click', async () => { await dbAction($('dbStop'), 'Menghentikan…', '/api/database/stop'); });
$('dbStartShortcut')?.addEventListener('click', () => {
  if (!$('dbStart').disabled) $('dbStart').click();
  else navigateSxlPage('database');
});
$('dbStopShortcut')?.addEventListener('click', () => $('dbStop').click());
$('dbSqlShortcut')?.addEventListener('click', () => setMariaDbTab('sql'));
$('dbUseVersion').addEventListener('click', async () => {
  const versionId = $('dbVersionSelect').value;
  const picked = (databaseStatus?.versions || []).find(v => v.id === versionId);
  if (!picked?.canSelect) { $('dbVersionMessage').textContent = 'Versi belum terpasang atau belum terinisialisasi; pasang terlebih dahulu.'; return; }
  if (!await askConfirm(`Gunakan ${picked.label} sebagai versi database aktif? SINZ tidak akan memindahkan atau mengubah data versi lainnya.`)) return;
  databaseBusy = true;
  $('dbUseVersion').disabled = true;
  $('dbVersionMessage').textContent = 'Mengubah pilihan versi…';
  try {
    const result = await api('/api/database/select-version', { method: 'POST', body: JSON.stringify({ versionId }) });
    $('dbVersionMessage').textContent = result.message || 'Versi database aktif diperbarui.';
    setDbError('');
  } catch (e) { $('dbVersionMessage').textContent = e.message; }
  finally { databaseBusy = false; await refreshDatabase(); }
});
$('dbInstall13').addEventListener('click', async () => {
  const current13 = (databaseStatus?.versions || []).find(v => v.id === 'mariadb-13.0.2-winx64');
  const repairPartial = Boolean(current13?.repairable);
  const confirmation = repairPartial
    ? 'Pulihkan instalasi MariaDB 13.0.2 yang belum sehat? SINZ memindahkan seluruh folder yang ada ke folder recovery, bukan menghapusnya, lalu memasang runtime baru dari ZIP yang SHA-256-nya diverifikasi. Jika port lama masih digunakan, pemulihan dibatalkan. Data lama tidak dipakai otomatis oleh runtime baru.'
    : 'Pasang MariaDB 13.0.2 untuk Windows x64? Pilih arsip asli mariadb-13.0.2-winx64.zip. SINZ memverifikasi SHA-256 dan versi executable, membuat data baru, serta tidak mengubah runtime lama. Versi tidak diaktifkan otomatis.';
  if (!await askConfirm(confirmation)) return;
  databaseBusy = true;
  $('dbInstall13').disabled = true;
  $('dbVersionMessage').textContent = 'Pilih ZIP MariaDB 13.0.2 yang akan diverifikasi…';
  try {
    const selected = await api('/api/database/browse-archive', { method: 'POST', body: '{}' });
    if (!selected.archivePath) { $('dbVersionMessage').textContent = 'Pemilihan arsip dibatalkan.'; return; }
    $('dbVersionMessage').textContent = 'Memverifikasi checksum dan menginisialisasi data baru. Jangan tutup aplikasi selama proses ini.';
    const result = await api('/api/database/install-version', { method: 'POST', body: JSON.stringify({ archivePath: selected.archivePath, repairPartial }) });
    $('dbVersionMessage').textContent = result.message || 'MariaDB 13.0.2 dipasang; versi aktif tidak berubah.';
    setDbError('');
  } catch (e) {
    $('dbVersionMessage').textContent = e.message;
    setDbError(e.message);
  } finally { databaseBusy = false; await refreshDatabase(); }
});
$('dbSavePort').addEventListener('click', async () => {
  const port = Number($('dbPortInput').value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) { $('dbVersionMessage').textContent = 'Port harus bilangan bulat 1024–65535.'; return; }
  databaseBusy = true;
  $('dbSavePort').disabled = true;
  $('dbVersionMessage').textContent = 'Memeriksa konflik port dan menyimpan konfigurasi…';
  try {
    const result = await api('/api/database/set-port', { method: 'POST', body: JSON.stringify({ port }) });
    $('dbVersionMessage').textContent = result.message || 'Port disimpan.';
    setDbError('');
  } catch (e) { $('dbVersionMessage').textContent = e.message; setDbError(e.message); }
  finally { databaseBusy = false; await refreshDatabase(); }
});

$('dbRefreshLog').addEventListener('click', async () => {
  const button = $('dbRefreshLog');
  button.disabled = true;
  const old = button.textContent;
  button.textContent = 'Membaca…';
  try {
    const result = await api('/api/database/log');
    $('dbLogContents').textContent = result.log || 'Belum ada log database untuk versi aktif.';
  } catch (e) { $('dbLogContents').textContent = `Gagal membaca log: ${e.message}`; }
  finally { button.disabled = false; button.textContent = old; }
});
$('dbLogPanel').addEventListener('toggle', () => {
  if ($('dbLogPanel').open) $('dbRefreshLog').click();
});
$('dbRunQuery').addEventListener('click', runDatabaseQuery);
$('dbShowDatabases').addEventListener('click', () => {
  $('sqlInput').value = $('sqlLanguage').value === 'id' ? 'TAMPILKAN DATABASE;' : 'SHOW DATABASES;';
  runDatabaseQuery();
});

async function loadDatabaseTables() {
  const databaseName = $('dbContext').value;
  const button = $('dbShowTables'); const select = $('dbTableSelect');
  if (!databaseName) { setDbError('Pilih database dahulu untuk melihat tabel.'); return; }
  if (!databaseStatus?.running || databaseBusy) { setDbError('Jalankan MariaDB terlebih dahulu.'); return; }
  const original = button.textContent; button.disabled = true; button.textContent = 'Memuat…';
  setDbError('');
  try {
    const result = await api('/api/database/query', { method: 'POST', body: JSON.stringify({ sql: 'SHOW TABLES', language: 'native', database: databaseName }) });
    const previous = select.value;
    select.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = result.rows?.length ? 'Pilih tabel…' : 'Belum ada tabel'; select.appendChild(empty);
    for (const row of result.rows || []) {
      const name = String(row?.[0] ?? '');
      if (!name) continue;
      const option = document.createElement('option'); option.value = name; option.textContent = name; select.appendChild(option);
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    select.disabled = !(result.rows || []).length || !databaseStatus?.running;
    $('dbDescribeTable').disabled = !select.value || !databaseStatus?.running;
    renderQueryResults(result);
    if (!(result.rows || []).length) showDbMessage(`Database ${databaseName} belum memiliki tabel.`);
  } catch (error) { setDbError(error.message); }
  finally { button.textContent = original; button.disabled = !databaseStatus?.running || databaseBusy || !$('dbContext').value; }
}
$('dbShowTables')?.addEventListener('click', loadDatabaseTables);
$('dbTableSelect')?.addEventListener('change', () => { $('dbDescribeTable').disabled = !Boolean($('dbTableSelect').value) || !databaseStatus?.running; });
$('dbDescribeTable')?.addEventListener('click', async () => {
  const tableName = $('dbTableSelect').value; const databaseName = $('dbContext').value;
  if (!tableName || !databaseName) { setDbError('Pilih database dan tabel terlebih dahulu.'); return; }
  // The table comes from SHOW TABLES; escape backticks before building the identifier.
  const identifier = `\`${tableName.replace(/`/g, '``')}\``;
  $('sqlInput').value = `DESCRIBE ${identifier};`;
  $('sqlLanguage').value = 'native';
  await runDatabaseQuery();
});
async function loadDatabaseList() {
  try {
    const previous = $('dbContext').value;
    const result = await api('/api/database/databases');
    const select = $('dbContext');
    select.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Tanpa database aktif';
    select.appendChild(empty);
    for (const name of (result.databases || [])) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    if ($('dbDropDatabase')) $('dbDropDatabase').disabled = !databaseStatus?.running || databaseBusy || !select.value;
  } catch (e) {
    setDbError(e.message);
  }
}
$('dbRefreshList').addEventListener('click', loadDatabaseList);
$('dbContext').addEventListener('change', () => {
  $('dbTranslated').textContent = $('dbContext').value
    ? `Query akan dijalankan dalam database: ${$('dbContext').value}`
    : 'Tidak ada database aktif yang dipilih.';
  if ($('dbCreateProjectUser')) $('dbCreateProjectUser').disabled = !databaseStatus?.running || databaseBusy || !$('dbContext').value;
  if ($('dbTableSelect')) { $('dbTableSelect').replaceChildren(); const option = document.createElement('option'); option.value = ''; option.textContent = 'Muat tabel dahulu…'; $('dbTableSelect').appendChild(option); $('dbTableSelect').disabled = true; }
  if ($('dbShowTables')) $('dbShowTables').disabled = !databaseStatus?.running || databaseBusy || !$('dbContext').value;
  if ($('dbDescribeTable')) $('dbDescribeTable').disabled = true;
});
$('dbCreateProjectUser').addEventListener('click', async () => {
  const databaseName = $('dbContext').value;
  const username = $('dbProjectUsername').value.trim();
  if (!databaseName) { $('dbProjectUserMessage').textContent = 'Pilih database pada bagian Database aktif terlebih dahulu.'; return; }
  if (!await askConfirm(`Buat akun non-root ${username} dengan hak akses hanya pada database ${databaseName}?`)) return;
  databaseBusy = true;
  $('dbCreateProjectUser').disabled = true;
  $('dbProjectUserMessage').textContent = 'Membuat akun database…';
  $('dbProjectUserCredentials').hidden = true;
  $('dbCopyProjectUser').hidden = true;
  try {
    const result = await api('/api/database/project-user', { method: 'POST', body: JSON.stringify({ database: databaseName, username }) });
    const credentialsText = `DB_HOST=${result.host}\nDB_PORT=${result.port}\nDB_DATABASE=${result.database}\nDB_USERNAME=${result.username}\nDB_PASSWORD=${result.password}`;
    $('dbProjectUserMessage').textContent = result.message + ' ' + result.privileges;
    $('dbProjectUserCredentials').textContent = credentialsText;
    $('dbProjectUserCredentials').hidden = false;
    $('dbCopyProjectUser').hidden = false;
    $('dbCopyProjectUser').onclick = async () => {
      try { await navigator.clipboard.writeText(credentialsText); $('dbProjectUserMessage').textContent = 'Kredensial disalin. Simpan di secret manager atau file environment yang tidak dipublikasikan.'; }
      catch { $('dbProjectUserMessage').textContent = 'Clipboard tidak tersedia. Salin kredensial yang ditampilkan secara manual.'; }
    };
  } catch (error) {
    $('dbProjectUserMessage').textContent = `Gagal membuat akun: ${error.message}`;
  } finally {
    databaseBusy = false;
    await refreshDatabase();
    $('dbCreateProjectUser').disabled = !databaseStatus?.running || databaseBusy || !$('dbContext').value;
  }
});
$('dbClearResult').addEventListener('click', () => {
  $('dbResults').replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'db-result-empty';
  empty.textContent = 'Hasil dibersihkan.';
  $('dbResults').appendChild(empty);
  $('dbTranslated').textContent = '';
  setDbError('');
});
async function refreshBackups() {
  try {
    const result = await api('/api/database/backups');
    const select = $('dbBackupList');
    const previous = select.value;
    select.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = result.backups?.length ? 'Pilih backup…' : 'Belum ada backup';
    select.appendChild(empty);
    for (const item of (result.backups || [])) {
      const option = document.createElement('option');
      option.value = item.filename;
      const size = item.size < 1024 * 1024 ? `${Math.max(1, Math.round(item.size / 1024))} KB` : `${(item.size / (1024 * 1024)).toFixed(1)} MB`;
      option.textContent = `${item.filename} · ${size}`;
      select.appendChild(option);
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    if ($('dbDropDatabase')) $('dbDropDatabase').disabled = !databaseStatus?.running || databaseBusy || !select.value;
    $('dbRestore').disabled = !databaseStatus?.running || databaseBusy || !select.value;
  } catch (e) {
    $('dbBackupMessage').textContent = `Gagal memuat backup: ${e.message}`;
  }
}

$('dbBackup').addEventListener('click', async () => {
  databaseBusy = true;
  $('dbBackup').disabled = true;
  $('dbBackupMessage').textContent = 'Membuat backup semua database pengguna…';
  try {
    const result = await api('/api/database/backup', { method: 'POST', body: JSON.stringify({}) });
    $('dbBackupMessage').textContent = `${result.message} File: ${result.filename}`;
    await refreshBackups();
  } catch (e) {
    $('dbBackupMessage').textContent = `Backup gagal: ${e.message}`;
  } finally {
    databaseBusy = false;
    await refreshDatabase();
    await refreshBackups();
  }
});
$('dbRefreshBackups').addEventListener('click', refreshBackups);
$('dbBackupList').addEventListener('change', () => {
  $('dbRestore').disabled = !databaseStatus?.running || databaseBusy || !$('dbBackupList').value;
});
$('dbRestore').addEventListener('click', async () => {
  const filename = $('dbBackupList').value;
  if (!filename) return;
  if (!await askConfirm(`Pulihkan backup ${filename}? Data saat ini dapat berubah. SINZ akan membuat backup keselamatan otomatis sebelum pemulihan.`)) return;
  databaseBusy = true;
  $('dbRestore').disabled = true;
  $('dbBackupMessage').textContent = 'Memulihkan backup…';
  try {
    const result = await api('/api/database/restore', { method: 'POST', body: JSON.stringify({ filename }) });
    $('dbBackupMessage').textContent = `${result.message} Backup keselamatan: ${result.safetyBackup}`;
    await loadDatabaseList();
  } catch (e) {
    $('dbBackupMessage').textContent = `Pemulihan gagal: ${e.message}`;
  } finally {
    databaseBusy = false;
    await refreshDatabase();
    await refreshBackups();
  }
});

$('dbCredentials').addEventListener('click', async () => {
  if (credentialsVisible) {
    $('dbCredentialsBox').style.display = 'none';
    $('dbCredentials').textContent = 'Lihat Kredensial';
    credentialsVisible = false;
    return;
  }
  try {
    const c = await api('/api/database/credentials', { method: 'POST', body: '{}' });
    $('dbUsername').textContent = c.username;
    $('dbPassword').textContent = c.password;
    $('dbCredentialsBox').style.display = 'block';
    $('dbCredentials').textContent = 'Sembunyikan Kredensial';
    credentialsVisible = true;
  } catch (e) { setDbError(e.message); }
});
$('sqlLanguage').addEventListener('change', () => {
  $('dbTranslated').textContent = $('sqlLanguage').value === 'id'
    ? 'Mode Indonesia menerjemahkan kata kunci SQL sebelum dikirim ke MariaDB. String, komentar, dan nama identifier ber-backtick tidak diterjemahkan.'
    : 'Mode SQL standar meneruskan perintah ke MariaDB tanpa penerjemahan.';
});

refreshDatabase();
refreshBackups();
dbRefreshTimer = window.setInterval(refreshDatabase, 5000);
window.addEventListener('pagehide', () => {
  if (dbRefreshTimer) window.clearInterval(dbRefreshTimer);
});

// PostgreSQL and SQLite use independent adapters; MariaDB's existing manager is untouched.
let extraDbState = null;
function engineMessage(id, message, isError = false) {
  const node = $(id); if (!node) return;
  node.textContent = message || '';
  node.style.color = isError ? 'var(--bad)' : 'var(--muted)';
}
function setEngineDot(id, good, warn = false) {
  const node = $(id); if (node) node.className = `dot ${good ? 'good' : warn ? 'warn' : ''}`;
}
async function refreshExtraDbStatus() {
  try {
    const state = await api('/api/engines/status');
    extraDbState = state;
    const pg = state.postgresql || {};
    setEngineDot('pgDot', Boolean(pg.running), Boolean(pg.configured && pg.initialized && !pg.running));
    $('pgStatusText').textContent = !pg.configured ? 'Runtime belum dipilih' : !pg.installed ? 'Binary tidak lengkap' : !pg.initialized ? 'Belum diinisialisasi' : pg.running ? 'Berjalan' : 'Berhenti';
    $('pgDetail').textContent = pg.error || `${pg.version || 'Versi belum diverifikasi'} · ${pg.host || '127.0.0.1'}:${pg.port || 5433}. ${pg.message || ''} Data terisolasi: ${pg.dataDir || 'data/database-engines/postgresql/default'}.`;
    if (pg.binDir && document.activeElement !== $('pgBinDir')) $('pgBinDir').value = pg.binDir;
    if (document.activeElement !== $('pgPort')) $('pgPort').value = Number(pg.port || 5433);
    const pgConfigured = Boolean(pg.configured && pg.installed);
    $('pgBinDir').disabled = Boolean(pg.running);
    $('pgPort').disabled = Boolean(pg.running);
    $('pgConfigure').disabled = Boolean(pg.running);
    $('pgInitialize').disabled = !pgConfigured || Boolean(pg.initialized);
    $('pgStart').disabled = !pgConfigured || !pg.initialized || Boolean(pg.running);
    $('pgStop').disabled = !pgConfigured || !pg.running;
    $('pgCredentials').disabled = !pgConfigured || !pg.passwordConfigured;
    $('pgBackup').disabled = !pgConfigured || !pg.running;
    $('pgRunQuery').disabled = !pgConfigured || !pg.running;
    $('pgRefreshDatabases').disabled = !pgConfigured || !pg.running;
    $('pgCreateDatabase').disabled = !pgConfigured || !pg.running;
    setEngineDot('sqliteDot', Boolean(state.sqlite?.available), Boolean(state.sqlite?.configured && !state.sqlite?.available));
    $('sqliteStatusText').textContent = !state.sqlite?.configured ? 'CLI belum dipilih' : state.sqlite.available ? `${state.sqlite.files?.length || 0} database lokal` : 'CLI tidak ditemukan';
    $('sqliteDetail').textContent = state.sqlite?.directory ? `File database: ${state.sqlite.directory}. ` + (state.sqlite.available ? `CLI ${state.sqlite.version || ''}: ${state.sqlite.executable}` : 'Pilih executable sqlite3 yang valid.') : 'SQLite belum dikonfigurasi.';
    if (state.sqlite?.executable && document.activeElement !== $('sqliteExecutable')) $('sqliteExecutable').value = state.sqlite.executable;
    const currentSelection = $('sqliteDatabaseSelect').value;
    const select = $('sqliteDatabaseSelect');
    select.replaceChildren();
    for (const file of (state.sqlite?.files || [])) {
      const option = document.createElement('option'); option.value = file.replace(/\.sqlite3?$/i, ''); option.textContent = file; select.appendChild(option);
    }
    if (!select.options.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'Belum ada database'; select.appendChild(option); }
    select.value = (state.sqlite?.files || []).some(f => f.replace(/\.sqlite3?$/i, '') === currentSelection) ? currentSelection : (select.options[0]?.value || '');
    $('sqliteCreate').disabled = !state.sqlite?.available;
    $('sqliteRunQuery').disabled = !state.sqlite?.available || !select.value;
    $('sqliteBackup').disabled = !state.sqlite?.available || !select.value;
  } catch (error) {
    engineMessage('pgDetail', `Gagal membaca status: ${error.message}`, true);
    engineMessage('sqliteDetail', `Gagal membaca status: ${error.message}`, true);
  }
}
async function engineAction(buttonId, label, route, body, outputId, refreshAfter = true) {
  const button = $(buttonId);
  const original = button?.textContent || label;
  if (button) { button.disabled = true; button.textContent = 'Memproses…'; }
  try {
    const response = await api(route, { method: 'POST', body: JSON.stringify(body || {}) });
    if (outputId) {
      const value = response.output ?? response.log ?? response.backup ?? response.message ?? response.status?.message ?? JSON.stringify(response, null, 2);
      $(outputId).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      if (response.notice) $(outputId).textContent += `\n\n${response.notice}`;
      if (response.databases) $(outputId).textContent = response.databases.join('\n') || '(belum ada database)';
    }
    if (refreshAfter) await refreshExtraDbStatus();
    return response;
  } catch (error) {
    if (outputId) $(outputId).textContent = `GAGAL: ${error.message}`;
    else engineMessage('pgDetail', error.message, true);
    throw error;
  } finally {
    if (button) { button.textContent = original; }
    await refreshExtraDbStatus();
  }
}
$('extraDbRefresh')?.addEventListener('click', refreshExtraDbStatus);
$('pgConfigure')?.addEventListener('click', async () => {
  try {
    await engineAction('pgConfigure', 'Simpan Runtime', '/api/engines/postgresql/configure', { binDir: $('pgBinDir').value.trim(), port: Number($('pgPort').value) }, 'pgOutput');
    $('pgOutput').textContent = 'Konfigurasi PostgreSQL tersimpan. Belum ada data yang diinisialisasi atau dimodifikasi.';
  } catch {}
});
$('pgInitialize')?.addEventListener('click', async () => {
  if (!await askConfirm('SINZ akan membuat cluster PostgreSQL BARU di direktori data SINZ. Direktori nonkosong akan ditolak. Data dari instalasi PostgreSQL lain tidak dipakai atau diubah. Lanjutkan?', 'Inisialisasi PostgreSQL', 'Buat Cluster Baru')) return;
  try { await engineAction('pgInitialize', 'Inisialisasi Data SINZ', '/api/engines/postgresql/initialize', {}, 'pgOutput'); } catch {}
});
$('pgStart')?.addEventListener('click', async () => { try { await engineAction('pgStart', 'Jalankan PostgreSQL', '/api/engines/postgresql/start', {}, 'pgOutput'); } catch {} });
$('pgStop')?.addEventListener('click', async () => {
  if (!await askConfirm('Hentikan PostgreSQL menggunakan shutdown normal? SINZ tidak akan menghentikan proses lain secara paksa.', 'Hentikan PostgreSQL')) return;
  try { await engineAction('pgStop', 'Hentikan PostgreSQL', '/api/engines/postgresql/stop', {}, 'pgOutput'); } catch {}
});
$('pgCredentials')?.addEventListener('click', async () => {
  const box = $('pgCredentialsBox');
  if (!box.hidden) { box.hidden = true; $('pgCredPassword').textContent = ''; return; }
  if (!await askConfirm('Tampilkan password PostgreSQL lokal di layar? Pastikan orang lain tidak dapat melihat layar ini.', 'Tampilkan kredensial')) return;
  try {
    const response = await api('/api/engines/postgresql/credentials', { method: 'POST', body: '{}' });
    $('pgCredPort').textContent = response.port; $('pgCredUsername').textContent = response.username; $('pgCredPassword').textContent = response.password; box.hidden = false;
  } catch (error) { $('pgOutput').textContent = `GAGAL: ${error.message}`; }
});
$('pgRunQuery')?.addEventListener('click', async () => {
  try { await engineAction('pgRunQuery', 'Jalankan SQL', '/api/engines/postgresql/query', { database: $('pgDatabase').value.trim(), sql: $('pgSql').value }, 'pgOutput', false); } catch {}
});
$('pgRefreshDatabases')?.addEventListener('click', async () => {
  try { await engineAction('pgRefreshDatabases', 'Daftar Database', '/api/engines/postgresql/databases', {}, 'pgOutput', false); } catch {}
});
$('pgCreateDatabase')?.addEventListener('click', async () => {
  const name = $('pgNewDatabase').value.trim();
  if (!await askConfirm(`Buat database PostgreSQL baru bernama “${name}”? Database yang sudah ada tidak akan ditimpa.`, 'Buat Database PostgreSQL')) return;
  try {
    const response = await engineAction('pgCreateDatabase', 'Buat Database', '/api/engines/postgresql/create-database', { name }, 'pgOutput');
    if (response?.database) $('pgDatabase').value = response.database;
  } catch {}
});
$('pgBackup')?.addEventListener('click', async () => {
  if (!await askConfirm(`Buat backup PostgreSQL untuk database “${$('pgDatabase').value.trim()}”?`, 'Backup PostgreSQL')) return;
  try { await engineAction('pgBackup', 'Backup PostgreSQL', '/api/engines/postgresql/backup', { database: $('pgDatabase').value.trim() }, 'pgOutput'); } catch {}
});
$('pgRefreshLog')?.addEventListener('click', async () => {
  try { const response = await api('/api/engines/postgresql/log'); $('pgLog').textContent = response.log || '(log kosong)'; }
  catch (error) { $('pgLog').textContent = `GAGAL: ${error.message}`; }
});
$('sqliteConfigure')?.addEventListener('click', async () => {
  try { await engineAction('sqliteConfigure', 'Simpan CLI', '/api/engines/sqlite/configure', { executable: $('sqliteExecutable').value.trim() }, 'sqliteOutput'); $('sqliteOutput').textContent = 'Path CLI SQLite tersimpan. File database lama tidak diubah.'; }
  catch {}
});
$('sqliteCreate')?.addEventListener('click', async () => {
  const name = $('sqliteNewName').value.trim();
  if (!await askConfirm(`Buat file database SQLite baru “${name}.sqlite3” di direktori data SINZ? File yang sudah ada tidak akan ditimpa.`, 'Buat database SQLite')) return;
  try { await engineAction('sqliteCreate', 'Buat Database', '/api/engines/sqlite/create', { name }, 'sqliteOutput'); await refreshExtraDbStatus(); $('sqliteDatabaseSelect').value = name; }
  catch {}
});
$('sqliteDatabaseSelect')?.addEventListener('change', refreshExtraDbStatus);
$('sqliteRunQuery')?.addEventListener('click', async () => {
  try { await engineAction('sqliteRunQuery', 'Jalankan SQL', '/api/engines/sqlite/query', { database: $('sqliteDatabaseSelect').value, sql: $('sqliteSql').value }, 'sqliteOutput', false); }
  catch {}
});
$('sqliteBackup')?.addEventListener('click', async () => {
  const name = $('sqliteDatabaseSelect').value;
  if (!await askConfirm(`Buat backup konsisten untuk file database “${name}”? File sumber tidak akan diubah.`, 'Backup SQLite')) return;
  try { await engineAction('sqliteBackup', 'Backup SQLite', '/api/engines/sqlite/backup', { database: name }, 'sqliteOutput'); } catch {}
});
$('sqliteRefresh')?.addEventListener('click', refreshExtraDbStatus);
refreshExtraDbStatus();
const extraDbRefreshTimer = window.setInterval(refreshExtraDbStatus, 7000);
window.addEventListener('pagehide', () => window.clearInterval(extraDbRefreshTimer));


// Local development services and project workspace.
let servicesState = null;
let servicesBusy = false;
function setServiceMessage(id, message, isError = false) {
  const node = $(id); if (!node) return;
  node.textContent = message || '';
  node.style.color = isError ? 'var(--bad)' : 'var(--muted)';
}
function setDot(id, good, warn = false) { $(id).className = `dot ${good ? 'good' : warn ? 'warn' : ''}`; }
async function refreshServices() {
  try {
    servicesState = await api('/api/services/status');
    const a = servicesState.apache || {};
    setDot('apacheDot', a.running, a.installed);
    $('apacheState').textContent = a.running ? 'Aktif' : a.installed ? 'Terpasang, berhenti' : 'Belum terpasang';
    $('apacheDetail').textContent = a.path ? `${a.path} · port ${a.port} · ${a.url}` : `Belum ada binary Apache yang terdeteksi. Target port ${a.port}.`;
    $('apacheInstall').disabled = servicesBusy || a.installed || !a.installSupported;
    $('apacheStart').disabled = servicesBusy || !a.installed || a.running;
    $('apacheStop').disabled = servicesBusy || !a.running;
    $('apacheOpen').disabled = servicesBusy || !a.running;
    const php = servicesState.php || {};
    setDot('phpDot', Boolean(php.portableInstalled || php.systemPath), Boolean(php.portableInstalled || php.systemPath));
    $('phpState').textContent = php.activePath ? 'Versi aktif terdeteksi' : php.portableInstalled ? 'Portable SINZ tersedia' : 'Belum terdeteksi';
    $('phpDetail').textContent = php.activePath ? `PHP aktif: ${php.activePath}` : 'Pilih atau pasang folder versi PHP untuk menjalankan proyek dan Composer.';
    $('phpVersion').textContent = php.activePath || php.recommendedVersion || 'Belum dipilih';
    $('phpInstall').disabled = servicesBusy || !php.installSupported || php.recommendedInstalled;
    const composer = servicesState.composer || {};
    setDot('composerDot', composer.installed, composer.installed);
    $('composerState').textContent = composer.installed ? 'Terpasang' : 'Belum terpasang';
    $('composerDetail').textContent = composer.installed ? `Composer tersimpan di ${composer.path}` : 'Pasang Composer untuk menjalankan composer install pada proyek Laravel/PHP.';
    $('composerInstall').disabled = servicesBusy || !composer.installSupported || composer.installed;
    const pma = servicesState.phpMyAdmin || {};
    setDot('pmaDot', pma.running, pma.installed);
    $('pmaState').textContent = pma.running ? 'Aktif' : pma.installed ? 'Terpasang, berhenti' : 'Belum terpasang';
    $('pmaDetail').textContent = pma.running ? `${pma.url} · PHPMyAdmin ${pma.version}` : `phpMyAdmin ${pma.version} · port lokal akan dipilih otomatis.`;
    $('pmaInstall').disabled = servicesBusy || pma.installed;
    $('pmaStart').disabled = servicesBusy || !pma.installed || pma.running;
    $('pmaStop').disabled = servicesBusy || !pma.running;
    $('pmaOpen').disabled = servicesBusy || !pma.running;
    $('workspacePath').textContent = servicesState.workspace || '';
    renderProjects(servicesState.projects || []);
  } catch (e) {
    setServiceMessage('apacheMessage', `Gagal membaca status layanan: ${e.message}`, true);
  }
}
async function serviceAction(buttonId, label, endpoint, messageId) {
  const button = $(buttonId); const original = button.textContent;
  servicesBusy = true; button.disabled = true; button.textContent = label; setServiceMessage(messageId, 'Sedang memproses…');
  try {
    const result = await api(endpoint, { method: 'POST', body: '{}' });
    setServiceMessage(messageId, result.message || 'Selesai.');
    await refreshServices(); await refreshDatabase();
  } catch (e) { setServiceMessage(messageId, e.message, true); }
  finally { servicesBusy = false; button.textContent = original; await refreshServices(); }
}
let phpVersionsData = null;
async function refreshPhpVersions(showMessage = false) {
  const select = $('phpVersionSelect');
  const rootLabel = $('phpVersionsRoot');
  const countLabel = $('phpVersionsCount');
  const message = $('phpVersionSelectMessage');
  const scanButton = $('scanPhpVersions');
  if (scanButton) { scanButton.disabled = true; scanButton.textContent = 'Memindai…'; }
  try {
    const result = await api('/api/runtime/php-versions');
    phpVersionsData = result;
    if (rootLabel) rootLabel.textContent = result.root || 'Lokasi folder tidak diketahui';
    const versions = Array.isArray(result.versions) ? result.versions : [];
    if (select) {
      select.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = versions.length ? 'Pilih versi PHP…' : 'Belum ada versi PHP ditemukan';
      select.append(placeholder);
      for (const item of versions) {
        const option = document.createElement('option');
        option.value = item.phpBinary;
        const ver = item.version ? `PHP ${item.version}` : 'Versi tidak terbaca';
        const cgi = item.phpCgiBinary ? (item.cgiVersion && item.cgiVersion === item.version ? ' · FastCGI siap' : ' · periksa PHP-CGI') : ' · CLI saja';
        const state = item.error ? ` · ${item.error}` : '';
        option.textContent = `${item.label} — ${ver}${cgi}${state}`;
        option.disabled = !item.executable || Boolean(item.error);
        if (item.selected || (result.selectedPath && item.phpBinary.toLowerCase() === String(result.selectedPath).toLowerCase())) option.selected = true;
        select.append(option);
      }
      if (!select.value && versions.length) {
        const selected = versions.find(item => item.selected) || versions.find(item => item.executable && !item.error) || versions[0];
        if (selected) select.value = selected.phpBinary;
      }
    }
    if (countLabel) countLabel.textContent = `${versions.length} versi`;
    if (servicesState?.projects) renderProjects(servicesState.projects);
    const chosen = versions.find(item => item.phpBinary === select?.value);
    const useButton = $('usePhpVersion');
    if (useButton) useButton.disabled = !chosen || !chosen.executable || Boolean(chosen.error);
    if (message && (showMessage || !message.textContent || /Memuat|Pindai|memindai/i.test(message.textContent))) {
      message.style.color = 'var(--muted)';
      message.textContent = versions.length
        ? `${versions.filter(item => item.executable).length} versi dapat dijalankan. Folder PHP Windows biasanya berisi php.exe, php-cgi.exe, php.ini-development, dan folder ext.`
        : 'Belum ada versi ditemukan. Klik Buka Folder PHP, salin folder distribusi PHP ke dalamnya, lalu klik Pindai Versi.';
    }
    return result;
  } catch (error) {
    if (message) { message.style.color = 'var(--bad)'; message.textContent = `Gagal memindai versi PHP: ${error.message}`; }
  } finally {
    if (scanButton) { scanButton.disabled = false; scanButton.textContent = 'Pindai Versi'; }
  }
}
async function useSelectedPhpVersion() {
  const select = $('phpVersionSelect');
  const button = $('usePhpVersion');
  const message = $('phpVersionSelectMessage');
  const phpBinary = select?.value || '';
  if (!phpBinary) return;
  if (button) { button.disabled = true; button.textContent = 'Mengaktifkan…'; }
  if (message) { message.style.color = 'var(--muted)'; message.textContent = 'Memeriksa versi PHP dan mencocokkan PHP-CGI…'; }
  try {
    const result = await api('/api/runtime/php-versions/select', { method: 'POST', body: JSON.stringify({ phpBinary }) });
    if (message) { message.style.color = 'var(--good, #24845d)'; message.textContent = result.message || 'Versi PHP berhasil diaktifkan.'; }
    await refreshPhpVersions();
    await loadManualRuntimePaths(true);
    await refreshServices();
    await refreshRuntimeStatus();
  } catch (error) {
    if (message) { message.style.color = 'var(--bad)'; message.textContent = error.message; }
  } finally {
    if (button) { button.textContent = 'Gunakan Versi Ini'; button.disabled = false; }
    await refreshPhpVersions();
  }
}
async function openPhpVersionsFolder() {
  const button = $('openPhpVersionsFolder');
  const message = $('phpVersionSelectMessage');
  if (button) { button.disabled = true; }
  try {
    const result = await api('/api/runtime/php-versions/open-folder', { method: 'POST', body: '{}' });
    if (message) { message.style.color = 'var(--muted)'; message.textContent = `${result.message} Salin setiap distribusi PHP ke dalam folder ini, lalu klik Pindai Versi.`; }
  } catch (error) {
    if (message) { message.style.color = 'var(--bad)'; message.textContent = error.message; }
  } finally { if (button) button.disabled = false; }
}
$('scanPhpVersions')?.addEventListener('click', () => refreshPhpVersions(true));
$('usePhpVersion')?.addEventListener('click', useSelectedPhpVersion);
$('openPhpVersionsFolder')?.addEventListener('click', openPhpVersionsFolder);
$('phpVersionSelect')?.addEventListener('change', () => {
  const selected = phpVersionsData?.versions?.find(item => item.phpBinary === $('phpVersionSelect')?.value);
  const button = $('usePhpVersion');
  if (button) button.disabled = !selected || !selected.executable || Boolean(selected.error);
  const message = $('phpVersionSelectMessage');
  if (message && selected) {
    message.style.color = selected.error ? 'var(--bad)' : 'var(--muted)';
    message.textContent = `${selected.phpBinary}${selected.phpCgiBinary ? `\nPHP-CGI: ${selected.phpCgiBinary}` : '\nPHP-CGI tidak ditemukan; versi ini hanya tersedia untuk CLI/Composer.'}${selected.hasPhpIni ? '\nphp.ini tersedia.' : selected.hasIniTemplate ? '\nphp.ini belum ada; template konfigurasi ditemukan.' : '\nphp.ini tidak ditemukan.'}${selected.hasExtensions ? '\nFolder ekstensi ext tersedia.' : '\nFolder ext tidak ditemukan.'}${selected.error ? `\nStatus: ${selected.error}` : ''}`;
  }
});
refreshPhpVersions();

const runtimePathFields = {
  apacheBinary: 'manualApacheBinary',
  phpBinary: 'manualPhpBinary',
  phpCgiBinary: 'manualPhpCgiBinary',
  composerPhar: 'manualComposerPhar',
  nodeBinary: 'manualNodeBinary',
  npmCli: 'manualNpmCli',
  cloudflaredBinary: 'manualCloudflaredBinary',
  phpMyAdminDir: 'manualPhpMyAdminDir',
  mariaDbBinDir: 'manualMariaDbBinDir'
};
async function loadManualRuntimePaths(messageOnSuccess = false) {
  const message = $('manualRuntimeMessage');
  try {
    const result = await api('/api/runtime/paths');
    for (const [key, id] of Object.entries(runtimePathFields)) {
      const field = $(id);
      if (field) field.value = result.paths?.[key] || '';
    }
    const configuredCount = Object.values(result.status || {}).filter(item => item.configured && item.exists).length;
    if (message) {
      message.style.color = 'var(--muted)';
      message.textContent = messageOnSuccess
        ? `Jalur dimuat. ${configuredCount} konfigurasi manual sudah terisi dan ditemukan.`
        : `Konfigurasi dimuat: ${configuredCount} jalur manual terdeteksi. Kosongkan field yang ingin kembali memakai deteksi otomatis.`;
    }
  } catch (error) {
    if (message) { message.style.color = 'var(--bad)'; message.textContent = `Tidak dapat membaca konfigurasi runtime: ${error.message}`; }
  }
}
async function saveManualRuntimePaths(clear = false) {
  const button = $('saveManualRuntimePaths');
  const message = $('manualRuntimeMessage');
  const paths = {};
  for (const [key, id] of Object.entries(runtimePathFields)) paths[key] = clear ? '' : ($(id)?.value || '').trim();
  if (button) { button.disabled = true; button.textContent = clear ? 'Mengosongkan…' : 'Memvalidasi…'; }
  if (message) { message.style.color = 'var(--muted)'; message.textContent = 'Memeriksa file dan folder yang dipilih…'; }
  try {
    const result = await api('/api/runtime/paths', { method: 'POST', body: JSON.stringify({ paths }) });
    if (message) { message.style.color = 'var(--good, #24845d)'; message.textContent = result.message || 'Konfigurasi runtime tersimpan.'; }
    await refreshServices();
    await refreshRuntimeStatus();
    await refreshDatabase();
    await refreshPhpVersions();
    await loadManualRuntimePaths(true);
  } catch (error) {
    if (message) { message.style.color = 'var(--bad)'; message.textContent = error.message; }
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Simpan & Validasi Path'; }
  }
}
$('saveManualRuntimePaths')?.addEventListener('click', () => saveManualRuntimePaths(false));
$('clearManualRuntimePaths')?.addEventListener('click', async () => {
  if (!await askConfirm('Semua path manual akan dihapus dari konfigurasi SINZ. File runtime dan data database tidak akan dihapus.', 'Kosongkan path manual', 'Kosongkan path')) return;
  for (const id of Object.values(runtimePathFields)) if ($(id)) $(id).value = '';
  await saveManualRuntimePaths(true);
});
$('refreshManualRuntimePaths')?.addEventListener('click', () => loadManualRuntimePaths(true));
loadManualRuntimePaths();

const desktopStartupOption = $('desktopStartupOption');
const desktopStartupToggle = $('desktopStartupToggle');
const desktopStartupMessage = $('desktopStartupMessage');
if (window.sxlDesktop && desktopStartupOption && desktopStartupToggle && desktopStartupMessage) {
  desktopStartupOption.hidden = false;
  desktopStartupToggle.disabled = true;
  window.sxlDesktop.getStartupSettings().then(settings => {
    desktopStartupOption.hidden = !settings.available;
    desktopStartupToggle.checked = settings.enabled;
    desktopStartupMessage.textContent = settings.enabled
      ? 'SINZ akan dibuka otomatis saat Anda masuk ke Windows.'
      : 'SINZ tidak akan dijalankan otomatis saat Windows masuk.';
  }).catch(error => {
    desktopStartupMessage.style.color = 'var(--bad)';
    desktopStartupMessage.textContent = `Pengaturan startup tidak dapat dibaca: ${error.message}`;
  }).finally(() => { desktopStartupToggle.disabled = false; });
  desktopStartupToggle.addEventListener('change', async () => {
    const enabled = desktopStartupToggle.checked;
    desktopStartupToggle.disabled = true;
    desktopStartupMessage.style.color = 'var(--muted)';
    desktopStartupMessage.textContent = 'Menyimpan pilihan startup…';
    try {
      const result = await window.sxlDesktop.setStartupOnLogin(enabled);
      desktopStartupToggle.checked = result.enabled;
      desktopStartupMessage.style.color = 'var(--good, #24845d)';
      desktopStartupMessage.textContent = result.enabled
        ? 'SINZ akan dibuka otomatis saat Anda masuk ke Windows.'
        : 'SINZ tidak akan dijalankan otomatis saat Windows masuk.';
    } catch (error) {
      desktopStartupToggle.checked = !enabled;
      desktopStartupMessage.style.color = 'var(--bad)';
      desktopStartupMessage.textContent = `Pilihan startup tidak dapat disimpan: ${error.message}`;
    } finally { desktopStartupToggle.disabled = false; }
  });
}

$('servicesRefresh').addEventListener('click', refreshServices);
$('startAllServices').addEventListener('click', async () => {
  if (!await askConfirm('Jalankan semua layanan yang sudah terpasang (MariaDB, Apache, dan phpMyAdmin jika tersedia)?')) return;
  await serviceAction('startAllServices', 'Menjalankan…', '/api/services/start-all', 'apacheMessage');
});
$('stopAllServices').addEventListener('click', async () => {
  if (!await askConfirm('Hentikan phpMyAdmin, Apache, dan MariaDB? Proyek yang sedang berjalan juga akan tetap terpisah.')) return;
  await serviceAction('stopAllServices', 'Menghentikan…', '/api/services/stop-all', 'apacheMessage');
});
$('phpInstall').addEventListener('click', async () => {
  if (!await askConfirm('Pasang atau siapkan PHP 8.3 untuk SINZ? Windows menggunakan runtime portable yang checksum-nya diverifikasi; macOS memasang php@8.3 melalui Homebrew.')) return;
  await serviceAction('phpInstall', 'Memasang PHP…', '/api/services/php/install', 'phpMessage');
});
$('composerInstall').addEventListener('click', async () => {
  if (!await askConfirm('Unduh Composer dari getcomposer.org, verifikasi SHA-256, lalu simpan di folder runtime SINZ?')) return;
  await serviceAction('composerInstall', 'Memasang Composer…', '/api/services/composer/install', 'composerMessage');
});
$('apacheInstall').addEventListener('click', async () => {
  if (!await askConfirm('Pasang Apache untuk SINZ? Windows mengunduh binary Apache Lounge melalui HTTPS; macOS menggunakan Homebrew. Apache hanya akan bind ke 127.0.0.1 dan SINZ membuat konfigurasi terpisah.')) return;
  await serviceAction('apacheInstall', 'Memasang Apache…', '/api/services/apache/install', 'apacheMessage');
});
$('apacheStart').addEventListener('click', () => serviceAction('apacheStart', 'Menjalankan…', '/api/services/apache/start', 'apacheMessage'));
$('apacheStop').addEventListener('click', () => serviceAction('apacheStop', 'Menghentikan…', '/api/services/apache/stop', 'apacheMessage'));
$('apacheOpen').addEventListener('click', () => serviceAction('apacheOpen', 'Membuka…', '/api/services/apache/open', 'apacheMessage'));
$('pmaInstall').addEventListener('click', async () => {
  if (!await askConfirm('Unduh dan pasang phpMyAdmin 5.2.3 dari server resmi phpMyAdmin? SINZ memverifikasi SHA-256 sebelum ekstraksi. phpMyAdmin membutuhkan PHP 8.3 dan MariaDB yang berjalan untuk login.')) return;
  await serviceAction('pmaInstall', 'Mengunduh…', '/api/services/phpmyadmin/install', 'pmaMessage');
});
$('pmaStart').addEventListener('click', () => serviceAction('pmaStart', 'Menjalankan…', '/api/services/phpmyadmin/start', 'pmaMessage'));
$('pmaStop').addEventListener('click', () => serviceAction('pmaStop', 'Menghentikan…', '/api/services/phpmyadmin/stop', 'pmaMessage'));
$('pmaOpen').addEventListener('click', () => serviceAction('pmaOpen', 'Membuka…', '/api/services/phpmyadmin/open', 'pmaMessage'));

async function runDiagnostics() {
  const button = $('runDiagnostics'); const summary = $('diagnosticsSummary'); const list = $('diagnosticsList');
  if (button) { button.disabled = true; button.textContent = 'Memeriksa…'; }
  if (summary) summary.textContent = 'Memeriksa runtime dan layanan. Proses ini dapat memakan beberapa detik.';
  if (list) list.replaceChildren();
  try {
    const result = await api('/api/diagnostics');
    const counts = result.summary || {};
    if (summary) summary.textContent = `${counts.ok || 0} berhasil · ${counts.warning || 0} peringatan · ${counts.failed || 0} gagal · Diperiksa ${new Date(result.generatedAt).toLocaleString()}`;
    for (const check of result.checks || []) {
      const row = document.createElement('article'); row.className = `diagnostic-item diagnostic-${check.status}`;
      const head = document.createElement('div'); head.className = 'diagnostic-head';
      const title = document.createElement('strong'); title.textContent = check.label;
      const badge = document.createElement('span'); badge.className = 'diagnostic-status'; badge.textContent = check.status === 'ok' ? 'OK' : check.status === 'warn' ? 'Perlu perhatian' : 'Gagal';
      head.append(title, badge);
      const message = document.createElement('p'); message.textContent = check.message || '';
      row.append(head, message);
      if (check.details) { const details = document.createElement('small'); details.textContent = check.details; row.appendChild(details); }
      list?.appendChild(row);
    }
  } catch (error) {
    if (summary) summary.textContent = `Diagnostik gagal: ${error.message}`;
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Jalankan Diagnostik'; }
  }
}
$('runDiagnostics')?.addEventListener('click', runDiagnostics);

$('dbCreateDatabase').addEventListener('click', async () => {
  const name = $('dbNewName').value.trim();
  if (!name) { setDbError('Masukkan nama database.'); return; }
  databaseBusy = true; $('dbCreateDatabase').disabled = true; $('dbCreateMessage').textContent = 'Membuat database…'; setDbError('');
  try {
    const result = await api('/api/database/create', { method: 'POST', body: JSON.stringify({ name }) });
    $('dbCreateMessage').textContent = result.message; $('dbNewName').value = '';
    await loadDatabaseList(); $('dbContext').value = result.database;
  } catch (e) { $('dbCreateMessage').textContent = e.message; $('dbCreateMessage').style.color = 'var(--bad)'; }
  finally { databaseBusy = false; await refreshDatabase(); }
});
$('dbDropDatabase').addEventListener('click', async () => {
  const name = $('dbContext').value;
  if (!name) { setDbError('Pilih database yang ingin dihapus.'); return; }
  if (!await askConfirm(`Hapus database ${name} beserta semua tabel dan data? Tindakan ini tidak dapat dibatalkan.`)) return;
  databaseBusy = true; $('dbDropDatabase').disabled = true; $('dbCreateMessage').textContent = `Menghapus database ${name}…`;
  try {
    const result = await api('/api/database/drop', { method: 'POST', body: JSON.stringify({ name }) });
    $('dbCreateMessage').textContent = result.message; $('dbContext').value = '';
    await loadDatabaseList();
  } catch (e) { $('dbCreateMessage').textContent = e.message; $('dbCreateMessage').style.color = 'var(--bad)'; }
  finally { databaseBusy = false; await refreshDatabase(); }
});

async function loadProjects() {
  try {
    const result = await api('/api/projects/list');
    $('workspacePath').textContent = result.workspace || '';
    if ($('projectLocation')) $('projectLocation').value = result.workspace || 'Workspace tidak tersedia';
    updateProjectFolderPreview();
    renderProjects(result.projects || []);
  } catch (e) { $('projectMessage').textContent = `Tidak dapat membaca proyek: ${e.message}`; }
}
function updatePublishProjectOptions(projects) {
  const select = $('publishProject'); if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = projects.length ? 'Pilih proyek?' : 'Belum ada proyek'; select.appendChild(placeholder);
  for (const project of projects) {
    const option = document.createElement('option'); option.value = project.slug; option.textContent = project.name || project.slug; select.appendChild(option);
  }
  if (projects.some(project => project.slug === previous)) select.value = previous;
}
function renderProjects(projects) {
  updatePublishProjectOptions(projects);
  const host = $('projectList'); if (!host) return;
  host.replaceChildren();
  if (!projects.length) { const empty = document.createElement('div'); empty.className = 'db-result-empty'; empty.textContent = 'Belum ada proyek. Gunakan “Buat Proyek” untuk memulai.'; host.appendChild(empty); return; }
  for (const project of projects) {
    const row = document.createElement('div'); row.className = 'project-row';
    const main = document.createElement('div'); main.className = 'project-main';
    const projectKind = project.framework ? `${project.framework.toUpperCase()} ${project.frameworkVersion || ''}`.trim() : project.type.toUpperCase();
    const name = document.createElement('strong'); name.textContent = `${project.name || project.slug} · ${projectKind}`;
    const pathNode = document.createElement('small'); pathNode.textContent = `${project.path}${project.running && project.url ? ` · ${project.url}` : ''}`;
    main.append(name, pathNode); row.appendChild(main);
    const actions = document.createElement('div'); actions.className = 'project-actions';
    if (project.type === 'php') {
      const phpWrap = document.createElement('label'); phpWrap.className = 'project-php-picker';
      const phpLabel = document.createElement('span'); phpLabel.textContent = 'Versi PHP proyek';
      const phpSelect = document.createElement('select'); phpSelect.className = 'input project-php-select'; phpSelect.setAttribute('aria-label', `Versi PHP untuk ${project.slug}`);
      const globalOption = document.createElement('option'); globalOption.value = ''; globalOption.textContent = 'Gunakan versi global'; phpSelect.appendChild(globalOption);
      const versions = Array.isArray(phpVersionsData?.versions) ? phpVersionsData.versions : [];
      for (const version of versions) {
        const option = document.createElement('option'); option.value = version.phpBinary;
        option.textContent = `PHP ${version.version || version.label}${version.phpCgiBinary && version.cgiVersion === version.version ? ' · FastCGI siap' : ' · FastCGI belum siap'}`;
        option.disabled = !version.executable || Boolean(version.error) || !version.phpCgiBinary || version.cgiVersion !== version.version;
        if (project.phpBinary && version.phpBinary === project.phpBinary) option.selected = true;
        phpSelect.appendChild(option);
      }
      if (project.phpBinary && !versions.some(item => item.phpBinary === project.phpBinary)) {
        const missing = document.createElement('option'); missing.value = project.phpBinary; missing.textContent = `Path tidak tersedia: ${project.phpBinary}`; missing.selected = true; missing.disabled = true; phpSelect.appendChild(missing);
      }
      const savePhp = document.createElement('button'); savePhp.className = 'btn secondary'; savePhp.textContent = 'Simpan PHP'; savePhp.title = 'Atur PHP khusus proyek ini tanpa mengubah pilihan global';
      const updateSavePhpState = () => { savePhp.disabled = Boolean(project.running) || (Boolean(phpSelect.value) && !versions.some(item => item.phpBinary === phpSelect.value && item.executable && !item.error && item.phpCgiBinary && item.cgiVersion === item.version)); };
      phpSelect.addEventListener('change', updateSavePhpState);
      updateSavePhpState();
      savePhp.onclick = async () => {
        savePhp.disabled = true; savePhp.textContent = 'Menyimpan…';
        try {
          const result = await api('/api/projects/php-version', { method: 'POST', body: JSON.stringify({ slug: project.slug, phpBinary: phpSelect.value }) });
          setServiceMessage('projectMessage', result.message || 'Versi PHP proyek disimpan.');
          await refreshServices();
        } catch (error) { setServiceMessage('projectMessage', error.message, true); }
        finally { savePhp.textContent = 'Simpan PHP'; updateSavePhpState(); }
      };
      phpWrap.append(phpLabel, phpSelect); actions.append(phpWrap, savePhp);
    }
    const openFolder = document.createElement('button'); openFolder.className = 'btn secondary'; openFolder.textContent = 'Buka Folder';
    openFolder.onclick = () => api('/api/projects/open-folder', { method: 'POST', body: JSON.stringify({ slug: project.slug }) }).then(r => setServiceMessage('projectMessage', r.message)).catch(e => setServiceMessage('projectMessage', e.message, true));
    actions.appendChild(openFolder);
    const terminal = document.createElement('button'); terminal.className = 'btn secondary'; terminal.textContent = 'Terminal terpisah';
    terminal.title = 'Buka aplikasi terminal sistem langsung di folder proyek';
    terminal.onclick = () => api('/api/projects/open-terminal', { method: 'POST', body: JSON.stringify({ slug: project.slug }) }).then(r => setServiceMessage('projectMessage', r.message)).catch(e => setServiceMessage('projectMessage', e.message, true));
    actions.appendChild(terminal);
    if (project.type === 'php' && project.composerAvailable) {
      const composer = document.createElement('button'); composer.className = 'btn secondary'; composer.textContent = 'Composer Install'; composer.disabled = !servicesState?.composer?.installed;
      composer.title = composer.disabled ? 'Pasang Composer terlebih dahulu di panel layanan.' : 'Menjalankan composer install pada proyek ini';
      composer.onclick = async () => {
        if (!await askConfirm(`Jalankan composer install untuk ${project.slug}? Composer dapat mengeksekusi skrip dari composer.json; lanjutkan hanya untuk proyek yang tepercaya.`)) return;
        composer.disabled = true; composer.textContent = 'Menginstal…'; setServiceMessage('projectMessage', `Menjalankan Composer untuk ${project.slug}…`);
        try { const result = await api('/api/projects/composer-install', { method: 'POST', body: JSON.stringify({ slug: project.slug }) }); setServiceMessage('projectMessage', `${result.message}${result.log ? `\n${result.log}` : ''}`); await loadProjects(); }
        catch (e) { setServiceMessage('projectMessage', e.message, true); }
        finally { composer.disabled = false; composer.textContent = 'Composer Install'; }
      };
      actions.appendChild(composer);
    }
    if (project.running) {
      const open = document.createElement('button'); open.className = 'btn secondary'; open.textContent = 'Buka'; open.onclick = () => api('/api/projects/open', { method: 'POST', body: JSON.stringify({ slug: project.slug }) }).then(r => setServiceMessage('projectMessage', r.message)).catch(e => setServiceMessage('projectMessage', e.message, true));
      const logs = document.createElement('button'); logs.className = 'btn secondary'; logs.textContent = 'Lihat Log'; logs.onclick = () => setServiceMessage('projectMessage', project.log || 'Belum ada output proses proyek.');
      const stop = document.createElement('button'); stop.className = 'btn danger'; stop.textContent = 'Stop'; stop.onclick = async () => { stop.disabled = true; try { const r = await api('/api/projects/stop', { method: 'POST', body: JSON.stringify({ slug: project.slug }) }); setServiceMessage('projectMessage', r.message); await loadProjects(); } catch (e) { setServiceMessage('projectMessage', e.message, true); } };
      actions.append(open, logs, stop);
    } else {
      const start = document.createElement('button'); start.className = 'btn'; start.textContent = 'Jalankan lokal'; start.onclick = async () => {
        start.disabled = true; start.textContent = 'Memulai…'; setServiceMessage('projectMessage', `Menjalankan ${project.slug}…`);
        try {
          let r;
          try { r = await api('/api/projects/start', { method: 'POST', body: JSON.stringify({ slug: project.slug }) }); }
          catch (e) {
            if (project.type !== 'node' || !/Dependensi npm belum terpasang/.test(e.message) || !await askConfirm('Proyek ini membutuhkan dependensi npm. Instal hanya jika proyek tepercaya. Lanjutkan npm install?')) throw e;
            r = await api('/api/projects/start', { method: 'POST', body: JSON.stringify({ slug: project.slug, installDependencies: true }) });
          }
          setServiceMessage('projectMessage', r.message || 'Proyek aktif.'); await loadProjects();
        } catch (e) { setServiceMessage('projectMessage', e.message, true); }
        finally { start.disabled = false; start.textContent = 'Jalankan lokal'; }
      };
      actions.appendChild(start);
      if (project.type === 'static' && servicesState?.apache?.running) {
        const virtual = document.createElement('button'); virtual.className = 'btn secondary'; virtual.textContent = 'Apache virtual host'; virtual.title = `http://${project.slug}.localhost:${servicesState.apache.port}`;
        virtual.onclick = () => api('/api/projects/open', { method: 'POST', body: JSON.stringify({ slug: project.slug }) }).then(r => setServiceMessage('projectMessage', `Virtual host dibuka: http://${project.slug}.localhost:${servicesState.apache.port}`)).catch(e => setServiceMessage('projectMessage', e.message, true));
        actions.appendChild(virtual);
      }
    }
    const rowControls = document.createElement('div'); rowControls.className = 'project-row-controls';
    const manage = document.createElement('button'); manage.className = 'btn secondary'; manage.type = 'button'; manage.textContent = 'Kelola';
    actions.classList.add('project-dialog-actions');
    manage.addEventListener('click', () => {
      $('projectActionsTitle').textContent = project.name || project.slug;
      $('projectActionsHint').textContent = `${project.type.toUpperCase()} · ${project.running ? 'Sedang berjalan' : 'Berhenti'}`;
      $('projectActionContent').replaceChildren(actions);
      $('projectActionsDialog').showModal();
    });
    const publish = document.createElement('button'); publish.className = 'btn project-publish-trigger'; publish.type = 'button'; publish.textContent = 'Push ke GitHub';
    publish.addEventListener('click', () => {
      const select = $('publishProject');
      select.value = project.slug;
      select.dispatchEvent(new Event('change'));
      $('publishName').value = project.slug;
      $('publishVisibility').value = 'private';
      $('publishProjectLabel').textContent = `${project.name || project.slug} · ${project.type.toUpperCase()}`;
      $('publishGithubMessage').textContent = '';
      $('projectPublishDialog').showModal();
      $('publishName').focus();
    });
    rowControls.append(manage, publish);
    row.appendChild(rowControls);
    host.appendChild(row);
  }
}
let publishPreviewFiles = null;
let publishPreviewSlug = '';
let publishPreviewGitignore = null;
function clearPublishPreview(message = 'Langkah 2: buat pratinjau untuk meninjau file dan checksum sebelum publikasi.') {
  publishPreviewFiles = null;
  publishPreviewSlug = '';
  publishPreviewGitignore = null;
  const list = $('publishPreviewFiles');
  if (list) list.replaceChildren();
  const excludedList = $('publishExcludedFiles'); if (excludedList) excludedList.replaceChildren();
  const gitignoreInfo = $('publishGitignoreInfo');
  if (gitignoreInfo) { gitignoreInfo.replaceChildren(); gitignoreInfo.hidden = true; }
  if ($('publishPreviewSummary')) $('publishPreviewSummary').textContent = '';
  if ($('publishExcludedHeading')) $('publishExcludedHeading').hidden = true;
  const previewMessage = $('publishPreviewMessage');
  if (previewMessage) { previewMessage.textContent = message; previewMessage.style.color = 'var(--muted)'; }
  if ($('publishConfirmFiles')) { $('publishConfirmFiles').checked = false; $('publishConfirmFiles').disabled = true; }
  if ($('publishGithub')) $('publishGithub').disabled = true;
}
function validPublishPreview(files) {
  return Array.isArray(files) && files.length > 0 && files.every(file =>
    file && typeof file === 'object' && !Array.isArray(file) &&
    typeof file.path === 'string' && file.path.length > 0 &&
    Number.isSafeInteger(file.size) && file.size >= 0 &&
    typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(file.sha256)
  );
}
function validGitignorePlan(plan) {
  return Boolean(plan && typeof plan === 'object' && !Array.isArray(plan) &&
    ['created', 'updated', 'unchanged'].includes(plan.action) &&
    (plan.originalSha256 === null || (typeof plan.originalSha256 === 'string' && /^[a-f0-9]{64}$/i.test(plan.originalSha256))) &&
    typeof plan.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(plan.sha256) &&
    Array.isArray(plan.addedRules) && plan.addedRules.every(rule => typeof rule === 'string' && rule.length > 0)
  );
}
$('publishProject')?.addEventListener('change', () => {
  clearPublishPreview();
  const option = $('publishProject').selectedOptions[0];
  if (option && option.value && !$('publishName').value.trim()) $('publishName').value = option.textContent.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
});
$('closeProjectActions')?.addEventListener('click', () => $('projectActionsDialog').close());
$('closePublishDialog')?.addEventListener('click', () => $('projectPublishDialog').close());
$('publishPreview')?.addEventListener('click', async () => {
  const slug = $('publishProject').value;
  if (!slug) { clearPublishPreview('Pilih proyek sebelum membuat pratinjau.'); $('publishProject').focus(); return; }
  const button = $('publishPreview'); button.disabled = true;
  const list = $('publishPreviewFiles'); if (list) list.replaceChildren();
  const excludedList = $('publishExcludedFiles'); if (excludedList) excludedList.replaceChildren();
  if ($('publishPreviewSummary')) $('publishPreviewSummary').textContent = '';
  if ($('publishExcludedHeading')) $('publishExcludedHeading').hidden = true;
  const previewMessage = $('publishPreviewMessage');
  if (previewMessage) { previewMessage.textContent = 'Memindai file dan menghitung SHA-256. Belum ada file atau aturan yang diubah.'; previewMessage.style.color = 'var(--muted)'; }
  if ($('publishConfirmFiles')) { $('publishConfirmFiles').checked = false; $('publishConfirmFiles').disabled = true; }
  if ($('publishGithub')) $('publishGithub').disabled = true;
  publishPreviewFiles = null; publishPreviewSlug = '';
  try {
    // Keep these exact preview objects: the publishing API compares them with its fresh scan.
    const result = await api('/api/projects/github-preview', { method: 'POST', body: JSON.stringify({ slug }) });
    if (!validPublishPreview(result.files)) throw new Error('Pratinjau tidak berisi daftar file valid (path, ukuran, SHA-256).');
    if (!validGitignorePlan(result.gitignore)) throw new Error('Rencana .gitignore dari server tidak valid. Tutup dialog lalu coba lagi.');
    publishPreviewFiles = result.files;
    publishPreviewSlug = slug;
    publishPreviewGitignore = result.gitignore;
    for (const file of publishPreviewFiles) {
      const item = document.createElement('li');
      item.textContent = file.path;
      list?.appendChild(item);
    }
    const totalBytes = Number.isSafeInteger(result.totalBytes) && result.totalBytes >= 0 ? result.totalBytes : publishPreviewFiles.reduce((sum, file) => sum + file.size, 0);
    const repoLabel = result.gitRepository ? ' | Metadata Git terdeteksi; remote dan riwayat akan diperiksa saat publikasi' : '';
    $('publishPreviewSummary').textContent = `${publishPreviewFiles.length} file | ${totalBytes.toLocaleString()} byte${repoLabel}`;
    const gitignoreInfo = $('publishGitignoreInfo');
    if (gitignoreInfo) {
      gitignoreInfo.replaceChildren();
      const heading = document.createElement('strong');
      const actionLabel = {
        created: 'File .gitignore baru akan dibuat setelah Anda menerbitkan.',
        updated: 'Aturan aman akan ditambahkan ke .gitignore yang sudah ada setelah Anda menerbitkan.',
        unchanged: '.gitignore sudah memuat aturan yang disarankan; isinya tidak akan diubah.'
      };
      heading.textContent = actionLabel[result.gitignore.action];
      gitignoreInfo.appendChild(heading);
      if (result.gitignore.addedRules.length) {
        const explanation = document.createElement('p');
        explanation.textContent = 'Aturan tambahan:';
        const rules = document.createElement('ul');
        for (const rule of result.gitignore.addedRules) {
          const item = document.createElement('li');
          item.textContent = rule;
          rules.appendChild(item);
        }
        gitignoreInfo.append(explanation, rules);
      }
      gitignoreInfo.hidden = false;
    }
    const excluded = Array.isArray(result.excluded) ? result.excluded : [];
    $('publishExcludedHeading').hidden = excluded.length === 0;
    for (const entry of excluded) {
      if (!entry || typeof entry.path !== 'string') continue;
      const item = document.createElement('li');
      item.textContent = `${entry.path}${typeof entry.reason === 'string' && entry.reason ? ` | ${entry.reason}` : ''}`;
      excludedList?.appendChild(item);
    }
    if (previewMessage) { previewMessage.textContent = `Langkah 2 selesai: ${publishPreviewFiles.length} file diperiksa. File dan rencana .gitignore diverifikasi ulang sebelum dikirim.`; previewMessage.style.color = 'var(--good, #24845d)'; }
    $('publishConfirmFiles').disabled = false;
  } catch (error) {
    clearPublishPreview(`Pratinjau gagal: ${error.message}`);
    $('publishPreviewMessage').style.color = 'var(--bad)';
  } finally { button.disabled = false; }
});
$('publishConfirmFiles')?.addEventListener('change', () => {
  const ready = Boolean(publishPreviewFiles && publishPreviewGitignore && publishPreviewSlug === $('publishProject').value && $('publishConfirmFiles').checked);
  $('publishGithub').disabled = !ready;
});
$('publishGithub')?.addEventListener('click', async () => {
  const slug = $('publishProject').value;
  const name = $('publishName').value.trim();
  const visibility = $('publishVisibility').value;
  // Deliberately send the same path/size/hash objects received from the preview response.
  const confirmFiles = publishPreviewFiles;
  const confirmGitignore = publishPreviewGitignore;
  const message = $('publishGithubMessage');
  const showMessage = (text, error = false) => { message.textContent = text || ''; message.style.color = error ? 'var(--bad)' : 'var(--muted)'; };
  if (!slug) { showMessage('Pilih proyek yang akan diterbitkan.', true); $('publishProject').focus(); return; }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,99})?$/.test(name)) { showMessage('Gunakan nama repository atau pemilik/nama-repository. Setiap bagian harus 1-100 karakter berisi huruf, angka, titik, garis bawah, atau tanda hubung.', true); $('publishName').focus(); return; }
  if (!['private', 'public'].includes(visibility)) { showMessage('Pilih visibilitas repository yang valid.', true); return; }
  if (!validPublishPreview(confirmFiles) || !validGitignorePlan(confirmGitignore) || publishPreviewSlug !== slug) { showMessage('Buat pratinjau baru untuk proyek ini sebelum menerbitkan.', true); clearPublishPreview('Pratinjau sudah tidak berlaku. Buat pratinjau baru.'); return; }
  if (!$('publishConfirmFiles').checked) { showMessage('Periksa dan konfirmasi daftar file pratinjau terlebih dahulu.', true); $('publishConfirmFiles').focus(); return; }
  if (!await askConfirm(`Terbitkan proyek ${slug} ke GitHub sebagai repository ${visibility} "${name}"? File dan aturan .gitignore yang ditinjau akan diterapkan. Pastikan daftar file tidak memuat rahasia.`, 'Konfirmasi publikasi GitHub', 'Terbitkan proyek')) return;
  const button = $('publishGithub'); const previewButton = $('publishPreview');
  button.disabled = true; previewButton.disabled = true;
  showMessage('Langkah 3 dari 4: memverifikasi ulang file dan aturan .gitignore...');
  try {
    const result = await api('/api/projects/publish-to-github', { method: 'POST', body: JSON.stringify({ slug, name, visibility, confirmFiles, confirmGitignore }) });
    const detail = `${result.message || 'Proyek berhasil diterbitkan.'} ${result.repository ? `Repository: ${result.repository}.` : ''} Visibilitas: ${visibility}. Branch: ${result.branch || 'main'}. File: ${result.filesPublished ?? confirmFiles.length}.`;
    showMessage(detail); showGlobalToast(detail);
    clearPublishPreview('Publikasi selesai. Buat pratinjau baru untuk publikasi berikutnya.');
    $('projectPublishDialog').close();
  } catch (error) {
    showMessage(error.message, true); showGlobalToast(`Publikasi GitHub gagal: ${error.message}`, true);
    clearPublishPreview('Publikasi gagal. Buat pratinjau baru untuk memverifikasi file terkini.');
  } finally {
    previewButton.disabled = false;
    button.disabled = true;
  }
});

$('projectCreate').addEventListener('click', () => {
  $('projectCreateMessage').textContent = '';
  $('projectCreateSubmit').disabled = true;
  $('projectCreateDialog').showModal();
  $('projectName').focus();
  checkProjectWizardDependencies();
});
function updateProjectFolderPreview() {
  const root = $('projectLocation')?.value || '';
  const normalized = ($('projectName')?.value || '').trim().toLowerCase().replace(/\s+/g, '-');
  const preview = $('projectFolderPreview');
  if (!preview) return;
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(normalized)) {
    preview.textContent = root ? `${root}${root.includes('\\') ? '\\' : '/'}[nama proyek tidak valid]` : 'Masukkan nama proyek yang valid';
    return;
  }
  preview.textContent = `${root}${root.includes('\\') ? '\\' : '/'}${normalized}`;
}
$('projectName').addEventListener('input', updateProjectFolderPreview);
function renderProjectDependencyChecks(checks, ready) {
  const host = $('projectDependencyList');
  if (!host) return;
  host.replaceChildren();
  for (const check of checks) {
    const row = document.createElement('div'); row.className = `project-dependency-row ${check.ok ? 'is-ready' : 'is-blocked'}`;
    const label = document.createElement('strong'); label.textContent = `${check.ok ? '✓' : '!' } ${check.name}${check.version ? ` · ${check.version}` : ''}`;
    const message = document.createElement('small'); message.textContent = check.message;
    row.append(label, message); host.appendChild(row);
  }
  $('projectCreateSubmit').disabled = !ready;
}
async function checkProjectWizardDependencies() {
  const button = $('projectCheckDependencies');
  const submit = $('projectCreateSubmit');
  if (button) { button.disabled = true; button.textContent = 'Memeriksa…'; }
  if (submit) submit.disabled = true;
  try {
    const result = await api('/api/projects/dependencies', {
      method: 'POST',
      body: JSON.stringify({ type: $('projectType').value, initializeGit: $('projectInitializeGit').checked })
    });
    renderProjectDependencyChecks(result.checks || [], Boolean(result.ready));
    if ($('projectLocation') && result.workspace) $('projectLocation').value = result.workspace;
    updateProjectFolderPreview();
    if (result.ready) $('projectCreateMessage').textContent = 'Semua prasyarat wajib tersedia. Pembuatan baru dimulai setelah tombol Buat Proyek ditekan.';
    else $('projectCreateMessage').textContent = 'Perbaiki prasyarat yang ditandai sebelum membuat proyek. Download Center dapat dibuka tanpa kehilangan pilihan.';
  } catch (error) {
    renderProjectDependencyChecks([{ name: 'Pemeriksaan', ok: false, message: error.message }], false);
    $('projectCreateMessage').textContent = error.message;
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Periksa dependensi'; }
  }
}
$('projectCheckDependencies').addEventListener('click', checkProjectWizardDependencies);
$('projectType').addEventListener('change', checkProjectWizardDependencies);
$('projectInitializeGit').addEventListener('change', checkProjectWizardDependencies);
$('projectWizardDownloadCenter').addEventListener('click', () => {
  $('projectCreateDialog').close();
  navigateSxlPage('downloads');
});
$('projectCreateSubmit').addEventListener('click', async () => {
  const name = $('projectName').value.trim(); const type = $('projectType').value;
  const button = $('projectCreateSubmit');
  if (!name) { $('projectCreateMessage').textContent = 'Masukkan nama proyek.'; $('projectName').focus(); return; }
  button.disabled = true; button.textContent = 'Memeriksa…'; $('projectCreateMessage').textContent = 'Memeriksa dependensi dan lokasi proyek…';
  try {
    const dependencies = await api('/api/projects/dependencies', {
      method: 'POST',
      body: JSON.stringify({ type, initializeGit: $('projectInitializeGit').checked })
    });
    renderProjectDependencyChecks(dependencies.checks || [], Boolean(dependencies.ready));
    if (!dependencies.ready) throw new Error('Prasyarat belum terpenuhi. Periksa daftar dependensi sebelum membuat proyek.');
    if (type === 'laravel' && !await askConfirm('SINZ akan mengunduh paket Laravel stabil terbaru melalui Composer, membuat konfigurasi SQLite lokal, dan memverifikasi file artisan/composer.json. File parsial tidak akan dihapus jika proses gagal. Lanjutkan?', 'Konfirmasi pembuatan Laravel', 'Buat Proyek')) return;
    button.textContent = type === 'laravel' ? 'Membuat Laravel…' : 'Membuat…';
    $('projectCreateMessage').textContent = type === 'laravel' ? 'Composer sedang mengunduh dan memasang Laravel. Jangan tutup SINZ.' : 'Menyiapkan struktur proyek…';
    const result = await api('/api/projects/create', { method: 'POST', body: JSON.stringify({ name, type, initializeGit: $('projectInitializeGit').checked }) });
    $('projectName').value = '';
    $('projectCreateDialog').close();
    setServiceMessage('projectMessage', `${result.message}${result.log ? `\n${result.log}` : ''}`);
    showGlobalToast(result.message || 'Proyek berhasil dibuat.');
    await loadProjects();
  } catch (error) {
    $('projectCreateMessage').textContent = error.message;
    $('projectCreateMessage').style.color = 'var(--bad)';
  } finally {
    button.textContent = 'Buat Proyek';
    await checkProjectWizardDependencies();
  }
});
$('openWorkspace').addEventListener('click', async () => {
  try { const result = await api('/api/projects/open-workspace', { method: 'POST', body: '{}' }); setServiceMessage('projectMessage', result.message); }
  catch (e) { setServiceMessage('projectMessage', e.message, true); }
});
$('openWorkspaceTerminal').addEventListener('click', async () => {
  try { const result = await api('/api/projects/open-workspace-terminal', { method: 'POST', body: '{}' }); setServiceMessage('projectMessage', result.message); }
  catch (e) { setServiceMessage('projectMessage', e.message, true); }
});
$('projectRefresh').addEventListener('click', loadProjects);
refreshServices();
window.setInterval(refreshServices, 4000);


// Independent feature tabs keep large settings forms out of the way until needed.
function setDatabaseEngine(value) {
  document.querySelectorAll('[data-db-engine-tab]').forEach(button => {
    const selected = button.dataset.dbEngineTab === value;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('[data-db-engine-panel]').forEach(panel => { panel.hidden = panel.dataset.dbEnginePanel !== value; });
}
function setMariaDbTab(value) {
  document.querySelectorAll('[data-db-subtab]').forEach(button => {
    const selected = button.dataset.dbSubtab === value;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('[data-db-subpanel]').forEach(panel => { panel.hidden = panel.dataset.dbSubpanel !== value; });
}
function setExtraDbEngine(value) {
  document.querySelectorAll('[data-extra-engine-tab]').forEach(button => {
    const selected = button.dataset.extraEngineTab === value;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('[data-extra-engine-panel]').forEach(panel => { panel.hidden = panel.dataset.extraEnginePanel !== value; });
  document.querySelector('.extra-db-grid')?.classList.toggle('single', true);
}
function setServiceTab(value) {
  document.querySelectorAll('[data-service-tab]').forEach(button => {
    const selected = button.dataset.serviceTab === value;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('[data-service-panel]').forEach(panel => { panel.hidden = panel.dataset.servicePanel !== value; });
}
function setSettingsTab(value) {
  document.querySelectorAll('[data-settings-tab]').forEach(button => {
    const selected = button.dataset.settingsTab === value;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('[data-settings-category]').forEach(panel => { panel.hidden = panel.dataset.settingsCategory !== value; });
}
document.querySelectorAll('[data-db-engine-tab]').forEach(button => button.addEventListener('click', () => setDatabaseEngine(button.dataset.dbEngineTab)));
document.querySelectorAll('[data-db-subtab]').forEach(button => button.addEventListener('click', () => setMariaDbTab(button.dataset.dbSubtab)));
document.querySelectorAll('[data-extra-engine-tab]').forEach(button => button.addEventListener('click', () => setExtraDbEngine(button.dataset.extraEngineTab)));
document.querySelectorAll('[data-service-tab]').forEach(button => button.addEventListener('click', () => setServiceTab(button.dataset.serviceTab)));
document.querySelectorAll('[data-settings-tab]').forEach(button => button.addEventListener('click', () => setSettingsTab(button.dataset.settingsTab)));
setSettingsTab('sharing');

// SXL page navigation and live dashboard summary.
// Each tool has its own workspace page rather than appearing as one long landing page.
const SXL_PAGE_META = {
  dashboard: { kicker: 'RUANG KERJA / RINGKASAN', title: 'Dashboard', subtitle: 'Ringkasan lingkungan pengembangan lokal kamu.' },
  projects:  { kicker: 'RUANG KERJA / PROYEK', title: 'Pengelola Proyek', subtitle: 'Buat, temukan, jalankan, dan kelola proyek lokal.' },
  downloads: { kicker: 'TOOLS / RUNTIME', title: 'Download Center', subtitle: 'Temukan sumber resmi, verifikasi instalasi, dan pasang runtime yang didukung SINZ.' },
  'download-history': { kicker: 'TOOLS / RIWAYAT', title: 'Aktivitas Download Center', subtitle: 'Tinjau hasil instalasi pada sesi ini.' },
  apps:      { kicker: 'APLIKASI / LAYANAN', title: 'Aplikasi', subtitle: 'Kelola aplikasi lokal dan operasikan layanan web.' },
  settings:  { kicker: 'PREFERENSI / KONFIGURASI', title: 'Pengaturan', subtitle: 'Atur runtime, port, akses berbagi, dan preferensi SINZ.' },
  database:  { kicker: 'DATA / PENYIMPANAN', title: 'Database', subtitle: 'Pilih engine, lalu buka fitur runtime, data, query, atau backup sesuai kebutuhan.' },
  sharing:   { kicker: 'PUBLIKASI / BERBAGI', title: 'Berbagi Website', subtitle: 'Buat URL HTTPS untuk menguji website dari perangkat lain.' },
  guide:     { kicker: 'BANTUAN / DOKUMENTASI', title: 'Panduan SINZ', subtitle: 'Pahami alur kerja dan gunakan lingkungan lokal dengan aman.' }
};
function navigateSxlPage(page, updateHash = true) {
  if (!SXL_PAGE_META[page]) page = 'dashboard';
  document.querySelectorAll('[data-page-view]').forEach(view => {
    const selected = view.dataset.pageView === page;
    view.hidden = !selected;
    view.classList.toggle('active', selected);
  });
  document.querySelectorAll('[data-nav]').forEach(button => {
    const selected = button.dataset.nav === page;
    if (button.classList.contains('nav-item')) {
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  });
  const meta = SXL_PAGE_META[page];
  $('pageKicker').textContent = meta.kicker;
  $('pageTitle').textContent = meta.title;
  $('pageSubtitle').textContent = meta.subtitle;
  document.title = `${meta.title} · SINZ`;
  if (updateHash && window.location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  $('sidebar')?.classList.remove('open');
  $('sidebarBackdrop').hidden = true;
  $('mobileNavToggle')?.setAttribute('aria-expanded', 'false');
  if (page === 'projects') loadProjects();
  if (page === 'downloads') loadDownloadCatalog(true);
  if (page === 'download-history') renderDownloadHistory();
  syncOverviewMetrics();
}
document.querySelectorAll('[data-nav]').forEach(button => {
  button.addEventListener('click', () => navigateSxlPage(button.dataset.nav));
});
$('dashboardCreateProject')?.addEventListener('click', () => {
  navigateSxlPage('projects');
  $('projectCreate').click();
});
$('dashboardStartDatabase')?.addEventListener('click', () => {
  if (!$('dbStart').disabled) $('dbStart').click();
  else navigateSxlPage('database');
});
$('dashboardOpenSql')?.addEventListener('click', () => $('launchSqlTerminal')?.click());
window.addEventListener('hashchange', () => navigateSxlPage(window.location.hash.slice(1), false));
$('mobileNavToggle')?.addEventListener('click', () => {
  const opened = $('sidebar').classList.toggle('open');
  $('sidebarBackdrop').hidden = !opened;
  $('mobileNavToggle').setAttribute('aria-expanded', String(opened));
});
$('sidebarBackdrop')?.addEventListener('click', () => {
  $('sidebar').classList.remove('open');
  $('sidebarBackdrop').hidden = true;
  $('mobileNavToggle')?.setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    $('sidebar')?.classList.remove('open');
    if ($('sidebarBackdrop')) $('sidebarBackdrop').hidden = true;
    $('mobileNavToggle')?.setAttribute('aria-expanded', 'false');
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && ['1','2','3','4','5','6','7'].includes(event.key)) {
    const order = ['dashboard', 'projects', 'database', 'apps', 'settings', 'guide', 'downloads'];
    event.preventDefault(); navigateSxlPage(order[Number(event.key) - 1]);
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    const currentTab = event.target.closest?.('[data-settings-tab]');
    if (!currentTab) return;
    const tabs = [...document.querySelectorAll('[data-settings-tab]')];
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(tabs.indexOf(currentTab) + direction + tabs.length) % tabs.length];
    event.preventDefault();
    next.focus();
    next.click();
  }
});
function syncOverviewMetrics() {
  const sharingText = $('statusText')?.textContent || '';
  const sharingValue = /aktif/i.test(sharingText) && !/tidak/i.test(sharingText) ? 'Aktif' : /menghubungkan/i.test(sharingText) ? 'Menghubungkan…' : 'Tidak aktif';
  if ($('overviewSharingStatus')) $('overviewSharingStatus').textContent = sharingValue;
  const dbText = $('dbStatusText')?.textContent || '';
  const dbOverview = databaseStatus?.running ? 'Berjalan'
    : databaseStatus?.installed ? 'Berhenti'
      : databaseStatus?.repairable ? 'Perlu pemulihan'
        : /memeriksa/i.test(dbText) ? 'Memeriksa…' : 'Belum siap';
  if ($('overviewDatabaseStatus')) $('overviewDatabaseStatus').textContent = dbOverview;
  const apacheText = $('apacheState')?.textContent || '';
  if ($('overviewApacheStatus')) $('overviewApacheStatus').textContent = /aktif/i.test(apacheText) ? 'Aktif' : /terpasang/i.test(apacheText) ? 'Terpasang' : /memeriksa/i.test(apacheText) ? 'Memeriksa…' : 'Belum siap';
  const projectRows = document.querySelectorAll('#projectList .project-row').length;
  if ($('overviewProjectCount')) $('overviewProjectCount').textContent = String(projectRows);
  if ($('navDatabaseDot')) {
    $('navDatabaseDot').classList.toggle('good', Boolean(databaseStatus?.running));
    $('navDatabaseDot').classList.toggle('warn', Boolean(databaseStatus?.installed && !databaseStatus?.running));
  }
  if ($('navServiceCount')) {
    const ready = ['apacheState', 'phpState', 'composerState', 'pmaState'].filter(id => {
      const value = $(id)?.textContent || '';
      return /aktif|tersedia|terpasang|terdeteksi/i.test(value) && !/belum/i.test(value);
    }).length;
    $('navServiceCount').textContent = `${ready}/4`;
  }
}
const initialSxlPage = window.location.hash.slice(1);
navigateSxlPage(SXL_PAGE_META[initialSxlPage] ? initialSxlPage : 'dashboard', false);
window.setInterval(syncOverviewMetrics, 1500);
