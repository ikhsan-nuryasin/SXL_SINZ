# Catatan Implementasi

## Cakupan
Implementasi memuat backend toko online: autentikasi, dashboard, data user, kategori, produk, foto utama, galeri foto, relasi Eloquent, dan laporan cetak. Dokumentasi penjelasan konsep serta jawaban latihan terdapat di `README.md` dan `README-LATIHAN.md`.

## Penyesuaian terhadap modul
- Menggunakan empat tabel bisnis (`user`, `kategori`, `produk`, `foto_produk`) seperti alur modul.
- Password user selalu di-hash.
- Penamaan route resource konsisten dengan prefix `backend`.
- Laporan menggunakan rentang tanggal penuh sampai akhir hari.
- File upload disimpan pada disk `public`; perintah `storage:link` mengeksposnya.
- Kode upload mempertahankan gambar asli. Helper sengaja ringan dan tidak membuat thumbnail multiukuran seperti contoh lanjutan di modul; fungsi CRUD/galeri tetap tersedia.
- Bootstrap dimuat dari CDN; koneksi internet diperlukan untuk styling CDN.

## Sebelum dinilai
1. Jalankan instalasi sesuai README.
2. Uji seluruh checklist.
3. Ambil screenshot login, dashboard, CRUD, galeri, dan laporan untuk lampiran tugas.
4. Ubah akun demo/password sebelum demo kelompok.
5. Jelaskan pada presentasi bahwa proyek ini merupakan aplikasi backend pembelajaran, bukan sistem transaksi komersial.
