@echo off
setlocal EnableExtensions DisableDelayedExpansion

if not exist "%~dp0scripts\stop.ps1" (
    echo [ERROR] Missing scripts\stop.ps1. Restore the complete project folder.
    set "STOP_EXIT_CODE=1"
    goto finish
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" -ProjectRoot "%~dp0."
set "STOP_EXIT_CODE=%ERRORLEVEL%"

:finish
if /i not "%~1"=="/nopause" pause
exit /b %STOP_EXIT_CODE%
