<?php
namespace App\Http\Controllers;
use App\Models\Kategori; use Illuminate\Http\Request; use Illuminate\Validation\Rule;
class KategoriController extends Controller {
 public function index(Request $request){$q=Kategori::query();if($request->filled('q'))$q->where('nama_kategori','like','%'.$request->q.'%');return view('backend.v_kategori.index',['judul'=>'Manajemen Kategori','index'=>$q->orderBy('nama_kategori')->paginate(10)->withQueryString()]);}
 public function create(){return view('backend.v_kategori.create',['judul'=>'Tambah Kategori']);}
 public function store(Request $request){$data=$request->validate(['nama_kategori'=>'required|max:255|unique:kategori,nama_kategori']);Kategori::create($data);return redirect()->route('backend.kategori.index')->with('success','Kategori berhasil ditambahkan.');}
 public function show(string $id){return redirect()->route('backend.kategori.edit',$id);}
 public function edit(string $id){return view('backend.v_kategori.edit',['judul'=>'Edit Kategori','edit'=>Kategori::findOrFail($id)]);}
 public function update(Request $request,string $id){$kategori=Kategori::findOrFail($id);$data=$request->validate(['nama_kategori'=>['required','max:255',Rule::unique('kategori','nama_kategori')->ignore($kategori->id)]]);$kategori->update($data);return redirect()->route('backend.kategori.index')->with('success','Kategori berhasil diperbarui.');}
 public function destroy(string $id){$kategori=Kategori::findOrFail($id);if($kategori->produk()->exists())return back()->with('error','Kategori masih digunakan oleh produk.');$kategori->delete();return redirect()->route('backend.kategori.index')->with('success','Kategori berhasil dihapus.');}
}
