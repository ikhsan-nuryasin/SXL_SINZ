# SINZ v0.14.14 — Local Development Workspace

SINZ adalah lingkungan pengembangan lokal untuk Windows dan macOS. Selain website sharing, SINZ mengelola MariaDB, PostgreSQL, SQLite, Apache, PHP 8.3, Composer, phpMyAdmin, proyek PHP/Laravel dan Node.js, editor SQL Bahasa Indonesia, backup database, serta Cloudflare Quick Tunnel. Laragon tidak diperlukan. Aplikasi desktop dibuat dengan Electron; data disimpan di `%APPDATA%\\SXL Localhost` pada Windows (atau direktori data pengguna setara di macOS) agar tidak hilang saat aplikasi diperbarui. Nama package, app ID, dan direktori data historis SXL dipertahankan untuk kompatibilitas meskipun branding aplikasi menjadi SINZ.

Saat phpMyAdmin dijalankan, SINZ mengosongkan password akun root MariaDB aktif agar login root tidak memerlukan password. MariaDB dan phpMyAdmin hanya diikat ke `127.0.0.1`; jangan ubah bind ke alamat publik. Aplikasi/proyek yang sebelumnya memakai password root perlu diperbarui. Gunakan akun aplikasi terpisah untuk proyek.


## Mulai cepat tanpa build source (Windows x64)

Untuk menjalankan panel portable lokal tanpa membangun Electron: ekstrak ZIP, kemudian buka `MULAI-SXL-LOCALHOST.bat`. Launcher akan memakai Node.js yang cocok dari sistem atau mengunduh Node.js portable resmi dan memverifikasi hash bila diperlukan. ZIP MariaDB 13.0.2 sudah dibundel sehingga runtime database tidak diunduh lagi dari internet. Pada profil baru, bootstrap database dan pemeriksaan SQL dilakukan sebelum panel dibuka. Cloudflare Tunnel baru disiapkan saat fitur sharing diaktifkan. Data disimpan di `%APPDATA%\SXL Localhost`.

Untuk desktop Electron, gunakan installer Windows atau portable EXE di folder `dist/` setelah build. Installer Windows menampilkan pilihan folder; lokasi awalnya adalah folder `SINZ` di profil pengguna (biasanya `C:\Users\<nama>\SINZ`) agar tidak memerlukan hak administrator. Pembaruan tetap memakai lokasi instalasi yang sudah dipilih. Portable EXE tidak memasang aplikasi dan berjalan dari folder tempat file tersebut disimpan. Launcher browser di atas tetap menjadi alternatif bila tidak ingin memasang aplikasi desktop. Nama folder data historis `%APPDATA%\SXL Localhost` sengaja tidak diubah agar data lama tetap terbaca.

Dokumentasi build dan pemakaian ada di `PANDUAN-RUNTIME-MANUAL.md`; catatan rilis berada di `CHANGELOG.md`, dan arsip pemeriksaan teknis di `RIWAYAT-AUDIT.md`.

## Fitur

- Panel admin hanya terikat ke `127.0.0.1`.
- Preview server untuk website statis yang aman dan terpilih secara eksplisit.
- Cloudflare Quick Tunnel untuk URL HTTPS publik sementara.
- Aplikasi desktop untuk Windows (`.exe` installer/portable) dan macOS (`.dmg`, `.pkg`, `.zip`).
- Cloudflare Tunnel 2026.10.4 diunduh dari release resmi untuk Windows x64 atau macOS Intel/Apple Silicon dan SHA-256 diverifikasi. Binary kelolaan yang tidak terverifikasi tidak dipakai begitu saja.
- Runtime MariaDB lama tetap tersedia; pada profil baru Windows x64, MariaDB 13.0.2 yang dibundel otomatis dipasang, dipilih, dan dinyalakan. PostgreSQL (binary yang dipilih pengguna) dan SQLite via CLI tersedia di panel Database Tambahan.
- Database aktif hanya mengikat `127.0.0.1`; port database tidak dipublikasikan melalui tunnel. Port bawaan adalah 3307 untuk runtime lama dan biasanya 3308 untuk MariaDB 13.0.2.
- SQL editor mendukung sintaks Indonesia yang diterjemahkan di sisi SXL sebelum dikirim ke MariaDB, serta mode SQL standar.
- Terminal SQL Bahasa Indonesia tersedia di jendela terpisah; hasil query ditampilkan sebagai teks aman dan setiap perubahan API tetap dilindungi CSRF loopback.
- Halaman Aplikasi dapat mendaftarkan executable database, coding, terminal, atau aplikasi lain yang sudah terpasang. SINZ menjalankannya dengan argumen terpisah tanpa shell; aplikasi pihak ketiga tidak diunduh atau dipasang otomatis.
- Proyek dapat diterbitkan ke GitHub melalui Git dan GitHub CLI (`gh`) yang telah login. SXL menampilkan file dan SHA-256 untuk ditinjau, mengecualikan file privat/dump umum, merencanakan `.gitignore` otomatis, lalu meminta konfirmasi sebelum membuat repository. SXL tidak menyimpan token GitHub.
- Pengelola Proyek memakai daftar ringkas: pembuatan proyek, tindakan seperti menjalankan/membuka/Composer, dan push GitHub dibuka dalam pop-up. Setiap proyek memiliki tombol **Push ke GitHub** sendiri; daftar file tetap harus ditinjau dan dikonfirmasi sebelum dikirim.
- **Download Center** menampilkan sumber HTTPS resmi, status yang dideteksi lokal, versi lokal jika dapat diverifikasi, serta pemisahan jelas antara runtime yang bisa dipasang SINZ dan paket yang harus dipasang dari situs resminya. PHP, Composer, MariaDB, dan Apache memakai alur terkelola yang sudah tersedia; PostgreSQL, MySQL, Node.js, Bun, Git, VS Code, SQLite CLI, dan Nginx hanya ditautkan ke sumber resmi, bukan diklaim terpasang atau dikelola SINZ.
- **New Project Wizard** memeriksa PHP/ekstensi/Composer dan metadata rilis stabil Laravel sebelum mengizinkan pembuatan. Proyek Laravel dibuat dengan Composer di folder staging, memakai SQLite sebagai konfigurasi awal, diverifikasi (`artisan`, `composer.json`, `vendor/autoload.php`, `.env`), lalu dipindahkan dan didaftarkan. Git bersifat opsional; proyek Laravel berjalan melalui `artisan serve` pada loopback. Untuk saat ini lokasi proyek tetap pada workspace SINZ dan database wizard hanya SQLite; wizard tidak membuat database server atau menjalankan migrasi.
- Versi katalog yang tidak dapat diperiksa tidak diberi label “terbaru”. Detail paket selalu menyediakan tautan ke sumber resmi. Aktivitas instalasi ditampilkan tanpa persentase palsu bila installer tidak menyediakan progres.
- Pendaftaran aplikasi lokal juga memakai pop-up; daftar aplikasi tetap terlihat di halaman Aplikasi.
- Dashboard menyediakan tindakan cepat untuk membuat proyek, membuka SQL, dan menjalankan MariaDB. Navigasi utama mengikuti urutan Dashboard, Proyek, Database, Aplikasi, dan Pengaturan; terminal SQL dipisahkan sebagai tool tersendiri.
- Pengaturan panjang dikelompokkan dalam tab **Berbagi & keamanan**, **Database**, dan **Web & runtime**. Pada halaman Database, tombol cepat untuk MariaDB serta editor SQL tersedia sebelum panel detail runtime, data, dan query.
- Backup database pengguna ke dump SQL (schema sistem MariaDB dikecualikan) dan pemulihan backup melalui dashboard; sebelum restore, SXL membuat backup keselamatan otomatis.
- Mode runtime statis, PHP (Windows: PHP 8.3 portable dengan SHA-256; macOS: PHP 8.3 melalui Homebrew), dan Node.js (Node LTS portable yang diverifikasi SHA-256).
- Kontrol Start All/Stop All untuk MariaDB, Apache, serta phpMyAdmin yang sudah diinstal. Start All tidak memasang paket yang belum terpasang secara otomatis.
- Composer PHAR yang diunduh dari getcomposer.org dan divalidasi menggunakan checksum resmi; proyek PHP dengan composer.json dapat menjalankan `composer install` setelah konfirmasi pengguna.
- Pengaturan runtime manual: path Apache, PHP CLI, PHP-CGI, Composer PHAR, Node.js, npm-cli.js, folder phpMyAdmin, binary Cloudflare Tunnel, dan folder bin MariaDB dapat diisi sendiri dari panel Web & Runtime.
- Tombol Buka Folder WWW untuk workspace dan deteksi otomatis proyek yang sudah ada di dalamnya (Laravel/PHP, Node.js, atau HTML statis) saat refresh.
- Versi PHP per proyek: tiap proyek PHP/Laravel dapat memilih PHP CLI dan PHP-CGI yang cocok tanpa mengubah versi global.
- Diagnostik satu klik untuk path runtime, versi dan ekstensi PHP, sintaks Apache, konektivitas MariaDB, Composer, serta phpMyAdmin.
- Proteksi kata sandi opsional pada website sharing, untuk preview statis maupun proxy runtime PHP/Node. Kredensial tidak diteruskan ke server aplikasi di belakang proxy.
- Kontrol `Start All`/`Stop All` untuk Apache, MariaDB, dan phpMyAdmin yang sudah terpasang; proyek individual tetap dikelola sendiri.

## Multi-database dan Cloudflare Quick Tunnel (v0.14.3)

### PostgreSQL dan SQLite

- PostgreSQL tidak dibundel pada source ZIP. Pilih folder `bin` PostgreSQL yang berisi `postgres`, `initdb`, `pg_ctl`, `psql`, dan `pg_dump`; SINZ memvalidasi versi minimal 14 dan membuat cluster baru di data pengguna.
- PostgreSQL default listen hanya pada `127.0.0.1:5433`. Data dari instalasi PostgreSQL lain tidak diadopsi otomatis. Ganti binary/port hanya saat layanan berhenti dan statusnya dapat diverifikasi.
- Panel PostgreSQL menyediakan konfigurasi runtime, inisialisasi, start/stop normal, status, log, query SQL, daftar/buat database, kredensial, dan backup custom format. Restore PostgreSQL belum tersedia dari UI pada paket ini; pulihkan dump hanya dengan prosedur PostgreSQL yang sesuai dan setelah backup target.
- SQLite tidak menjalankan service. Pilih executable CLI `sqlite3` resmi; SINZ memverifikasi output versi dan hanya membuat/mengelola file di direktori data aplikasi. Panel mendukung query dan backup, sedangkan restore melalui UI belum disediakan. Simpan file database lama di luar direktori data aplikasi bila tidak ingin dikelola SINZ.
- MongoDB, Redis, dan MySQL server asli belum menjadi pengelola runtime terpadu pada rilis ini.

### Cloudflare Quick Tunnel

- Saat tidak ada binary manual, SXL mengunduh `cloudflared` release **2026.10.4** untuk Windows x64 dan macOS x64/arm64 serta memeriksa SHA-256 yang dipatok. Binary terkelola yang checksum-nya tak sesuai dilewati dan dipasang ulang melalui staging/karantina; binary manual hanya dipakai bila dipilih/dikonfigurasi pengguna.
- Akses publik anonim meminta konfirmasi eksplisit. Untuk perlindungan lebih baik, isi kata sandi SXL dan/atau allow-list email Cloudflare. Satu email per baris diperbolehkan, termasuk pola `*@domain.com`; Cloudflare menggunakan kode OTP email. Allow-list memerlukan `cloudflared` 2026.10.4 atau lebih baru.
- Setiap sesi menggunakan direktori konfigurasi terisolasi agar file `config.yml`/kredensial tunnel pengguna yang sebenarnya tidak mengganggu Quick Tunnel. Ketika sesi berhenti, direktori sementara milik sesi dibersihkan.
- Quick Tunnel hanya untuk pengembangan/tes, bukan hosting produksi. URL acak sementara berubah tiap sesi; batas saat ini 200 permintaan in-flight, dan SSE tidak didukung. Jangan arahkan tunnel ke panel admin, port database, atau layanan internal.
- Auto-install mendukung Windows x64 dan macOS Intel/Apple Silicon. Linux memerlukan binary `cloudflared` yang sesuai dan dikonfigurasi manual pada rilis ini.

## Instalasi aplikasi desktop (direkomendasikan)

### Windows 10/11 64-bit

1. Jalankan `SXL-Localhost-0.14.14-x64.exe` hasil build installer.
2. Ikuti wizard. Instalasi default hanya untuk akun Windows yang sedang digunakan dan tidak meminta hak Administrator.
3. Setelah selesai, installer membuka **SINZ** dan membuat shortcut di Start Menu serta Desktop. Opsi **Web & Runtime → Layanan → Startup Windows** dapat digunakan untuk mengaktifkan atau menonaktifkan aplikasi berjalan saat masuk Windows. Opsi ini tersedia di aplikasi hasil installer, bukan portable EXE.
4. Pada pembukaan pertama di Windows x64, MariaDB 13.0.2 disiapkan otomatis dari arsip yang dibundel dan tidak memerlukan unduhan MariaDB terpisah. Setup berjalan di ruang data pengguna; permintaan Administrator tidak diperlukan. Internet masih dibutuhkan untuk dependensi build, Cloudflare Tunnel, dan runtime lain yang belum dibundel.
5. Menghapus aplikasi tidak menghapus database dan data pengguna. Hapus data tersebut secara terpisah hanya jika memang tidak diperlukan lagi.

### macOS Intel dan Apple Silicon

Untuk mengambil aplikasi Mac dari GitHub, buka repository proyek → **Actions** → **Build SXL Localhost desktop installers** → **Run workflow**. Setelah job macOS selesai, buka workflow run tersebut dan unduh artifact **SXL-macOS-Installer**. Artifact berisi `.dmg`, `.pkg`, dan `.zip` universal untuk Mac Intel serta Apple Silicon. Workflow juga berjalan otomatis saat tag rilis `v*` didorong.

1. Buka file `.dmg` hasil build lalu seret **SINZ** ke folder **Applications**, atau gunakan file `.pkg` untuk installer macOS.
2. Buka aplikasi dari Applications. Saat pertama kali, macOS dapat menampilkan konfirmasi keamanan karena paket belum ditandatangani dan dinotariskan dengan sertifikat Developer ID.
3. Untuk MariaDB di macOS, pasang Homebrew dari https://brew.sh terlebih dahulu. Kemudian gunakan tombol **Pasang MariaDB** di SINZ. SINZ menyimpan data database sendiri dan tidak menggunakan direktori database Homebrew global.

Paket di arsip ini adalah source code serta konfigurasi build. Installer `.exe`, `.dmg`, dan `.pkg` dihasilkan melalui perintah build pada OS target; paket macOS harus dibangun pada macOS. Belum ada signature/notarization yang disediakan.

## Menjalankan mode pengembangan

Membutuhkan Node.js 22.12+ untuk versi Electron yang digunakan. Dependensi langsung mencakup Undici untuk dukungan proxy HTTPS pada unduhan runtime.

```sh
npm install
npm run app
```

Mode server/browser lama di Windows tetap tersedia melalui `Start-SXL-Website-Sharing.bat`. Di macOS, `Start-SXL-Website-Sharing.command` merupakan launcher mode pengembangan (membutuhkan Node.js dan paket npm); untuk pengguna biasa gunakan installer desktop.

### Menyiapkan paket PHP dan MariaDB di folder pack (Windows x64)

Paket v0.14.10 menyertakan arsip MariaDB 13.0.2 di `runtime/packages/`; bootstrapper runtime masih tersedia untuk paket opsional yang tidak dibundel. Jalankan `Install-SXL-Runtime-Pack.bat` atau PowerShell berikut dari folder SXL yang sudah diekstrak jika Anda ingin menyiapkan runtime tambahan:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-SXL-Runtime-Pack.ps1
```

Di v0.14.10, ZIP MariaDB 13.0.2 sudah ada di `runtime/packages/` dan dipakai otomatis pada first-run Windows x64. `Install-SXL-Runtime-Pack.ps1` masih dapat digunakan untuk mengisi paket tambahan seperti PHP; internet diperlukan saat mengunduh paket tambahan tersebut, bukan untuk mengambil ZIP MariaDB yang sudah dibundel.

### Membuat installer

Jalankan pada sistem operasi target:

```sh
npm run build:win             # Windows: installer NSIS + portable EXE
npm run build:mac             # macOS: DMG + PKG + ZIP untuk arsitektur host
npm run build:mac:intel       # macOS Intel (x64)
npm run build:mac:arm         # Apple Silicon (arm64)
npm run build:mac:universal   # Aplikasi universal (build di Mac)
```

Hasil build ada di folder `dist/`. Untuk distribusi ke publik, macOS memerlukan tanda tangan Developer ID dan notarization agar pengguna tidak perlu melewati peringatan Gatekeeper; Windows juga sebaiknya memakai code signing untuk distribusi publik.

## Menjalankan server dari ZIP di Windows

1. Ekstrak ZIP ke folder yang dapat ditulis, misalnya `C:\Apps\SXL-Localhost`.
2. Jalankan `Start-SXL-Website-Sharing.bat`.
3. Tunggu Node.js portable dan Cloudflare Tunnel disiapkan jika belum tersedia.
4. Panel terbuka pada port localhost yang tersedia.
5. Pada Windows x64, first-run desktop memasang, memilih, menginisialisasi, dan menguji MariaDB 13.0.2 dari ZIP yang sudah dibundel. Untuk profil yang sudah mempunyai konfigurasi database, pilihan yang ada dipertahankan; pemasangan/repair manual tetap tersedia melalui **Database → Pasang MariaDB 13.0.2 dari ZIP**.


## Menggunakan runtime yang sudah terpasang

Untuk instruksi dan contoh path Windows/macOS yang lebih lengkap, lihat `PANDUAN-RUNTIME-MANUAL.md`.


Buka **Web & Runtime → Gunakan runtime yang sudah terpasang**, masukkan path absolut tanpa tanda kutip, lalu tekan **Simpan & Validasi Path**. Contoh Windows:

- Apache: `C:\xampp\apache\bin\httpd.exe`
- PHP: `C:\laragon\bin\php\php-8.3.x\php.exe`
- PHP-CGI: `C:\laragon\bin\php\php-8.3.x\php-cgi.exe`
- Cloudflare Tunnel: `C:\tools\cloudflared.exe`
- Node.js: `C:\Program Files\nodejs\node.exe`
- npm CLI: `C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`
- Composer: path file `composer.phar`
- phpMyAdmin: folder hasil ekstrak yang berisi `index.php`
- MariaDB: folder `bin` yang berisi binary server, installer, client, dan dump.

Path harus merujuk pada file/folder yang benar-benar ada. Kosongkan satu field untuk kembali ke deteksi otomatis SINZ. Untuk PHP-FastCGI, versi `php.exe` dan `php-cgi.exe` harus cocok. Jika memakai folder bin MariaDB manual di Windows, SINZ menyalin komponen runtime yang diperlukan ke folder data privat, lalu membuat direktori data database baru; database lama Laragon/XAMPP tidak diimpor dan tidak diubah. Binary MySQL murni tidak selalu kompatibel dengan installer MariaDB.

## Pengelolaan database

- Setiap versi managed menyimpan binary, konfigurasi, log, temporary files, backup, dan data pada lokasi yang terpisah di bawah `runtime/mariadb/`. Untuk versi lama, jalur kompatibilitas tetap `runtime/mariadb/server`, `runtime/mariadb/data`, `runtime/mariadb/settings.json`, dan `runtime/mariadb/backups`.
- MariaDB 13.0.2 dipisahkan di `runtime/mariadb/versions/mariadb-13.0.2-winx64/`; data barunya ada di folder `data`, konfigurasi di `config/my.ini`, log di `logs/mariadbd.log`, dan backup di `backups`.
- Pilihan versi tersimpan di `runtime/mariadb/manager.json`. Pada profil desktop baru Windows x64, MariaDB 13.0.2 dibundel akan dipilih setelah instalasi dan tes startup berhasil. Profil yang sudah ada tidak diubah diam-diam kecuali ditemukan instalasi MariaDB 13.0.2 parsial yang perlu dipulihkan; data parsial dikarantina ke recovery dan tidak dipakai otomatis.
- Password root acak disimpan dalam `settings.json` setiap versi; pada Windows nilai password diproteksi DPAPI untuk akun Windows yang memasangnya, dan ACL folder instance dibatasi. Jangan bagikan berkas atau folder backup tersebut. DPAPI bukan perlindungan dari malware/administrator yang berjalan dengan hak setara atau lebih tinggi. Data versi lama tidak dipindahkan atau dimigrasikan otomatis.
- Sebelum upgrade atau mengganti versi, lakukan backup SQL dari runtime sumber. Restore memakai dump aplikasi/schema pengguna; dump system schema MariaDB tidak diterima oleh alur restore biasa.
- Port aktif dapat disesuaikan dari Database saat database berhenti. SXL menolak port yang sedang menerima koneksi dan tidak menghentikan proses lain secara paksa. Host tetap `127.0.0.1`.
- Gunakan tombol **Lihat Kredensial** di panel lokal untuk melihat hostname, port, username, dan password yang dibuat saat inisialisasi.
- Host default database adalah `127.0.0.1`, username admin `root`. Runtime lama biasanya memakai port `3307`; MariaDB 13.0.2 memakai port konfigurasi `3308` (dan memilih port bebas bila port itu sedang dipakai). Database tidak di-bind ke seluruh antarmuka jaringan dan portnya tidak diteruskan melalui Cloudflare Tunnel.
- Tombol **Backup Database Pengguna** membuat dump SQL pada folder `runtime/mariadb/backups`. Untuk memulihkan, pilih file dalam daftar lalu klik **Pulihkan Backup**. SXL membuat backup keselamatan otomatis sebelum menjalankan restore. Simpan salinan backup di media terpisah; backup yang tersimpan pada disk yang sama tidak melindungi dari kerusakan disk.

## MariaDB 13.0.2 otomatis (Windows x64)

Pada profil desktop baru, SXL memakai arsip `runtime/packages/mariadb-13.0.2-winx64.zip` yang sudah dibundel. SXL memvalidasi checksum dan struktur arsip, menginisialisasi direktori data terpisah, menjalankan startup test dengan autentikasi dan `SELECT VERSION()`, lalu memilih dan menyalakan versi tersebut sebelum panel utama dibuka. Koneksi internet tidak diperlukan untuk mengambil ZIP MariaDB.

Alur manual tetap tersedia pada **Database → Pasang MariaDB 13.0.2 dari ZIP**. SXL memeriksa nama arsip, ukuran, SHA-256, struktur ZIP, executable, DLL/plugin, dan lisensi. Runtime ini hanya untuk Windows x64. Data dari MySQL, XAMPP, Laragon, atau versi database lain tidak diimpor otomatis.

Jika ada runtime MariaDB 13.0.2 parsial dari pemasangan sebelumnya, SXL menyimpannya di `runtime/mariadb/versions/recovery/` dan tidak menggunakan data tersebut otomatis; bila proses pemulihan gagal, folder lama dikembalikan. Jika port default `3308` tidak tersedia, SXL memilih port bebas mulai dari `3308` sampai `3408`.

Konfigurasi host/port aplikasi proyek dan phpMyAdmin yang sudah ada tidak diubah diam-diam. Perbarui konfigurasi proyek sesuai status runtime MariaDB yang terpilih.

SHA-256 arsip sumber resmi yang dipatok oleh integrasi ini:

`ba9cefd6674b3f2f7bc67334c05305dc7c919643d76836e10767e70db0b5fb74`

MariaDB 13.0.2 merupakan rilis stabil jalur rolling, bukan LTS. Runtime lama tetap dipertahankan untuk kompatibilitas dan masa dukungan lebih panjang. Jangan menyalin folder `data` dari versi lain ke direktori MariaDB 13.0.2. Migrasi data harus menggunakan dump/restore dan pengecekan aplikasi secara terpisah.

## Akun database untuk aplikasi

Pilih database pada bagian **Database aktif**, lalu buat akun aplikasi melalui panel. SXL menolak nama akun yang sudah ada agar tidak mengubah hak akses akun lama, membuat password acak, dan memberi hak akses hanya pada database terpilih. Kata sandi ditampilkan satu kali; salin ke konfigurasi rahasia backend dan jangan simpan di JavaScript frontend atau folder publik. MariaDB tetap hanya mendengarkan di `127.0.0.1`.

## Sintaks SQL Bahasa Indonesia

### Terminal SQL terpisah

Klik **SQL terminal** di navigasi untuk membuka editor pada jendela terpisah. Pilih Bahasa Indonesia atau SQL standar, sisipkan contoh kode, atau cari materi dan kamus perintah MariaDB. Beberapa perintah dapat dijalankan berurutan dalam satu koneksi dengan pemisah titik koma (maksimal 50 perintah per batch); hasil setiap perintah ditampilkan terpisah dan bila suatu perintah gagal, hasil yang sudah selesai tetap ditampilkan. Perintah yang berhasil sebelum error tidak otomatis dibatalkan. Jalankan dengan tombol atau `Ctrl+Enter`. Terminal menggunakan koneksi dan perlindungan lokal yang sama dengan dashboard.

## Direktori aplikasi dan publikasi GitHub

Pada halaman **Aplikasi**, daftarkan aplikasi yang telah terpasang dengan nama, kategori, path executable, argumen opsional (satu per baris), dan working directory. Pastikan path benar dan hanya daftarkan executable yang Anda percaya. Menghapus aplikasi dari direktori SXL hanya menghapus catatannya, bukan file aplikasinya.

Pada halaman **Proyek**, pilih **Push ke GitHub** pada proyek yang akan diterbitkan, lalu ikuti empat langkah di dialog:

1. Masukkan nama repository (misalnya `aplikasi-saya`) atau `pemilik/aplikasi-saya`, lalu pilih **Private** atau **Public**. Private disarankan; repository Public dapat dilihat dan disalin siapa saja.
2. Buat pratinjau. Periksa nama dan ukuran setiap file, SHA-256 yang diverifikasi server, serta daftar file yang dikecualikan. Tidak ada perubahan pada proyek saat pratinjau dibuat.
3. Periksa rencana `.gitignore` otomatis dan centang persetujuan hanya jika file dan visibilitasnya sudah benar. Aturan mencakup `.env*`, kredensial, dependensi/cache, log, file sementara, dump database/backup, serta konfigurasi editor dan OS. File `.gitignore` baru atau aturan tambahan baru ditulis setelah konfirmasi; file tersebut juga masuk dalam daftar pratinjau dan commit.
4. Terbitkan. SXL memindai ulang daftar file dan rencana `.gitignore`, memeriksa Git, membuat commit pada branch `main`, membuat repository, lalu mengirimnya. Perubahan sejak pratinjau membatalkan publikasi. Repository yang memiliki remote, perubahan staged yang belum ditinjau, atau riwayat commit ditolak untuk menghindari pengiriman ke tujuan yang salah atau rahasia lama dalam riwayat.

Persyaratan: Git dan GitHub CLI (`gh`) harus terpasang, `gh auth login` harus sudah dijalankan, dan identitas commit harus dikonfigurasi dengan `git config --global user.name` serta `git config --global user.email`. SXL tidak menyimpan token GitHub. Jika proses terhenti setelah commit lokal dibuat, periksa repository dan Git secara manual sebelum mencoba lagi; jangan menghapus riwayat atau remote yang tidak dikenal. Jangan lanjutkan jika daftar file memuat rahasia atau data yang tidak ingin dibagikan.

Mode **Bahasa Indonesia** adalah penerjemah sintaks di SINZ. MariaDB tetap memakai sintaks SQL resminya; SINZ mengubah perintah sebelum dikirim ke server. Ini menjaga kompatibilitas dengan MariaDB/MySQL dan aplikasi yang sudah ada.

| Sintaks di SXL | SQL yang dikirim ke MariaDB |
|---|---|
| `BUAT DATABASE kampus;` | `CREATE DATABASE kampus;` |
| `GUNAKAN kampus;` | `USE kampus;` |
| `BUAT TABEL mahasiswa (id INT, nama VARCHAR(80));` | `CREATE TABLE mahasiswa (id INT, nama VARCHAR(80));` |
| `TAMPILKAN DATABASE;` | `SHOW DATABASES;` |
| `TAMPILKAN TABEL;` | `SHOW TABLES;` |
| `PILIH nama DARI mahasiswa DIMANA id = 1;` | `SELECT nama FROM mahasiswa WHERE id = 1;` |
| `TAMBAHKAN KE mahasiswa (nama) ISI ('Ikhsan');` | `INSERT INTO mahasiswa (nama) VALUES ('Ikhsan');` |
| `UBAH mahasiswa ATUR nama = 'Baru' DIMANA id = 1;` | `UPDATE mahasiswa SET nama = 'Baru' WHERE id = 1;` |
| `HAPUS DARI mahasiswa DIMANA id = 1;` | `DELETE FROM mahasiswa WHERE id = 1;` |
| `HAPUS TABEL mahasiswa;` | `DROP TABLE mahasiswa;` |
| `HAPUS DATABASE kampus;` | `DROP DATABASE kampus;` |
| `URUTKAN BERDASARKAN nama;` | `ORDER BY nama;` |

Penerjemah melewati literal teks, komentar, dan nama identifier yang dibungkus backtick. Bila nama kolom/tabel bentrok dengan kata kunci Indonesia, gunakan backtick, misalnya `` `dari` ``. Satu query dapat dijalankan per eksekusi. Tetap periksa perintah `HAPUS`, `UBAH`, `DROP`, `UPDATE`, dan `DELETE` sebelum dijalankan karena perubahan bisa bersifat permanen.

## Jenis website yang didukung

| Jenis | Cara kerja |
|---|---|
| HTML/CSS/JavaScript statis | Preview server internal dengan blokir file rahasia, path traversal, dan tipe file tidak dikenal. Untuk React/Vue, pilih `dist` atau `build`. |
| PHP sederhana | Menjalankan PHP built-in server pada loopback dengan router SXL yang menolak dotfiles, backup, dan konfigurasi sensitif. Pada Windows PHP portable diunduh dan checksum diverifikasi. |
| Laravel | Menjalankan `php artisan serve` pada loopback jika proyek sudah memiliki `vendor/autoload.php` dan `public/index.php`. Composer dan dependensi Laravel harus disiapkan terlebih dahulu. |
| Backend Node.js | Node.js LTS portable diunduh dan checksum diverifikasi. Folder proyek harus memiliki `package.json` dengan `scripts.start`. Jika `node_modules` belum ada, SXL meminta konfirmasi sebelum menjalankan `npm install`. |
| WordPress | Dapat dijalankan dengan PHP/web server yang sesuai, tetapi membutuhkan database WordPress dan file konfigurasi yang benar. Untuk proyek serius, uji backup dan jangan publikasikan instance pengembangan tanpa proteksi. |

**Peringatan runtime dinamis:** mode PHP/Node menjalankan kode proyek yang dipilih dan menerbitkan aplikasinya melalui URL publik. Lanjutkan hanya untuk proyek tepercaya, cek autentikasi aplikasi, dan jangan mengekspos panel admin atau konfigurasi rahasia. macOS memerlukan PHP sistem/Homebrew untuk mode PHP; Node.js disiapkan SXL secara portable. Pemasangan PHP portable otomatis saat ini tersedia pada Windows x64.

## Akses dari perangkat lain

- Panel admin SXL tetap lokal di komputer host.
- Pilih mode **Statis**, **PHP**, atau **Node.js**, lalu tekan **Mulai Berbagi** untuk membuka website melalui URL HTTPS Quick Tunnel.
- Perangkat penerima memerlukan internet, tetapi tidak harus berada di jaringan Wi-Fi yang sama.
- URL bersifat sementara dan tidak memerlukan/mengaktifkan port forwarding router.
- Jangan membagikan halaman yang berisi data privat. Siapa pun yang memiliki URL dapat mencoba mengakses konten yang diterbitkan.
- Tunnel hanya meneruskan website statis, bukan dashboard admin SXL atau database MariaDB.

## Tes dan pengembangan

Membutuhkan Node.js versi 22.12+ untuk menjalankan aplikasi dan tes di lingkungan pengembangan.

```powershell
node --test
```

Tes mencakup penerjemah sintaks Indonesia, validasi nama backup, URL policy Electron, CSRF dan Host API, server panel, port dinamis, serving aset statis, fallback SPA, blokir path sensitif, siklus sharing dengan tunnel simulasi, serta runtime PHP bila PHP tersedia.

## Catatan versi pengembangan

Paket source tidak menyertakan `package-lock.json` karena registry npm tidak dapat dijangkau saat pengemasan ini dibuat. Dependensi utama dipatok di `package.json`; untuk build yang sepenuhnya reproducible, jalankan `npm install --package-lock-only` saat registry tersedia, tinjau file lock yang dihasilkan, lalu commit bersama source sebelum membuat rilis. Workflow CI saat ini memakai `npm install` sehingga build tetap dapat berjalan, tetapi pohon dependensi transitif belum sepenuhnya terkunci.

## Sumber runtime resmi
- PHP for Windows: https://windows.php.net/downloads/releases/
- Composer: https://getcomposer.org/download/
- Apache HTTP Server: https://httpd.apache.org/
- Apache Lounge Windows binaries: https://www.apachelounge.com/download/

- Node.js: https://nodejs.org/dist/
- Electron: https://releases.electronjs.org/
- electron-builder: https://www.electron.build/
- Cloudflare Tunnel: https://github.com/cloudflare/cloudflared/releases
- MariaDB Windows ZIP: https://archive.mariadb.org/mariadb-11.4.13/winx64-packages/
- MariaDB macOS via Homebrew: https://mariadb.com/docs/server/server-management/install-and-upgrade-mariadb/installing-mariadb/binary-packages/installing-mariadb-on-macos-using-homebrew

## Pemecahan masalah

**MariaDB tidak dapat dipasang:** periksa ruang disk dan pesan di panel Database. Pada Windows, first-run MariaDB 13.0.2 menggunakan arsip bundel; periksa `runtime/mariadb/versions/mariadb-13.0.2-winx64/logs/mariadbd.log` dan pesan startup test jika instalasi parsial. Jangan menghapus folder recovery. Pada macOS pastikan Homebrew dapat dipanggil dari `/opt/homebrew/bin/brew` atau `/usr/local/bin/brew`; setelah memasang Homebrew, buka ulang SINZ.

**MariaDB tidak bisa dimulai:** periksa port pada konfigurasi versi aktif. Runtime lama biasanya memakai `3307`; MariaDB 13.0.2 memakai `3308` atau port bebas yang tercatat pada status. Periksa `runtime/mariadb/versions/mariadb-13.0.2-winx64/logs/mariadbd.log` serta pesan startup test. Pastikan executable runtime bisa berjalan dan tidak diblokir kebijakan keamanan Windows. Database hanya boleh mendengarkan di `127.0.0.1`.

**SQL Bahasa Indonesia gagal:** ganti dropdown ke SQL MariaDB standar untuk membandingkan perintah. Pastikan identifier yang sama dengan kata kunci Indonesia ditulis menggunakan backtick.

**Cloudflare URL tidak muncul:** periksa internet, firewall, VPN, dan DNS; hentikan berbagi lalu coba ulang. Quick Tunnel bukan hosting permanen.
