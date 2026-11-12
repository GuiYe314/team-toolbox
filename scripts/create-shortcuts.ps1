param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = 'Stop'
$shell = $null
try {
    $root = (Resolve-Path -LiteralPath $ProjectRoot -ErrorAction Stop).Path
    $icons = Join-Path $root 'assets\icons\ico'
    $appLabel = '设备调试工具'
    $appIcon = Join-Path $icons 'device.ico'
    $stopIcon = Join-Path $icons 'stop.ico'
    foreach ($icon in @($appIcon, $stopIcon)) {
        if (-not (Test-Path -LiteralPath $icon -PathType Leaf)) { throw "图标缺失，请恢复完整项目：$icon" }
    }
    $startTarget = @('启动.cmd', 'start.bat') | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    $stopTarget = @('停止.cmd', '关闭.cmd', 'stop.bat') | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $startTarget -or -not $stopTarget) { throw '启动或关闭入口缺失，请恢复完整项目。' }
    $output = Join-Path $root '快捷方式'
    if (Test-Path -LiteralPath $output) {
        $item = Get-Item -LiteralPath $output -Force
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '快捷方式输出位置必须是普通文件夹。' }
    }
    $null = New-Item -ItemType Directory -Path $output -Force
    $entries = @(
        @{ Name = "启动$appLabel"; Target = $startTarget; Icon = $appIcon },
        @{ Name = "关闭$appLabel"; Target = $stopTarget; Icon = $stopIcon }
    )
    $shell = New-Object -ComObject WScript.Shell
    foreach ($entry in $entries) {
        $shortcutPath = Join-Path $output ($entry.Name + '.lnk')
        if ((Test-Path -LiteralPath $shortcutPath) -and ((Get-Item -LiteralPath $shortcutPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '不能覆盖链接类型的快捷方式文件。' }
        $link = $null
        try {
            $link = $shell.CreateShortcut($shortcutPath)
            $link.TargetPath = $entry.Target
            $link.Arguments = ''
            $link.WorkingDirectory = $root
            $link.IconLocation = $entry.Icon + ',0'
            $link.Description = $entry.Name + '；目录移动后请重新生成。'
            # 保留启动/停止脚本的可见错误提示；成功时仍由原启动器关闭窗口。
            $link.WindowStyle = 1
            $link.Save()
            Write-Host ('已生成：' + $shortcutPath)
        } finally {
            if ($null -ne $link) { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) }
        }
    }
    Write-Host '可将快捷方式复制到桌面。移动项目文件夹后，请重新运行本脚本。'
} catch {
    Write-Host ('创建快捷方式失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if ($null -ne $shell) { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
}
