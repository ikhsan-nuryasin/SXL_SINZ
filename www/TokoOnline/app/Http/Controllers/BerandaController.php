<?php
namespace App\Http\Controllers;
use App\Models\User; use App\Models\Kategori; use App\Models\Produk;
class BerandaController extends Controller {
 public function berandaBackend(){return view('backend.v_beranda.index',['judul'=>'Dashboard','jumlahUser'=>User::count(),'jumlahKategori'=>Kategori::count(),'jumlahProduk'=>Produk::count()]);}
}
