!macro customInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $0 == ""
    ReadEnvStr $0 "USERPROFILE"
    ${if} $0 != ""
      StrCpy $INSTDIR "$0\${APP_FILENAME}"
    ${endif}
  ${endif}
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SINZ"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SXL Localhost"
!macroend
