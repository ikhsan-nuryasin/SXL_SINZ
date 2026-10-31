<?php
namespace App\Http\Middleware;
use Closure; use Illuminate\Http\Request; use Illuminate\Support\Facades\Auth;
class RedirectIfAuthenticated {
 public function handle(Request $request, Closure $next, ...$guards) {
  foreach ($guards ?: [null] as $guard) if (Auth::guard($guard)->check()) return redirect()->route('backend.beranda');
  return $next($request);
 }
}
