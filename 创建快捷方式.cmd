@echo off
setlocal EnableExtensions DisableDelayedExpansion
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcuts.ps1" -ProjectRoot "%~dp0."
set "SHORTCUT_EXIT_CODE=%ERRORLEVEL%"
if /i not "%~1"=="/nopause" pause
exit /b %SHORTCUT_EXIT_CODE%
