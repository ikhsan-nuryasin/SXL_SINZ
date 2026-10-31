<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request; use Illuminate\Support\Facades\Auth;
class LoginController extends Controller {
 public function loginBackend(){if(Auth::check()) return redirect()->route('backend.beranda'); return view('backend.v_login.login',['judul'=>'Masuk ke TokoOnline']);}
 public function authenticateBackend(Request $request){
  $credentials=$request->validate(['email'=>'required|email','password'=>'required|string']);
  if(Auth::attempt($credentials)){
   if(!Auth::user()->status){Auth::logout();return back()->withInput($request->only('email'))->with('error','Akun belum aktif. Hubungi administrator.');}
   $request->session()->regenerate();return redirect()->intended(route('backend.beranda'));
  }
  return back()->withInput($request->only('email'))->with('error','Email atau password tidak sesuai.');
 }
 public function logoutBackend(Request $request){Auth::logout();$request->session()->invalidate();$request->session()->regenerateToken();return redirect()->route('backend.login');}
}
