param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'

try {
    $root = (Get-Item -LiteralPath $ProjectRoot).FullName.TrimEnd('\', '/')
    $services = @(
        @{ Name = 'backend'; Directory = Join-Path $root 'backend'; Command = 'start'; Entry = Join-Path $root 'backend\src\index.js' },
        @{ Name = 'frontend'; Directory = Join-Path $root 'frontend'; Command = 'run\s+dev'; Entry = Join-Path $root 'frontend\node_modules\vite\bin\vite.js' }
    )
    $processes = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'cmd.exe' OR Name = 'node.exe'")
    $targets = @()

    foreach ($process in $processes) {
        if (-not $process.CommandLine) { continue }

        foreach ($service in $services) {
            $matched = $false
            if ($process.Name -ieq 'cmd.exe') {
                # Match start.bat's launcher, including its exact project directory.
                # A port number or window title alone cannot identify this checkout.
                $pattern = '(?:^|\s)/(?:k|c)\s+"?\s*cd\s+/d\s+"?' +
                    [regex]::Escape($service.Directory) + '[\\/]?"?\s*&&\s*(?:call\s+)?npm(?:\.cmd)?\s+' +
                    $service.Command + '\s*"?\s*$'
                $matched = $process.CommandLine -match $pattern
            } elseif ($process.Name -ieq 'node.exe') {
                # Also accept an absolute entry point (Vite uses one under npm).
                # Only the script argument counts; unrelated arguments do not.
                $entryMatch = [regex]::Match($process.CommandLine,
                    '^\s*(?:"[^"]+"|\S+)\s+(?:--watch\s+)?(?:"([^"]+)"|(\S+))')
                if ($entryMatch.Success) {
                    $entry = $entryMatch.Groups[1].Value
                    if (-not $entry) { $entry = $entryMatch.Groups[2].Value }
                    if ([IO.Path]::IsPathRooted($entry)) {
                        $matched = [IO.Path]::GetFullPath($entry) -ieq $service.Entry
                        if ($matched -and $service.Name -eq 'frontend') {
                            $arguments = $process.CommandLine.Substring($entryMatch.Length).TrimStart()
                            # Vite uses the same executable for serve and build/preview.
                            # A build is not a background development service.
                            if ($arguments -match '^(?:"?)(build|preview|optimize)(?:"?)(?:\s|$)') { $matched = $false }
                        }
                    }
                }
            }
            if ($matched) {
                $targets += @{ Process = $process; Service = $service.Name }
                break
            }
        }
    }

    if ($targets.Count -eq 0) {
        Write-Host '[info] No running team-toolbox services found for this project folder.'
        exit 0
    }

    $failed = $false
    foreach ($target in $targets) {
        $original = $target.Process
        $current = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $($original.ProcessId)"
        # A parent may already have stopped this child. Never act on a reused PID.
        if (-not $current -or $current.CreationDate -ne $original.CreationDate) { continue }

        try {
            & taskkill.exe /PID $original.ProcessId /T /F
            if ($LASTEXITCODE -ne 0) {
                throw "taskkill failed with exit code $LASTEXITCODE"
            }
            Write-Host "[info] Stopped $($target.Service) (PID $($original.ProcessId))."
        } catch {
            $failed = $true
            Write-Host "[ERROR] Could not stop $($target.Service): $($_.Exception.Message)"
        }
    }

    if ($failed) { exit 1 }
    Write-Host '[info] team-toolbox stopped. Data files are kept.'
    exit 0
} catch {
    Write-Host "[ERROR] Unable to inspect project services: $($_.Exception.Message)"
    exit 1
}
