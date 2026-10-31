# Panduan Perbaikan dan Menjalankan TokoOnline

## 1. Buka folder proyek yang benar

Setelah ZIP diekstrak, struktur foldernya bertingkat. Buka terminal di folder yang berisi `composer.json`, `artisan`, dan `.env.example`. Contoh PowerShell:

```powershell
cd "$HOME\Downloads\TokoOnline-Laravel10-Lengkap\TokoOnline"
Get-ChildItem composer.json, artisan, .env.example
```

Jika perintah terakhir tidak menampilkan ketiga file tersebut, berarti terminal masih berada di folder yang salah.

## 2. Instal dependensi

Pastikan PHP dan Composer sudah terpasang dan dapat dipanggil dari terminal:

```powershell
php -v
composer --version
composer install
```

Jika Composer gagal, simpan seluruh pesan error. Jangan lanjut ke perintah Artisan sebelum `composer install` selesai berhasil karena folder `vendor` harus dibuat terlebih dahulu.

## 3. Siapkan konfigurasi

```powershell
Copy-Item .env.example .env
php artisan key:generate
```

Jika `.env` sudah ada, jangan menyalinnya lagi; edit file yang sudah ada.

## 4. Buat database

Buat database kosong bernama `db_tokoonline` lewat phpMyAdmin atau klien MariaDB/MySQL. Sesuaikan variabel berikut di `.env` dengan instalasi lokal:

```dotenv
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=db_tokoonline
DB_USERNAME=root
DB_PASSWORD=
```

Port `3306` hanya contoh. Gunakan port yang benar-benar dipakai oleh server database kamu.

## 5. Buat tabel dan data contoh

```powershell
php artisan migrate --seed
php artisan storage:link
```

`migrate:fresh` akan menghapus tabel beserta data di database yang dipilih; gunakan hanya jika memang ingin mengulang database dari awal.

## 6. Jalankan aplikasi

```powershell
php artisan serve
```

Buka `http://127.0.0.1:8000`. Akun demo: `admin@gmail.com`, kata sandi `P@55word`. Ganti kata sandi demo sebelum aplikasi dipakai di luar praktikum.

## 7. Pemeriksaan jika masih error

- `composer.json not found`: terminal berada di folder induk; masuk ke subfolder `TokoOnline`.
- `vendor/autoload.php` not found: `composer install` belum berhasil.
- `could not find driver`: aktifkan ekstensi PHP `pdo_mysql` pada `php.ini` yang dipakai terminal, lalu buka ulang terminal.
- `Unknown database`: buat `db_tokoonline` atau samakan `DB_DATABASE` dengan nama database yang sudah dibuat.
- `Connection refused` / `Access denied`: periksa status MariaDB/MySQL, port, username, dan password di `.env`.
- `No application encryption key`: jalankan `php artisan key:generate`.
- Foto tidak tampil: jalankan `php artisan storage:link`, lalu periksa folder `storage/app/public`.
- Error HTTP 500: periksa `storage/logs/laravel.log`; untuk diagnosis lokal, pastikan `APP_DEBUG=true` di `.env`, tetapi jangan aktifkan debug pada server publik.

## Status pemeriksaan paket

Berkas PHP dalam paket diperiksa dengan `php -l` dan tidak ditemukan kesalahan sintaks. Lingkungan penyusunan tidak memiliki Composer, sehingga instalasi dependensi, koneksi database, dan pengujian browser end-to-end belum dapat diverifikasi di sini.
