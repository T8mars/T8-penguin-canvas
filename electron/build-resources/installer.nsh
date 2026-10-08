!macro customInit
  ; Older updater clients may pass /S. Keep the installer visible so users can
  ; confirm the update flow instead of watching the app disappear silently.
  SetSilent normal
!macroend

!macro customCheckAppRunning
  ; Exact executable name: the *-Setup-*.exe installer is not the app.
  ; 30 seconds covers the old clients' 10s save gate + 15s backend cutoff.
  ; Never force-kill a process whose canvas may not have been saved.
  Push $R0
  Push $R1
  Push $R3
  StrCpy $R1 0
  t8_wait_for_app_exit:
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 603
      Goto t8_app_exit_confirmed
    ${EndIf}
    ${If} $R0 == 0
    ${AndIf} $R1 < 30
      IntOp $R1 $R1 + 1
      Sleep 1000
      Goto t8_wait_for_app_exit
    ${EndIf}
    StrCpy $R3 "The app is still running or saving. Installation has not started. Close the canvas normally, then retry. In Task Manager > Details, check ${APP_EXECUTABLE_FILENAME}; the installer itself does not count."
    ${If} $LANGUAGE == 2052
      StrCpy $R3 "应用仍在运行或保存，安装尚未开始。请正常关闭画布后重试。可在任务管理器的详细信息页查看 ${APP_EXECUTABLE_FILENAME}；安装器本身不算画布进程。"
    ${EndIf}
    ${If} $R0 != 0
      StrCpy $R3 "Process detection failed (code $R0). Installation has not started. Restart Windows and run the installer again. Do not delete application data."
      ${If} $LANGUAGE == 2052
        StrCpy $R3 "进程检测失败（代码 $R0），安装尚未开始。请重启电脑后运行安装包，不要删除画布或数据目录。"
      ${EndIf}
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$R3" /SD IDCANCEL IDRETRY t8_retry_app_exit
    SetErrorLevel 2
    Quit
  t8_retry_app_exit:
    StrCpy $R1 0
    Goto t8_wait_for_app_exit
  t8_app_exit_confirmed:
    ${nsProcess::Unload}
    Pop $R3
    Pop $R1
    Pop $R0
!macroend

!macro customInstall
  ; Electron-builder normally creates these, but updater/reinstall paths can keep
  ; missing shortcuts. Recreate them explicitly so users always get launch entry
  ; points after a foreground install or update.
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"

  CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
