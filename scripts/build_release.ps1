param(
    [string]$Version = '',
    [string]$RuntimeSource = '',
    [string]$BuildNode = 'node.exe',
    [string]$InnoCompiler = '',
    [switch]$SkipFrontendBuild
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourcePackage = Get-Content -LiteralPath (Join-Path $repoRoot 'backend\package.json') -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $sourcePackage.version }
if ($Version -notmatch '^\d+\.\d+\.\d+$' -or $Version -ne $sourcePackage.version) { throw 'Version must match backend/package.json and use x.y.z.' }
foreach ($relative in @('backend\package-lock.json', 'frontend\package.json', 'frontend\package-lock.json')) {
    $packageVersion = & $BuildNode -p "JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8')).version" (Join-Path $repoRoot $relative)
    if ($LASTEXITCODE -ne 0) { throw "Cannot read version: $relative" }
    if ($packageVersion -ne $Version) { throw "Version mismatch: $relative" }
}
if (-not $RuntimeSource) { $RuntimeSource = Join-Path $repoRoot 'build\runtime-cache\22.22.2\node-v22.22.2-win-x64' }
if (-not $InnoCompiler) { $InnoCompiler = Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe' }
foreach ($required in @((Join-Path $RuntimeSource 'node.exe'), (Join-Path $RuntimeSource 'LICENSE'), (Join-Path $RuntimeSource 'node_modules\npm\bin\npm-cli.js'), $InnoCompiler)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Build dependency missing: $required" }
}
$releaseDirectory = Join-Path $repoRoot 'release'
$stagingParent = Join-Path $repoRoot 'build\release-stage'
$appName = "device-debugger-$Version"
$stage = Join-Path $stagingParent $appName
function Reset-StagingDirectory([string]$Directory) {
    $full = [IO.Path]::GetFullPath($Directory)
    $allowed = [IO.Path]::GetFullPath((Join-Path $repoRoot 'build')) + '\'
    if (-not $full.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging cleanup path.' }
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
    $null = New-Item -ItemType Directory -Path $full -Force
}
function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$Directory) {
    Push-Location -LiteralPath $Directory
    try { & $Executable @Arguments; if ($LASTEXITCODE -ne 0) { throw "Native build command failed with exit code $LASTEXITCODE" } }
    finally { Pop-Location }
}
function Copy-Source([string]$Relative, [string]$Destination = '') {
    if (-not $Destination) { $Destination = $Relative }
    $target = Join-Path $stage $Destination
    $null = New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot $Relative) -Destination $target -Force
}
if (-not $SkipFrontendBuild) { Invoke-Checked $BuildNode @('node_modules\vite\bin\vite.js', 'build') (Join-Path $repoRoot 'frontend') }
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'frontend\dist\index.html'))) { throw 'Frontend dist is missing.' }
Reset-StagingDirectory $stage
$null = New-Item -ItemType Directory -Path $releaseDirectory -Force
foreach ($relative in @('backend\package.json', 'backend\package-lock.json', 'README.md', 'docs\USER_GUIDE.md', 'docs\VERSION_POLICY.md', 'scripts\start-services.ps1', 'scripts\stop.ps1')) { Copy-Source $relative }
$productionSources = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'backend\src') -Filter '*.js' -File | Where-Object { $_.Name -notmatch '\.test\.js$' -and $_.Name -match '^(android-|unity-|tool-access\.js$|version\.js$|index\.js$|server\.js$)' }
foreach ($file in $productionSources) { Copy-Source ('backend\src\' + $file.Name) }
$null = New-Item -ItemType Directory -Path (Join-Path $stage 'frontend') -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'frontend\dist') -Destination (Join-Path $stage 'frontend\dist') -Recurse
Copy-Source 'scripts\runtime-check.cjs' 'runtime\check.js'
Copy-Source 'scripts\release-start.cmd' '启动.cmd'
Copy-Source 'stop.bat' '关闭.cmd'
Copy-Item -LiteralPath (Join-Path $RuntimeSource 'node.exe') -Destination (Join-Path $stage 'runtime\node.exe')
Copy-Item -LiteralPath (Join-Path $RuntimeSource 'LICENSE') -Destination (Join-Path $stage 'runtime\NODE-LICENSE.txt')
$null = New-Item -ItemType Directory -Path (Join-Path $stage 'data') -Force
$npmArguments = @((Join-Path $RuntimeSource 'node_modules\npm\bin\npm-cli.js'), 'ci', '--omit=dev', '--ignore-scripts', '--offline', '--no-audit', '--no-fund')
Invoke-Checked (Join-Path $RuntimeSource 'node.exe') $npmArguments (Join-Path $stage 'backend')
Invoke-Checked (Join-Path $stage 'runtime\node.exe') @((Join-Path $stage 'runtime\check.js')) $stage
Invoke-Checked $BuildNode @((Join-Path $stage 'runtime\check.js')) $stage
# Frontend dependencies are bundled. Preserve their root licenses in addition to
# the complete backend production dependency license files installed by npm ci.
foreach ($name in @('vue', 'vue-router', 'qrcode', '@vue\runtime-core', '@vue\runtime-dom', '@vue\reactivity', '@vue\shared')) {
    $dependency = Join-Path $repoRoot ('frontend\node_modules\' + $name)
    foreach ($license in @(Get-ChildItem -LiteralPath $dependency -File | Where-Object { $_.Name -match '^LICENSE(?:\..*)?$' })) {
        $licenseDirectory = Join-Path $stage ('licenses\frontend\' + $name)
        $null = New-Item -ItemType Directory -Path $licenseDirectory -Force
        Copy-Item -LiteralPath $license.FullName -Destination (Join-Path $licenseDirectory $license.Name)
    }
}
$product = [ordered]@{ product = 'device-debugger'; version = $Version; branch = 'codex/device-debugger'; releaseTag = "device-debugger-v$Version"; features = @('android', 'unity-logs'); defaultPort = 3100 }
$product | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stage 'product.json') -Encoding UTF8
$zip = Join-Path $releaseDirectory "$appName.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -LiteralPath $stage -DestinationPath $zip -CompressionLevel Optimal
Invoke-Checked $InnoCompiler @('/Qp', "/DVersionValue=$Version", "/DAppSource=$stage", "/DReleaseOutput=$releaseDirectory", (Join-Path $repoRoot 'installer\device-debugger.iss')) $repoRoot
$installer = Join-Path $releaseDirectory "device-debugger-Setup-$Version.exe"
function Asset([string]$Path) { $file = Get-Item -LiteralPath $Path; return [ordered]@{ name = $file.Name; size = $file.Length; sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant(); url = "https://github.com/GuiYe314/team-toolbox/releases/download/device-debugger-v$Version/$($file.Name)" } }
$manifest = [ordered]@{ schema = 1; product = 'device-debugger'; version = $Version; branch = 'codex/device-debugger'; releaseTag = "device-debugger-v$Version"; portable = (Asset $zip); installer = (Asset $installer); features = @('android', 'unity-logs', 'unity-persistent-files', 'apk-package-info', 'apk-install-queue') }
$manifestPath = Join-Path $releaseDirectory 'device-debugger-manifest.json'
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$hashes = foreach ($file in @($zip, $installer, $manifestPath)) { $item = Get-Item -LiteralPath $file; '{0}  {1}  {2}' -f (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant(), $item.Length, $item.Name }
$hashes | Set-Content -LiteralPath (Join-Path $releaseDirectory "$appName-SHA256.txt") -Encoding ASCII
$audit = foreach ($file in $productionSources) { [ordered]@{ path = 'backend/src/' + $file.Name; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } }
@{ product = $product; sources = @($audit); stage = $stage; artifacts = @($manifest.portable, $manifest.installer) } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $repoRoot 'build\release-audit.json') -Encoding UTF8
Write-Host "[OK] Built Device Debugger $Version. Publish device-debugger-v$Version with make_latest=false."
Write-Host "[OK] Stage: $stage"
Write-Host "[OK] Assets: $releaseDirectory"
