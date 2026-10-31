# Spesifikasi — SXL Localhost Desktop Website Sharing + Database

Versi implementasi: 0.14.8

## Tujuan
Menjalankan aplikasi desktop Windows/macOS tanpa Laragon, membagikan website statis dan runtime PHP/Node.js melalui Cloudflare Quick Tunnel agar dapat dibuka dari jaringan berbeda, serta menyediakan MariaDB, PostgreSQL, SQLite, dan editor SQL Bahasa Indonesia.

## Fitur aplikasi dan sharing
- Aplikasi desktop Electron dengan installer Windows NSIS/portable dan macOS DMG/PKG/ZIP.
- Panel admin localhost pada `127.0.0.1` (port dinamis untuk aplikasi desktop; port 4177 pada launcher ZIP).
- Launcher mode ZIP Windows: `Start-SXL-Website-Sharing.bat`; mode pengembangan macOS: `Start-SXL-Website-Sharing.command`.
- Aplikasi desktop memakai runtime Node.js dari Electron dan menyimpan runtime/data di direktori data pengguna.
- `cloudflared` diunduh sesuai OS/arsitektur dan SHA-256 diverifikasi terhadap release Cloudflare yang dipatok.
- Folder picker native Windows/macOS serta input path manual.
- Preview HTTP statis loopback, MIME type untuk aset umum, GET/HEAD, fallback SPA, dan port alternatif.
- Cloudflare Quick Tunnel URL HTTPS sementara, tombol start/stop, timeout, log error, dan pembersihan proses.

## Antarmuka dan aplikasi terpisah (v0.14.8)
- Navigasi menggunakan struktur ruang kerja modern-industrial dengan dashboard ringkas, kartu status konsisten, dan layout responsif.
- Pintasan Terminal membuka aplikasi shell sistem di folder workspace atau folder proyek; terminal tidak dijalankan sebagai panel tertanam di SXL.
- Pintasan phpMyAdmin menjalankan server web lokalnya bila dibutuhkan, lalu membuka halaman di browser default. Bila belum terpasang, pemasangan baru berjalan setelah persetujuan pengguna.
- phpMyAdmin dan panel admin SXL terpisah secara proses dan tampilan; service tetap mengikat loopback `127.0.0.1`.

## Database Manager
- Windows: MariaDB Server 11.4 LTS portable diunduh dari arsip resmi ketika pengguna menekan tombol Pasang MariaDB.
- macOS: MariaDB dipasang dari formula Homebrew; data milik SXL diinisialisasi di folder data pengguna terpisah, tidak menggunakan data direktori service Homebrew.
- Binary Cloudflare Tunnel diverifikasi memakai SHA-256 yang dipatok dari rilis resmi sebelum digunakan.
- Server database di-bind hanya ke `127.0.0.1`; port default 3307 dan bukan bagian dari Cloudflare Tunnel.
- Dashboard mendukung pasang, start, stop, melihat kredensial admin, membuat akun aplikasi non-root dengan hak akses terbatas pada satu database, memilih database aktif, menjalankan satu SQL statement setiap kali, dan menampilkan hasil query.
- Password root dibuat acak saat instalasi dan disimpan di `runtime/mariadb/settings.json`. Data database berada di `runtime/mariadb/data`. Backup mencakup database pengguna saja; schema sistem MariaDB dikecualikan dan restore backup lama yang menyertakan schema sistem ditolak.
- Mode Bahasa Indonesia menerjemahkan kata kunci SQL di SXL; parser MariaDB asli tidak diubah.
- Query dapat menggunakan SQL standar MariaDB atau kata kunci Indonesia. Literals, komentar, dan identifier ber-backtick tidak diterjemahkan.

## Pengamanan
- Panel admin dan API hanya bind ke loopback; Origin diperiksa untuk permintaan browser yang menyertakannya.
- Tunnel tidak diarahkan ke panel admin atau port database.
- Preview hanya menerima GET/HEAD.
- Dotfiles, metadata developer, dependensi server, file backend, dump/backup/key, tipe file tak dikenal, traversal, stream/colon path, dan symlink keluar root diblokir.
- Root yang tampak seperti folder source proyek ditolak jika mengandung metadata sensitif umum.
- Database hanya di-bind ke `127.0.0.1`; password tidak dipublikasikan ke URL sharing.

## Batasan
- Modul sharing mendukung website statis, PHP sederhana, Laravel melalui `artisan serve`, serta proyek Node.js yang memiliki skrip `start`. Ini bukan pengganti penuh Apache/Nginx atau orkestrator runtime: beberapa aplikasi membutuhkan konfigurasi tambahan, ekstensi, database, layanan latar, atau reverse proxy khusus.
- MariaDB tersedia untuk penggunaan lokal dan integrasi backend lokal, tetapi backend dinamis harus dijalankan menggunakan runtime web server yang sesuai.
- Quick Tunnel membutuhkan koneksi internet; URL bersifat sementara. Akses publik harus dikonfirmasi dan dapat dilindungi dengan password SXL dan/atau allow-list email Cloudflare. Tunnel bukan untuk produksi, dibatasi 200 permintaan in-flight, dan tidak mendukung SSE.
- Runtime Node.js, PHP Windows, Cloudflare Tunnel, dan MariaDB Windows diunduh dari sumber resmi sesuai kebutuhan serta diverifikasi dengan SHA-256 jika checksum tersedia. Pemasangan pertama memerlukan koneksi internet dan ruang disk tambahan. macOS tetap memerlukan Homebrew untuk MariaDB dan PHP sistem/Homebrew untuk mode PHP.
- Installer Windows menargetkan Windows 10/11 64-bit. Workflow macOS membuat paket universal; paket tetap harus diuji di macOS Intel dan Apple Silicon.
- Paket sumber tidak menyertakan installer native yang sudah dikompilasi. Installer dibangun oleh workflow Windows/macOS. Paket yang dihasilkan oleh konfigurasi saat ini belum ditandatangani/notarized; untuk distribusi publik siapkan Developer ID dan notarization.

## Pengujian
Jalankan `node --test` dari folder proyek dengan Node.js 22.12+. Test suite mencakup penerjemah SQL, pemindai statement, backup/restore (termasuk penolakan schema sistem), URL policy Electron, CSRF/Host/Content-Type API, server panel/port dinamis, aset statis, SPA fallback, blokir file sensitif, traversal, symlink, lifecycle sharing dengan tunnel simulasi, runtime PHP, dan penolakan source-root. Pemasangan MariaDB, eksekusi binary, installer, dan Quick Tunnel nyata tetap perlu diuji pada OS target dengan internet aktif.

## Sumber runtime resmi
- Node.js: https://nodejs.org/dist/
- Cloudflare Tunnel: https://github.com/cloudflare/cloudflared/releases
- MariaDB Server 11.4.13: https://archive.mariadb.org/mariadb-11.4.13/winx64-packages/
- Panduan ZIP Windows MariaDB: https://mariadb.com/docs/server/server-management/install-and-upgrade-mariadb/installing-mariadb/binary-packages/installing-mariadb-windows-zip-packages
- Panduan MariaDB macOS: https://mariadb.com/docs/server/server-management/install-and-upgrade-mariadb/installing-mariadb/binary-packages/installing-mariadb-on-macos-using-homebrew
- Electron Builder macOS: https://www.electron.build/v26/docs/mac/


## Perbaikan v0.6.0

- Pemeriksaan origin URL Electron berbasis URL parser, bukan awalan string.
- CSRF token per proses dan validasi Host/Origin/Content-Type untuk permintaan API yang mengubah state.
- Runtime sharing statis, PHP/Laravel, dan Node.js dengan batas waktu startup serta pembersihan proses.
- Backup SQL dan pemulihan database yang membuat backup keselamatan lebih dulu.
- Paket runtime Node.js dan PHP Windows diverifikasi dengan SHA-256 sumber resmi.
- Akun non-root proyek dibuat dengan hak database terbatas, password acak, dan tanpa menimpa akun yang sudah ada.
- Backup semua database pengguna mengecualikan schema sistem MariaDB; restore dump lama yang berisi schema sistem ditolak.
- Pemeriksaan keamanan runtime PHP diperluas untuk menolak file konfigurasi database yang umum.
- Workflow CI membangun installer Windows/macOS dan membuat Release Assets saat tag versi dibuat.


## Tambahan v0.8.0 — Local Development Stack

- Tombol Start All/Stop All untuk layanan yang sudah terpasang (MariaDB, Apache, phpMyAdmin). Layanan yang belum dipasang tidak diunduh otomatis oleh tombol Start All.
- Runtime PHP 8.3 dapat dipasang melalui dashboard (Windows portable dan macOS lewat Homebrew) untuk kompatibilitas dengan phpMyAdmin 5.2.3.
- Composer PHAR diunduh dari getcomposer.org dan diverifikasi SHA-256 menggunakan checksum yang disediakan pada endpoint resmi.
- Composer install dapat dijalankan untuk proyek yang memiliki composer.json dengan konfirmasi sebelum menjalankan skrip proyek.
- Daftar proyek menampilkan keberadaan composer.json serta memiliki tombol membuka folder lokal.
- phpMyAdmin 5.2.3 tetap berjalan pada server PHP loopback terpisah; port admin/database tidak diteruskan ke Cloudflare Tunnel.
- Proyek PHP/Laravel dari Project Manager menggunakan PHP-CGI FastCGI melalui Apache `mod_proxy_fcgi`; Laravel memakai folder `public` dan `.htaccess` untuk routing. FastCGI hanya bind ke loopback.


## Tambahan v0.9.0 — Stack web lokal seperti Laragon

- Tombol Start All/Stop All menjalankan/menghentikan MariaDB, Apache, dan phpMyAdmin yang tersedia. Instalasi tetap manual dan eksplisit lewat tombol masing-masing.
- Pemasangan/penyiapan PHP 8.3 untuk Windows x64 (portable dengan checksum) dan macOS (Homebrew). Versi ini dipilih agar kompatibel dengan phpMyAdmin 5.2.3 yang mendukung PHP mulai 7.2 tetapi di bawah 8.4.
- Pengelola Composer diunduh dari sumber resmi dan dicek dengan SHA-256. Composer install dapat dijalankan untuk project yang memiliki `composer.json`, dengan konfirmasi skrip project.
- Workspace memiliki tombol buka folder `www`; project HTML, PHP/Laravel, dan Node.js yang sudah ada dideteksi berdasarkan struktur file saat daftar disegarkan.
- phpMyAdmin dipasang dari distribusi resmi, dicek SHA-256, memakai konfigurasi cookie authentication dan bind loopback.
- Batasan: PHP-CGI harus tersedia di paket runtime PHP; Apache wajib memiliki `mod_proxy`, `mod_proxy_fcgi`, dan `mod_rewrite`. Integrasi FastCGI harus diuji pada binary nyata Windows/macOS.
- Pengujian pada rilis v0.9.0: `node --test` meluluskan 25 tes otomatis saat itu. Binary Apache, PHP, MariaDB, Composer, phpMyAdmin, tunnel dan installer native tetap harus diuji pada Windows/macOS target dengan internet aktif.


## Tambahan v0.10.0 — Workflow gaya Laragon

- Terminal workspace dan terminal proyek dapat dibuka langsung ke folder yang dimaksud melalui PowerShell pada Windows dan Terminal pada macOS.
- Proyek existing yang diletakkan di workspace dapat dikenali dari struktur file; project manager tidak mengubah folder existing hanya untuk mendaftarkannya.
- Form pembuatan database tersedia pada dashboard bersama phpMyAdmin dan SQL editor.
- Versi paket aplikasi diperbarui menjadi 0.10.0.
- Terminal dapat dibuka langsung pada workspace atau folder proyek melalui menu Project Manager.
- Batasan yang disengaja: Apache virtual host mengelola proyek statis, sementara PHP/Laravel berjalan dengan server lokal proyek. Nginx manager, mail catcher, pergantian multi-versi PHP/MySQL, dan integrasi Apache FastCGI belum disediakan.
- Pengujian yang dapat dijalankan di lingkungan source pada paket ini: `node --test` (27 tes setelah pembaruan) dan pemeriksaan sintaks Node.js. Binary native dan installer harus tetap diuji pada Windows/macOS target.


## Tambahan v0.11.0 — Apache + PHP-CGI FastCGI

- Proyek PHP aktif mendapat virtual host `http://<slug>.localhost:<port-apache>`.
- PHP-CGI dijalankan pada port ephemeral di `127.0.0.1`; port FastCGI tidak dipublikasikan.
- Apache mengaktifkan modul proxy/FastCGI/rewrite yang diperlukan di konfigurasi SXL, tanpa mengubah konfigurasi Apache global.
- Saat proyek PHP dihentikan, worker PHP-CGI dihentikan dan Apache dimulai ulang dengan konfigurasi vhost yang diperbarui. Jika pengguna menghentikan Apache, worker PHP project ikut dihentikan.
- Tes otomatis menguji pembentukan konfigurasi FastCGI, pemilihan document root Laravel, urutan modul Apache, serta pencarian binary PHP-CGI. Apache/PHP-CGI native tetap perlu smoke-test pada Windows/macOS.


## Perbaikan v0.12.0 — stabilitas FastCGI

- Handler PHP hanya menetapkan `SetHandler` dan tidak mengesampingkan blokir nama file sensitif menggunakan aturan izin yang terlalu luas.
- Virtual host tetap tercantum pada konfigurasi Apache ketika worker PHP-CGI sedang direstart.
- Rollback startup proyek menandai worker sebagai berhenti sebelum mematikan proses agar supervisor tidak menghidupkannya kembali.
- Output log Apache tidak dicatat dua kali.

## Antarmuka pengguna v0.13.0
- Halaman utama dipisah menjadi Dashboard, Project Manager, Web & Runtime, Database Studio, Website Sharing, dan Panduan.
- Navigasi utama menggunakan sidebar yang tetap terlihat di desktop, top bar dengan judul dan konteks halaman, serta sidebar drawer pada layar kecil.
- Dashboard menampilkan status live sharing, MariaDB, Apache, jumlah proyek, dan akses cepat ke fitur utama.
- Navigasi dipertahankan melalui hash URL dan shortcut Ctrl/Cmd+1 sampai Ctrl/Cmd+6.
- CSS UI dipisahkan ke `public/styles.css`; server admin menyediakan route khusus dengan MIME type `text/css`.
- Semua ID kontrol yang dipakai `public/app.js` dipertahankan dan diuji untuk mencegah regressi fitur.


## Hardening v0.13.0

- Host unduhan harus menggunakan HTTPS dan host yang cocok persis dengan allowlist komponen; pengalihan diperiksa ulang.
- Arsip Apache Windows dicocokkan dengan versi/URL serta SHA-256 dari manifest paket eksternal sebelum ekstraksi. Kegagalan memperoleh atau memvalidasi manifest menolak instalasi.
- Workspace default Apache ditolak, unknown virtual host tidak melayani source, static vhost mematikan `.htaccess` dan symlink, dan PHP vhost membatasi kategori override sambil menjaga kompatibilitas rewrite Laravel.
- Sharing PHP memakai document root publik jika tersedia dan menolak sebagian pola root proyek yang berisiko mengandung rahasia. Pemeriksaan tetap berbasis pola sehingga pengguna harus meninjau konten yang akan diterbitkan.
- UI memiliki dialog konfirmasi aplikasi, fokus keyboard yang jelas, ukuran teks lebih terbaca, dan dukungan reduced-motion.
- Hasil pemeriksaan source pada lingkungan ini: `npm test` 36/36 lulus dan pemeriksaan sintaks JavaScript lulus. Pengujian service native serta installer Windows/macOS belum dilakukan.
- Lockfile belum dapat dibuat di lingkungan pengemasan karena npm registry tidak dapat dijangkau. Workflow membuat satu lockfile dalam job persiapan dan menggunakannya untuk kedua job build pada run yang sama; commit `package-lock.json` tetap disarankan untuk release reproducible lintas waktu.


## Patch v0.13.1 — Windows test compatibility

- Tes Apache memvalidasi absolute module path dengan normalisasi separator ke format yang dipakai konfigurasi Apache.
- Penemuan PHP-CGI tidak lagi memakai fallback generik dari PATH yang berpotensi mencampur versi CLI dan CGI; file CGI sibling atau konfigurasi eksplisit `SXL_PHP_CGI_PATH` harus digunakan.
- Paket aplikasi dan UI ditingkatkan ke v0.13.1.


## Patch v0.13.2 — runtime fallback dan metadata diagnosis

- Sebelum mengunduh runtime Node.js, SXL mencari Node.js sistem beserta `npm-cli.js`, lalu memverifikasi versi dengan menjalankan `node --version`.
- Hanya Node.js 22.12+ yang diterima sebagai runtime proyek.
- Jika sumber metadata gagal dicapai, error menyertakan detail sebab yang tersedia pada `error.cause` dan panduan proxy/firewall.
- Status UI membedakan Node.js portable SXL dari Node.js sistem.
- Tes regresi mencakup penggunaan runtime sistem tanpa fetch metadata, versi minimum, serta error jaringan yang informatif.


## Patch v0.13.4 — pemulihan metadata runtime dan proxy

- Deteksi Node.js sistem menggunakan `npm_node_execpath`/`npm_execpath` yang diwariskan oleh npm, PATH, serta lokasi instalasi umum pada sistem operasi.
- Unduhan metadata dan runtime menggunakan `undici.ProxyAgent` bila variabel proxy disetel, menghormati `NO_PROXY`, dan tidak mencetak kredensial proxy ke pesan error. Dependency Undici dipatok ke 7.30.1 (mendukung Node.js 20.18.1+).
- `fetchText()` menerima tujuan metadata agar kegagalan checksum PHP menyebut `windows.php.net`, bukan metadata Node.js.
- Diagnosis error menyertakan hostname dan penyebab yang tersedia tanpa menghapus detail `cause`; koneksi tetap menggunakan HTTPS dan verifikasi checksum tetap diwajibkan.
- Tambahan tes regresi untuk penggunaan Node/npm lokal, konfigurasi proxy, dan error metadata yang spesifik.


## Runtime manual (v0.13.6)

SXL menyimpan pilihan path runtime di `config/runtime-paths.json` pada data directory pengguna. Path yang didukung: Apache `httpd`, PHP CLI, PHP-CGI, Composer `composer.phar`, Node.js, `npm-cli.js`, binary `cloudflared`, folder phpMyAdmin, dan folder bin MariaDB. Endpoint administrasi lokal `GET/POST /api/runtime/paths` memvalidasi file/folder yang dipilih dan hanya menerima field yang diizinkan. Menghapus konfigurasi path tidak menghapus binary ataupun data database.


## Patch v0.13.6 — pengaturan runtime manual

- Pengguna dapat memasukkan path absolut untuk Apache, PHP CLI, PHP-CGI, Composer PHAR, Node.js, npm CLI, `cloudflared`, folder phpMyAdmin, dan folder `bin` MariaDB/MySQL-compatible.
- Validasi memeriksa bentuk path, keberadaan file/folder, dan nama executable/marker sesuai komponen. `php.exe` dan `php-cgi.exe` tetap harus berasal dari versi yang kompatibel.
- Jika runtime manual tersedia, layanan terkait memprioritaskannya sehingga SXL tidak perlu mengambil metadata atau binary untuk komponen tersebut.
- Path disimpan di `config/runtime-paths.json` di direktori data pengguna. Menghapus path manual tidak menghapus program, proyek, atau database.
- Pemilihan folder bin MariaDB pada Windows menyalin komponen runtime yang diperlukan ke penyimpanan privat SXL dan menginisialisasi data directory baru. Database lama tidak diimpor otomatis.
- SXL tidak menonaktifkan validasi checksum untuk installer otomatis. Binary yang dipilih manual harus berasal dari sumber tepercaya dan ditinjau oleh pengguna.

## Pengelola versi PHP berbasis folder (v0.13.6)

- Koleksi default: `runtime/php-versions` di direktori data aplikasi.
- Scanner mendukung distribusi PHP di root koleksi, subfolder, dan struktur Laragon bertingkat sampai tiga tingkat.
- UI menampilkan label folder, versi aktual, lokasi `php.exe`/`php-cgi`, keberadaan `php.ini`, template INI, dan folder ekstensi.
- Versi aktif divalidasi dengan menjalankan `php -r` dan `php-cgi -v`; versi CLI dan CGI harus sama sebelum bisa dipilih untuk FastCGI.
- Pemilihan menyimpan `phpBinary` serta `phpCgiBinary` dalam konfigurasi runtime SXL. PHP CLI dan Composer memakai versi aktif. phpMyAdmin tetap mencari versi yang kompatibel.
- Di Windows, jika versi koleksi tidak memiliki `php.ini`, SXL membuat konfigurasi awal dari template tanpa menimpa konfigurasi yang sudah ada; ekstensi diaktifkan hanya jika DLL terkait tersedia.
- API: `GET /api/runtime/php-versions`, `POST /api/runtime/php-versions/select`, dan `POST /api/runtime/php-versions/open-folder`.


## Patch v0.14.0 — diagnostik dan konfigurasi proyek
- Pengaturan PHP per proyek disimpan terpisah dari pilihan runtime global.
- PHP-CGI harus cocok versi dengan PHP CLI untuk menjalankan proyek melalui Apache/FastCGI.
- Endpoint `/api/diagnostics` merangkum pemeriksaan runtime, ekstensi PHP, konfigurasi Apache, konektivitas database, Composer dan phpMyAdmin.
- Sharing dapat diberi kata sandi opsional melalui autentikasi HTTP Basic pada preview statis dan proxy runtime. Kredensial tidak diteruskan ke aplikasi backend.
- Tes mencakup akses ditolak/diizinkan, kredensial tidak diteruskan, penyimpanan konfigurasi PHP per proyek, endpoint diagnostik, dan kontrol penjelajah tabel.


## Batasan yang masih terbuka pada v0.14.0
- Nginx belum mempunyai service manager dan template virtual host khusus SXL.
- SSL lokal trusted belum dikelola otomatis; sertifikat self-signed tidak boleh dianggap setara dengan HTTPS publik.
- Mailpit belum disediakan sebagai layanan terkelola.
- Paket sumber ini tidak menyertakan `package-lock.json` karena registry npm tidak merespons saat pengemasan. Workflow build membuat satu lockfile untuk kedua runner OS, tetapi lockfile tetap harus dikomit sebelum rilis publik reproducible.


## Patch v0.14.1 — runtime MariaDB 13.0.2

- Memperluas Studio Database yang sudah ada dengan daftar versi, pemilihan runtime, port, dan impor arsip MariaDB 13.0.2 Windows x64.
- Versi tambahan mempunyai direktori binary, konfigurasi, data, log, sementara, dan backup terpisah. Pemilihan versi tidak memindahkan database atau mengubah konfigurasi PHP/proyek.
- Arsip diterima hanya jika nama, ukuran, SHA-256, dan struktur runtime sesuai manifest. Server dibatasi pada `127.0.0.1`; konflik port menghasilkan pesan dan tidak menghentikan proses lain.
- Installer legacy diperketat agar menolak overwrite folder binary yang sudah ada dan data lama yang tidak terinisialisasi.
- Keterbatasan: startup, shutdown, init, konfigurasi option-file, phpMyAdmin, serta backup/restore menggunakan MariaDB 13.0.2 belum diuji pada Windows nyata di lingkungan build Linux.


## Hardening v0.14.2 — kredensial, ACL, dan pemulihan

- Windows: `settings.json` memakai DPAPI untuk password; migrasi konfigurasi plaintext bersifat best-effort dan mempertahankan berkas asli saat gagal.
- Windows: ACL privat diterapkan pada folder database yang dikelola, dan versi MariaDB tidak diklaim terverifikasi bila versi executable belum berhasil dibaca.
- MariaDB 13.0.2: pemasangan parsial dapat dipulihkan dengan memindahkan instance lama ke karantina; tidak ada penghapusan rekursif atas folder instance lama.
- Tes unit baru mencakup pemulihan tanpa overwrite, proteksi konfigurasi, dan deteksi metadata versi.
- Pengujian installer, native binary, backup/restore dan build tetap membutuhkan Windows x64.


## v0.14.3 — Multi-database dan Cloudflare hardening

- Menambahkan adapter PostgreSQL (binary pilihan pengguna, cluster baru terisolasi, start/stop normal, query, daftar/buat database, backup) dan SQLite CLI (buat database, query, backup). PostgreSQL restore dan SQLite restore UI belum disediakan. MongoDB, Redis, dan MySQL asli belum menjadi engine manager.
- Quick Tunnel dipatok pada cloudflared 2026.10.4 untuk Windows x64 dan macOS x64/arm64 dengan SHA-256 resmi; binary managed tak terverifikasi tidak dijalankan, dan setup standalone ZIP juga menggunakan auto-install yang sama.
- Menambahkan allow-list email Cloudflare (`--allowed-mail`, OTP) dan konfirmasi sebelum tunnel publik tanpa autentikasi. Mengisolasi HOME/USERPROFILE/XDG_CONFIG_HOME/APPDATA/LOCALAPPDATA per sesi agar konfigurasi tunnel pribadi tidak terpakai.
- Mencegah dua proses setup sharing beradu; status mencerminkan persiapan dan Stop memberi peringatan saat setup belum selesai.
- Pengujian source: lihat `RIWAYAT-AUDIT.md`; server Windows, binary PostgreSQL/SQLite native, dan build Electron perlu diuji pada OS target.


## v0.14.4 — pemulihan MariaDB dan penyederhanaan UI

- Memisahkan status runtime MariaDB `ready`, `unverified`, `partial`, dan `not-installed`; folder pengelola versi tidak lagi dianggap bukti adanya instalasi legacy parsial.
- Pemulihan MariaDB parsial memindahkan file/folder legacy ke `runtime/mariadb/versions/recovery/` tanpa menghapusnya, memeriksa port sebelum perpindahan, dan mencoba mengembalikan komponen lama bila pemasangan pengganti gagal.
- Menambahkan endpoint untuk memeriksa ulang versi executable tanpa mengubah data. Database yang belum siap atau versinya belum terverifikasi tidak dapat dijalankan.
- Memisahkan menu Database menjadi MariaDB dan PostgreSQL/SQLite; membagi fungsi MariaDB menjadi Runtime & Status, Database & Backup, serta SQL. Web & Runtime dibagi menjadi Layanan, Diagnostik, dan Path Manual.
- Pengujian otomatis: 94/94 tes lulus pada lingkungan Linux. Recovery Windows x64, binary MariaDB native, dan alur ACL tetap membutuhkan smoke test Windows nyata.


## v0.14.6 — pemulihan installer MariaDB
- Ukuran dan SHA-256 arsip MariaDB 11.4.13 dipatok; unduhan menggunakan fallback beberapa cermin HTTPS yang ditentukan.
- Salinan payload runtime dibuat eksplisit dan diperiksa untuk server, installer, client, admin, serta dump.
- Log instalasi permanen dan disanitasi disimpan pada `runtime/mariadb/logs/mariadb-install.log`.
- Kesalahan pemasangan menyertakan lokasi log sehingga kegagalan tidak lagi hanya terlihat sebagai status parsial tanpa jejak diagnostik.

## v0.14.5 — perbaikan pemulihan path runtime

- Status MariaDB parsial merinci executable yang tidak ditemukan.
- Jika konfigurasi path manual menunjuk ke runtime SXL yang sedang dikarantina, pemulihan mengizinkan instalasi bersih dan memeriksa ulang path sesudah karantina. Path eksternal yang rusak tetap ditolak agar tidak memakai runtime yang tidak lengkap.
- Tes lintas platform diperbaiki agar hasil Windows tidak dipengaruhi izin symlink, mode file POSIX, atau instalasi Node/npm lokal pengguna.
- Validasi paket di host Linux; pemulihan native, DPAPI/ACL, dan startup MariaDB tetap memerlukan tes Windows x64.

## v0.14.7 — pemulihan MariaDB dengan staging deterministik
- Salinan runtime tidak lagi bergantung pada perilaku penyalinan folder yang berbeda antar versi Windows PowerShell. File disalin ke path staging eksplisit, diperiksa, lalu dipindahkan ke direktori aktif.
- Arsip dapat dipakai ulang hanya jika nama, ukuran, dan SHA-256 cocok dengan metadata yang dipatok.
- Diagnostik menampilkan penyebab gagal terakhir dari log `runtime/mariadb/logs/mariadb-install.log`.
- Data lama tetap dipertahankan melalui mekanisme recovery yang sudah ada; data dari instance lama tidak diimpor otomatis.

- Skrip repair mandiri Windows tersedia lewat `Repair-SXL-MariaDB.bat`; skrip memeriksa port, meminta konfirmasi sebelum mengarantina runtime/data lama, dan menampilkan log jika pemasangan gagal.


---

# Panduan UI/UX v0.14.8

## Struktur navigasi
- **Dashboard**: status dan akses ke alur kerja utama.
- **Proyek**: pembuatan, pemilihan versi PHP per proyek, buka folder, start, dan Composer.
- **Web & Runtime**: layanan lokal, diagnostik, dan path manual.
- **Basis Data**: MariaDB/MySQL dan engine lain, dikelompokkan per kebutuhan.
- **Berbagi Website**: preview/tunnel dan pengaturan akses.
- **Panduan**: instruksi dasar.
- **Aplikasi Terpisah → Terminal**: membuka shell sistem pada folder WWW SXL, tidak menampilkan terminal tertanam.
- **Aplikasi Terpisah → phpMyAdmin**: memasang (dengan konfirmasi) atau menjalankan service phpMyAdmin lalu membuka webnya di browser default.

## Prinsip desain
- Warna dasar slate/teal, teks kontras, kartu seragam, dan aksen warna dibatasi untuk status/tindakan.
- Keterangan operasional dipersingkat dan dikumpulkan dalam tab sesuai jenis tugas.
- Notifikasi toast dipakai untuk hasil peluncuran aplikasi eksternal tanpa mengganggu halaman yang aktif.
- Pada layar kecil, sidebar menjadi panel geser dan kartu tersusun satu kolom.
- Database dan service tetap terikat ke loopback; aplikasi eksternal tidak mengubah kebijakan jaringan atau memublikasikan port database.