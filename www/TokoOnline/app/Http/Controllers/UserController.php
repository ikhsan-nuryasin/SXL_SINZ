<?php
namespace App\Http\Controllers;
use App\Models\User; use Illuminate\Http\Request; use Illuminate\Support\Facades\Hash; use Illuminate\Validation\Rule; use App\Helpers\ImageHelper;
class UserController extends Controller {
 public function index(Request $request){$q=User::query();if($request->filled('q'))$q->where(fn($s)=>$s->where('nama','like','%'.$request->q.'%')->orWhere('email','like','%'.$request->q.'%'));return view('backend.v_user.index',['judul'=>'Manajemen User','index'=>$q->latest('updated_at')->paginate(10)->withQueryString()]);}
 public function create(){return view('backend.v_user.create',['judul'=>'Tambah User']);}
 public function store(Request $request){
  $data=$request->validate(['nama'=>'required|max:255','email'=>'required|email|max:255|unique:user,email','role'=>'required|in:0,1,2','status'=>'required|boolean','hp'=>'nullable|digits_between:10,13','password'=>'required|min:8|confirmed','foto'=>'nullable|image|mimes:jpg,jpeg,png,gif,webp|max:1024']);
  $data['password']=Hash::make($data['password']);if($request->hasFile('foto')){$name=uniqid('user_').'.'.$request->file('foto')->extension();ImageHelper::uploadAndResize($request->file('foto'),'img-user',$name,385,400);$data['foto']=$name;}
  User::create($data);return redirect()->route('backend.user.index')->with('success','User berhasil ditambahkan.');
 }
 public function show(string $id){return redirect()->route('backend.user.edit',$id);}
 public function edit(string $id){return view('backend.v_user.edit',['judul'=>'Edit User','edit'=>User::findOrFail($id)]);}
 public function update(Request $request,string $id){
  $user=User::findOrFail($id);$data=$request->validate(['nama'=>'required|max:255','email'=>['required','email','max:255',Rule::unique('user','email')->ignore($user->id)],'role'=>'required|in:0,1,2','status'=>'required|boolean','hp'=>'nullable|digits_between:10,13','password'=>'nullable|min:8|confirmed','foto'=>'nullable|image|mimes:jpg,jpeg,png,gif,webp|max:1024']);
  if(empty($data['password']))unset($data['password']);else $data['password']=Hash::make($data['password']);
  if($request->hasFile('foto')){ImageHelper::delete('img-user',$user->foto);$name=uniqid('user_').'.'.$request->file('foto')->extension();ImageHelper::uploadAndResize($request->file('foto'),'img-user',$name,385,400);$data['foto']=$name;}
  $user->update($data);return redirect()->route('backend.user.index')->with('success','User berhasil diperbarui.');
 }
 public function destroy(string $id){$user=User::findOrFail($id);if($user->id===auth()->id())return back()->with('error','Akun yang sedang digunakan tidak dapat dihapus.');if($user->produk()->exists())return back()->with('error','User masih menjadi pembuat produk.');ImageHelper::delete('img-user',$user->foto);$user->delete();return redirect()->route('backend.user.index')->with('success','User berhasil dihapus.');}
 public function formUser(){return view('backend.v_user.form',['judul'=>'Laporan User']);}
 public function cetakUser(Request $request){$data=$request->validate(['tanggal_awal'=>'required|date','tanggal_akhir'=>'required|date|after_or_equal:tanggal_awal']);$users=User::whereBetween('created_at',[$data['tanggal_awal'].' 00:00:00',$data['tanggal_akhir'].' 23:59:59'])->orderByDesc('id')->get();return view('backend.v_user.cetak',['judul'=>'Laporan User','tanggalAwal'=>$data['tanggal_awal'],'tanggalAkhir'=>$data['tanggal_akhir'],'cetak'=>$users]);}
}
