<?php
namespace App\Helpers;
use Illuminate\Http\UploadedFile; use Illuminate\Support\Facades\Storage;
class ImageHelper {
 public static function uploadAndResize(UploadedFile $file, string $directory, string $name, ?int $width=null, ?int $height=null): string {
  $path=trim($directory,'/'); Storage::disk('public')->putFileAs($path,$file,$name); return $name;
 }
 public static function delete(string $directory, ?string $name): void { if($name) Storage::disk('public')->delete(trim($directory,'/').'/'.$name); }
}
