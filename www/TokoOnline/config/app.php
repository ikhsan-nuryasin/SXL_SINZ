<?php
return [
'name'=>env('APP_NAME','TokoOnline'),'env'=>env('APP_ENV','production'),'debug'=>(bool)env('APP_DEBUG',false),
'url'=>env('APP_URL','http://localhost'),'asset_url'=>env('ASSET_URL'),'timezone'=>'Asia/Jakarta','locale'=>'id','fallback_locale'=>'en','faker_locale'=>'id_ID',
'key'=>env('APP_KEY'),'cipher'=>'AES-256-CBC','maintenance'=>['driver'=>'file'],
'providers'=>Illuminate\Support\ServiceProvider::defaultProviders()->merge([App\Providers\AppServiceProvider::class])->toArray(),
'aliases'=>Illuminate\Support\Facades\Facade::defaultAliases()->toArray(),
];
