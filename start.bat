@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION

REM ============================================================
REM  team-toolbox one-click starter (Windows)
REM  Scope: Stage 1 TASK-001 scaffold only.
REM  Steps:
REM      1. Verify Node.js / npm.
REM      2. Install backend & frontend deps on first run.
REM      3. Run database migration if data file is missing.
REM      4. Launch backend (3000) and frontend (5173) in separate
REM         windows; open browser to frontend URL.
REM  Stop: close the two titled command windows, or Ctrl+C.
REM ============================================================
REM  IMPORTANT: this system has NO authentication.
REM  Do NOT bind to 0.0.0.0 or expose to the public network.
REM  See docs/ARCHITECTURE.md section 7.
REM ============================================================

cd /d "%~dp0"

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
echo [info] project root: %CD%

REM ---- Backend deps (skip if already present) ----
if not exist "backend\node_modules" (
    echo [step] installing backend dependencies...
    pushd backend
    call npm install
    if errorlevel 1 ( popd & echo [ERROR] backend npm install failed & pause & exit /b 1 )
    popd
)

REM ---- Migration (only when database file missing) ----
if not exist "data\team-toolbox.sqlite3" (
    echo [step] running database migration...
    pushd backend
    call npm run migrate
    if errorlevel 1 ( popd & echo [ERROR] backend migrate failed & pause & exit /b 1 )
    popd
) else (
    echo [info] database exists, skipping migrate. Run "cd backend ^&^& npm run migrate" to upgrade.
)

REM ---- Frontend deps ----
if not exist "frontend\node_modules" (
    echo [step] installing frontend dependencies...
    pushd frontend
    call npm install
    if errorlevel 1 ( popd & echo [ERROR] frontend npm install failed & pause & exit /b 1 )
    popd
)

REM ---- Launch backend in a new titled window ----
echo [step] starting backend on http://127.0.0.1:3000
start "team-toolbox-backend" cmd /k "cd /d %~dp0backend && npm start"

REM ---- Launch frontend in a new titled window ----
echo [step] starting frontend on http://127.0.0.1:5173
start "team-toolbox-frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

REM ---- Wait for frontend dev server then open browser ----
echo [info] waiting for frontend dev server...
set /a TRIES=0
:wait_loop
set /a TRIES+=1
timeout /t 1 /nobreak >nul
curl -sS -o nul -w "" http://127.0.0.1:5173/ 2>nul
if errorlevel 1 (
    if !TRIES! lss 30 goto wait_loop
    echo [warn] frontend did not respond in 30s. Check the frontend window.
) else (
    echo [info] frontend is up.
    start "" "http://127.0.0.1:5173/"
)

echo.
echo ============================================================
echo  team-toolbox started.
echo    backend : http://127.0.0.1:3000  (window: team-toolbox-backend)
echo    frontend: http://127.0.0.1:5173  (window: team-toolbox-frontend)
echo  Stop: close the two titled windows.
echo  WARN: NO auth. Do NOT bind 0.0.0.0 / expose publicly.
echo ============================================================
echo.

endlocal
exit /b 0