<?php
use Illuminate\Database\Migrations\Migration; use Illuminate\Database\Schema\Blueprint; use Illuminate\Support\Facades\Schema;
return new class extends Migration { public function up(): void {Schema::create('foto_produk',function(Blueprint $table){$table->id();$table->foreignId('produk_id')->constrained('produk')->cascadeOnDelete();$table->string('foto');$table->timestamps();});} public function down(): void {Schema::dropIfExists('foto_produk');}};
