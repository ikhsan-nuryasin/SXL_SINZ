@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.12 atau lebih baru belum ditemukan.
  echo Pasang Node.js LTS x64 lalu jalankan file ini kembali.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v" %%V in ('node -p "process.versions.node"') do set NODE_MAJOR=%%V
node -e "const v=process.versions.node.split('.').map(Number); if(v[0]<22||(v[0]===22&&v[1]<12)) process.exit(1)"
if errorlevel 1 (
  echo Versi Node.js harus 22.12 atau lebih baru.
  pause
  exit /b 1
)
if not exist "runtime\packages\mariadb-13.0.2-winx64.zip" (
  echo ZIP MariaDB 13.0.2 bawaan tidak ditemukan.
  pause
  exit /b 1
)
echo Memasang dependensi build...
call npm install
if errorlevel 1 (
  echo npm install gagal.
  pause
  exit /b 1
)
echo Membuat installer Windows x64 dan aplikasi portable...
call npm run build:win
if errorlevel 1 (
  echo Build gagal. Periksa output di atas.
  pause
  exit /b 1
)
echo Build selesai. Lihat folder dist.
pause
