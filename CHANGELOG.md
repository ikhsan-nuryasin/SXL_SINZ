# Riwayat Perubahan SXL Localhost

## SXL Localhost v0.14.15 — 2026-10-31

- Mencegah electron-builder mencoba menerbitkan artefak langsung dari job build; GitHub Actions mengunggah artefak hanya setelah build Windows dan macOS sama-sama berhasil.

## SXL Localhost v0.14.14 — 2026-10-31

- Memperbaiki kompatibilitas pengujian pada Windows dan macOS, termasuk penyimpanan kredensial database sesuai platform dan pemeriksaan lokasi runtime yang deterministik.
- Memperbaiki workflow GitHub Actions agar menyiapkan folder runtime pada kedua platform dan mengunduh arsip MariaDB Windows hanya setelah checksum resminya diverifikasi.
- Memperjelas publikasi GitHub proyek, pratinjau `.gitignore`, dan perlindungan file lokal/rahasia.

## Perubahan workspace saat ini
- Menambahkan login phpMyAdmin root tanpa password dengan membatasi MariaDB dan phpMyAdmin ke loopback.
- Memperbaiki izin ACL MariaDB pada Windows dan validasi startup native.
- Menggabungkan changelog lama agar riwayat versi mudah dicari.
- Build Windows menghasilkan installer NSIS dan EXE portable.

<!-- Sumber: CHANGELOG-SXL-0.14.13.md -->
# SXL Localhost v0.14.13

- Fix attempt for Windows `Access is denied` when launching `mariadb-install-db.exe` from the copied AppData payload: launch the initializer from a separate temporary extraction beside the portable project, falling back to `%TEMP%` if the project location is not writable.
- SHA-256 validation still occurs before extraction; remove Mark-of-the-Web only from files extracted from the exact verified archive, if present. No Windows security controls are disabled.
- Keep the final runtime/data under the per-user SXL runtime. Existing data is not automatically adopted or deleted; failed installs retain recovery/rollback behavior.
- Keep authenticated startup plus `SELECT VERSION()` as the readiness gate.
- Native Windows first-run must still be verified on the target PC.

<!-- Sumber: CHANGELOG-SXL-0.14.12.md -->
# SXL Localhost v0.14.12 — Portable Auto MariaDB 13.0.2

## Perbaikan bootstrap ACL Windows

- Mengganti pengaturan izin tree runtime dengan `icacls.exe` yang hanya memodifikasi DACL: reset izin, lalu menerapkan akses eksplisit hanya ke akun saat ini, SYSTEM, dan Administrators. Ini menghindari kegagalan `PrivilegeNotHeldException` terkait `SeSecurityPrivilege`.
- Memvalidasi seluruh tree agar tidak berisi reparse point sebelum mengubah ACL.
- Memakai metode yang sama pada fungsi ACL di installer staging MariaDB 13.0.2, bukan hanya pada jalur recovery.
- Mempertahankan fail-closed behavior: bila `icacls` gagal, bootstrap tetap gagal secara eksplisit dan tidak menampilkan database siap.
- Menambah tes regresi untuk mencegah penggunaan kembali `Set-Acl` di kedua jalur tersebut.

## Validasi

- Tes Node.js mencakup assertion source-level untuk ACL dan semua tes regresi yang ada.
- Tes startup server native dan koneksi SQL harus tetap dijalankan pada Windows x64. Paket ini tidak mengklaim telah lulus uji native Windows dari lingkungan build.

<!-- Sumber: CHANGELOG-SXL-0.14.11.md -->
# SXL Localhost v0.14.11 — Portable Auto MariaDB 13.0.2

- Added `MULAI-SXL-LOCALHOST.bat` as the simple portable launch entry point.
- Portable launcher downloads a verified Node.js LTS runtime only when a compatible system/portable Node.js is unavailable. No manual `npm install` is required for portable browser mode.
- MariaDB 13.0.2 ZIP remains bundled and SHA-256 pinned. On a fresh Windows x64 user profile, startup validates, initializes, starts and performs a real authenticated `SELECT VERSION()` smoke test before opening the local panel.
- Portable runtime state and database files are stored in `%APPDATA%\SXL Localhost`, not inside the extracted ZIP folder.
- Existing runtime/database selection is preserved; partial MariaDB 13.0.2 repair uses recovery and does not delete old data. A failed bootstrap stops startup rather than claiming readiness.
- Cloudflare Tunnel is no longer downloaded merely to open the local panel; it is verified/downloaded on demand when sharing is activated.
- Added regression tests for portable bootstrap ordering and lazy Cloudflare setup.

## Verification

- Node.js syntax checks: passed.
- Automated Node tests: 116 passed, 0 failed.
- MariaDB archive SHA-256: verified against the pinned manifest value.
- Native Windows execution, fresh-profile MariaDB startup, SQL smoke test, and Electron `.exe` packaging: not executed in the build environment. This ZIP is a portable launcher bundle, not a precompiled Electron installer.

<!-- Sumber: CHANGELOG-SXL-0.14.10.md -->
# SXL Localhost v0.14.10 — First-run MariaDB Ready

- Bundles the exact MariaDB 13.0.2 Windows x64 ZIP in `runtime/packages/`; first-run installation no longer needs a separate MariaDB download.
- On a pristine Windows x64 profile, automatically verifies, extracts, initializes, smoke-starts, authenticates, runs `SELECT VERSION()`, commits the runtime, selects MariaDB 13.0.2, and starts it before opening the main UI.
- Adds a first-run splash window while the database runtime is prepared.
- On later launches, automatically starts MariaDB 13.0.2 only when that version was selected previously.
- If the managed MariaDB 13.0.2 folder is partial, the installer uses the existing recovery/restore path: old files are quarantined, not deleted or automatically reused. If the configured port is still occupied, repair aborts without moving the folder.
- Reworks Windows runtime ACL application to set explicit permissions on each file and directory instead of relying on recursive inheritance propagation. The staging payload ACL is applied before database initialization and again before startup/SQL smoke testing, not only immediately before commit.
- The version installer now performs a real authenticated startup test and `SELECT VERSION()` before committing the runtime. Files existing on disk alone are not considered a successful install.
- MariaDB launch working directory is the executable's own `bin` directory so the compact Windows launcher can resolve its adjacent `server.dll` and runtime components.
- Existing PostgreSQL, SQLite, PHP, Apache, Composer, Cloudflare Tunnel, terminal, project manager, and sharing features are retained.

## Verification status

- Node.js syntax checks: passed.
- Node.js regression tests: 113 passed.
- ZIP and manifest checks: verified when assembling this source package.
- Native Windows PowerShell installer execution, MariaDB 13.0.2 startup, SQL smoke test, NSIS build and portable EXE build: not run in this Linux environment; use `Build-SXL-Localhost-Windows.bat` on Windows to build and perform runtime validation.

<!-- Sumber: CHANGELOG-SXL-0.14.8.md -->
# SXL Localhost v0.14.8 — UI/UX Redesign & Standalone Tools

## Perubahan utama
- Menata ulang tema menjadi workspace modern-industrial yang lebih tenang, ringan, kontras, dan konsisten.
- Menyederhanakan dashboard: ilustrasi dekoratif dihilangkan, ringkasan dan akses kerja menjadi fokus.
- Menambah pintasan **Terminal** yang membuka terminal sistem sebagai aplikasi terpisah pada folder workspace SXL.
- Menambah pintasan **phpMyAdmin** yang menjalankan layanan bila perlu lalu membuka halaman web di browser default, bukan di dalam panel aplikasi.
- Pintasan phpMyAdmin melakukan pemasangan hanya setelah konfirmasi dan menampilkan progres/kesalahan melalui toast.
- Tombol terminal tiap proyek secara eksplisit bertuliskan **Terminal terpisah**.
- Panel service, kartu, input, tabel, dan tabs dirapikan; layout tetap responsif pada layar kecil.
- Tidak menambah framework UI atau dependensi npm baru.

## Catatan
- Terminal eksternal memakai shell sistem yang tersedia; pada Windows target awal adalah PowerShell, pada macOS Terminal, dan pada Linux emulator terminal default.
- phpMyAdmin berjalan sebagai server PHP lokal terpisah dan dibuka di browser default. Akses tetap di loopback `127.0.0.1`.
- Source ZIP tidak membundel binary PHP/MariaDB. Runtime tetap dipasang melalui skrip installer.

<!-- Sumber: CHANGELOG-SXL-0.14.7.md -->
# Changelog — SXL Localhost v0.14.7

Tanggal: 27 Oktober 2026

## MariaDB runtime repair
- Mengganti copy folder runtime yang ambigu dengan penyalinan file-per-file ke direktori staging dengan relative path yang pasti.
- Memverifikasi kelima kelompok executable dan versi `mariadbd.exe --version` sebelum memindahkan payload ke `runtime/mariadb/server`.
- Menyimpan arsip MariaDB 11.4.13 yang telah diverifikasi di `runtime/mariadb/packages`. Cache hanya dipakai ulang bila ukuran 95.024.126 byte dan SHA-256 cocok dengan nilai yang dipatok.
- Memakai `curl.exe` untuk unduhan HTTPS dengan HTTPS-only redirect bila tersedia; fallback ke `Invoke-WebRequest` bila curl tidak tersedia.
- Status Database menampilkan kesalahan terakhir yang tercatat di log installer, alih-alih hanya menyajikan status parsial generik.
- Data lama tidak dihapus atau dipakai otomatis; mekanisme karantina/recovery sebelumnya tetap berlaku.

## Pengujian
- `npm test`: 102/102 lulus pada Linux x86-64, Node.js 22.16.0.
- Pemeriksaan native PowerShell/Windows x64 belum dapat dijalankan dalam lingkungan ini. Proses unduh, ekstraksi, ACL, DPAPI, inisialisasi, dan startup tetap memerlukan pengujian di Windows.
- Source ZIP tidak menyertakan binary MariaDB/PHP dan bukan installer `.exe` siap pakai.

- Menambahkan `Repair-SXL-MariaDB.bat` dan `Repair-SXL-MariaDB-Standalone.ps1` untuk memperbaiki direktori runtime langsung tanpa perlu membangun ulang aplikasi desktop. Script meminta persetujuan eksplisit sebelum memindahkan komponen lama dan mencoba rollback bila pemasangan gagal.

<!-- Sumber: CHANGELOG-SXL-0.14.6.md -->
# SXL Localhost v0.14.6 — MariaDB Installer Reliability & Diagnostics

Tanggal paket: 27 Oktober 2026

## Perbaikan MariaDB
- Mengganti pengambilan checksum saat runtime dengan ukuran arsip dan SHA-256 yang dipatok untuk paket MariaDB 11.4.13 Windows x64.
- Installer mencoba URL arsip resmi terlebih dahulu, lalu tiga cermin HTTPS yang ditentukan jika unduhan atau verifikasi ukuran/hash gagal.
- Menolak arsip yang ukuran atau SHA-256-nya tidak cocok sebelum mengekstrak atau menjalankan binary.
- Membuat penyalinan hasil ekstraksi lebih eksplisit, dan memeriksa semua lima kelompok executable penting setelah ekstraksi dan setelah penyalinan.
- Menjalankan installer database dari working directory runtime agar file resource lebih mudah ditemukan.
- Menyimpan diagnostik instalasi yang disanitasi di `runtime/mariadb/logs/mariadb-install.log`, tetap tersedia setelah folder staging dibersihkan.
- Saat install gagal, pesan SXL menunjuk ke file log diagnostik. Pemulihan masih mempertahankan folder lama di recovery dan tidak mengaktifkan database yang belum sehat.

## Pengujian
- Menambahkan tes source-level untuk pin ukuran/hash, daftar sumber HTTPS, log persisten, dan pemeriksaan executable.
- `npm test`: 99/99 lulus pada Linux x86-64 dengan Node.js v22.16.0.
- PowerShell, ACL/DPAPI Windows, unduhan runtime, dan smoke test MariaDB native Windows tidak dijalankan pada lingkungan ini.

## Batas
- Paket masih berupa source code. Binary PHP/MariaDB dan installer `.exe` hasil build tidak tertanam/diikutkan.
- SHA-256 dan ukuran arsip harus diverifikasi lagi pada rilis Windows sebelum pemakaian produksi; test source-level tidak menggantikan smoke test native Windows.

<!-- Sumber: CHANGELOG-SXL-0.14.5.md -->
# SXL Localhost v0.14.5 — MariaDB Recovery Reliability

Tanggal paket: 27 Oktober 2026

## MariaDB
- Perbaikan recovery untuk path runtime manual lama yang menunjuk ke folder bin di dalam runtime SXL yang rusak.
- Saat proses pemulihan mengarantina folder `server`, manager memvalidasi ulang path manual yang disimpan sebelum memanggil installer; path yang hilang/tidak lengkap tidak dikirim sebagai `SourceBinDir`.
- Path manual eksternal yang tidak valid tetap menghasilkan pesan bantuan yang jelas dan tidak dilewati diam-diam.
- Status `partial` mengeluarkan daftar executable yang hilang supaya penyebab terlihat di UI.
- Data lama tetap dipindahkan ke folder recovery, bukan dihapus atau otomatis dibuka oleh runtime baru.

## Pengujian lintas platform
- Test symlink kini berhenti segera setelah skip karena OS tidak memberi izin membuat symlink.
- Tes mode izin POSIX di-skip pada Windows, karena Windows menggunakan ACL dan tidak menyediakan semantik permission-bit POSIX yang sama.
- Tes kegagalan jaringan Node.js mengosongkan jalur kandidat Node/npm serta konfigurasi runtime manual untuk mencegah instalasi lokal penguji mengubah hasil.
- Jumlah tes ditambah menjadi 95 pada host Linux; native Windows recovery tetap harus dibuktikan di Windows x64.

## Batas validasi
- ZIP source tidak menyertakan binary PHP/MariaDB dan tidak berisi installer Electron hasil build.
- Pengujian pada paket ini dijalankan dengan Node.js 22.16.0 di Linux. PowerShell, DPAPI/ACL Windows, download binary, dan recovery pada instalasi MariaDB rusak sungguhan tidak dijalankan di host ini.

<!-- Sumber: CHANGELOG-SXL-0.14.4.md -->
# SXL Localhost v0.14.4 — Pemulihan Runtime & UI Lebih Ringkas

Tanggal paket: 27 Oktober 2026

## Pemulihan MariaDB
- Status database dibagi ke `ready`, `unverified`, `partial`, atau `not-installed`; folder pengelola versi saja tidak lagi membuat runtime MariaDB lama terdeteksi sebagai instalasi parsial.
- Penanganan instalasi parsial MariaDB bawaan/LTS kini memindahkan folder `server`, `data`, `backups`, `tmp`, `settings.json`, log, dan PID yang tersedia ke folder recovery menggunakan pemindahan satu volume. Tidak ada komponen database lama yang dihapus.
- Port yang tercatat di konfigurasi/settings diperiksa terlebih dahulu. Pemulihan berhenti jika port sedang digunakan, sehingga proses yang tidak dikelola SXL tidak disentuh.
- Bila pemasangan runtime pengganti gagal, hasil percobaan dipisahkan dan komponen lama dikembalikan bila target masih aman untuk dipulihkan.
- Endpoint `POST /api/database/verify-version` memungkinkan pengguna meminta pemeriksaan ulang versi binary tanpa mengubah isi data database.
- Tombol Start dan kredensial dinonaktifkan ketika instance tidak terinisialisasi atau versi binary masih belum terverifikasi.

## UI/UX
- Halaman Database dipisahkan menjadi tab MariaDB dan PostgreSQL/SQLite.
- MariaDB punya tab Runtime & Status, Database & Backup, serta SQL untuk mengurangi panjang halaman dan mengelompokkan fungsi yang terkait.
- PostgreSQL dan SQLite dipisah dengan tab engine.
- Web & Runtime dipisah menjadi Layanan, Diagnostik, dan Path Manual.
- Pengaturan responsif pada layar kecil, tombol tab dapat difokuskan keyboard, panel yang tidak terpilih disembunyikan, dan tidak ada dependensi UI tambahan.

## Pengujian dan batasan
- Tes otomatis Node.js: 94/94 tes lulus pada lingkungan Linux; hasil dan batas verifikasi dicatat pada `RIWAYAT-AUDIT.md`.
- Runtime binary PHP/MariaDB belum dibundel dalam ZIP source; skrip installer mengunduh paket resmi dan memverifikasi checksum pada komputer pengguna.
- Instalasi/recovery native MariaDB Windows memerlukan pengujian pada Windows x64 dengan instalasi parsial nyata sebelum distribusi produksi.

<!-- Sumber: CHANGELOG-SXL-0.14.3.md -->
# SXL Localhost v0.14.3 — Multi-database & Cloudflare Tunnel hardening

Tanggal paket: 27 Oktober 2026

## Ditambahkan
- Database Studio menambahkan adapter PostgreSQL dan SQLite pada UI/API yang sudah ada, tanpa mengganti manager MariaDB.
- PostgreSQL: konfigurasi folder binary terverifikasi, inisialisasi cluster baru milik SXL, start/stop normal, status/log, query SQL, daftar/buat database, kredensial, dan backup `pg_dump -Fc`.
- SQLite: memilih CLI tepercaya berdasarkan nama `sqlite3`/`sqlite3.exe` dan versi yang dilaporkan, membuat file database SXL, menjalankan SQL, dan membuat backup `.backup`.
- Cloudflare Quick Tunnel: pembatasan akses berdasarkan email dengan OTP (`--allowed-mail`), mendukung alamat tunggal dan wildcard domain; dapat digabung dengan password sharing SXL.
- Quick Tunnel otomatis memasang `cloudflared` pada Windows x64 dan macOS x64/arm64 ketika tidak tersedia, termasuk mode standalone/ZIP.
- Menambahkan manifest versi/digest aset cloudflared 2026.10.4, smoke tests dan tes regresi.

## Keamanan/perbaikan
- Menolak adopsi direktori PostgreSQL yang berisi data tetapi belum terdaftar sebagai instance SXL.
- Menolak perubahan binary/port ketika PostgreSQL berjalan atau status cluster sebelumnya tidak dapat dipastikan.
- Jika inisialisasi PostgreSQL gagal dan meninggalkan data parsial, data dipindahkan ke lokasi recovery; tidak dihapus otomatis.
- Database SQLite hanya dibuat di direktori data SXL dan file yang ada tidak ditimpa.
- Memeriksa binary cloudflared terkelola sebelum memilihnya; binary tidak valid dikeluarkan dari pemilihan otomatis.
- Memvalidasi unduhan Cloudflare dengan SHA-256, HTTPS dan allow-list host GitHub; staging unik sebelum dipasang dan binary lama dikarantina.
- Quick Tunnel memakai HOME/config terisolasi dan menghindari konfigurasi/credentials lokal pengguna yang tidak terkait.
- Mencegah start sharing yang tumpang-tindih; Stop menjelaskan bila setup masih berlangsung.
- Menambahkan peringatan bahwa Quick Tunnel bersifat publik bila tidak ada proteksi dan tidak sesuai untuk produksi.

## Batasan yang diketahui
- PostgreSQL harus dipasang/diunduh pengguna secara terpisah; source SXL saat ini tidak membundel server PostgreSQL.
- Pengelola PostgreSQL belum menyediakan UI restore, manajemen akun aplikasi terbatas, maupun upgrade major version otomatis.
- Pengelola SQLite belum menyediakan UI restore.
- MongoDB, Redis, dan server MySQL asli belum menjadi runtime manager terintegrasi.
- Auto-download cloudflared hanya dipatok untuk Windows x64 dan macOS Intel/Apple Silicon; Linux memerlukan path binary manual.
- Tidak ada installer Electron `.exe`/`.dmg` yang dibangun dalam lingkungan kerja ini.
- PostgreSQL/SQLite/cloudflared tidak diuji menjalankan binary native di OS target dalam sesi ini; tes otomatis memakai adapter/mock dan pemeriksaan statis.

### Paket runtime PHP dan MariaDB
- Menambahkan `runtime/packages/` dan bootstrapper untuk mengunduh ZIP PHP 8.3.36 NTS x64 dan MariaDB 13.0.2 x64 dari sumber resmi.
- SHA-256 PHP dipatok berdasarkan checksum publikasi resmi; checksum dan ukuran MariaDB menggunakan metadata paket SXL yang sudah diaudit.
- Installer PHP menggunakan arsip lokal terverifikasi bila tersedia, sehingga instalasi PHP selanjutnya tidak perlu mengunduh ulang.
- Pemasangan MariaDB 13.0.2 otomatis memilih ZIP dalam folder paket; pemilih arsip manual tetap digunakan bila arsip belum tersedia.
- Runtime binary tidak ditanam pada source ZIP hasil perubahan ini karena pengambilan arsip biner langsung tidak tersedia di lingkungan penyuntingan. Jalankan bootstrapper di Windows x64 untuk mengisi folder tersebut.

<!-- Sumber: CHANGELOG-MARIADB-HARDENING.md -->
# SXL Localhost v0.14.2 — perbaikan keamanan dan pemulihan

Tanggal paket: 2026-10-27

## Perubahan utama

- Password database Windows diproteksi dengan DPAPI per akun Windows saat disimpan ke `settings.json`.
- Konfigurasi legacy yang masih plaintext dimigrasikan secara aman saat dibaca; bila proteksi gagal, file sumber tetap dipertahankan dan status error/peringatan ditampilkan.
- ACL privat diterapkan ke folder runtime/data/config/log/backup untuk instance database Windows.
- Runtime MariaDB 13.0.2 memerlukan versi executable terverifikasi; `versionVerified` disimpan pada konfigurasi.
- Versi database tidak mengklaim `11.4.13 LTS` ketika metadata dan binary tidak dapat memverifikasi versi.
- Instalasi runtime parsial dapat dikarantina sebelum perbaikan. Operasi memakai rename same-volume dan tidak menggabungkan atau menghapus folder recovery yang sudah ada.
- Validasi arsip Windows mencakup nama path berbahaya, traversal, ADS, reserved device names, duplicate case-insensitive, symlink ZIP, batas expanded size, serta binary wajib.
- Menambahkan smoke test Windows untuk checksum, pemasangan, verifikasi versi, koneksi, dump/restore, dan shutdown normal.

## Batasan / risiko tersisa

- `mariadb-install-db.exe` pada Windows menerima password melalui opsi baris perintah. Password dibuat acak, log disaring, dan staging dibatasi ACL, tetapi administrator/proses lokal dengan hak tinggi masih mungkin melihat command line saat proses inisialisasi berjalan.
- DPAPI membatasi pembacaan data at rest ke akun Windows saat ini, tetapi bukan perlindungan terhadap malware atau administrator yang beroperasi dengan hak yang sama/lebih tinggi.
- Native Windows runtime, PowerShell installer, GUI Electron build, installer NSIS, dan uji backup/restore belum dijalankan dalam lingkungan Linux ini. Jalankan `tests/windows-mariadb-smoke.ps1` pada Windows x64 sebelum rilis.
- `package-lock.json` tidak tersedia. Pembuatan lewat npm registry timeout; jangan menyatakan build dapat direproduksi lintas rilis sampai lockfile diperoleh dari lingkungan yang dapat mengakses registry, ditinjau, lalu dikomit.

## Pemulihan

1. Hentikan database melalui SXL jika layanan memang dikelola SXL dan masih merespons.
2. Buat salinan penuh folder `runtime/mariadb` sebelum perbaikan manual.
3. Jangan menghapus `data`, `backups`, `logs`, `settings.json`, atau folder `versions/recovery` saat diagnosis.
4. Untuk instalasi MariaDB 13 yang parsial, gunakan tombol pemulihan setelah membaca pesan UI. Skrip memindahkan direktori lama ke recovery; verifikasi hasil baru sebelum memilih versi tersebut.
5. Bila DPAPI tidak dapat didekripsi karena akun Windows berubah, pulihkan menggunakan akun Windows asal atau backup kredensial/data yang tervalidasi. Jangan mencoba “memperbaiki” dengan mengosongkan password atau menghapus pengaturan.


## Riwayat rilis yang sebelumnya tercantum di README

## Pembaruan v0.14.13

- Memperbaiki kegagalan bootstrap Windows: pengamanan ACL runtime tidak lagi memakai `Set-Acl`, yang dapat meminta `SeSecurityPrivilege` dan gagal pada pengguna portable.
- Pengaturan DACL runtime sekarang menggunakan `icacls.exe`, memvalidasi reparse point sebelum mengubah ACL, dan hanya memberi akses kepada akun saat ini, SYSTEM, serta Administrators.
- Perubahan diterapkan pada runtime yang akan dipulihkan dan pada staging installer MariaDB 13.0.2 agar kegagalan serupa tidak terulang pada tahap ekstraksi/inisialisasi.
- Tidak menghapus database, konfigurasi, log, backup, atau folder recovery.
- Verifikasi Windows native tetap harus dijalankan di komputer target; tes Node.js hanya menguji source/test suite.

## Pembaruan v0.14.11

- Mode portable mem-bootstrap MariaDB 13.0.2 dari ZIP lokal sebelum membuka panel.
- Runtime Node.js portable diverifikasi dan disiapkan otomatis bila belum ada.
- Download Cloudflare Tunnel dipindahkan ke saat fitur sharing digunakan.
- Status siap hanya dicatat setelah startup dan query SQL terverifikasi.

## Pembaruan v0.14.10

- ZIP MariaDB 13.0.2 Windows x64 sekarang disertakan pada `runtime/packages/`; first-run Windows x64 menyiapkan database otomatis tanpa mengunduh arsip MariaDB lagi.
- Splash screen menunjukkan tahap persiapan database. Runtime hanya dipilih aktif setelah startup, autentikasi, dan `SELECT VERSION()` berhasil.
- Saat ada instalasi MariaDB 13.0.2 yang parsial, folder lama disimpan di recovery sebelum instalasi baru; file lama tidak dihapus atau dipakai otomatis.
- Perbaikan ACL Windows diterapkan ke tiap file/direktori runtime dan proses server dijalankan dari folder `server/bin` agar dapat menemukan modul yang berdampingan.
- Pada peluncuran berikutnya, versi MariaDB 13.0.2 yang sebelumnya dipilih akan otomatis dinyalakan. Pilihan runtime lama yang eksplisit tetap dipertahankan.

- Desain UI/UX diarahkan ke workspace modern-industrial yang lebih sederhana: navigasi kontras, kartu konsisten, dashboard ringkas, dan tampilan responsif tanpa framework tambahan.
- Menu **Terminal** membuka shell sistem sebagai aplikasi/jendela terpisah, langsung pada folder workspace SXL. Tombol Terminal pada setiap proyek membuka shell pada folder proyek tersebut.
- Menu **phpMyAdmin** menjalankan service web bila belum aktif dan membuka phpMyAdmin pada browser default. Halamannya tidak ditanam di dalam panel SXL, dan server tetap dibatasi ke loopback lokal.
- Bila phpMyAdmin belum terpasang, SXL meminta persetujuan sebelum mengunduh paket resmi dan memverifikasi checksum.
- Notifikasi ringan memberi tahu pengguna saat terminal atau phpMyAdmin sedang dibuka maupun ketika langkahnya gagal.
- Tidak ada framework UI atau dependency npm baru yang ditambahkan.

### Cara memakai aplikasi terpisah
1. Klik **Terminal** di bagian **Aplikasi Terpisah** pada sidebar untuk membuka shell pada folder WWW SXL.
2. Dari daftar proyek, klik **Terminal terpisah** untuk membuka shell langsung di folder proyek.
3. Klik **phpMyAdmin** untuk membuka halaman web pada browser default. Untuk login dan mengelola database, MariaDB yang digunakan harus tersedia serta berjalan.
4. Untuk mengatur atau memeriksa service dan runtime, buka **Web & Runtime**. Fitur lanjutan dipisahkan dalam tab Layanan, Diagnostik, dan Path Manual.

## Riwayat v0.14.7
- Installer MariaDB memakai staging dengan path file yang eksplisit, cache arsip terverifikasi, fallback unduhan HTTPS, dan verifikasi versi sebelum runtime dipindahkan ke lokasi aktif.
- Penyebab kegagalan instalasi terakhir ditampilkan langsung pada status Database setelah aplikasi dibuka kembali.

### Perbaikan langsung pada Windows tanpa build ulang aplikasi

1. Tutup SXL Localhost terlebih dahulu.
2. Ekstrak source ZIP ini ke folder baru dan pastikan `Install-SXL-MariaDB.ps1`, `Repair-SXL-MariaDB-Standalone.ps1`, serta `Repair-SXL-MariaDB.bat` ada dalam folder yang sama.
3. Jalankan `Repair-SXL-MariaDB.bat`. Script akan menolak bila port 3307 sedang digunakan, meminta konfirmasi dengan mengetik `PINDAHKAN`, mengunduh arsip resmi MariaDB 11.4.13, memverifikasi ukuran dan SHA-256, lalu memeriksa executable.
4. Komponen runtime/data lama dipindahkan ke `runtime/mariadb/versions/recovery`; tidak dihapus dan tidak otomatis diimpor. Jika installer gagal, script mencoba mengembalikan komponen lama dan menampilkan lokasi log.
5. Setelah berhasil, buka ulang SXL dan tekan **Verifikasi Binary**.

Script langsung ini memerlukan Windows x64 dan koneksi internet. Bila tidak ada koneksi ke sumber HTTPS, ia akan berhenti dengan penyebab yang dicatat di `logs/mariadb-install.log`; ia tidak akan mengaktifkan runtime yang belum sehat.

## Riwayat v0.14.6

- Installer MariaDB 11.4.13 memeriksa ukuran dan SHA-256 arsip yang dipatok sebelum executable dapat dijalankan. Unduhan mencoba arsip resmi dan cermin HTTPS yang sudah ditentukan bila sumber sebelumnya gagal.
- Ekstraksi dan penyalinan folder runtime dibuat eksplisit agar struktur hasil tetap `runtime/mariadb/server/bin`, bukan folder bertingkat yang tidak ditemukan manager.
- Pemeriksaan pasca-ekstraksi memverifikasi server, installer database, client, admin, dan dump sebelum inisialisasi.
- Log instalasi yang sudah disanitasi dipertahankan di `runtime/mariadb/logs/mariadb-install.log` agar penyebab kegagalan tidak hilang setelah staging sementara dibersihkan.
- Pesan kesalahan pemasangan menampilkan lokasi log untuk diagnosis berikutnya; status partial tetap menonaktifkan tombol Jalankan.
- Perbaikan path manual dari v0.14.5 dan pemisahan UI/UX database, service, runtime, serta SQL tetap dipertahankan.
- Source/release ZIP ini menyertakan arsip MariaDB 13.0.2 Windows x64 yang diverifikasi menggunakan ukuran dan SHA-256 yang dipatok. ZIP PHP tidak dibundel; runtime PHP/Cloudflare yang belum tersedia dapat memerlukan unduhan saat pertama kali digunakan.

**Pemulihan pada komputer pengguna:** buka **Database → MariaDB → Runtime & Status**, klik **Pulihkan Instalasi Parsial**, setujui pemindahan folder lama ke `runtime/mariadb/versions/recovery`, lalu biarkan installer mengunduh runtime baru. Jika gagal, baca `logs/mariadb-install.log` di folder runtime pengguna dan kirim bagian akhir log tanpa kredensial. Jika port 3307 masih digunakan, SXL akan membatalkan pemulihan; periksa proses pemilik port sebelum mencoba lagi. Data lama tidak otomatis dipakai pada runtime baru.

## Lingkungan pengembangan lokal v0.13.0

Panel **Web Server & Runtime** menampilkan kontrol Apache, PHP 8.3, Composer, dan phpMyAdmin. Di bagian database, MariaDB digunakan sebagai server kompatibel MySQL. Tombol **Start All** mencoba menjalankan semua layanan yang sudah terpasang; tombol tersebut tidak akan diam-diam mengunduh server yang belum diinstal. **Stop All** menghentikan MariaDB, Apache, dan phpMyAdmin; proses proyek dikelola secara terpisah dari layanan global.

### Menyiapkan stack awal

1. Pasang dan jalankan MariaDB dari panel database. Port default adalah `127.0.0.1:3307`.
2. Pasang PHP 8.3. Windows menggunakan runtime portable SXL; macOS menggunakan `brew install php@8.3`. PHP 8.3 dipilih karena phpMyAdmin 5.2.3 menyatakan kompatibilitas PHP di bawah 8.4.
3. Pasang Composer dari panel layanan jika ingin menjalankan proyek Laravel/Composer. File PHAR diverifikasi menggunakan SHA-256 yang disediakan oleh getcomposer.org.
4. Pasang Apache jika dibutuhkan untuk website statis dan virtual host `.localhost`. Apache berjalan dengan konfigurasi SXL sendiri dan port lokal yang dipilih otomatis mulai dari `8080`.
5. Pasang phpMyAdmin, kemudian klik Start phpMyAdmin. phpMyAdmin memakai server PHP lokal dan hanya aktif setelah MariaDB hidup. Login dengan kredensial MariaDB yang ditampilkan melalui tombol **Lihat Kredensial**.
6. Gunakan **Start All** untuk menjalankan layanan yang sudah siap dan **Stop All** untuk menghentikan database/web service.


### Fitur gaya Laragon yang ditambahkan pada v0.11.0

- Kontrol Apache, PHP, MariaDB/MySQL-compatible, dan phpMyAdmin dari satu dashboard. Tombol **Start All** hanya menyalakan layanan yang sudah terpasang; tombol **Stop All** menghentikan layanan global.
- Form pembuatan database dari dashboard, selain editor SQL, impor/ekspor/backup dan restore. phpMyAdmin bisa dipasang dari distribusi resmi dan diakses melalui `127.0.0.1` setelah MariaDB serta PHP aktif.
- Project manager untuk proyek HTML, PHP/Laravel, dan Node.js; folder proyek existing dapat ditemukan dari workspace `www`. Tombol **Terminal** membuka shell pada folder proyek/workspace untuk menjalankan Artisan, Composer, npm, atau Git.
- Penerjemah SQL Bahasa Indonesia, backup/restore database pengguna, kredensial database yang terpisah, dan perlindungan agar port MariaDB tetap lokal.
- Apache membuat virtual host `.localhost` untuk proyek statis serta proyek PHP/Laravel aktif. PHP-CGI berjalan sebagai FastCGI pada loopback; Apache memakai `mod_proxy`, `mod_proxy_fcgi`, dan `mod_rewrite` untuk meneruskan permintaan PHP. Laravel memakai `public/` sebagai document root jika `artisan` dan `public/index.php` tersedia.
- SXL belum menyediakan seluruh fitur Laragon secara identik: belum ada switching beberapa versi PHP/MySQL dalam satu klik, Nginx manager, Mailpit/MailHog, SSL lokal otomatis, atau panel pengaturan restart PHP-CGI. Worker PHP-CGI memiliki pemulihan otomatis dasar dengan batas percobaan, tetapi kebijakan restart belum bisa dikonfigurasi dari UI.

### Batasan penting

- Proyek PHP/Laravel di Project Manager kini dipublikasikan melalui Apache + PHP-CGI FastCGI dan URL `http://nama-proyek.localhost:PORT`. Runtime sharing internet tetap menggunakan alur sharing tersendiri; jangan membagikan folder proyek yang berisi file rahasia.
- Apache Windows memakai binary pihak ketiga Apache Lounge melalui HTTPS. SXL memvalidasi URL dan versi terhadap manifest paket Microsoft winget-pkgs, lalu mencocokkan SHA-256 arsip sebelum ekstraksi; bila manifest tidak tersedia atau tidak cocok, instalasi dibatalkan. Siapkan Microsoft Visual C++ Redistributable sesuai kebutuhan binary.
- Pada macOS, Homebrew tetap menjadi dependensi untuk MariaDB, PHP 8.3, dan Apache. Data MariaDB tetap berada di folder data pengguna SXL.
- Installer `.exe` / `.dmg` native perlu dibangun dan diuji pada sistem operasi target; source ZIP bukan installer yang sudah dikompilasi.


## Perubahan v0.11.0 — Apache + PHP-CGI FastCGI

- Proyek PHP/Laravel dari Project Manager memulai PHP-CGI pada loopback lalu memasang virtual host `.localhost` melalui Apache.
- Apache mengaktifkan `mod_proxy`, `mod_proxy_fcgi`, dan `mod_rewrite` hanya saat diperlukan oleh proyek PHP, dengan path modul absolut.
- Laravel memakai `public/` sebagai document root apabila `artisan` dan `public/index.php` tersedia; `.htaccess` diizinkan untuk mendukung routing Laravel.
- PHP-CGI dan Apache terikat pada `127.0.0.1`; port FastCGI tidak diteruskan ke Cloudflare Tunnel. Ketika proyek dihentikan, konfigurasi vhost dimuat ulang untuk menghapus rutenya.
- Dukungan FastCGI harus diverifikasi pada binary Apache/PHP yang terpasang di masing-masing sistem operasi. Jika paket PHP tidak memiliki `php-cgi` atau Apache tidak menyediakan modul yang diperlukan, SXL menampilkan error yang jelas.


## Perbaikan v0.12.0 — stabilitas FastCGI

- Menghapus aturan `Require all granted` dari blok handler PHP generik agar tidak berkonflik dengan aturan `Require all denied` untuk nama file sensitif. Hak akses umum tetap ditentukan oleh blok direktori proyek.
- Mempertahankan konfigurasi virtual host PHP selama worker FastCGI sedang melakukan pemulihan, sehingga vhost tidak hilang apabila Apache harus dimulai ulang di jendela waktu tersebut.
- Menghentikan supervisor PHP-CGI secara eksplisit saat startup proyek gagal dan di-rollback, untuk mencegah worker hidup kembali setelah proyek dibatalkan.
- Menghindari pencatatan ganda untuk output stdout/stderr Apache.
- Menambahkan pemeriksaan tes bahwa blok handler PHP tidak memberikan `Require all granted` yang terlalu luas.


## UI baru v0.13.0

Antarmuka kini memakai sidebar dan top bar dengan halaman terpisah: Dashboard, Project Manager, Web & Runtime, Database Studio, Website Sharing, dan Panduan. Navigasi mendukung URL hash, shortcut Ctrl/Cmd+1 sampai Ctrl/Cmd+6, serta sidebar mobile. CSS dipisah ke `public/styles.css` agar lebih mudah dirawat. Semua ID kontrol yang digunakan `public/app.js` dipertahankan agar alur layanan dan API tetap terhubung.


## Perbaikan keamanan dan stabilitas v0.13.0

- Memperbaiki allowlist unduhan berdasarkan komponen. Composer hanya diunduh dari `getcomposer.org`, phpMyAdmin dari `files.phpmyadmin.net`, dan arsip Apache dari Apache Lounge; redirect HTTPS diperiksa ulang setelah respons diterima.
- Menambahkan batas ukuran stream unduhan, verifikasi SHA-256 arsip Apache terhadap manifest paket eksternal, dan instalasi staging/rollback agar arsip tak terverifikasi tidak dipasang. Manifest adalah sumber verifikasi pihak ketiga, bukan checksum yang diterbitkan Apache Lounge sendiri.
- Memperbarui sumber unduhan binary Windows Apache Lounge ke jalur VS18; pemasangan akan gagal dengan pesan yang jelas jika rilis yang ditemukan belum memiliki manifest checksum yang cocok.
- Mengunci akses default virtual host Apache dan workspace agar host yang tidak dikenal tidak dapat membaca isi folder workspace. Static vhost menolak override `.htaccess` dan symlink; PHP vhost hanya mengizinkan kategori override yang diperlukan untuk routing umum Laravel, bukan `AllowOverride All`.
- Mengarahkan sharing PHP ke direktori publik aplikasi bila tersedia, seperti `public/` Laravel, dan menolak root proyek yang menunjukkan indikasi file konfigurasi/rahasia jika tidak ada direktori publik. Tetap periksa folder sebelum membagikan URL publik.
- Mengganti dialog konfirmasi bawaan browser dengan dialog aplikasi untuk tindakan yang mengubah data atau layanan. Ukuran teks penting, fokus keyboard, serta preferensi reduced-motion juga ditingkatkan.
- Menambahkan tes allowlist URL HTTPS yang memverifikasi host secara persis dan memperbaiki tes yang sebelumnya gagal karena label UI dan ekspektasi konfigurasi lama.

### Status verifikasi v0.13.0

- `npm test`: 36/36 tes lulus pada lingkungan pengembangan ini. Pemeriksaan sintaks JavaScript juga lulus.
- Installer native, Apache/PHP-CGI/MariaDB sungguhan, tunnel internet, serta smoke-test Electron masih harus diuji pada Windows dan macOS.
- `package-lock.json` belum dapat disertakan karena registry npm tidak bisa dijangkau dari lingkungan pengemasan ini. Workflow CI membuat satu lockfile per build lalu membagikannya ke job Windows dan macOS agar kedua paket dalam satu rilis memakai dependency graph yang sama. Untuk reproducibility lintas rilis, commit lockfile yang dihasilkan oleh mesin dengan akses npm registry sebelum rilis publik.


## Perbaikan v0.13.1 — kompatibilitas tes Windows dan PHP-CGI

- Memperbaiki tes path modul Apache agar menerima path absolut dengan slash `/`, format yang valid dan konsisten pada konfigurasi Apache Windows.
- Memperketat pencarian PHP-CGI agar tidak mengambil binary berbeda versi secara diam-diam dari PATH. PHP-CGI harus berpasangan dengan executable PHP yang dipilih; binary khusus tetap dapat diatur secara eksplisit melalui `SXL_PHP_CGI_PATH`.
- Memperbarui versi aplikasi ke v0.13.1.
- Jalankan `npm test` lagi setelah mengunduh versi ini. Tes yang lolos di source belum membuktikan installer dan layanan native berjalan tanpa uji nyata.


## Perbaikan v0.13.2 — fallback Node.js lokal dan diagnosis jaringan

- SXL memeriksa pasangan Node.js dan `npm-cli.js` sistem yang kompatibel sebelum mencoba mengunduh runtime portable. Ini menghindari ketergantungan ke server metadata saat Node.js sudah tersedia.
- Node.js sistem harus versi 22.12 atau lebih baru; versi yang terlalu lama tidak dipakai.
- Jika unduhan metadata tetap diperlukan, pesan error menyertakan kode penyebab jaringan seperti `ENOTFOUND`, `ECONNRESET`, atau kegagalan TLS bila dilaporkan runtime.
- Panel status runtime membedakan runtime portable SXL dan Node.js sistem.
- Jika Node.js sudah terpasang tetapi tidak terdeteksi oleh SXL, tutup seluruh proses aplikasi lalu buka kembali. Untuk lokasi khusus, variabel `SXL_NODE_PATH` dan `SXL_NPM_CLI_PATH` dapat digunakan. Variabel proxy `HTTPS_PROXY`/`HTTP_PROXY` harus tersedia pada lingkungan proses SXL jika jaringan menggunakan proxy.
- Verifikasi pada lingkungan pengembangan: 38/38 tes otomatis lulus. Build installer native dan koneksi dari jaringan/proxy pengguna tetap harus diuji di komputer target.


## Perbaikan v0.13.4 — metadata runtime, proxy, dan deteksi Node lokal

- SXL sekarang mengenali `npm_node_execpath` dan `npm_execpath` yang diwariskan dari `npm run app`, serta lokasi Node.js umum di Windows/macOS/Linux. Ini membantu SXL memakai Node.js yang sudah tersedia tanpa mengunduh runtime baru.
- Pengambilan metadata/arsip runtime menggunakan `undici.ProxyAgent` untuk mendukung `HTTPS_PROXY`, `HTTP_PROXY`, dan `ALL_PROXY` (huruf besar/kecil), serta menghormati `NO_PROXY`. URL/kredensial proxy tidak ditulis ke pesan error.
- Error jaringan menamai sumber metadata yang benar (Node.js atau checksum PHP), hostname, timeout, dan petunjuk diagnosis; error `fetch failed` tidak lagi disamarkan sebagai pesan generik.
- Menambahkan tes untuk Node/npm yang diwariskan dari proses npm, aturan bypass proxy, dan kesalahan metadata PHP yang tidak salah dilabeli sebagai Node.js.
- Jika masih gagal, cek bahwa jaringan dapat membuka `https://nodejs.org` atau `https://windows.php.net`. Pada jaringan kampus/kantor, periksa proxy atau firewall; jangan menonaktifkan verifikasi TLS atau checksum.


Setelah mengganti source dengan versi terbaru, jalankan `npm install`, `npm test`, lalu `npm run app`. Installer `.exe` yang dibuat dari versi lama tidak akan ikut diperbaiki; build ulang dengan `npm run build:win`.


## Perbaikan v0.13.6 — runtime manual tanpa metadata online

- Semua komponen runtime utama dapat dipilih dengan path absolut dari panel **Web & Runtime → Gunakan runtime yang sudah terpasang**.
- Jika PHP manual dipilih, tombol pemasangan PHP menggunakan binary tersebut dan tidak mengunduh metadata PHP. PHP-CGI dapat diatur terpisah, tetapi versi CLI dan CGI harus cocok.
- Apache, Composer PHAR, Node.js + npm CLI, phpMyAdmin, MariaDB bin, dan `cloudflared` dapat menunjuk ke instalasi yang sudah ada. Path manual yang valid mengambil prioritas atas deteksi otomatis SXL.
- Path `cloudflared` manual sekarang juga mencegah SXL memulai jalur pengunduhan binary otomatis pada aplikasi desktop. Binary harus berasal dari sumber tepercaya dan sesuai OS/arsitektur.
- Konfigurasi path disimpan di direktori data pengguna SXL. Mengosongkan path menghapus preferensi manual saja, bukan binary, proyek, atau data database.
- Pada Windows, MariaDB manual membutuhkan server, installer database, client, dan dump utility di folder `bin`. SXL menyalin komponen yang diperlukan ke runtime privat dan membuat data directory baru; data database lama Laragon/XAMPP tidak otomatis dipindahkan.
- Contoh path macOS: `/opt/homebrew/opt/httpd/bin/httpd`, `/opt/homebrew/opt/php@8.3/bin/php`, `/opt/homebrew/opt/mariadb/bin`, `/opt/homebrew/bin/node`. Sesuaikan dengan lokasi aktual melalui `which httpd`, `which php`, `which node`, atau `brew --prefix`.
- Jika metadata gagal karena jaringan, masukkan runtime yang sudah terpasang dan simpan. Ini menghindari pengunduhan untuk komponen yang path-nya telah diatur manual, tetapi tidak meniadakan kebutuhan internet untuk `npm install`, pembaruan, atau komponen yang belum disediakan.

## Pengelola beberapa versi PHP (v0.13.6)

SXL dapat memindai folder versi PHP lokal. Buka **Web & Runtime → Versi PHP yang digunakan → Buka Folder PHP**. Letakkan satu atau beberapa folder distribusi PHP di folder koleksi yang ditampilkan, lalu klik **Pindai Versi** dan **Gunakan Versi Ini**.

Folder koleksi berada pada `runtime/php-versions` di direktori data SXL. Untuk aplikasi desktop terpasang, data berada di folder `userData` milik Electron (Windows biasanya `%APPDATA%\sxl-localhost\runtime\php-versions`; macOS biasanya `~/Library/Application Support/sxl-localhost/runtime/php-versions`). Tombol **Buka Folder PHP** membuka lokasi yang tepat secara otomatis.

Contoh struktur:

```text
runtime/php-versions/
  php-8.3.30/
    php.exe
    php-cgi.exe
    php.ini-development
    ext/
  php-8.5.11-nts-Win32-vs17-x64/
    php.exe
    php-cgi.exe
    php.ini-development
    ext/
```

Kamu juga bisa menyalin folder `php` dari `C:\laragon\bin\php` ke folder koleksi tersebut; SXL memindai subfolder bertingkat sampai tiga tingkat. Di Windows, saat memilih versi yang dikelola SXL dan belum memiliki `php.ini`, SXL akan membuat konfigurasi awal dari `php.ini-development`/`php.ini-production` dan mengaktifkan ekstensi umum yang file DLL-nya tersedia. `php.ini` yang sudah ada tidak diganti seluruhnya. Jika `extension_dir` masih menunjuk folder instalasi asal, SXL membuat backup `php.ini.sxl-backup` dan menambahkan pengaturan agar ekstensi dibaca dari folder koleksi SXL.

Versi aktif digunakan untuk PHP CLI, Composer, dan proyek PHP/Laravel. PHP-CGI harus berasal dari versi yang sama agar FastCGI di Apache dapat berjalan. phpMyAdmin 5.2.3 tetap memakai PHP yang kompatibel (PHP 8.3 atau lebih lama dalam rentang dukungan yang dikonfigurasi), sehingga memilih PHP lebih baru tidak memaksakan phpMyAdmin memakai versi yang tidak didukung.


## Perbaikan v0.14.0 — stabilitas proyek, diagnosa, dan sharing terlindungi

- Menambahkan pilihan PHP per proyek; konfigurasi disimpan terpisah pada `config/project-settings.json` di data SXL. Perubahan ditolak ketika proyek sedang aktif dan PHP-CGI wajib cocok versinya dengan PHP CLI.
- Menambahkan halaman Diagnostik untuk memeriksa binary runtime, ekstensi PHP umum, konfigurasi Apache, koneksi MariaDB, Composer, dan phpMyAdmin.
- Menambahkan autentikasi Basic opsional pada sharing statis dan reverse proxy PHP/Node. Kata sandi minimal 10 karakter, tidak ditampilkan melalui API status, dan header otorisasi dihapus sebelum permintaan diteruskan ke aplikasi.
- Memperbaiki tombol Mulai Berbagi agar kembali aktif jika dialog konfirmasi dibatalkan.
- Menambahkan tes integrasi untuk autentikasi sharing, penghapusan header kredensial, penyimpanan versi PHP per proyek, serta endpoint diagnostik.
- Meningkatkan teks bantu dan tampilan kartu diagnostik.

### Status verifikasi v0.14.0

- Tes otomatis Node.js: 52 tes lulus pada lingkungan pengujian paket ini, termasuk penjelajah tabel dan tampilan status diagnostik.
- Installer native dan service Apache/MariaDB di Windows/macOS tetap harus diuji di runner/sistem operasi target.
- Registry npm tidak merespons di lingkungan pengemasan sehingga `package-lock.json` tidak dapat dihasilkan dan tidak disertakan pada ZIP sumber ini. Workflow rilis menghasilkan satu lockfile lalu menggunakannya bersama pada kedua build OS. Untuk rilis publik yang benar-benar reproducible, commit lockfile ke repositori setelah registry npm dapat diakses.


### Belum termasuk pada v0.14.0

Nginx Manager, pembuatan sertifikat SSL lokal yang dipercaya browser, dan Mailpit belum diimplementasikan sebagai layanan siap pakai. Fitur tersebut tetap tahap berikutnya; tidak ditampilkan seolah-olah sudah berfungsi dalam versi ini.


## Perbaikan v0.14.1 — pengelola versi database dan MariaDB 13.0.2

- Menambahkan pemilih versi MariaDB di Database, impor ZIP lokal dengan checksum yang dipatok, tampilan status/port/path per versi, penggantian port dengan pemeriksaan konflik, dan pembacaan log sesuai versi aktif.
- Mempertahankan jalur data runtime lama. MariaDB 13.0.2 mendapat direktori versi yang sepenuhnya terpisah dan tidak dipilih otomatis.
- Mengubah installer lama agar menolak overwrite folder binary yang telah ada dan folder data nonkosong yang belum terinisialisasi.
- Pemeriksaan source/test dilakukan pada Linux. Binary Windows, inisialisasi Windows, startup/shutdown, koneksi nyata, dan build installer Windows belum dijalankan di lingkungan ini; lihat `RIWAYAT-AUDIT.md`.

## Audit dan laporan rilis

- `RIWAYAT-AUDIT.md` — temuan source, prioritas perbaikan, validasi arsip, batas kompatibilitas, dan prosedur pemulihan.
- `RIWAYAT-AUDIT.md` — hasil tes yang benar-benar dijalankan dan daftar tes yang masih memerlukan Windows x64.
- `MANIFEST-MARIADB-13.0.2.json` — manifest runtime, SHA-256 arsip dan binary penting.
- `MANIFEST-SXL-0.14.10.json` — manifest first-run MariaDB dan hash file penting; manifest rilis sebelumnya tetap disertakan untuk riwayat.
- `PANDUAN-RUNTIME-MANUAL.md` — petunjuk paket runtime terpisah.
- `PANDUAN-RUNTIME-MANUAL.md` — petunjuk paket runtime terpisah.


## Perbaikan keamanan dan pemulihan v0.14.2 (baseline)

- Password MariaDB Windows baru disimpan dengan perlindungan DPAPI untuk akun Windows saat ini; konfigurasi lawas dimigrasikan saat dibaca dan file asli tidak ditimpa bila migrasi gagal. DPAPI tidak melindungi dari malware yang berjalan sebagai pengguna yang sama atau administrator lokal.
- Folder instance database Windows menggunakan ACL eksplisit untuk akun pengguna saat ini, SYSTEM, dan Administrators. Skrip inisialisasi MariaDB masih perlu menjalankan `--password` sesuai antarmuka utility Windows; password ini acak, durasinya singkat, dirahasiakan dari log, dan staging dibatasi ACL, tetapi argumen proses mungkin terlihat oleh administrator/proses lokal berhak tinggi.
- Instalasi parsial MariaDB 13.0.2 hanya dapat diperbaiki setelah konfirmasi. Instance lama dipindahkan ke folder `runtime/mariadb/versions/recovery/`, tidak dihapus. Jika percobaan baru gagal, runtime hasil percobaan dipisah dan folder lama dikembalikan.
- Versi runtime tidak lagi menganggap `11.4.13 LTS` benar bila tidak ada metadata versi yang terverifikasi. SXL mencoba `mariadbd.exe --version`/`mysqld.exe --version` dan menampilkan `Versi belum terverifikasi` jika pemeriksaan gagal.
- `tests/windows-mariadb-smoke.ps1` menyiapkan pengujian pada Windows x64: checksum, instalasi, DPAPI, ACL, startup, koneksi, dump/restore dan shutdown. Skrip ini belum dijalankan pada lingkungan Linux pengemasan ini.
- Paket source tidak menyertakan `package-lock.json`: percobaan membuat lockfile tidak berhasil karena registry npm tidak dapat dijangkau. Workflow CI membagikan satu lockfile per run, tetapi rilis yang reproducible lintas waktu masih membutuhkan lockfile yang dikomit setelah npm registry dapat diakses.


## Build native Windows v0.14.10

Paket yang didistribusikan di sini adalah source/release bundle, bukan EXE Windows yang sudah dikompilasi dan ditandatangani. Pada Windows x64, jalankan `Build-SXL-Localhost-Windows.bat` untuk memasang dependensi build dan menghasilkan installer NSIS serta portable EXE pada folder `dist/`. MariaDB sendiri sudah disertakan dan tidak perlu diunduh lagi. Pengujian startup nyata harus dilaksanakan pada Windows target.
