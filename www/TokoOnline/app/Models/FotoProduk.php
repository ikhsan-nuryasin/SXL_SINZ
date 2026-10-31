<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class FotoProduk extends Model {
 protected $table='foto_produk'; protected $fillable=['produk_id','foto'];
 public function produk(){return $this->belongsTo(Produk::class,'produk_id');}
}
