@echo off
setlocal
cd /d "%~dp0"
echo SXL Localhost - Perbaikan MariaDB
 echo.
echo Tutup aplikasi SXL Localhost sebelum melanjutkan.
echo Skrip akan memverifikasi arsip resmi dan mempertahankan file lama di recovery.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Repair-SXL-MariaDB-Standalone.ps1"
set "SXL_REPAIR_EXIT=%ERRORLEVEL%"
echo.
if not "%SXL_REPAIR_EXIT%"=="0" echo Perbaikan belum berhasil. Baca pesan di atas dan log installer.
pause
exit /b %SXL_REPAIR_EXIT%
