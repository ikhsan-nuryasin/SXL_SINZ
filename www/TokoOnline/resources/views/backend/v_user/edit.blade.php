@extends('backend.v_layouts.app')
@section('content')
<div class="mb-4"><h1 class="page-title h2">{{ $judul }}</h1></div><div class="card p-4"><form method="POST" action="{{ route('backend.user.update',$edit) }}" enctype="multipart/form-data">@csrf @method('PUT')
<div class="mb-3"><label class="form-label">Nama lengkap</label><input class="form-control" name="nama" value="{{ old('nama',$edit->nama ?? '') }}" required maxlength="255"></div>
<div class="mb-3"><label class="form-label">Email</label><input type="email" class="form-control" name="email" value="{{ old('email',$edit->email ?? '') }}" required></div>
<div class="row"><div class="col-md-6 mb-3"><label class="form-label">Role</label><select class="form-select" name="role" required>@foreach([0=>'Admin',1=>'Super Admin',2=>'Customer'] as $v=>$label)<option value="{{ $v }}" @selected((string)old('role',$edit->role ?? 0)===(string)$v)>{{ $label }}</option>@endforeach</select></div><div class="col-md-6 mb-3"><label class="form-label">Status</label><select class="form-select" name="status"><option value="1" @selected((string)old('status',$edit->status ?? 1)==='1')>Aktif</option><option value="0" @selected((string)old('status',$edit->status ?? 1)==='0')>Nonaktif</option></select></div></div>
<div class="mb-3"><label class="form-label">Nomor HP</label><input class="form-control" name="hp" value="{{ old('hp',$edit->hp ?? '') }}" placeholder="08xxxxxxxxxx"></div>
<div class="row"><div class="col-md-6 mb-3"><label class="form-label">Password @if(isset($edit))<span class="muted">(kosongkan jika tidak diganti)</span>@endif</label><input type="password" class="form-control" name="password" @if(!isset($edit)) required @endif></div><div class="col-md-6 mb-3"><label class="form-label">Konfirmasi password</label><input type="password" class="form-control" name="password_confirmation" @if(!isset($edit)) required @endif></div></div>
<div class="mb-4"><label class="form-label">Foto profil (maks. 1 MB)</label><input type="file" class="form-control" name="foto" accept="image/*">@if(isset($edit) && $edit->foto)<img class="thumb mt-2" src="{{ asset('storage/img-user/'.$edit->foto) }}">@endif</div>

<div class="d-flex gap-2"><button class="btn btn-primary">Simpan Perubahan</button><a class="btn btn-light" href="{{ route('backend.user.index') }}">Batal</a></div></form></div>
@endsection
