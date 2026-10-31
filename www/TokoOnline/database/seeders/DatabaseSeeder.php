<?php
namespace Database\Seeders;
use Illuminate\Database\Seeder; use App\Models\User; use App\Models\Kategori; use App\Models\Produk;
class DatabaseSeeder extends Seeder {
 public function run(): void {
  User::updateOrCreate(['email'=>'admin@gmail.com'],['nama'=>'Administrator','role'=>1,'status'=>1,'hp'=>'0812345678901','password'=>bcrypt('P@55word')]);
  User::updateOrCreate(['email'=>'sopianaji@admin.com'],['nama'=>'Sopian Aji','role'=>0,'status'=>1,'hp'=>'081234567892','password'=>bcrypt('P@55word')]);
  foreach(['Brownies','Combro','Dawet','Mochi','Wingko'] as $name) Kategori::firstOrCreate(['nama_kategori'=>$name]);
 }
}
