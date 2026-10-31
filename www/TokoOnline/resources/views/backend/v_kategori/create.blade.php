@extends('backend.v_layouts.app')
@section('content')<h1 class="page-title h2 mb-4">{{ $judul }}</h1><div class="card p-4"><form method="POST" action="{{ route('backend.kategori.store') }}">@csrf
<div class="mb-4"><label class="form-label">Nama kategori</label><input class="form-control" name="nama_kategori" value="{{ old('nama_kategori',$edit->nama_kategori ?? '') }}" required maxlength="255" placeholder="Contoh: Makanan"></div>
<div class="d-flex gap-2"><button class="btn btn-primary">Simpan</button><a class="btn btn-light" href="{{ route('backend.kategori.index') }}">Batal</a></div></form></div>@endsection
