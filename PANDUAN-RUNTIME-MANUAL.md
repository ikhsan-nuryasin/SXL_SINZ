# Panduan Runtime Manual SINZ

Gunakan halaman **Web & Runtime → Gunakan runtime yang sudah terpasang** jika SXL tidak bisa mengambil metadata atau mengunduh runtime dari internet.

## Sebelum mulai

1. Buka folder instalasi runtime yang sudah ada (misalnya Laragon, XAMPP, Node.js, atau Homebrew).
2. Salin **path absolut** ke field yang sesuai. Jangan sertakan tanda kutip.
3. Klik **Simpan & Validasi Path**.
4. Refresh status layanan. Jalankan tombol layanan yang diperlukan.
5. Untuk kembali ke pendeteksian otomatis SXL, kosongkan hanya field yang diinginkan lalu simpan. Tombol **Kosongkan Semua Path** menghapus seluruh preferensi path; tidak menghapus aplikasi atau data database.

## Windows

Contoh lokasi umum (sesuaikan dengan versi yang benar-benar terpasang):

| Komponen | Contoh path |
|---|---|
| Apache | `C:\xampp\apache\bin\httpd.exe` |
| PHP CLI | `C:\laragon\bin\php\php-8.3.x\php.exe` |
| PHP-CGI | `C:\laragon\bin\php\php-8.3.x\php-cgi.exe` |
| Composer | `C:\ProgramData\ComposerSetup\bin\composer.phar` (jika file ini tersedia) |
| Node.js | `C:\Program Files\nodejs\node.exe` |
| npm CLI | `C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js` |
| Cloudflare Tunnel | `C:\tools\cloudflared.exe` |
| phpMyAdmin | `C:\xampp\phpMyAdmin` atau folder ekstrak yang memiliki `index.php` |
| MariaDB | `C:\laragon\bin\mysql\mariadb-<versi>\bin` atau folder bin MariaDB lain yang lengkap |

Untuk menemukan executable yang berada di PATH, jalankan di PowerShell:

```powershell
where.exe php
where.exe node
where.exe httpd
where.exe cloudflared
```

Perintah `where.exe` hanya menemukan executable yang masuk PATH. Jika hasilnya kosong, periksa folder instalasi secara langsung.

### Syarat folder MariaDB manual di Windows

Folder `bin` perlu berisi server, installer database, client, admin, dan dump tool: `mariadbd.exe`/`mysqld.exe`, `mariadb-install-db.exe`/`mysql_install_db.exe`, `mariadb.exe`/`mysql.exe`, `mariadb-admin.exe`/`mysqladmin.exe`, dan `mariadb-dump.exe`/`mysqldump.exe`. SXL menyalin runtime yang diperlukan ke direktori privat SXL dan membuat **data directory baru**. Database lama Laragon/XAMPP tidak dipindahkan atau diubah otomatis. MySQL murni tanpa installer yang kompatibel belum tentu dapat digunakan.

## macOS

Contoh path Homebrew umum:

| Komponen | Contoh path |
|---|---|
| Apache | `/opt/homebrew/opt/httpd/bin/httpd` |
| PHP CLI | `/opt/homebrew/opt/php@8.3/bin/php` |
| PHP-CGI | Cari `php-cgi` di folder bin PHP versi yang sama |
| Node.js | `/opt/homebrew/bin/node` |
| npm CLI | `/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js` (sesuaikan dengan output `npm root -g`) |
| MariaDB | `/opt/homebrew/opt/mariadb/bin` |
| phpMyAdmin | Folder ekstrak yang memiliki `index.php` |
| Cloudflare Tunnel | Misalnya `/opt/homebrew/bin/cloudflared` atau lokasi binary yang sudah diunduh |

Gunakan perintah berikut untuk memeriksa lokasi aktual:

```bash
which php
which node
brew --prefix httpd
brew --prefix mariadb
npm root -g
```

Pada Mac Intel, Homebrew biasanya memakai prefix `/usr/local` alih-alih `/opt/homebrew`. Gunakan hasil perintah di komputer sendiri, bukan menyalin contoh secara membabi buta.

## Catatan kompatibilitas

- PHP CLI dan PHP-CGI sebaiknya berasal dari instalasi dan versi yang sama. Untuk phpMyAdmin 5.2.3, gunakan versi PHP yang didukung oleh rilis phpMyAdmin tersebut.
- Composer harus berupa `composer.phar`; SXL menjalankannya menggunakan PHP yang dipilih.
- Jika folder phpMyAdmin manual sudah memiliki `config.inc.php`, SXL tidak menimpanya. Jika phpMyAdmin harus mengakses database SXL, periksa konfigurasi server agar memakai host `127.0.0.1` dan port `3307`; konfigurasi lama XAMPP/Laragon bisa menunjuk ke port lain.
- Node.js harus versi 22.12 atau lebih baru dan harus dipasangkan dengan `npm-cli.js` yang kompatibel.
- Binary `cloudflared` harus sesuai OS dan arsitektur. Setelah path manual valid, SXL tidak mencoba mengunduh binary itu secara otomatis. Tunnel tetap membutuhkan internet agar URL publik bisa dibuat.
- Path yang disimpan menggantikan deteksi otomatis untuk komponen tersebut. Jika path salah atau file dipindah, buka panel ini dan perbarui path.
- Path manual menghindari unduhan metadata untuk komponen terpilih, tetapi tidak menghapus kebutuhan internet untuk `npm install`, pembaruan dependensi, atau komponen yang belum tersedia.
- SXL tidak menyarankan memublikasikan direktori source proyek atau kredensial. Untuk Laravel gunakan document root `public` dan jangan membagikan file `.env`.

## Memasang beberapa versi PHP ke koleksi SXL

1. Buka SXL → **Web & Runtime** → bagian **Versi PHP yang digunakan**.
2. Klik **Buka Folder PHP**. Folder koleksi yang benar akan dibuka otomatis.
3. Ekstrak/ salin setiap distribusi PHP ke subfolder terpisah, misalnya `php-8.3.30` dan `php-8.5.11-nts-Win32-vs17-x64`. Jangan menimpa satu versi dengan versi lain.
4. Untuk PHP Windows, usahakan setiap folder berisi `php.exe`, `php-cgi.exe`, `php.ini-development` atau `php.ini-production`, serta folder `ext`.
5. Klik **Pindai Versi**, pilih versi yang diinginkan, lalu **Gunakan Versi Ini**.
6. Pastikan pesan menyatakan PHP-CGI cocok jika kamu ingin menjalankan proyek PHP/Laravel melalui Apache FastCGI.

SXL tidak menghapus atau mengubah runtime asli Laragon/XAMPP. PHP yang disalin ke koleksi adalah salinan terpisah yang dapat dipilih dari UI; jika konfigurasi salinan menunjuk ke folder ekstensi lama, SXL mencadangkan `php.ini` lalu mengarahkannya ke ekstensi lokal. Di Windows, ketika `php.ini` belum tersedia, SXL menyiapkan konfigurasi awal dari template dan mengaktifkan ekstensi hanya bila DLL-nya tersedia. Selalu periksa error `php -m` jika aplikasi membutuhkan ekstensi tambahan.


Untuk PHP Windows, pilih paket **x64 Non Thread Safe (NTS)** dari distribusi resmi Windows PHP jika akan dipakai dengan Apache FastCGI. Salin `php.exe`, `php-cgi.exe`, folder `ext`, dan file konfigurasi dari satu paket/version yang sama. Jangan gabungkan PHP CLI dari satu versi dengan PHP-CGI dari versi lain.


## Versi PHP per proyek (SXL v0.14.0)

1. Letakkan distribusi PHP lengkap di folder koleksi versi PHP SXL atau tambahkan path manual.
2. Pastikan distribusi mempunyai `php.exe`/`php` dan `php-cgi.exe`/`php-cgi` bila proyek menggunakan Apache FastCGI.
3. Buka **Pengelola Proyek**, cari proyek PHP/Laravel, lalu pilih **Versi PHP proyek**.
4. Simpan pilihan. Proyek harus dihentikan dahulu; versi PHP-CGI wajib cocok dengan PHP CLI. Pilihan kosong berarti menggunakan versi global.
5. Jalankan ulang proyek dan periksa halaman **Diagnostik** jika ada error.

## Proteksi kata sandi website sharing

Di halaman **Berbagi Website**, isi kata sandi minimal 10 karakter sebelum menekan **Mulai Berbagi**. Browser pengunjung akan menampilkan prompt Basic Authentication; gunakan username `sxl` dan kata sandi yang kamu tetapkan. Bagikan kata sandi lewat jalur terpisah dari URL. Fitur ini membantu membatasi akses, tetapi bukan pengganti pengamanan aplikasi, dan website publik tetap harus berisi file yang memang boleh dipublikasikan.


## MariaDB 13.0.2 (Windows x64) sebagai versi tambahan

Gunakan **Database → Pasang MariaDB 13.0.2 dari ZIP** dan pilih arsip resmi `mariadb-13.0.2-winx64.zip`. Arsip wajib lolos verifikasi SHA-256 yang dipatok oleh source. Runtime baru ditempatkan di `runtime/mariadb/versions/mariadb-13.0.2-winx64`; data, config, log, temporary, dan backup-nya terpisah. Versi ini tidak diaktifkan otomatis.

Setelah pemasangan selesai, pilih versi pada daftar dan tekan **Gunakan Versi**. Pindah versi tidak memigrasikan database dan tidak mengubah konfigurasi PHP, phpMyAdmin, ataupun proyek. Periksa host/port koneksi proyek dan konfigurasi phpMyAdmin secara eksplisit setelah berganti versi. Jangan memakai folder data dari runtime lama langsung pada MariaDB 13.0.2; buat backup SQL terlebih dahulu dan gunakan alur restore terpisah.



## Keamanan dan pemulihan database (v0.14.2)

Pada Windows, password database disimpan terenkripsi dengan DPAPI dan terikat pada akun Windows yang membuatnya. Jalankan SXL dengan akun Windows yang sama. Jika akun berubah atau DPAPI gagal dibaca, jangan menghapus `settings.json` atau folder data; simpan salinan seluruh direktori runtime dan pulihkan dengan akun asal atau backup yang valid.

Jika UI menampilkan **Pulihkan Instalasi Parsial**, tindakan ini memindahkan direktori runtime yang belum sehat ke `runtime/mariadb/versions/recovery/` dan mencoba pemasangan baru pada lokasi versi yang kosong. Apabila pemasangan baru gagal, SXL mencoba mengembalikan nama direktori asli. Jangan menghapus folder recovery sampai data diperiksa dan backup sukses diverifikasi.

`tests/windows-mariadb-smoke.ps1` merupakan smoke test destruktif hanya terhadap database sementara yang dibuat oleh skrip itu sendiri. Jalankan dari PowerShell 64-bit pada Windows x64 menggunakan arsip `mariadb-13.0.2-winx64.zip` asli dan source tree SXL. Jangan mengarahkannya ke direktori data produksi.

## PostgreSQL, SQLite, dan Cloudflare Quick Tunnel (v0.14.3)

### PostgreSQL

Di Database, pilih folder `bin` PostgreSQL resmi (minimal major 14) yang menyediakan `postgres`, `initdb`, `pg_ctl`, `psql`, dan `pg_dump`. Tekan **Simpan Runtime**, lalu **Inisialisasi Data SXL** untuk cluster baru. Default port 5433 dan bind `127.0.0.1`. SXL tidak mengadopsi direktori data nonkosong yang belum didaftarkan, tidak melakukan upgrade major otomatis, dan menggunakan shutdown normal. Panel menyediakan query, daftar/buat database, kredensial, log, dan backup custom-format. UI restore belum tersedia; jangan menggunakan restore manual pada database penting tanpa backup dan pemeriksaan log.

### SQLite

Pilih path absolut executable CLI resmi `sqlite3.exe`/`sqlite3`. SXL memvalidasi nama executable dan output versi. Buat database di panel SQLite; file hanya ditempatkan di direktori data SXL. Panel mendukung query dan backup. Restore melalui UI belum tersedia; pertahankan salinan file sebelum operasi manual.

### Cloudflare Quick Tunnel

SXL menyematkan cloudflared 2026.10.4 untuk Windows x64 dan macOS Intel/Apple Silicon; SHA-256 diverifikasi saat unduhan, dan binary kelolaan dengan checksum salah tidak dipakai sebagai runtime terverifikasi. Sesi memakai folder konfigurasi terisolasi. Di menu **Berbagi Website**, masukkan kata sandi minimal 10 karakter dan/atau allow-list email (satu per baris; `*@domain.com` didukung). Cloudflare meminta OTP email dan fitur email membutuhkan cloudflared 2026.10.4+. Jika tidak mengisi keduanya, pengguna harus mengonfirmasi akses publik tanpa autentikasi.

Quick Tunnel merupakan fitur pengembangan/tes, bukan hosting produksi. URL berubah tiap sesi, ada batas 200 permintaan in-flight, dan SSE tidak didukung. Jangan membagikan root source, folder `.env`, panel admin, atau port database. Auto-download runtime didukung Windows x64/macOS x64/arm64; pada Linux siapkan binary resmi dan atur path manual.


---

# First-run MariaDB 13.0.2 — SINZ v0.14.13

This distribution embeds `runtime/packages/mariadb-13.0.2-winx64.zip`. A clean Windows x64 install does not need to download MariaDB separately or browse for its ZIP.

## What happens the first time SINZ is opened

1. The application verifies the exact bundled archive using its pinned SHA-256 and expected size.
2. The installer checks ZIP paths and required MariaDB binaries. To avoid the observed Windows `Access is denied` when launching `mariadb-install-db.exe` from a protected AppData staging folder, it executes the initializer from a temporary extracted copy beside the portable project (or `%TEMP%` if needed), while the final runtime/data remain staged in the SXL user-data directory. The archive hash is checked before this step.
3. The installer initializes a dedicated SXL-owned data directory. Existing MySQL/MariaDB installations and database directories are not adopted.
4. It writes a version-specific `my.ini`, applies runtime DACLs with `icacls.exe` (not `Set-Acl`/SACL privileges), starts the staged server locally, authenticates with the generated root credential, runs `SELECT VERSION()`, and shuts down normally.
5. Only after that smoke test succeeds does it commit the version directory, select MariaDB 13.0.2, and start the database. The UI's READY status is based on a real connection check.

The bundled runtime uses `127.0.0.1` and a free port starting at `3308`. It does not expose the database through Cloudflare Tunnel.
Setup runs under the current Windows user and does not require Administrator/UAC approval: the runtime and data stay in the user's profile, and the server binds only to loopback. If Windows application-control policy blocks a verified MariaDB executable, SXL reports the failure and where to inspect it instead of requesting elevation that cannot reliably override that policy.

## If an earlier MariaDB 13.0.2 install is partial

The app may preserve an incomplete managed runtime into `runtime/mariadb/versions/recovery/` and attempt a fresh setup from the bundled ZIP. This is a move to recovery, not a deletion; the old folder is not used automatically. If the port associated with that partial runtime is still occupied, repair stops and leaves the existing folder in place. Never manually delete `data`, `backups`, or `recovery` while diagnosing a failure.

If setup cannot finish, the app remains open and reports the error instead of falsely reporting READY. Inspect `runtime/mariadb/versions/mariadb-13.0.2-winx64/logs/mariadbd.log` and the app's Database status panel. Native Windows execution still needs validation on the target PC. If Windows policy still blocks the initializer even outside the AppData payload, check Windows Security > Protection history and AppLocker/WDAC logs; SXL does not disable security controls.

## Build the Windows installer / portable executable

Requirements: Windows x64, Node.js 22.12 or newer, and internet access for npm build dependencies. MariaDB itself is already bundled; the build does not need to download MariaDB again.

Run `Build-SXL-Localhost-Windows.bat`. Output appears in `dist/` as the NSIS installer and portable EXE according to `package.json`.

The NSIS installer is scoped to the current Windows user, does not request Administrator elevation, and offers the normal folder-selection wizard. It creates Start Menu and Desktop shortcuts, launches SXL after installation, and preserves the user's database/runtime data if the app is later uninstalled. The optional Windows sign-in launch setting can be changed under **Web & Runtime → Layanan → Startup Windows**; uninstall removes its Windows startup entry. MariaDB's first-run setup is performed by SXL in the user profile; it does not require a separate installer or elevation.

This file is a source/release package, not a compiled signed Windows EXE. The produced Windows app has to be built and smoke-tested on Windows; this distribution does not claim a native Windows build was run here.


## Mode portable (tanpa memasang Node.js manual)

Untuk mode browser portable di Windows x64, ekstrak seluruh ZIP lalu jalankan `Start-SXL-Website-Sharing.bat`. Launcher akan menyiapkan Node.js portable bila belum ada, menggunakan ZIP MariaDB 13.0.2 yang dibundel, menjalankan smoke test serta `SELECT VERSION()`, lalu membuka panel lokal. Koneksi internet diperlukan saat pertama kali jika Node.js portable belum tersedia. Cloudflared baru diunduh dan diverifikasi saat fitur website sharing diaktifkan; instalasi MariaDB tidak mengunduh paket database dari internet.

Jika bootstrap MariaDB gagal, launcher berhenti dan menampilkan pesan/log, alih-alih meneruskan ke UI seolah database sudah siap. Runtime dan data lama tidak dihapus otomatis. Bila sudah ada pilihan database versi lama, SXL mempertahankannya dan tidak menggantinya secara diam-diam.

---

# MariaDB 13.0.2 pada SINZ v0.14.10

MariaDB 13.0.2 untuk Windows x64 disertakan di `runtime/packages/mariadb-13.0.2-winx64.zip`. Pada profil desktop baru, SXL otomatis memvalidasi arsip, memasang runtime, membuat data SXL baru yang terisolasi, melakukan startup test terautentikasi, menjalankan `SELECT VERSION()`, memilih versi tersebut, lalu memulai layanan sebelum panel utama dibuka. Unduhan MariaDB terpisah tidak diperlukan.

Port default pertama adalah `3308`, atau port bebas berikutnya jika 3308 digunakan. Server mengikat hanya ke `127.0.0.1`.

Jika runtime 13.0.2 sebelumnya parsial, SXL memindahkan folder lama ke `runtime/mariadb/versions/recovery/` dan membangun ulang dari arsip yang dibundel. Folder lama tidak dihapus dan tidak dipakai otomatis. Jika port terkait masih digunakan, pemulihan dibatalkan. Jangan menghapus `data`, `backups`, atau `recovery` manual.

Jika startup test gagal, runtime tidak ditandai READY. Periksa pesan pada panel Database dan `runtime/mariadb/versions/mariadb-13.0.2-winx64/logs/mariadbd.log`. Jika file log tidak terbentuk, gunakan pesan startup yang disampaikan SXL karena server bisa gagal sebelum membuka log.

Untuk source/development: Node.js 22.12+ dibutuhkan. Pada Windows x64, jalankan `Build-SXL-Localhost-Windows.bat` untuk membangun installer EXE dan paket portable. Paket ini belum menyertakan EXE Windows hasil build atau signature code; hasil native perlu diuji di Windows.

---

# Panduan integrasi Multi-Database dan Cloudflare — SXL v0.14.3

## PostgreSQL
1. Pasang PostgreSQL versi 14 atau lebih baru dari sumber resmi dan pilih direktori `bin` yang memuat `postgres`, `initdb`, `pg_ctl`, `psql`, dan `pg_dump`.
2. Buka Database Studio → PostgreSQL → masukkan folder `bin` → **Simpan Runtime**.
3. Pastikan status versi benar, lalu pilih **Inisialisasi Cluster Baru**. SXL menolak folder data nonkosong yang tidak dikelola, dan cluster baru hanya dibuat di direktori data SXL.
4. Jalankan PostgreSQL. Default bind adalah `127.0.0.1:5433`; jika port konflik, pilih port kosong alih-alih menghentikan proses lain.
5. Gunakan query SQL, daftar/buat database, lihat log, dan backup. Kredensial ditampilkan hanya atas permintaan.
6. Jangan gunakan akun admin `sxl_admin` sebagai akun proyek publik. Buat role aplikasi terbatas secara manual untuk sementara. Restore dari backup belum tersedia melalui UI pada versi ini.

## SQLite
1. Pasang atau siapkan binary `sqlite3` tepercaya.
2. Pada Database Studio → SQLite, masukkan path penuh ke `sqlite3.exe` pada Windows atau `sqlite3` pada platform yang sesuai.
3. SXL menjalankan `--version` dan menolak executable dengan nama/output versi yang tidak diharapkan.
4. Buat file database dengan nama baru, jalankan SQL, dan gunakan **Backup SQLite**. File berada di direktori data SXL, terpisah dari source proyek.
5. UI restore SQLite belum tersedia. Salin backup hanya ke lokasi aman; jangan mengganti file database saat layanan/aplikasi sedang menggunakannya.

## Cloudflare Quick Tunnel
1. Pilih folder/proyek yang akan dibagikan dan pastikan preview berjalan lokal lebih dahulu.
2. Untuk Windows x64 dan macOS x64/arm64, SXL akan memasang `cloudflared` bila tidak tersedia; unduhan diverifikasi dengan SHA-256. Pada Linux, pilih binary `cloudflared` resmi melalui path manual.
3. Masukkan kata sandi sharing dan/atau daftar email yang diizinkan. Satu email per baris; wildcard `*@domain.com` diperbolehkan hingga 20 entri. Cloudflare dapat meminta OTP email ke tiap pengunjung yang diizinkan.
4. Memulai Quick Tunnel mempublikasikan preview ke internet. Tanpa password atau allow-list email, siapa pun yang memiliki URL dapat mengaksesnya.
5. URL Quick Tunnel bersifat sementara dan biasanya berubah saat sesi baru dimulai. Gunakan hanya untuk pengembangan/demo, bukan hosting produksi. Cloudflare mendokumentasikan batas 200 request in-flight dan tidak mendukung Server-Sent Events (SSE) pada Quick Tunnels.
6. Jangan pernah membagikan admin SXL, direktori source, `.env`, backup, kredensial, atau port database. Target tunnel dibatasi pada `127.0.0.1` dan port preview yang dibuat SXL.

## Platform
- cloudflared auto-download di source dipatok untuk Windows x64 dan macOS Intel/Apple Silicon.
- Linux perlu path binary manual.
- Digest macOS diambil dari metadata tiap aset resmi GitHub. Karena hash di catatan release GitHub berbeda dari metadata aset untuk dua arsip macOS, penginstal memercayai digest per-aset yang dipublikasikan dan menolak jika unduhan tidak cocok. Arsip macOS tidak dihitung ulang secara lokal selama pengemasan ini.

## Login root phpMyAdmin

Saat phpMyAdmin pertama kali dijalankan untuk database aktif, SXL mengosongkan password akun root MariaDB yang dipakai koneksi lokal. Login phpMyAdmin dapat memakai username `root` dengan kolom password kosong. Pengaturan disimpan sebagai `no-password-v1`; password kosong tidak dikirim ke DPAPI karena memang tidak ada secret untuk dienkripsi.

Perubahan ini mengganti password root yang lama dan dapat memutus aplikasi/proyek yang menyimpan password root sebelumnya. Perbarui koneksi tersebut dan gunakan akun database khusus aplikasi, bukan root. MariaDB mendengarkan hanya pada `127.0.0.1`, demikian pula layanan phpMyAdmin; jangan mengekspos port database atau server phpMyAdmin ke jaringan publik. Login tanpa password mengurangi keamanan terhadap proses lokal lain.