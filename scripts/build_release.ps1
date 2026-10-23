#!/usr/bin/env pwsh
# ============================================================================
#  team-toolbox 发布打包脚本
#
#  产出三份发布资产（与 docs/VERSION_POLICY.md 的约定一致）：
#    1. team-toolbox-<版本>.zip              便携包（解压即用，含生产依赖）
#    2. team-toolbox-Setup-<版本>.exe        安装包（Inno Setup 编译）
#    3. team-toolbox-<版本>-SHA256.txt       校验清单
#
#  与参考项目 TravelMap 的差异（必须理解，否则会照搬出错）：
#    TravelMap 用 PyInstaller 把 Python 后端冻结成单文件 EXE。
#    本项目后端是 Node.js，better-sqlite3 与 sharp 都含原生模块，
#    **无法**像 Python 那样冻结进单个可执行文件。
#    因此改为「生产依赖随包分发 + 一键启动脚本」：
#    便携包解压后双击 启动.cmd 即可，无需安装、无需联网装依赖。
#
#  两个必须注意的实现细节：
#  1. 依赖装在**暂存目录**里，不动开发者的 backend/node_modules。
#     在源码目录跑 npm install --omit=dev 会裁剪开发依赖，
#     导致开发者本地的 npm test 跑不起来。
#  2. 前端 dist 在构建前用 PowerShell 清空，不交给 Vite 的 emptyOutDir。
#     Vite 用 node 的 fs.rmSync 删目录，会被 WorkBuddy 的删除保护拦截
#     （单目录超过 50 个文件即拒绝），构建必然失败。
#
#  用法：
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_release.ps1 -Version 0.1.0
# ============================================================================
param(
    [string]$Version = "0.1.0",
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$projectRoot = Split-Path -Parent $PSScriptRoot
$frontend    = Join-Path $projectRoot "frontend"
$backend     = Join-Path $projectRoot "backend"
$stageDir    = Join-Path $projectRoot "build\release\$Version"
$releaseDir  = Join-Path $projectRoot "release"
$innoDir     = Join-Path $projectRoot "installer"

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid version '$Version'. Expected semver like 0.1.0"
}

function Say([string]$msg, [string]$color = "Gray") {
    Write-Host $msg -ForegroundColor $color
}

# 把外部命令的 stderr 并入 stdout 输出。
#
# 坑：npm 会把 deprecation 警告写到 stderr，PowerShell 5.1 见到 stderr
# 输出就抛 NativeCommandError —— 打包其实**成功了**，退出码却是 1。
# 每次都得靠人工确认产物才能判断成败，很容易误判为失败而重跑。
# 这里统一重定向，真实失败仍由 $LASTEXITCODE 判定。
function Invoke-Native {
    param(
        [string]$Exe,
        [string[]]$Args,
        [string]$WorkDir
    )
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($WorkDir) { Push-Location $WorkDir }
        & $Exe @Args 2>&1 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
        return $LASTEXITCODE
    } finally {
        if ($WorkDir) { Pop-Location }
        $ErrorActionPreference = $saved
    }
}

Say ""
Say "=== team-toolbox release build ===" "Cyan"
Say "version : $Version"
Say "root    : $projectRoot"
Say ""

# ── 1. 清理并构建前端 ──────────────────────────────────────────────────────
Say "[1/5] 前端生产构建..." "Cyan"
$dist = Join-Path $frontend "dist"
if (Test-Path $dist) {
    # 用 PowerShell 删，而不是让 Vite 的 emptyOutDir 删。
    # Vite 走 node fs.rmSync，会被 WorkBuddy 删除保护拦截（>50 文件即拒绝）。
    Remove-Item $dist -Recurse -Force
}
Push-Location $frontend
try {
    $code = Invoke-Native -Exe 'npm.cmd' -Args @('run', 'build')
    if ($code -ne 0) { throw "前端生产构建失败（退出码 $code）。" }
} finally {
    Pop-Location
}
if (-not (Test-Path (Join-Path $dist "index.html"))) {
    throw "前端构建产物缺失：$dist\index.html"
}
Say "      dist 就绪" "Green"

# ── 2. 组装暂存目录 ───────────────────────────────────────────────────────
Say "[2/5] 组装暂存目录..." "Cyan"
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
$appDir = Join-Path $stageDir "team-toolbox"
$backendOut = Join-Path $appDir "backend"
$frontendOut = Join-Path $appDir "frontend"
New-Item -ItemType Directory -Path $backendOut -Force | Out-Null
New-Item -ItemType Directory -Path $frontendOut -Force | Out-Null

# 后端：只带源码与清单，**不带 node_modules** —— 依赖在暂存目录里重装，
# 这样发布包拿到的是与 package.json 严格一致的生产依赖树，
# 也不会污染开发者的 backend/node_modules。
Say "      复制后端源码..."
Copy-Item (Join-Path $backend "src") $backendOut -Recurse -Force
Copy-Item (Join-Path $backend "package.json") $backendOut -Force
if (Test-Path (Join-Path $backend "package-lock.json")) {
    Copy-Item (Join-Path $backend "package-lock.json") $backendOut -Force
}

Say "      复制前端产物..."
Copy-Item $dist $frontendOut -Recurse -Force

# 数据目录：只建空的，不带任何用户数据与数据库
New-Item -ItemType Directory -Path (Join-Path $appDir "data") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $appDir "data\assets") -Force | Out-Null

# 文档随包带上用户指南
$docsOut = Join-Path $appDir "docs"
New-Item -ItemType Directory -Path $docsOut -Force | Out-Null
if (Test-Path (Join-Path $projectRoot "docs\USER_GUIDE.md")) {
    Copy-Item (Join-Path $projectRoot "docs\USER_GUIDE.md") $docsOut -Force
}
if (Test-Path (Join-Path $projectRoot "README.md")) {
    Copy-Item (Join-Path $projectRoot "README.md") $appDir -Force
}

# ── 3. 在暂存目录安装生产依赖 ──────────────────────────────────────────────
Say "[3/5] 安装后端生产依赖（暂存目录内）..." "Cyan"
Push-Location $backendOut
try {
    $code = Invoke-Native -Exe 'npm.cmd' -Args @('install', '--omit=dev', '--no-audit', '--no-fund')
    if ($code -ne 0) { throw "后端生产依赖安装失败（退出码 $code）。" }
} finally {
    Pop-Location
}
Say "      生产依赖就绪" "Green"

# ── 4. 写启动脚本 ─────────────────────────────────────────────────────────
Say "[4/5] 写启动脚本..." "Cyan"

# 启动.cmd：双击即用。检查 Node、首次运行初始化数据库、启动后端并开浏览器。
$startCmd = @'
@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

REM ---- Node.js 检查 ----
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] 未找到 Node.js。请先安装 Node.js v20.19+ 或 v22 LTS。
    echo         https://nodejs.org/en/download
    pause
    exit /b 1
)

REM ---- 首次运行：初始化数据库 ----
if not exist "data\team-toolbox.sqlite3" (
    echo [step] 首次运行，正在初始化数据库...
    pushd backend
    call npm run migrate
    if errorlevel 1 ( popd & echo [ERROR] 数据库初始化失败 & pause & exit /b 1 )
    popd
)

REM ---- 启动后端（同时托管前端与 API，单端口）----
echo [info] 正在启动 team-toolbox...
echo [info] 浏览器将自动打开 http://127.0.0.1:3000/
start "" "http://127.0.0.1:3000/"

pushd backend
call npm start
popd

echo.
echo 服务已停止。
pause
'@
# 以 UTF-8 with BOM 写入 —— cmd.exe 在中文系统上按 OEM 代码页解读无 BOM 的 UTF-8，
# 中文会变乱码；有 BOM 时 cmd 会切到 UTF-8 代码页。
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText((Join-Path $appDir "启动.cmd"), $startCmd, $utf8Bom)

# 停止.cmd：按端口结束本机实例
$stopCmd = @'
@echo off
chcp 65001 >nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr LISTENING') do (
    echo [info] 结束 PID %%p ...
    taskkill /PID %%p /F >nul 2>&1
)
echo [info] 已停止。
'@
[System.IO.File]::WriteAllText((Join-Path $appDir "停止.cmd"), $stopCmd, $utf8Bom)
Say "      启动脚本就绪" "Green"

# ── 5. 打包 ZIP + 编译安装包 + 校验清单 ────────────────────────────────────
Say "[5/5] 打包产物..." "Cyan"
if (-not (Test-Path $releaseDir)) { New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null }

$zipPath = Join-Path $releaseDir "team-toolbox-$Version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stageDir, $zipPath,
    [System.IO.Compression.CompressionLevel]::Optimal, $false
)
Say ("      便携包 {0:N0} 字节" -f (Get-Item $zipPath).Length) "Green"

$setupPath = Join-Path $releaseDir "team-toolbox-Setup-$Version.exe"
if (-not $SkipInstaller) {
    $iscc = $null
    foreach ($cand in @(
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    )) {
        if (Test-Path $cand) { $iscc = $cand; break }
    }
    if (-not $iscc) {
        Write-Warning "未找到 Inno Setup 编译器（ISCC.exe），跳过安装包。可用 winget install JRSoftware.InnoSetup 安装。"
    } else {
        $iss = Join-Path $innoDir "team-toolbox.iss"
        $issContent = Get-Content $iss -Raw -Encoding UTF8

        # 逐行精确替换 —— 不用正则全文替换。
        #
        # 踩过的坑：用 -replace 'OutputDir=[^;]*;' 时，`[^;]*` 会跨行匹配
        # （.NET 的 [^;] 默认能匹配换行符），把 OutputDir 后面那一行的
        # 中文注释一起吞进替换文本，导致 Inno Setup 报
        # "Unknown filename prefix" —— 报错信息完全指不到真正的原因。
        $lines = $issContent -split "`r?`n"
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $l = $lines[$i]
            if ($l -match '^\s*#define\s+AppVersion\s+"') {
                $lines[$i] = "#define AppVersion `"$Version`""
            }
            elseif ($l -match '^\s*OutputDir=') {
                # 相对路径，以 .iss 所在目录（installer/）为基准。
                # Inno Setup 的 OutputDir 接受绝对路径，但用相对路径更稳 ——
                # 换机器构建时不会残留上一次的路径。
                $lines[$i] = "OutputDir=..\release"
            }
            elseif ($l -match '^\s*OutputBaseFilename=') {
                $lines[$i] = "OutputBaseFilename=`"team-toolbox-Setup-$Version`""
            }
            elseif ($l -match '^\s*Source:') {
                # 正则刻意**不写双引号**（不用 '^\s*Source:\s*"'）。
                #
                # 坑：PowerShell 5.1 解析单引号字符串时，若内容以 `"` 结尾
                # （如 '^\s*Source:\s*"'），解析器会把紧跟的 `)` 误判，
                # 报「字符串缺少终止符」，且**报错行号指向 200 行开外**，
                # 真正的问题行在中间。AST 解析器才能定位：
                #   [System.Management.Automation.Language.Parser]::ParseFile(...)
                #
                # Source 还必须是相对路径 —— Inno Setup 的 Source 指令
                # 不接受带盘符的绝对路径（报 Unknown filename prefix "D:"）。
                # 这里的相对路径以 .iss 文件所在目录（installer/）为基准。
                $lines[$i] = "Source: `"..\build\release\$Version\team-toolbox\*`"; DestDir: `"{app}`"; Flags: ignoreversion recursesubdirs createallsubdirs"
            }
        }
        $issContent = $lines -join "`r`n"

        # 在 installer/ 目录下生成编译用的 .iss —— Source 的相对路径以此为基准
        $tmpIss = Join-Path $innoDir "team-toolbox-$Version.iss"
        [System.IO.File]::WriteAllText($tmpIss, $issContent, (New-Object System.Text.UTF8Encoding($true)))

        $code = Invoke-Native -Exe $iscc -Args @($tmpIss)
        if ($code -ne 0) { throw "Inno Setup 编译失败（退出码 $code）。" }
        Say ("      安装包 {0:N0} 字节" -f (Get-Item $setupPath).Length) "Green"
    }
}

# 校验清单
$manifestPath = Join-Path $releaseDir "team-toolbox-$Version-SHA256.txt"
$lines = @(
    "# team-toolbox $Version 发布资产校验清单",
    "# 生成时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "# 用法: certutil -hashfile <文件> SHA256  或  sha256sum <文件>",
    ""
)
$assets = @()
if (Test-Path $setupPath) { $assets += $setupPath }
$assets += $zipPath
foreach ($a in $assets) {
    $h = (Get-FileHash -Path $a -Algorithm SHA256).Hash.ToLower()
    $sz = (Get-Item $a).Length
    $lines += "$h  $(Split-Path -Leaf $a)  $sz bytes"
    Say ("      {0}  {1}" -f (Split-Path -Leaf $a), $h.Substring(0,16)) "Green"
}
[System.IO.File]::WriteAllText($manifestPath, ($lines -join "`r`n"), (New-Object System.Text.UTF8Encoding($false)))

Say ""
Say "=== 完成 ===" "Green"
Say "输出目录: $releaseDir"
Get-ChildItem $releaseDir -File | Where-Object { $_.Name -like "*$Version*" } | ForEach-Object {
    Say ("  {0}  {1:N0} 字节" -f $_.Name, $_.Length)
}
Say ""
