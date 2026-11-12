@echo off
setlocal EnableExtensions DisableDelayedExpansion

REM ============================================================
REM  device-debugger one-click starter (Windows)
REM  Steps:
REM      1. Verify Node.js / npm.
REM      2. Install backend & frontend deps on first run.
REM      3. No database or migration required.
REM      4. Start hidden backend / Vite services and wait for readiness.
REM      5. Open the browser and close this launcher on success.
REM  Stop: double-click stop.bat. Diagnostics: project logs directory.
REM ============================================================
REM  IMPORTANT: this system has NO authentication.
REM  Default: trusted LAN. Use /local for loopback-only access.
REM  Do NOT expose this service to the public network.
REM  See docs/ARCHITECTURE.md section 7.
REM ============================================================

cd /d "%~dp0"
if /i "%~1"=="/local" set "TT_ACCESS_MODE=Local"

if not exist "%~dp0scripts\start-services.ps1" (
    echo [ERROR] Missing scripts\start-services.ps1. Restore the complete project.
    goto failed
)

REM ---- Node.js check ----
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] node not found. Install Node.js v20.19+ or v22 LTS.
    echo         https://nodejs.org/en/download
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODE_VERSION=%%v
for /f "delims=" %%v in ('npm -v')  do set NPM_VERSION=%%v
echo [info] node %NODE_VERSION%  npm %NPM_VERSION%
echo [info] project root: "%CD%"

REM ---- Backend deps (skip if already present) ----
if not exist "backend\node_modules" (
    echo [step] installing backend dependencies...
    pushd backend
    call npm install
    if errorlevel 1 ( popd & echo [ERROR] backend npm install failed & pause & exit /b 1 )
    popd
)

REM ---- Frontend deps ----
if not exist "frontend\node_modules" (
    echo [step] installing frontend dependencies...
    pushd frontend
    call npm install
    if errorlevel 1 ( popd & echo [ERROR] frontend npm install failed & pause & exit /b 1 )
    popd
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-services.ps1" -ProjectRoot "%~dp0."
if errorlevel 1 goto failed
exit /b 0

:failed
echo [ERROR] Startup failed. Review the error and the project logs directory.
if /i not "%~1"=="/nopause" pause
exit /b 1
