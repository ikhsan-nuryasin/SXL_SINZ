<?php
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\{LoginController,BerandaController,UserController,KategoriController,ProdukController};
Route::get('/', fn()=>redirect()->route('backend.login'));
Route::get('/backend/login',[LoginController::class,'loginBackend'])->name('backend.login');
Route::post('/backend/login',[LoginController::class,'authenticateBackend'])->name('backend.login.post');
Route::post('/backend/logout',[LoginController::class,'logoutBackend'])->name('backend.logout');
Route::middleware('auth')->prefix('backend')->name('backend.')->group(function(){
 Route::get('/beranda',[BerandaController::class,'berandaBackend'])->name('beranda');
 Route::resource('user',UserController::class);
 Route::resource('kategori',KategoriController::class);
 Route::resource('produk',ProdukController::class);
 Route::post('/foto-produk/store',[ProdukController::class,'storeFoto'])->name('foto_produk.store');
 Route::delete('/foto-produk/{id}',[ProdukController::class,'destroyFoto'])->name('foto_produk.destroy');
 Route::get('/laporan/formuser',[UserController::class,'formUser'])->name('laporan.formuser');
 Route::post('/laporan/cetakuser',[UserController::class,'cetakUser'])->name('laporan.cetakuser');
 Route::get('/laporan/formproduk',[ProdukController::class,'formProduk'])->name('laporan.formproduk');
 Route::post('/laporan/cetakproduk',[ProdukController::class,'cetakProduk'])->name('laporan.cetakproduk');
});
