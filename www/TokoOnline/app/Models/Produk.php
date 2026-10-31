<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class Produk extends Model {
 protected $table='produk'; protected $fillable=['kategori_id','user_id','nama_produk','detail','harga','stok','foto'];
 public function kategori(){return $this->belongsTo(Kategori::class,'kategori_id');}
 public function user(){return $this->belongsTo(User::class,'user_id');}
 public function fotoProduk(){return $this->hasMany(FotoProduk::class,'produk_id');}
}
