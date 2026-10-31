# Ringkasan Jawaban Latihan Modul Web Programming II

Dokumen ini adalah panduan belajar pendamping README utama, disusun dari topik dan instruksi praktikum yang tampak pada modul yang disediakan.

## A. Latihan Controller dan View (Minggu 2)
**Soal:** Buat `LatihanController` dengan `getTabel()` dan `getForm()` untuk menampilkan tabel dan form.

**Jawaban inti:**
```php
class LatihanController extends Controller {
    public function getTabel() { return view('latihan.tabel'); }
    public function getForm() { return view('latihan.form'); }
}
```
Route:
```php
Route::get('/latihan/tabel', [LatihanController::class, 'getTabel']);
Route::get('/latihan/form', [LatihanController::class, 'getForm']);
```
File view tabel diletakkan di `resources/views/latihan/tabel.blade.php`; view form di `resources/views/latihan/form.blade.php`. Controller bertugas memilih response, view bertugas menampilkan HTML.

## B. Latihan CRUD Anggota (Minggu 3–4)
**Struktur tabel:** `id`, `nama`, `hp`, `created_at`, `updated_at`. `id` menjadi primary key. `nama` wajib diisi. `hp` disimpan sebagai string agar nol pertama tidak hilang.

**Validasi:** `nama => required|max:255`, `hp => required|min:10|max:13`. Ketika validasi gagal, Laravel kembali ke form, menyimpan input lama, dan menyediakan pesan di `$errors`/directive `@error`.

**Resource controller:** `index` membaca data, `create` menampilkan form, `store` memvalidasi dan menyimpan, `show` menampilkan satu data, `edit` menampilkan form ubah, `update` menyimpan perubahan, `destroy` menghapus.

**`dd($request)` vs penyimpanan:** `dd()` hanya alat debugging dan menghentikan proses; setelah memeriksa request, hapus/nonaktifkan `dd()` agar baris simpan data dapat berjalan.

## C. Login dan tabel user (Minggu 5)
**Field tabel:** `id`, `nama`, `email` unik, `role`, `status`, `password`, `hp`, `foto`, timestamps. Role modul: 0 Admin, 1 SuperAdmin, 2 Customer. Status 0 nonaktif, 1 aktif.

**Mengapa password di-hash?** Agar kata sandi asli tidak tersimpan sebagai teks biasa. Laravel membandingkan input login dengan hash tersimpan.

**Mengapa regenerasi session setelah login?** Mengurangi risiko session fixation. Saat logout, session di-invalidate dan CSRF token diregenerasi.

**Kasus pengujian login:** email/password benar + aktif harus berhasil; password salah harus ditolak; akun nonaktif harus ditolak; halaman backend tanpa login harus diarahkan ke login; logout harus mengakhiri sesi.

## D. Kategori, Produk, Join (Minggu 9–11)
**Mengapa kategori dipisahkan?** Agar nama kategori tidak ditulis ulang pada setiap produk, menjaga konsistensi dan memudahkan pengelolaan kategori.

**Join/relasi:** `produk.kategori_id` merujuk `kategori.id`; `produk.user_id` merujuk `user.id`; `foto_produk.produk_id` merujuk `produk.id`. `belongsTo` digunakan dari produk menuju kategori/user; `hasMany` digunakan dari kategori/user/produk menuju record anak.

**Apa fungsi foto_produk?** Memungkinkan satu produk mempunyai banyak gambar galeri, terpisah dari foto utama yang disimpan di tabel produk.

## E. Laporan (Minggu 12)
Form laporan menerima `tanggal_awal` dan `tanggal_akhir`. Aturan `after_or_equal:tanggal_awal` memastikan rentang tidak terbalik. Query menggunakan `whereBetween(created_at, [awal 00:00:00, akhir 23:59:59])`. Halaman cetak dapat dikirim ke printer atau disimpan sebagai PDF dari browser.

## F. Pemetaan file yang diminta pada lembar SCRIPT MODUL
| Kelompok | File pada proyek |
|---|---|
| Controller | `LoginController.php`, `BerandaController.php`, `UserController.php`, `KategoriController.php`, `ProdukController.php` |
| Model | `User.php`, `Kategori.php`, `Produk.php`, `FotoProduk.php` |
| Migration/Seeder | empat migration dan `DatabaseSeeder.php` |
| Login/layout/dashboard | `backend/v_login/login.blade.php`, `backend/v_layouts/app.blade.php`, `backend/v_beranda/index.blade.php` |
| CRUD User | folder `backend/v_user/` |
| CRUD Kategori | folder `backend/v_kategori/` |
| CRUD Produk | folder `backend/v_produk/` |
| Route/helper | `routes/web.php`, `app/Helpers/ImageHelper.php` |

**Catatan:** Pada modul, sebagian file diminta berdasarkan halaman tertentu dan ada file yang harus menggabungkan kode awal dengan tambahan. Implementasi proyek ini menjaga fungsi yang diminta, tetapi merapikan validasi, upload, relasi, nama route, dan tampilan menjadi satu versi yang saling cocok.
