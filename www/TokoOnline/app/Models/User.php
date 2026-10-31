<?php
namespace App\Models;
use Illuminate\Foundation\Auth\User as Authenticatable; use Illuminate\Notifications\Notifiable; use Illuminate\Database\Eloquent\Factories\HasFactory;
class User extends Authenticatable {
 use HasFactory, Notifiable;
 protected $table='user';
 protected $fillable=['nama','email','role','status','password','hp','foto'];
 protected $hidden=['password','remember_token'];
 protected $casts=['status'=>'boolean','password'=>'hashed'];
 public function produk(){return $this->hasMany(Produk::class,'user_id');}
}
