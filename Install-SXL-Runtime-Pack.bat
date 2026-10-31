@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-SXL-Runtime-Pack.ps1" %*
if errorlevel 1 (
  echo.
  echo Persiapan runtime gagal. Baca pesan error di atas.
  pause
  exit /b 1
)
echo.
echo Paket PHP dan MariaDB sudah diverifikasi dan disimpan ke runtime\packages.
pause
