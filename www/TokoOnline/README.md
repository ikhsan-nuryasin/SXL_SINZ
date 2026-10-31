# TokoOnline — Praktikum Web Programming II (Laravel 10)

Proyek pembelajaran yang mengikuti studi kasus Toko Online dalam *Modul Web Programming II* dan daftar file pada `SCRIPT MODUL WEB PROGRAMMING II.pdf`. Proyek ini menggabungkan konsep minggu 1–16 dengan fokus implementasi toko online pada pertemuan 5–12.

> **Catatan sumber:** beberapa bagian modul berupa gambar atau potongan kode yang harus digabungkan. Implementasi ini dibuat sebagai proyek utuh yang konsisten berdasarkan struktur, field, alur, dan fitur yang ditunjukkan modul; bukan salinan kata demi kata setiap baris. Halaman latihan yang hanya meminta desain tabel/form dijawab di bagian “Jawaban latihan”.

## 1. Fitur
- Login/logout manual menggunakan autentikasi Laravel; akun berstatus nonaktif ditolak.
- Dashboard admin dan ringkasan jumlah user, kategori, dan produk.
- CRUD User: nama, email, role, status, nomor HP, foto profil, password terenkripsi.
- CRUD Kategori dengan validasi nama unik.
- CRUD Produk dengan relasi ke kategori dan user pembuat, harga, stok, deskripsi, foto utama.
- Galeri foto tambahan per produk.
- Pencarian dan pagination daftar.
- Laporan User dan Produk berdasarkan rentang tanggal, ditampilkan dalam halaman siap cetak.
- Validasi form, pesan berhasil/gagal, CSRF, middleware `auth`, dan tampilan responsif Bootstrap.
- Seeder akun demo dan kategori contoh.

## 2. Persyaratan
- PHP 8.1+ dan ekstensi umum Laravel (OpenSSL, PDO, Mbstring, Tokenizer, XML, Ctype, JSON, BCMath, Fileinfo).
- Composer 2.
- MySQL/MariaDB.
- Laragon direkomendasikan untuk Windows, atau PHP/MySQL terpasang terpisah.

## 3. Instalasi (Windows/Laragon)
1. Ekstrak folder `TokoOnline` ke `C:\laragon\www\TokoOnline` (atau folder kerja pilihan).
2. Buka terminal di folder proyek.
3. Pasang dependensi:
   ```bash
   composer install
   ```
4. Buat file environment:
   ```bash
   copy .env.example .env
   ```
   Jika `.env` sudah dibuat Composer, cukup edit file tersebut.
5. Buat database kosong di phpMyAdmin, nama **db_tokoonline**.
6. Edit `.env`:
   ```dotenv
   APP_NAME=TokoOnline
   APP_ENV=local
   APP_DEBUG=true
   APP_URL=http://127.0.0.1:8000
   DB_CONNECTION=mysql
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_DATABASE=db_tokoonline
   DB_USERNAME=root
   DB_PASSWORD=
   ```
   Sesuaikan port/user/password dengan instalasi lokal.
7. Buat application key:
   ```bash
   php artisan key:generate
   ```
8. Jalankan migrasi dan data contoh:
   ```bash
   php artisan migrate --seed
   ```
   Untuk instalasi ulang dari database kosong saja, gunakan `php artisan migrate:fresh --seed`. **Perintah `migrate:fresh` menghapus seluruh tabel dan data di database yang dipilih.**
9. Buat tautan file publik:
   ```bash
   php artisan storage:link
   ```
10. Jalankan:
    ```bash
    php artisan serve
    ```
11. Buka `http://127.0.0.1:8000`.

### Akun demo
- Email: `admin@gmail.com`
- Password: `P@55word`

Seeder juga membuat akun admin biasa `sopianaji@admin.com` dengan password sama. Ganti password demo sebelum aplikasi dipakai di luar lingkungan belajar.

## 4. Folder penting
```text
app/Http/Controllers/       Logika login, dashboard, user, kategori, produk
app/Models/                 Model User, Kategori, Produk, FotoProduk
app/Helpers/ImageHelper.php Helper pemrosesan gambar sederhana
database/migrations/        Skema tabel user, kategori, produk, foto_produk
database/seeders/           Akun dan kategori awal
resources/views/backend/    Login, dashboard, layout, CRUD, laporan
routes/web.php              Daftar URL dan middleware
public/storage/             Berkas upload yang dipublikasikan melalui storage:link
```

## 5. Struktur basis data
- **user**: `id`, `nama`, `email`, `role`, `status`, `password`, `hp`, `foto`, timestamps. Role mengikuti modul: `0=Admin`, `1=SuperAdmin`, `2=Customer`; status `0=nonaktif`, `1=aktif`.
- **kategori**: `id`, `nama_kategori`.
- **produk**: `id`, `kategori_id`, `user_id`, `nama_produk`, `detail`, `harga`, `stok`, `foto`, timestamps.
- **foto_produk**: `id`, `produk_id`, `foto`, timestamps.

Relasi: satu kategori dapat mempunyai banyak produk; satu user dapat membuat banyak produk; satu produk dapat memiliki banyak foto tambahan. Foreign key mencegah relasi yatim.

## 6. URL aplikasi
| URL | Fungsi |
|---|---|
| `/backend/login` | Form login |
| `/backend/beranda` | Dashboard (wajib login) |
| `/backend/user` | Daftar dan CRUD user |
| `/backend/kategori` | Daftar dan CRUD kategori |
| `/backend/produk` | Daftar dan CRUD produk |
| `/backend/laporan/formuser` | Filter laporan user |
| `/backend/laporan/formproduk` | Filter laporan produk |

## 7. Penjelasan materi dan jawaban latihan

### Minggu 1 — Instalasi dan konfigurasi Laravel
**Laravel** adalah framework PHP. **Composer** memasang library/dependensi. **Artisan** adalah CLI Laravel. `composer create-project laravel/laravel:^10.0 TokoOnline` membuat proyek. `php artisan serve` menjalankan server pengembangan; `Ctrl+C` menghentikannya. `.env` menyimpan konfigurasi lokal seperti koneksi DB dan APP_KEY; jangan unggah rahasia ke repositori.

### Minggu 2 — Controller, function, route, view
- **Route** memetakan URL dan HTTP method ke fungsi/controller.
- **Controller** memproses request dan menentukan response.
- **View Blade** menampilkan HTML; `@extends`, `@section`, `@yield` dipakai untuk layout.
- Jawaban studi kasus `LatihanController`: buat `getTabel()` yang mengembalikan `view('latihan.tabel')` dan `getForm()` yang mengembalikan `view('latihan.form')`; daftarkan dua route GET yang memanggil fungsi tersebut. View tabel berisi `<table>` dengan header dan baris contoh; view form berisi label, input, dan tombol submit. Intinya controller tidak perlu menulis HTML panjang langsung dalam return string.

### Minggu 3 — Database, migration, model, seeder
- **Migration** adalah definisi skema database dalam kode yang dapat dilacak versinya.
- **Model Eloquent** merepresentasikan tabel dan menyediakan operasi data.
- **Seeder** memasukkan data awal berulang kali secara terkontrol.
- `php artisan migrate` menjalankan migration baru; `php artisan db:seed` menjalankan seeder; `php artisan migrate:fresh --seed` menghapus tabel, membangun ulang skema, lalu mengisi data contoh.
- Contoh tabel `anggota` pada modul: `id` primary key, `nama` varchar, `hp` varchar maksimal 13, timestamps. Nomor HP sebaiknya `string`, bukan integer, karena angka nol awal harus tetap tersimpan.

### Minggu 4 — CRUD
- **Create** menampilkan form dan menyimpan data (`create/store`).
- **Read** menampilkan daftar/detail (`index/show`).
- **Update** menampilkan form edit dan menyimpan perubahan (`edit/update`).
- **Delete** menghapus data (`destroy`).
- `Route::resource()` membuat rute CRUD standar. `@csrf` mencegah pemalsuan request; `@method('PUT')` dan `@method('DELETE')` mengirim method yang didukung form HTML; `$request->validate()` memvalidasi input; `@error` menampilkan pesan validasi.
- Jawaban latihan anggota: validasi `nama|required|max:255`, `hp|required|min:10|max:13`; gunakan `findOrFail()` saat mencari data supaya ID yang tidak ada menghasilkan 404; sesudah aksi sukses, redirect ke daftar dan tampilkan pesan.

### Minggu 5 — Authentication dan unit testing
Autentikasi memverifikasi identitas. Aplikasi menggunakan `Auth::attempt()`, regenerasi session setelah login, dan `Auth::logout()` saat keluar. Status user `0` ditolak walaupun email/password benar. Password disimpan sebagai hash, bukan teks asli. Middleware `auth` melindungi dashboard dan halaman manajemen. Pengujian minimum: kredensial valid, password salah, user nonaktif, akses halaman tanpa login, logout, serta validasi form.

### Minggu 6 — HTML, CSS, Bootstrap, JavaScript
HTML menyusun struktur halaman, CSS mengatur tampilan, Bootstrap menyediakan komponen responsif, JavaScript memberi interaksi di sisi browser. Layout aplikasi dipisah supaya menu, header, dan pesan status konsisten. Bootstrap pada proyek ini dimuat melalui CDN sehingga browser memerlukan internet untuk mengambil aset; logika server tetap lokal.

### Minggu 7 — DataTable dan form dengan template
Tabel data perlu judul kolom jelas, aksi yang mudah ditemukan, validasi, dan pesan kesalahan. Form create/edit menggunakan komponen tampilan yang konsisten. Pada proyek ini pencarian server-side sederhana dan pagination Laravel disediakan; DataTables bukan syarat agar CRUD bekerja. Validasi sisi server tetap wajib meskipun ada validasi JavaScript.

### Minggu 8 — Review dan mini project
Mini project menggabungkan CRUD, autentikasi, template, dan data master. Lakukan pengujian per fitur sebelum integrasi: login, tambah/edit/hapus user, kategori, produk, upload foto, relasi kategori-user, dan cetak laporan.

### Minggu 9 — Manajemen data master
Kategori merupakan data acuan untuk mengelompokkan produk. Nama kategori wajib dan unik agar tidak ada kategori ganda. Seeder memudahkan data awal dimasukkan tanpa menginput ulang melalui form.

### Minggu 10–11 — Join dan relasi tabel
Produk memiliki `kategori_id` dan `user_id`. Relasi Eloquent `belongsTo` mengambil kategori/pembuat untuk suatu produk; `hasMany` mengambil daftar produk dari kategori/user. Relasi menghindari pengulangan nama kategori dan data pembuat di setiap record produk. Galeri menggunakan `foto_produk.produk_id` untuk menghubungkan banyak foto dengan satu produk.

### Minggu 12 — Laporan data master
Form laporan menerima tanggal awal dan akhir, memvalidasi tanggal akhir tidak lebih awal dari tanggal awal, lalu memfilter `created_at`. Halaman hasil memakai CSS cetak dan `window.print()`, sehingga pengguna dapat mencetak atau menyimpan sebagai PDF dari dialog browser. Rentang tanggal disertakan pada hasil laporan.

### Minggu 13–16 — Integrasi, UI/UX, finalisasi, evaluasi
Integrasikan modul dan rute, samakan layout, cek relasi database, lakukan uji alur dari login sampai laporan, perbaiki validasi dan error, lalu siapkan demo/presentasi. Pastikan konfigurasi lingkungan dan akun demo dijelaskan, dan jangan menggunakan data contoh sebagai data produksi.

## 8. Checklist pengujian
- [ ] Login benar berhasil; password salah ditolak.
- [ ] User nonaktif tidak dapat login.
- [ ] User dapat ditambah, dicari, diedit, diubah statusnya, dan dihapus.
- [ ] Kategori dapat ditambah, diedit, dan dihapus jika tidak dipakai produk.
- [ ] Produk menyimpan kategori dan pembuat dengan benar.
- [ ] Foto utama dan galeri dapat diunggah/dihapus.
- [ ] Laporan user/produk memfilter rentang tanggal dan membuka dialog cetak.
- [ ] Akses URL backend tanpa login diarahkan ke login.
- [ ] `php artisan route:list` menampilkan rute yang diharapkan.

## 9. Pemecahan masalah
- **Composer gagal / Laravel 10 ditandai security advisory:** Laravel 10 sudah bukan cabang terbaru. Proyek ini tetap memakai Laravel 10 karena ketentuan modul. Composer dikonfigurasi agar audit advisory tidak memblokir instalasi; ini bukan berarti risiko keamanannya hilang. Gunakan hanya untuk belajar lokal, jangan deploy publik tanpa evaluasi dan upgrade.
- **`could not find driver`:** aktifkan `pdo_mysql` pada `php.ini` PHP yang dipakai terminal, lalu buka terminal baru.
- **Database connection refused:** pastikan MySQL/MariaDB berjalan dan `DB_PORT` sesuai, biasanya 3306 (bisa berbeda pada instalasi lokal).
- **Tabel tidak ditemukan:** cek `.env`, nama database, lalu jalankan `php artisan migrate --seed`.
- **Gambar tidak tampil:** jalankan `php artisan storage:link`, pastikan folder `storage/app/public` dapat ditulis.
- **Perubahan `.env` tidak terbaca:** jalankan `php artisan config:clear`.
- **Route/cache membingungkan:** jalankan `php artisan route:clear` dan `php artisan cache:clear`.

## 10. Batasan
Proyek ini adalah fondasi praktikum backend. Ini bukan toko online publik lengkap: belum mencakup keranjang, checkout, pembayaran, pengiriman, stok transaksi, reset password email, atau pembatasan hak akses granular per role. Tambahkan fitur tersebut bila menjadi kebutuhan tugas kelompok.
