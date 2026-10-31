@echo off
chcp 65001 >nul
title SXL Localhost - Website Sharing
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-SXL-Website-Sharing.ps1"
if errorlevel 1 (
  echo.
  echo SXL gagal dijalankan. Baca pesan error di atas.
  pause
)
