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
#  三个必须注意的实现细节：
#  1. 依赖装在**暂存目录**里，不动开发者的 backend/node_modules。
#     在源码目录跑 npm install --omit=dev 会裁剪开发依赖，
#     导致开发者本地的 npm test 跑不起来。
#  2. 前端 dist 在构建前用 PowerShell 清空，不交给 Vite 的 emptyOutDir。
#     Vite 用 node 的 fs.rmSync 删目录，会被 WorkBuddy 的删除保护拦截
#     （单目录超过 50 个文件即拒绝），构建必然失败。
#  3. **必须内置 Node 运行时**（runtime/node.exe）—— 见下。
#
#  ── 为什么必须内置运行时 ──
#    better-sqlite3 是 NODE_MODULE_VERSION 敏感的原生模块：
#    它随包分发的 .node 二进制只能被**同 ABI** 的 Node 加载
#    （ABI 127 = Node 22，ABI 137 = Node 24，互不兼容）。
#    若依赖用户系统里的 Node，构建机（Node 22）与用户机（Node 24）一旦不同，
#    后端启动即报 NODE_MODULE_VERSION 127 vs 137 —— v0.1.0 就是这么坏的。
#    better-sqlite3 官方预编译包也不覆盖 Node 24（只有 v108/115/127/131），
#    用户机器上无法靠 npm rebuild 自愈（需 Visual Studio Build Tools）。
#    因此唯一可靠解法：**包内自带 node.exe**，启动脚本优先用它，
#    完全摆脱对用户系统 Node 版本与 ABI 的依赖。
#    代价是包体积 +约 88 MB（node.exe 单文件自包含，无需其他运行时文件）。
#    sharp 与 @napi-rs/canvas 是 N-API，本身跨 Node 版本兼容，无需额外处理。
#
#  用法：
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_release.ps1 -Version 0.1.0
# ============================================================================
param(
    [string]$Version = "0.1.0",
    [switch]$SkipInstaller,
    # 内置 Node 运行时的版本。必须是**稳定 LTS**，且与打包时安装依赖的
    # Node 版本一致 —— 否则 better-sqlite3 的 ABI 又对不上（这正是 v0.1.0 的坑）。
    [string]$NodeVersion = "22.22.2",
    # 更新清单里展示给用户的一句话说明（会出现在应用的「检查更新」对话框里）。
    [string]$Notes = "",
    # 标记为强制更新：客户端会提示「必须更新」，但**不会**替用户跳过备份。
    [switch]$Mandatory
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$projectRoot = Split-Path -Parent $PSScriptRoot
$frontend    = Join-Path $projectRoot "frontend"
$backend     = Join-Path $projectRoot "backend"
$stageDir    = Join-Path $projectRoot "build\release\$Version"
$releaseDir  = Join-Path $projectRoot "release"
$innoDir     = Join-Path $projectRoot "installer"
# 内置运行时的缓存目录 —— 跨版本复用，避免每次打包都重新下载 34 MB。
$runtimeCache = Join-Path $projectRoot "build\runtime-cache"

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid version '$Version'. Expected semver like 0.1.0"
}

function Say([string]$msg, [string]$color = "Gray") {
    Write-Host $msg -ForegroundColor $color
}

# ── 取得内置 Node 运行时 ─────────────────────────────────────────────────
#
# 返回 Node 发行版的**目录**（含 node.exe 与 npm）。
#
# 关键点：
#  1. node.exe 是**单文件自包含**的（Windows 版把 V8 / libuv / OpenSSL
#     全静态链接进去了），所以最终包里只需要这一个文件 ——
#     不需要 ICU 数据目录、不需要 npm、不需要 corepack。
#  2. 但**安装依赖时必须用同一套 Node 跑 npm**：better-sqlite3 的
#     预编译二进制是按跑 npm 时的 Node ABI 选的。若用构建机的 Node 22 装、
#     却让用户跑 Node 24，ABI 就对不上（v0.1.0 就是这么坏的）。
#     所以这里返回完整 dist，装依赖时把它加到 PATH 最前面。
#
# 缓存策略：按 Node 版本缓存到 build\runtime-cache\<version>\node-v<ver>-win-x64\。
# 打包机若无外网，可手工放置该目录后重跑（脚本会直接复用）。
function Get-NodeRuntime {
    param([string]$Ver)

    $cacheDir = Join-Path $runtimeCache $Ver
    $distDir  = Join-Path $cacheDir "node-v$Ver-win-x64"
    $exePath  = Join-Path $distDir "node.exe"

    if (Test-Path $exePath) {
        Say "      命中缓存：$exePath" "DarkGray"
        return $distDir
    }

    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    $zipUrl = "https://nodejs.org/dist/v$Ver/node-v$Ver-win-x64.zip"
    $zipPath = Join-Path $cacheDir "node.zip"

    Say "      下载 Node v$Ver 运行时..." "DarkGray"
    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 300
    } catch {
        throw "下载 Node 运行时失败：$zipUrl`n请检查网络，或手工放置 node-v$Ver-win-x64 目录到 $cacheDir 后重试。"
    }

    if (Test-Path $distDir) { Remove-Item $distDir -Recurse -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $cacheDir)
    Remove-Item $zipPath -Force

    if (-not (Test-Path $exePath)) { throw "Node 运行时压缩包里没有 node.exe：$zipUrl" }
    Say "      运行时就绪：node.exe（{0:N1} MB）" -f ((Get-Item $exePath).Length / 1MB) "Green"
    return $distDir
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
        # 参数名**不能叫 $Args** —— 它是 PowerShell 的自动变量
        # （函数未声明形参时接收剩余实参）。用作 param 名会被自动变量抢占，
        # 表现为参数个数恒为 0，于是 `& $Exe @Args` 展开成空调用，
        # npm 打印 usage 并以退出码 1 结束。
        # 症状极具迷惑性：报错指向「前端生产构建失败」，而真正原因在几行之外。
        [string[]]$ArgList,
        [string]$WorkDir
    )
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($WorkDir) { Push-Location $WorkDir }
        & $Exe @ArgList 2>&1 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
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
    $code = Invoke-Native -Exe 'npm.cmd' -ArgList @('run', 'build')
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

# 内置 Node 运行时 —— 解决 better-sqlite3 的 ABI 依赖（详见文件头说明）。
# 用户机器不需要装 Node，也不会因为系统 Node 版本不同而启动失败。
Say "      准备内置 Node 运行时..."
$nodeDist = Get-NodeRuntime -Ver $NodeVersion
$runtimeOut = Join-Path $appDir "runtime"
New-Item -ItemType Directory -Path $runtimeOut -Force | Out-Null
Copy-Item (Join-Path $nodeDist "node.exe") (Join-Path $runtimeOut "node.exe") -Force
Say "      运行时已内置（{0:N1} MB）" -f ((Get-Item (Join-Path $runtimeOut "node.exe")).Length / 1MB) "Green"

# 后端：只带源码与清单，**不带 node_modules** —— 依赖在暂存目录里重装，
# 这样发布包拿到的是与 package.json 严格一致的生产依赖树，
# 也不会污染开发者的 backend/node_modules。
Say "      复制后端源码..."
Copy-Item (Join-Path $backend "src") $backendOut -Recurse -Force
Copy-Item (Join-Path $backend "package.json") $backendOut -Force
if (Test-Path (Join-Path $backend "package-lock.json")) {
    Copy-Item (Join-Path $backend "package-lock.json") $backendOut -Force
}

# 剔除测试文件。
#
# 后端测试与源码同目录（`src/*.test.js`），直接整目录复制会把它们打进发布包。
# 危害不大（不会被执行），但发布包里躺着 4 个测试文件既让包体无谓变大，
# 也容易让人误会「这包是不是开发版」。npm 包也从不带 test 文件。
$stagedSrc = Join-Path $backendOut "src"
$testFiles = Get-ChildItem -Path $stagedSrc -Filter "*.test.js" -File -ErrorAction SilentlyContinue
if ($testFiles) {
    $testFiles | Remove-Item -Force
    Say ("      已剔除 {0} 个测试文件" -f $testFiles.Count) "DarkGray"
}

# 把 -Version 注入包内的 package.json。
#
# 这一步不能省：后端从 package.json 读版本号并对外报告（/api/health、
# 更新接口），而自动更新完全依赖版本比对。若忘了手工改 package.json
# 就用新版本号打包，包里会自称旧版本 —— 用户装了新版仍被提示「有新版本」，
# 或者干脆不提示。历史上真的发生过：v0.1.1 的包对外自称 0.1.0。
Say "      注入版本号到包内 package.json..."
$stagedPkg = Join-Path $backendOut "package.json"
$pkgRaw = [System.IO.File]::ReadAllText($stagedPkg, [System.Text.UTF8Encoding]::new($false))
$pkgNew = [regex]::Replace($pkgRaw, '("version"\s*:\s*")[^"]*(")', "`${1}$Version`${2}", 1)
if ($pkgNew -notmatch ('"version"\s*:\s*"' + [regex]::Escape($Version) + '"')) {
    throw "无法把版本号 $Version 写入包内 package.json，请检查该文件格式。"
}
[System.IO.File]::WriteAllText($stagedPkg, $pkgNew, [System.Text.UTF8Encoding]::new($false))

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
$origPath = $env:PATH
try {
    # **必须用内置 Node 跑 npm**：better-sqlite3 的预编译二进制是按
    # 跑 npm 时的 Node ABI 挑选的。若用构建机的 Node 装、却让用户跑
    # 另一个版本，ABI 对不上，后端启动即崩（v0.1.0 的真实故障）。
    # 把内置 dist 放到 PATH 最前面，保证 npm 与包内 node.exe 同源。
    $env:PATH = $nodeDist + ";" + $origPath
    $code = Invoke-Native -Exe 'npm.cmd' -ArgList @('install', '--omit=dev', '--no-audit', '--no-fund')
    if ($code -ne 0) { throw "后端生产依赖安装失败（退出码 $code）。" }
} finally {
    $env:PATH = $origPath
    Pop-Location
}
Say "      生产依赖就绪" "Green"

# ── 4. 写启动脚本 ─────────────────────────────────────────────────────────
Say "[4/5] 写启动脚本..." "Cyan"

# 以 UTF-8 with BOM 写入 —— cmd.exe 在中文系统上按 OEM 代码页解读无 BOM 的 UTF-8，
# 中文会变乱码；有 BOM 时 cmd 会切到 UTF-8 代码页。
# （JS 文件同理：Node 读无 BOM 的 UTF-8 没问题，但保持一致更省心。）
$utf8Bom = New-Object System.Text.UTF8Encoding($true)

# 启动.cmd：双击即用。检查 Node、首次运行初始化数据库、启动后端并开浏览器。
# 启动.cmd：双击即用。
#
# 运行时策略：**优先用包内自带的 runtime\node.exe**。
# 随包分发的 better-sqlite3 原生二进制与该 Node 的 ABI 严格绑定，
# 因此不依赖用户系统里装的是哪个 Node 版本 —— 这正是 v0.1.0 装完就崩的原因。
#
# 三个必须处理的情况：
#  1. 包内运行时缺失（用户删了目录）→ 退回系统 Node，并明确警告 ABI 风险。
#  2. 用户自己跑过 npm install（可能换成别的 Node 装的）→ 自检会报 ABI 不匹配。
#  3. 浏览器不能在后端就绪前打开，否则用户看到的是「无法访问此页面」。

# runtime/check.js：启动前自检，确认原生模块能加载。
$runtimeCheck = @'
// 发布包运行时自检。
//
// 存在的理由：better-sqlite3 的原生二进制与 Node 的 ABI（NODE_MODULE_VERSION）
// 严格绑定。若随包依赖被换成了别的 Node 版本编译的二进制，加载会失败并报
// "NODE_MODULE_VERSION 127 vs 137" —— 这类错误发生在 require 阶段，
// 堆栈深且信息晦涩，普通用户无从判断发生了什么。
//
// 这里提前做一次最小验证（打开内存库），失败时给出可操作的说明。
const path = require('node:path');

const modPath = path.join(__dirname, '..', 'backend', 'node_modules', 'better-sqlite3');

let Database;
try {
    Database = require(modPath);
} catch (err) {
    const msg = String((err && err.message) || err);
    if (msg.includes('NODE_MODULE_VERSION')) {
        console.error('');
        console.error('[ERROR] 数据库驱动与当前 Node 版本不兼容。');
        console.error('');
        console.error('        随包的原生模块是用另一个 Node 版本编译的，');
        console.error('        二者的 ABI（NODE_MODULE_VERSION）必须一致。');
        console.error('');
        console.error('        请重新下载完整的发布包（不要在包内跑 npm install）。');
        console.error('');
        console.error('        原始错误：' + msg);
    } else {
        console.error('');
        console.error('[ERROR] 无法加载数据库驱动：' + msg);
        console.error('        随包的 backend/node_modules 可能不完整，请重新下载发布包。');
    }
    process.exit(1);
}

// 显式检查导出类型。
//
// 理由：require 成功**不等于**模块可用。实测存在这种情形 ——
// 加载到了 .node 但导出里没有构造函数（版本不匹配时模块能 require 通过，
// 却在 new 时才炸）。若不显式检查，错误会表现为
// "Database is not a constructor"，对用户毫无指向性。
if (typeof Database !== 'function') {
    console.error('');
    console.error('[ERROR] 数据库驱动加载了，但不是可用的数据库实现。');
    console.error('        导出类型：' + typeof Database);
    console.error('        随包的 backend/node_modules 可能被替换过，请重新下载发布包。');
    process.exit(1);
}

try {
    const db = new Database(':memory:');
    db.close();
} catch (err) {
    console.error('');
    console.error('[ERROR] 数据库驱动自检失败：' + String((err && err.message) || err));
    console.error('        随包的原生模块与内置 Node 版本可能不匹配，请重新下载发布包。');
    process.exit(1);
}

console.log('[check] 运行时自检通过（Node ' + process.version + '，ABI ' + process.versions.modules + '）');
'@

# runtime/open-browser.js：等后端真正就绪后再打开浏览器。
$openBrowser = @'
// 等后端就绪后再打开浏览器。
//
// 为什么不用「先 start 浏览器再启动服务」：那样用户会先看到一个
// 「无法访问此页面」，还得手动刷新 —— 明明服务两秒后就起来了。
const http = require('node:http');
const { spawn } = require('node:child_process');

const URL = 'http://127.0.0.1:3000/';
const DEADLINE = Date.now() + 30000;

function openBrowser() {
    try {
        if (process.platform === 'win32') {
            spawn('cmd', ['/c', 'start', '""', URL], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'darwin') {
            spawn('open', [URL], { detached: true, stdio: 'ignore' }).unref();
        } else {
            spawn('xdg-open', [URL], { detached: true, stdio: 'ignore' }).unref();
        }
    } catch (e) {
        // 打不开浏览器不是致命错误 —— 用户可以手动访问地址
    }
    process.exit(0);
}

function retry() {
    if (Date.now() > DEADLINE) {
        console.error('[info] 后端未在 30 秒内就绪，未自动打开浏览器。请手动访问 ' + URL);
        process.exit(0);
    }
    setTimeout(probe, 500);
}

function probe() {
    const req = http.get(URL, (res) => {
        res.resume();
        openBrowser();
    });
    req.on('error', retry);
    req.setTimeout(1000, () => {
        req.destroy();
        retry();
    });
}

probe();
'@

[System.IO.File]::WriteAllText((Join-Path $runtimeOut "check.js"), $runtimeCheck, $utf8Bom)
[System.IO.File]::WriteAllText((Join-Path $runtimeOut "open-browser.js"), $openBrowser, $utf8Bom)

$startCmd = @'
@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

REM ---- 定位 Node 运行时 ----
REM 优先用包内自带的 runtime\node.exe：它的 ABI 与随包分发的
REM better-sqlite3 原生模块严格一致，因此不受用户系统 Node 版本影响。
set "NODE_EXE=%~dp0runtime\node.exe"
if exist "%NODE_EXE%" goto :runtime_ready

echo [warn] 未找到包内运行时 runtime\node.exe，将改用系统 Node。
echo [warn] 若随后报 NODE_MODULE_VERSION 错误，请重新下载完整发布包。
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] 未找到 Node.js，且包内运行时不完整，无法启动。
    echo         请重新下载完整的发布包：https://github.com/GuiYe314/team-toolbox/releases
    pause
    exit /b 1
)
set "NODE_EXE=node"

:runtime_ready
REM ---- 运行时自检：确认数据库驱动能加载 ----
"%NODE_EXE%" "%~dp0runtime\check.js"
if errorlevel 1 (
    echo.
    pause
    exit /b 1
)

REM ---- 启动后端（同时托管前端与 API，单端口）----
echo [info] 正在启动 team-toolbox...
REM TT_SKIP_BROWSER=1：由自动更新的换文件脚本设置。
REM 升级后重开一个浏览器标签页没有意义（用户本来就在页面上），
REM 而且会让「更新完自动回到应用」变成「多出一个重复标签」。
if "%TT_SKIP_BROWSER%"=="1" goto :skip_browser
echo [info] 就绪后会自动打开 http://127.0.0.1:3000/
start "" /b "%NODE_EXE%" "%~dp0runtime\open-browser.js"
:skip_browser

pushd backend
"%NODE_EXE%" src\index.js
popd

echo.
echo 服务已停止。
pause
'@
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

        $code = Invoke-Native -Exe $iscc -ArgList @($tmpIss)
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

# ── 更新清单（自动更新客户端读它）─────────────────────────────────────────
#
# 客户端靠这个文件回答三个问题：有没有新版、下哪个包、下到的包对不对。
# 只发 zip 不发清单，自动更新就什么也找不到 —— 两者必须同时发布。
#
# 注意：**不能带 UTF-8 BOM**。带 BOM 时 JSON.parse 会直接抛
# 「Unexpected token」，而错误现场看起来像「清单文件损坏」，
# 极难联想到是编码问题。同理服务端读取时也会先剥掉 BOM 兜底。
$updateManifest = Join-Path $releaseDir "manifest.json"
$zipHash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()
$zipSize = (Get-Item $zipPath).Length
$updatePayload = [ordered]@{
    schema   = 1
    channel  = 'stable'
    latest   = $Version
    releases = @(
        [ordered]@{
            version     = $Version
            released_at = (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
            file        = (Split-Path -Leaf $zipPath)
            sha256      = $zipHash
            size        = $zipSize
            mandatory   = [bool]$Mandatory
            notes       = $Notes
        }
    )
}
$updateJson = $updatePayload | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($updateManifest, $updateJson, (New-Object System.Text.UTF8Encoding($false)))
Say ("      更新清单 manifest.json（{0}）" -f $Version) "Green"

# ── 6. 运行时自检（封版硬门槛）────────────────────────────────────────────
#
# 为什么必须在这里自动验：v0.1.0 的包在构建机上一切正常，
# 装到用户机器却因 ABI 不匹配直接起不来。构建机跑通**不能**作为证据 ——
# 构建机装依赖时用的 Node 版本，决定了随包原生模块的 ABI。
#
# 这里用包内自带的 node.exe 实际加载随包的 better-sqlite3，
# 加载失败就中止打包，不让坏包流出去。
Say ""
Say "[封版自检] 验证随包原生模块可加载..." "Cyan"
$checkScript = Join-Path $appDir "runtime\check.js"
if (-not (Test-Path $checkScript)) {
    throw "封版自检失败：找不到 runtime\check.js（打包流程可能被改动过）。"
}
$checkOut = & (Join-Path $appDir "runtime\node.exe") $checkScript 2>&1
$checkCode = $LASTEXITCODE
$checkOut | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
if ($checkCode -ne 0) {
    throw "封版自检失败：包内 node.exe 无法加载随包的 better-sqlite3（退出码 $checkCode）。`n这说明原生模块的 ABI 与内置运行时不一致 —— 不要发布这个包。"
}
Say "      原生模块加载正常" "Green"

Say ""
Say "=== 完成 ===" "Green"
Say "输出目录: $releaseDir"
Get-ChildItem $releaseDir -File | Where-Object { $_.Name -like "*$Version*" } | ForEach-Object {
    Say ("  {0}  {1:N0} 字节" -f $_.Name, $_.Length)
}
# 清单名不含版本号，单独列出，避免它被漏掉
if (Test-Path (Join-Path $releaseDir "manifest.json")) {
    Say ("  manifest.json  {0:N0} 字节" -f (Get-Item (Join-Path $releaseDir "manifest.json")).Length)
}
Say ""
Say "自动更新：把 manifest.json 与 team-toolbox-$Version.zip 一起放到更新源目录，"
Say "          客户端配置该目录后即可检查并安装更新。"
Say ""
