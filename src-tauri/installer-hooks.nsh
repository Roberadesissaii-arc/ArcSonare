; ArcSonare NSIS installer hooks.
;
; Uninstalling used to remove only the executable. Everything that identifies
; the user survived: the local account and session in the WebView2 localStorage,
; the SQLite databases, and every provider credential in Windows Credential
; Manager. A reinstall therefore showed the previous person's account and their
; connected services — anyone reinstalling on a shared machine inherited them.
;
; POSTUNINSTALL removes all of it, so uninstall genuinely means "gone".

!macro NSIS_HOOK_POSTUNINSTALL
  ; App data: SQLite databases, settings.json, captures, audit log.
  RMDir /r "$APPDATA\com.arcsonare.desktop"
  ; WebView2 profile: this is where localStorage keeps the account + session.
  RMDir /r "$LOCALAPPDATA\com.arcsonare.desktop"

  ; Provider keys and OAuth tokens live in Windows Credential Manager under the
  ; "ArcSonare" service. Enumerated rather than hardcoded so providers added
  ; later are cleaned up too.
  nsExec::ExecToLog 'powershell -NoProfile -WindowStyle Hidden -Command "cmdkey /list | Select-String \"target=.*\.ArcSonare\" | ForEach-Object { $t = ($_.ToString() -split \"target=\")[-1].Trim(); cmdkey /delete:$t | Out-Null }"'
  Pop $0
!macroend
