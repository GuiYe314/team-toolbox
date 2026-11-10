@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if /i "%~1"=="/local" set "TT_ACCESS_MODE=Local"

REM Prefer the bundled runtime; the native database module uses its ABI.
set "NODE_EXE=%~dp0runtime\node.exe"
if exist "%NODE_EXE%" goto runtime_ready
echo [warn] Bundled runtime missing; trying system Node.
where node >nul 2>&1
if errorlevel 1 goto missing_runtime
set "NODE_EXE=node"

:runtime_ready
"%NODE_EXE%" "%~dp0runtime\check.js"
if errorlevel 1 goto failed
if not exist "%~dp0scripts\start-services.ps1" goto missing_helper
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-services.ps1" -ProjectRoot "%~dp0." -Mode Release -NodeExecutable "%NODE_EXE%"
if errorlevel 1 goto failed
REM Hidden services keep running; close this double-click launcher on success.
exit /b 0

:missing_runtime
echo [ERROR] No Node runtime found. Download the complete release package.
goto failed
:missing_helper
echo [ERROR] Missing scripts\start-services.ps1. Restore the complete package.
:failed
echo [ERROR] The service did not start. The error is kept visible here.
if /i not "%~1"=="/nopause" pause
exit /b 1
