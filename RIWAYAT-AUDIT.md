# Arsip Audit dan Pengujian SXL Localhost

<!-- Sumber: RIWAYAT-AUDIT.md -->
# Audit SXL Localhost + integrasi MariaDB 13.0.2

**Tanggal audit:** 27 Oktober 2026 (Asia/Jakarta)  
**Versi source hasil kerja:** SXL Localhost 0.14.2  
**Source asal:** `SXL-Localhost-v0.14.0-Stability-Project-PHP.zip`  
**Target tambahan:** MariaDB Server 13.0.2 Windows x64  
**Status:** hardening source dan paket runtime disiapkan; unit test Linux lulus; validasi native Windows masih diperlukan.

## Ringkasan keputusan

Integrasi dibuat sebagai versi database tambahan dalam Database Manager yang sudah ada. Pilihan awal tetap runtime lama (`mariadb-managed`); pemasangan MariaDB 13.0.2 tidak otomatis mengaktifkan versi baru. Direktori database lama tetap pada path kompatibilitasnya. Tidak ada database lama yang disalin, di-upgrade, atau dihapus.

MariaDB 13.0.2 merupakan stable rolling release, **bukan LTS**. Pertahankan runtime LTS untuk proyek yang membutuhkan masa pemeliharaan lebih panjang. Sumber resmi: [daftar rilis MariaDB](https://mariadb.org/mariadb/all-releases/) dan [pengumuman MariaDB 13.0 stable](https://mariadb.org/mariadb-13-0-is-now-stable/).

## Prioritas temuan

| Prioritas | Temuan saat audit | Tindakan | Status |
|---|---|---|---|
| Tinggi | Database Manager awal hanya mengelola satu layout `runtime/mariadb`; belum ada pemilihan versi terkelola yang persisten. | Tambah `lib/database-version-manager.js`, API versi, dan pemilih di Studio Database. Layout lama dipertahankan apa adanya; versi 13 disimpan di `runtime/mariadb/versions/mariadb-13.0.2-winx64/`. | Diperbaiki pada source; tes unit lulus |
| Tinggi | Installer legacy menghapus folder sementara dengan nama tetap (`extract`/`manual-stage`) dan memakai lokasi unduhan/log tetap. File pengguna yang kebetulan berada di sana berisiko tertimpa. | Ubah ke staging unik per pemasangan; pembersihan hanya diarahkan pada staging yang dibuat pada run tersebut. Folder binary/data yang sudah ada ditolak, bukan dihapus. | Diperbaiki secara statis; skrip PowerShell belum dieksekusi di Windows |
| Tinggi | Pengecekan konflik port lama hanya mengandalkan koneksi ke port; proses yang memiliki socket bind tetapi tidak menerima koneksi bisa luput. | Tambah `lib/port-utils.js` untuk menguji bind TCP ke `127.0.0.1`, gunakan saat mencari port, menyimpan port, dan sebelum start. | Tes socket nyata pada host build lulus; tetap perlu diuji ulang pada Windows |
| Tinggi | Installer runtime tambahan berpotensi merusak data jika target versi sudah ada, dan data lama tidak boleh digunakan langsung oleh versi baru. | Arsip ditolak bila target versi sudah ada; staging baru untuk inisialisasi; data dan konfigurasi tiap versi terpisah; versi baru tidak auto-select. | Diperbaiki pada source dan skrip; alur Windows nyata belum diuji |
| Sedang | Tidak ada status versi/port/log yang terpusat pada UI versi database. | Tambah informasi versi aktif, status instalasi/inisialisasi, path data/config/log, port, tombol log, pemilih versi, impor ZIP, dan pengaturan port. | Tes source/API lulus |
| Sedang | Port pilihan yang berubah tidak otomatis memperbarui konfigurasi aplikasi proyek atau phpMyAdmin. Mengubahnya diam-diam dapat memutus proyek pengguna. | UI dan dokumentasi menyatakan perubahan proyek/phpMyAdmin bersifat manual; host database dikunci ke `127.0.0.1`. Startup meneruskan port tersimpan sebagai argumen server. | Ditangani eksplisit |
| Sedang | Binary MariaDB 13.0.2 khusus Windows x64 tidak sesuai dengan runtime macOS/Linux atau Windows ARM. | Pemilihan/instalasi versi 13 ditolak di platform selain Windows x64; fallback tampilan memakai versi kompatibel. | Tes unit dan source check lulus; uji native Windows belum dilakukan |
| Rendah | Source asal tidak memiliki `package-lock.json` dan dependensi `node_modules` di paket. | Tidak membuat lockfile spekulatif atau menyertakan dependensi tak teruji. Tes Node bawaan dapat dijalankan; build Electron memerlukan instalasi dependensi terlebih dahulu. | Batasan dicatat |
| Rendah | Sejumlah path XAMPP/Laragon tetap muncul di panduan. | Ditinjau sebagai contoh path konfigurasi manual, bukan lokasi runtime default yang ditanam di integrasi MariaDB 13.0.2. | Tidak perlu diubah |

Tidak ditemukan temuan kritis yang memerlukan penghapusan atau migrasi data untuk menyelesaikan integrasi. Kategori tinggi di atas adalah risiko operasional yang sudah ditangani di source, tetapi hasil runtime pada Windows masih harus dibuktikan.

## Audit source dan arsitektur

Source asal berisi 36 file. Pengelolaan database terdapat di `database.js`; server lokal/API di `server.js`; tampilan Studio Database di `public/index.html`, `public/app.js`, dan `public/styles.css`; jalur desktop/user-data di `electron/main.js`; installer runtime lama di `Install-SXL-MariaDB.ps1`; dan paket/build di `package.json` beserta `.github/workflows/build-desktop.yml`.

Source ini sudah memiliki query SQL Bahasa Indonesia, pembuatan akun aplikasi non-root, backup/restore SQL, status database, dan instalasi MariaDB bawaan. Integrasi menambah pengelola versi pada komponen tersebut, bukan membangun halaman atau service manager database kedua.

### Path runtime

- **Versi kompatibilitas lama:** `runtime/mariadb/server`, `runtime/mariadb/data`, `runtime/mariadb/settings.json`, `runtime/mariadb/backups`, `runtime/mariadb/mariadbd.log`.
- **Versi baru:** `runtime/mariadb/versions/mariadb-13.0.2-winx64/server`, `data`, `config/my.ini`, `logs/mariadbd.log`, `tmp`, `backups`, `settings.json`, dan `version.json`.
- **Pilihan versi:** `runtime/mariadb/manager.json`. Jika belum ada, fallback tetap `mariadb-managed`.
- **Jaringan:** server dikonfigurasi/di-start dengan bind `127.0.0.1`; pemeriksaan port tidak menghentikan aplikasi lain.
- **Proyek dan phpMyAdmin:** tidak diubah otomatis saat versi atau port database diganti. Gunakan port yang ditampilkan di UI untuk menyesuaikan koneksi secara sengaja.

SXL membuat password root acak saat inisialisasi. Pada Windows, password di `settings.json` dilindungi DPAPI untuk akun pengguna yang membuatnya, dan installer menerapkan ACL pada folder instance. File konfigurasi legacy yang masih plaintext dimigrasikan saat dibaca; jika DPAPI gagal, file asli tidak ditimpa dan UI menampilkan peringatan. Pada Windows, utilitas inisialisasi menerima password melalui argumen proses; administrator/proses lokal berhak tinggi masih mungkin melihat command line saat inisialisasi. Password dibuat acak, staging dibatasi ACL, dan keluaran sensitif disamarkan dari log. Jangan jalankan pemasangan di komputer bersama yang tidak tepercaya atau membagikan `settings.json`.

## Validasi arsip MariaDB

| Pemeriksaan | Hasil |
|---|---|
| ZIP dapat dibuka dan seluruh CRC internal | Lulus (`ZipFile.testzip()` mengembalikan `None`) |
| Ukuran ZIP | 104.263.573 byte |
| Jumlah entri | 756 (650 file dan 106 entri direktori) |
| Ukuran total setelah ekstraksi | 338.137.372 byte |
| SHA-256 seluruh arsip | `ba9cefd6674b3f2f7bc67334c05305dc7c919643d76836e10767e70db0b5fb74` |
| Perbandingan dengan checksum rilis resmi | Cocok dengan daftar checksum MariaDB yang diperiksa |
| Nama path absolute/drive/komponen `..` | Tidak ditemukan |
| Duplikasi nama path case-insensitive | Tidak ditemukan |
| Entri symbolic link menurut atribut ZIP | Tidak ditemukan |
| File konfigurasi `.ini`/`.cnf` bawaan | Tidak ditemukan; installer membuat konfigurasi SXL sendiri |
| Data database lama/system data directory | Tidak ditemukan |
| Lisensi/atribusi | `COPYING`, `THIRDPARTY`, `CREDITS`, `README.md` tersedia |
| Binary Windows x64 | Header PE32+ x86-64 teridentifikasi untuk server, client, installer, admin, dump, dan `server.dll` |
| String versi | `include/mysql/mariadb_version.h` menyatakan `13.0.2` dan `13.0.2-MariaDB`; file ini metadata/header, bukan hasil menjalankan binary |
| Ketergantungan runtime | DLL Visual C++ runtime dan DLL pendukung ada dalam paket. Uji loader di Windows tetap belum dilakukan. |
| Binary dijalankan saat audit | Tidak; file executable tidak dijalankan di lingkungan Linux |

Arsip juga berisi simbol debug (`.pdb`) serta banyak header/import library untuk pengembangan. Installer SXL menyalin komponen `bin`, `lib`, dan `share` yang diperlukan dan mengecualikan file pengembangan yang tidak diperlukan (`.pdb`, `.lib`, header/source C/C++ dan sejenisnya), sambil mempertahankan lisensi/atribusi. Arsip asli tidak dimodifikasi.

SHA-256 binary penting dicatat dalam `MANIFEST-MARIADB-13.0.2.json` dan `SHA256SUMS.txt` paket runtime.

## Arsip runtime sebelumnya yang tersedia

Nama persis `SXL-XAMPP-Runtime-Library-Windows.zip` tidak ditemukan dalam daftar Library. Ditemukan dan CRC diuji arsip historis `SXL-Localhost-v0.15.0-XAMPP-Bundled-Windows.zip` (191.453.886 byte; 8.455 entri; CRC lulus; SHA-256 `599798fa948b0992e2f3d6639f6b600d67bc548ca00c1089db3d3bf77cf10a0d`). Dokumen arsip menyebut paket tersebut sebagai bundle XAMPP versi lama dan memverifikasi MariaDB 10.4.32 di dalamnya. Arsip ini dipakai sebagai referensi untuk kompatibilitas/runtime lama saja, tidak digabungkan ke source 0.14.2 dan tidak ditimpa.

## File source yang berubah

**Diubah:**
`Install-SXL-MariaDB.ps1`; `PANDUAN-RUNTIME-MANUAL.md`; `README.md`; `SPECIFIKASI.md`; `database.js`; `electron/main.js`; `package.json`; `public/app.js`; `public/index.html`; `public/styles.css`; `server.js`; `tests/desktop.test.js`; `tests/local-stack.test.js`.

**Ditambahkan:**
`Install-SXL-MariaDB-Version.ps1`; `lib/database-version-manager.js`; `lib/port-utils.js`; `lib/ini-port.js`; `tests/database-version-manager.test.js`; `tests/port-utils.test.js`; `tests/ini-port.test.js`; laporan dan manifest audit ini.

## Hasil pengujian

Rincian perintah dan batasan ada pada `RIWAYAT-AUDIT.md`. Hasil terakhir yang direkam sebelum pengemasan:

- `node --test` / `npm test`: **71 tes lulus, 0 gagal** pada host ini.
- `node --check`: modul utama, server, renderer, Electron main, database version manager, port utility, dan INI port helper lulus.
- `package.json`: JSON valid, versi `0.14.2`.
- Pemeriksaan port: tes nyata pada socket loopback host build membedakan port yang dapat di-bind dan port yang sedang digunakan.
- Integritas ZIP source dan MariaDB: lulus; checksum arsip MariaDB cocok.
- Build Electron/installer, parsing skrip PowerShell, MariaDB startup/shutdown/koneksi, backup/restore terhadap server 13.0.2, pemeriksaan kompatibilitas phpMyAdmin, dan `httpd -t`: **belum diuji**, karena lingkungan kerja Linux tidak memiliki PowerShell/Wine dan dependensi `node_modules` tidak disediakan.

## Langkah validasi wajib di Windows x64

1. Cadangkan database proyek yang penting melalui dump SQL dan simpan salinan di lokasi terpisah. Tutup SXL dan jangan memindah/menyalin direktori `data` dari MariaDB lain.
2. Ekstrak source ZIP hasil integrasi ke folder baru yang dapat ditulis. Buka SXL, lalu di **Studio Database** pilih **Pasang MariaDB 13.0.2 dari ZIP** dan pilih `mariadb-13.0.2-winx64.zip` yang asli. Jangan memilih ZIP luar paket runtime.
3. Pastikan checksum diterima, instalasi menyelesaikan inisialisasi, versi baru muncul sebagai siap, dan versi lama tetap terpilih. Catat port yang diberikan.
4. Pilih MariaDB 13.0.2, jalankan, cek status serta log. Verifikasi port mendengar hanya pada `127.0.0.1`. Coba query sederhana, buat database uji, lalu hentikan dengan tombol SXL.
5. Uji skenario konflik port dengan menghentikan database SXL, memilih port yang sudah dipakai layanan uji lokal, dan memastikan UI menolak tanpa menghentikan layanan uji. Ulangi dengan port kosong.
6. Buat backup SQL database uji dan pulihkan ke database uji lain. Jangan menggunakan database sistem `mysql`, `sys`, `performance_schema`, atau `information_schema` sebagai target restore.
7. Bila memakai phpMyAdmin/proyek lama, perbarui konfigurasi host/port secara eksplisit; tes koneksi keduanya. Jangan mengubah versi default sampai semua proyek penting tervalidasi.
8. Jalankan pengujian source (`npm test`), build Windows (`npm run build:win` pada mesin dengan dependensi terpasang), dan simpan log hasil uji sebagai bagian dari validasi rilis.

## Pemulihan

- Jangan hapus `runtime/mariadb` untuk menghapus versi baru. Data versi lama berada di path kompatibilitas; versi 13 berada di subfolder `versions`.
- Untuk rollback, hentikan database dari SXL dan pilih versi lama kembali. Ini mengganti pilihan aktif, bukan menyalin atau memigrasikan data.
- Jika MariaDB 13 gagal start, simpan `logs/mariadbd.log` dan jangan hapus folder `data`. Kembali ke versi lama tanpa menghapus direktori versi 13, lalu analisis log terlebih dahulu.
- Migrasi antaversi harus melalui backup/dump dan restore yang kompatibel, diikuti validasi aplikasi. Jangan mengarahkan server baru langsung ke data directory lama.


## Perbaikan hardening v0.14.2

| Temuan tambahan | Perbaikan | Batasan yang tersisa |
|---|---|---|
| Password config Windows disimpan sebagai teks biasa pada setup lama. | Penyimpanan baru menggunakan DPAPI per akun; migrasi lama tidak menimpa file jika proteksi gagal, dan UI menunjukkan peringatan. | DPAPI dan ACL belum diuji native Windows di lingkungan ini; proteksi tidak menangkal malware/administrator dengan hak yang sama/lebih tinggi. |
| Installer memberi password ke utility melalui command line. | Password acak, log disaring, staging diberi ACL, dan konfigurasi persisten terenkripsi DPAPI. | CLI tetap dapat terlihat sementara oleh administrator/proses lokal yang berhak; ini dicatat secara eksplisit. |
| Versi fallback dapat tampak pasti meski tidak diverifikasi. | `versionVerified` dan deteksi `--version`; status menjadi `Versi belum terverifikasi` bila metadata/binary tidak cukup. | Binary Windows tetap harus dijalankan pada Windows. |
| Instalasi versi 13 parsial tidak punya recovery aman. | Opsi UI recovery memindahkan folder lama ke `versions/recovery` dengan rename same-volume; percobaan gagal dipisahkan dan folder asli dikembalikan. | Alur aktual masih wajib diuji di Windows x64. |
| Paket tidak memiliki smoke test native. | Ditambahkan `tests/windows-mariadb-smoke.ps1` untuk install, DPAPI, startup, koneksi, dump/restore, dan shutdown normal menggunakan data sementara. | Skrip hanya disediakan; belum berjalan di Linux. |

**Status lockfile:** percobaan offline gagal karena cache npm tidak memiliki metadata `electron`, dan akses registry tidak tersedia. `package-lock.json` tidak dikarang atau ditambahkan. Build native tetap menunggu lingkungan Windows dengan akses dependency yang memadai.

<!-- Sumber: RIWAYAT-AUDIT.md -->
# Laporan Audit — SXL Localhost v0.14.3

Tanggal: 27 Oktober 2026

## Ringkasan

Source v0.14.3 memperluas Database Studio dengan adapter PostgreSQL dan SQLite, serta memperbaiki alur Cloudflare Quick Tunnel. MariaDB/MySQL manager lama tetap terpisah dan tidak dialihkan ke adapter baru. Pemeriksaan dijalankan pada source Linux x86-64 dengan Node.js 22.16.0; ini bukan validasi native Windows.

## Temuan Cloudflare sebelum perbaikan

1. Jalur auto-install `cloudflared` sebelumnya dibatasi pada mode Electron, sehingga pengguna source/ZIP standalone tanpa path binary manual bisa gagal memulai Quick Tunnel.
2. Pemilihan binary terkelola mempercayai keberadaan file sebelum memastikan digest cocok; binary korup dapat dipilih.
3. Pin lama `2026.10.3` tertinggal dari rilis resmi `2026.10.4` yang dipublikasikan 26 Oktober 2026.
4. UI Quick Tunnel belum menyediakan allow-list email untuk OTP, sementara Cloudflare mendokumentasikan opsi `--allowed-mail` mulai rilis yang sesuai.
5. Setup tunnel bersamaan dapat beradu (race) dan home/config pengguna dapat memengaruhi perilaku quick tunnel jika tidak diisolasi.
6. Quick Tunnel adalah alamat sementara untuk pengembangan/pengujian, bukan layanan produksi; tanpa autentikasi, siapa pun yang memiliki URL dapat mengaksesnya.
7. Catatan checksum release di halaman GitHub berbeda dari metadata digest aset untuk dua arsip macOS. Kode memilih digest `sha256` per aset yang dipublikasikan pada bagian assets, dan gagal tertutup jika bytes unduhan tidak cocok. Arsip macOS tidak diunduh dan hash lokal independen tidak dihitung di lingkungan ini.

## Perbaikan Cloudflare

- Pin cloudflared `2026.10.4`.
- Digest terdaftar dari metadata aset GitHub: Windows amd64 `411b16d40c8d872243efeb52c550053d00af0a8a97fbb32e730fb8aba429eaa8`; macOS amd64 tgz `f11fbef4207d715892331917dafd437f032cf4b7137ed64dea3008338c1c613d`; macOS arm64 tgz `68b6bc4080ac1330234db2a9002d07f98b000537a1bd531a687b660d4160fa7f`.
- Unduhan HTTPS dibatasi ke `github.com`, `objects.githubusercontent.com`, dan `release-assets.githubusercontent.com`, redirect dibatasi serta file dibatasi 100 MiB.
- Binary terkelola diverifikasi sebelum dipilih. Arsip ditahapkan di folder unik, hash diperiksa, binary lama yang tidak tepercaya dikarantina dan tidak langsung dihapus.
- Binary hasil ekstraksi macOS menggunakan sidecar verifikasi yang memuat hash arsip dan binary; binary tidak dibandingkan secara keliru dengan hash arsip.
- Quick Tunnel membuat home/config sementara yang terisolasi di bawah runtime SXL; symlink `cloudflared-home` yang keluar dari runtime ditolak.
- Setup sharing single-flight; permintaan Stop saat setup belum melahirkan proses memberi pesan status yang eksplisit.
- Form akses mendukung allow-list hingga 20 alamat atau pola `*@domain.com`, OTP email Cloudflare, kombinasi dengan password sharing, dan konfirmasi saat akan memublikasikan URL tanpa autentikasi.
- Auto-install berlaku pada mode desktop maupun standalone Windows x64 dan macOS x64/arm64. Linux memerlukan path binary manual saat ini.

## Audit database tambahan

### PostgreSQL
- Menggunakan binary yang dipilih pengguna; versi minimal yang diterima manager adalah PostgreSQL 14.
- Data berada di direktori SXL tersendiri; direktori eksternal yang nonkosong tidak diadopsi otomatis.
- Default bind `127.0.0.1`, port awal `5433`, pengguna admin `sxl_admin`, kredensial dibuat acak dan disimpan melalui mekanisme secure settings yang dipakai source.
- Fitur source: configure, init cluster baru, start/stop, status/log, SQL query, list/create database, credentials, `pg_dump -Fc`.
- Perubahan port/runtime ditolak jika cluster berjalan atau status cluster lama tidak dapat diverifikasi. Konflik port tidak menghentikan proses lain. Data parsial saat initdb gagal dipertahankan di recovery.
- Kekurangan: tidak ada UI restore PostgreSQL, manajemen role aplikasi terbatas, dan tidak ada upgrade major otomatis.

### SQLite
- Menggunakan CLI `sqlite3`/`sqlite3.exe` yang dipilih pengguna, nama executable dan output versi diperiksa.
- File database dan backup hanya berada di direktori SXL; file lama tidak ditimpa.
- Fitur source: create, query SQL dan backup konsisten menggunakan `.backup`.
- Kekurangan: restore belum tersedia dalam UI.

### Database lain
MongoDB, Redis dan MySQL server asli belum memiliki runtime manager penuh; koneksi dari aplikasi pengguna bukan hal yang sama dengan integrasi lifecycle service.

## Prioritas yang disarankan

- P0 sebelum rilis luas: jalankan tes install/upgrade/start/stop di Windows x64 dan macOS; uji firewall/port; uji OTP dan password sharing dari perangkat eksternal yang aman.
- P1: tambah restore PostgreSQL/SQLite dengan preflight, konfirmasi, backup keselamatan dan pemulihan atomik; tambah akun aplikasi PostgreSQL terbatas.
- P1: commit package-lock yang dibuat dari registry terpercaya, atau pertahankan pipeline yang menghasilkan lockfile per release dan unggah artefaknya untuk audit. Workflow kini membuat lockfile saat release, sehingga dependency build masih tidak sepenuhnya terkunci dalam source yang diserahkan.
- P2: integrasi adapter MongoDB/Redis/MySQL asli sesudah API service/backup standar tiap engine dirancang.

## Rujukan resmi eksternal

- Cloudflared release: https://github.com/cloudflare/cloudflared/releases/tag/2026.10.4
- Cloudflare Quick Tunnels: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
- Protect Quick Tunnels with email authentication: https://developers.cloudflare.com/changelog/post/2026-10-02-protected-quick-tunnels/

<!-- Sumber: RIWAYAT-AUDIT.md -->
# SXL Localhost v0.14.13 — MariaDB Initializer Launch Fix Audit

## Issue from the latest Windows log
The automatic install verified the bundled ZIP SHA-256, then Windows refused to start `mariadb-install-db.exe` when it was invoked from the copied AppData payload (`Access is denied`). The log also confirmed that the old runtime was restored from recovery after the attempt failed. This is a process-launch denial, not a MariaDB SQL or authentication failure. The exact Windows policy/ACL cause is not proven from the user log alone.

## Changes in this iteration
- `Install-SXL-MariaDB-Version.ps1` now creates a temporary bootstrap extraction beside the portable project, with `%TEMP%` as a fallback if the project folder is not writable.
- It validates the archive against the pinned SHA-256 before extracting it, then unblocks only extracted files from that verified archive (if they carry a Windows download-origin stream). It does not disable Defender, SmartScreen, AppLocker, or WDAC.
- The initializer is now launched from the verified source tree (`SourceBin\mariadb-install-db.exe`) with the source package root as working directory; the final runtime still uses the separately staged `Payload\server` files and SXL-owned data directory under AppData.
- The previous DACL-only `icacls.exe` approach, recovery/rollback behavior, and requirement for authenticated startup plus `SELECT VERSION()` before commit are retained.
- If Windows continues blocking the executable, the error now reports the exact initializer path and points to Windows Protection history / AppLocker / WDAC; security tools are not disabled.

## Checks performed here
- `node --test`: 118 passed, 0 failed.
- Embedded MariaDB archive size: 104,263,573 bytes.
- Embedded MariaDB SHA-256: `ba9cefd6674b3f2f7bc67334c05305dc7c919643d76836e10767e70db0b5fb74`.
- Installer pins that SHA-256 to `ba9cefd6674b3f2f7bc67334c05305dc7c919643d76836e10767e70db0b5fb74`.
- ZIP integrity was checked after archive creation.

## Not verified here
This environment cannot run Windows PE executables or native PowerShell `icacls.exe`. Therefore the new initializer location is a targeted source fix based on the observed failure path, not proof that the target PC will now start MariaDB. Native Windows initialization, service independence, connection authentication, and `SELECT VERSION()` must still be confirmed by running the portable build on Windows.

<!-- Sumber: RIWAYAT-AUDIT.md -->
# SXL Localhost v0.14.12 — ACL Bootstrap Fix Audit

## Issue reproduced from the user log
The portable bootstrap failed in `applyWindowsTreeAcl()` with PowerShell `Set-Acl` and `PrivilegeNotHeldException`: the process lacked `SeSecurityPrivilege`. The MariaDB first-run installer had a second ACL helper with the same full security-descriptor approach, so fixing only the recovery path would leave clean installs vulnerable to the same failure.

## Changes
- `lib/secure-settings.js`: `applyWindowsTreeAcl()` now validates the path tree and refuses reparse points, then uses `icacls.exe` to reset and apply NTFS DACLs. It does not set ownership or SACL/audit data.
- `Install-SXL-MariaDB-Version.ps1`: `Set-PrivateTreeAcl()` uses the same DACL-only approach for staging before database initialization and the startup smoke test.
- Failure remains explicit if `icacls.exe` returns a nonzero exit code; the app does not mark the database ready on ACL failure.
- No database files, logs, backups, configuration or recovery folders are deleted by this code change.
- Added regression assertions and updated the package version to 0.14.12.

## Verification performed here
- `node --check server.js` — passed.
- `node --check lib/secure-settings.js` — passed.
- `npm test` — 117 passed, 0 failed.
- Embedded MariaDB archive is 104,263,573 bytes and SHA-256 is `ba9cefd6674b3f2f7bc67334c05305dc7c919643d76836e10767e70db0b5fb74`, matching the pinned digest in the installer and the provided ZIP.
- ZIP integrity and included-file hashes are checked after packaging.

## Not verified
Native Windows PowerShell/`icacls.exe` execution and actual MariaDB startup/query have not been run inside this build environment. The patch specifically removes the known `Set-Acl`/`SeSecurityPrivilege` failure path, but the user must rerun the portable launcher on Windows to verify startup, authentication, and `SELECT VERSION()`.

<!-- Sumber: RIWAYAT-AUDIT.md -->
# Laporan Pengujian — SXL Localhost v0.14.8

Tanggal pengujian: 27 Oktober 2026  
Lingkungan: Linux x86-64, Node.js v22.16.0, npm 10.9.2.

## Ringkasan

| Pemeriksaan | Hasil | Keterangan |
|---|---|---|
| `npm test` / `node --test` | **LULUS — 103/103** | Seluruh tes otomatis lulus pada host Linux. |
| `node --check` semua file `.js` | **LULUS — 36 file** | Semua file JavaScript lolos pemeriksaan sintaks. |
| Parse JSON | **LULUS — 11 file** | Semua file JSON source dapat diparse. |
| Parser HTML dan ID | **LULUS — 206 ID unik** | Tidak ditemukan ID duplikat pada `public/index.html`. |
| Tes source installer MariaDB | **LULUS** | Memeriksa pin ukuran/hash, sumber HTTPS fallback, logging persisten, dan kelompok executable yang diwajibkan. Ini tes statis, bukan eksekusi PowerShell. |
| Tes recovery dan adapter database | **LULUS** | Tes menggunakan lingkungan isolasi, mock, serta helper; bukan startup binary MariaDB nyata. |
| Build Electron Windows/macOS | **BELUM DILAKUKAN** | Installer native belum dibangun pada OS target. |
| PowerShell, ACL, DPAPI Windows | **BELUM DILAKUKAN** | Lingkungan saat ini Linux dan tidak menyediakan PowerShell Windows native. |
| Download arsip MariaDB dan verifikasi hash langsung | **BELUM DILAKUKAN** | Tidak ada konektivitas download dari lingkungan pembuatan paket. Installer mencoba sumber HTTPS yang dipatok saat dijalankan di Windows. |
| Smoke test recovery MariaDB di Windows x64 | **BELUM DILAKUKAN** | Tetap diperlukan pada direktori data uji sekali pakai sebelum dipakai untuk data penting. |
| PostgreSQL/SQLite native, phpMyAdmin, Cloudflare Tunnel nyata | **BELUM DILAKUKAN** | Tes otomatis mencakup adapter/mocked behaviour; binary layanan native tidak dijalankan. |

## Perubahan UI/UX dan aplikasi terpisah pada v0.14.8

- Tes UI memastikan pintasan Terminal eksternal dan phpMyAdmin browser terpisah tersedia.
- Tes kontrak memastikan pintasan menggunakan endpoint pembuka terminal workspace serta endpoint start/open phpMyAdmin yang sudah ada.
- CSS hanya menggunakan stylesheet internal; tidak ada framework UI baru.
- JavaScript, HTML, dan JSON diperiksa ulang setelah pembaruan.
- Tes otomatis total 103/103 lulus pada Linux; pembukaan PowerShell/Terminal native dan Browser belum diuji di Windows/macOS pada lingkungan pembuatan paket.

## Riwayat perbaikan installer MariaDB pada v0.14.6

- Pemasang sekarang tidak mengambil checksum dari server yang sama saat runtime; ukuran dan SHA-256 paket Windows x64 ditetapkan pada source.
- Jika source resmi tidak dapat diakses, pemasang mencoba cermin HTTPS terpilih. Setiap kandidat tetap harus cocok dengan ukuran dan SHA-256.
- Hasil ekstraksi diperiksa sebelum disalin; salinan yang tidak lengkap tidak diaktifkan.
- Log instalasi permanen tersedia di `runtime/mariadb/logs/mariadb-install.log`. Pesan log dibersihkan dari argumen password/credential yang terdeteksi.
- Jika pemasangan gagal, SXL tetap menonaktifkan Jalankan Database serta menyertakan lokasi log; folder lama tetap diamankan atau dipulihkan sesuai prosedur pemulihan.

## Batas validasi

Tes source-level menguji struktur kode dan kontrak, bukan perilaku native PowerShell. Pemakaian data nyata tetap tidak dianjurkan sebelum arsip terunduh, SHA-256 terbukti cocok, binary melaporkan versi yang diharapkan, instance dapat start, koneksi SQL berhasil, backup dan restore berfungsi, dan shutdown normal telah dites pada Windows x64.

## Riwayat v0.14.7 — perbaikan runtime MariaDB
- Installer membuat struktur tujuan secara eksplisit (`server-payload\bin`) dan memverifikasi lima kelompok executable sebelum memindahkan runtime ke lokasi aktif.
- Arsip MariaDB yang sudah diunduh disimpan dalam `runtime/mariadb/packages` dan hanya digunakan ulang jika ukuran dan SHA-256 cocok dengan nilai yang dipatok.
- Unduhan mencoba `curl.exe` dengan pembatasan HTTPS/redirect HTTPS; jika tidak tersedia, installer memakai `Invoke-WebRequest`.
- Status Database menyertakan penyebab kegagalan instalasi terbaru dari log persisten.
- Disediakan launcher perbaikan langsung PowerShell (`Repair-SXL-MariaDB.bat`) yang meminta konfirmasi, memeriksa port, menjaga komponen lama di recovery, dan menjalankan installer terverifikasi.
- `npm test`: 103/103 lulus di Linux x86-64, Node.js 22.16.0 untuk v0.14.8.
- Catatan: PowerShell/Windows x64, ACL, DPAPI, pengunduhan aktual, dan startup MariaDB belum dapat dieksekusi di lingkungan ini; hasil tes source tidak menggantikan uji native Windows.

