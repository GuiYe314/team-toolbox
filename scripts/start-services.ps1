param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [ValidateSet('Development', 'Release')][string]$Mode = 'Development',
    [ValidateSet('Local', 'Lan')][string]$AccessMode = 'Lan',
    [string]$NodeExecutable = 'node.exe',
    [ValidateRange(1, 65535)][int]$BackendPort = 3100,
    [ValidateRange(1, 65535)][int]$FrontendPort = 5174,
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 30,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$started = @()
$savedEnvironment = @{}

function Read-ServiceProcess($Service) {
    $Service.Process.Refresh()
    if ($Service.Process.HasExited) { throw "$($Service.Name) exited before startup completed. See $($Service.ErrorLog)" }
    $current = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $Service.Process.Id)
    if (-not $current -or $current.CreationDate -ne $Service.Created -or
        $current.ExecutablePath -ine $Service.Node -or
        $current.CommandLine -notmatch ('^\s*(?:"[^"]+"|\S+)\s+"' + [regex]::Escape($Service.Entry) + '"(?:\s|$)')) {
        throw "Cannot confirm the identity of $($Service.Name)."
    }
    return $current
}

function Start-LocalService($Spec, [string]$Node, [string]$Logs) {
    $Spec.OutputLog = Join-Path $Logs ($Spec.Name + '.log')
    $Spec.ErrorLog = Join-Path $Logs ($Spec.Name + '-error.log')
    foreach ($logFile in @($Spec.OutputLog, $Spec.ErrorLog)) {
        if (Test-Path -LiteralPath $logFile) { Move-Item -LiteralPath $logFile -Destination ($logFile + '.previous') -Force }
    }
    $process = Start-Process -FilePath $Node -ArgumentList (@(('"' + $Spec.Entry + '"')) + $Spec.Arguments) -WorkingDirectory $Spec.Directory -WindowStyle Hidden -RedirectStandardOutput $Spec.OutputLog -RedirectStandardError $Spec.ErrorLog -PassThru
    $Spec.Process = $process
    $Spec.StartTicks = $process.StartTime.ToUniversalTime().Ticks
    $Spec.Node = $Node
    # Register immediately so a later inspection failure still cleans up this child.
    $script:started += $Spec
    $metadata = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $process.Id)
    if (-not $metadata) { throw "$($Spec.Name) exited immediately; see $($Spec.ErrorLog)" }
    $Spec.Created = $metadata.CreationDate
    $null = Read-ServiceProcess $Spec
    Write-Host ("[info] Starting {0} (PID {1}); log: {2}" -f $Spec.Name, $process.Id, $Spec.OutputLog)
}

function Stop-NewServices {
    foreach ($service in $script:started) {
        try {
            $service.Process.Refresh()
            if (-not $service.Process.HasExited -and $service.Process.StartTime.ToUniversalTime().Ticks -eq $service.StartTicks) {
                $current = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $service.Process.Id)
                if ($current -and $current.ExecutablePath -ieq $service.Node -and
                    $current.CommandLine -match ('^\s*(?:"[^"]+"|\S+)\s+"' + [regex]::Escape($service.Entry) + '"(?:\s|$)') -and
                    (-not $service.Created -or $current.CreationDate -eq $service.Created)) {
                    # Vite can own an esbuild worker; stop this verified tree too.
                    $cleanupOutput = & taskkill.exe /PID $service.Process.Id /T /F 2>&1
                    if ($LASTEXITCODE -ne 0) { throw "Could not stop the verified process tree: $cleanupOutput" }
                    $null = $service.Process.WaitForExit(5000)
                }
            }
        } catch { Write-Host ("[warn] Could not clean up this launch's {0}: {1}" -f $service.Name, $_.Exception.Message) }
    }
}

try {
    $root = (Get-Item -LiteralPath $ProjectRoot).FullName.TrimEnd('\', '/')
    if (-not $PSBoundParameters.ContainsKey('AccessMode') -and $env:TT_ACCESS_MODE) {
        if ($env:TT_ACCESS_MODE -notmatch '^(Local|Lan)$') { throw 'TT_ACCESS_MODE must be Local or Lan.' }
        $AccessMode = $env:TT_ACCESS_MODE
    }
    $listenHost = if ($AccessMode -eq 'Lan') { '0.0.0.0' } else { '127.0.0.1' }
    if (-not $PSBoundParameters.ContainsKey('BackendPort') -and $env:PORT) { $BackendPort = [int]$env:PORT }
    if (-not $PSBoundParameters.ContainsKey('FrontendPort') -and $env:VITE_DEV_PORT) { $FrontendPort = [int]$env:VITE_DEV_PORT }
    if ($BackendPort -lt 1 -or $BackendPort -gt 65535 -or $FrontendPort -lt 1 -or $FrontendPort -gt 65535 -or ($Mode -eq 'Development' -and $BackendPort -eq $FrontendPort)) { throw 'Invalid service port configuration.' }
    $node = (Get-Command $NodeExecutable -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $services = @(@{ Name = 'backend'; Entry = Join-Path $root 'backend\src\index.js'; Directory = Join-Path $root 'backend'; Port = $BackendPort; Path = '/api/health'; Arguments = @() })
    if ($Mode -eq 'Development') {
        $services += @{ Name = 'frontend'; Entry = Join-Path $root 'frontend\node_modules\vite\bin\vite.js'; Directory = Join-Path $root 'frontend'; Port = $FrontendPort; Path = '/'; Arguments = @('--host', $listenHost, '--port', "$FrontendPort", '--strictPort') }
    }
    # Resolve every entry and reject occupied ports before starting any process.
    foreach ($service in $services) {
        if (-not (Test-Path -LiteralPath $service.Entry -PathType Leaf)) { throw "Missing service entry: $($service.Entry)" }
        if (@(Get-NetTCPConnection -State Listen -LocalPort $service.Port -ErrorAction SilentlyContinue).Count) {
            throw "Port $($service.Port) is already in use. This launch will not stop or hide the existing service."
        }
    }
    $logs = Join-Path $root 'logs'
    $null = New-Item -ItemType Directory -Path $logs -Force
    foreach ($name in @('HOST', 'PORT', 'VITE_DEV_HOST', 'VITE_DEV_PORT', 'NODE_ENV', 'TOOLBOX_ALLOW_LAN')) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    $env:HOST = $listenHost
    $env:TOOLBOX_ALLOW_LAN = if ($AccessMode -eq 'Lan') { '1' } else { '0' }
    $env:PORT = "$BackendPort"
    $env:VITE_DEV_HOST = $listenHost
    $env:VITE_DEV_PORT = "$FrontendPort"
    if ($Mode -eq 'Release') { $env:NODE_ENV = 'production' }
    foreach ($service in $services) { Start-LocalService $service $node $logs }

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastReason = 'Waiting for the services to listen.'
    do {
        $ready = $true
        foreach ($service in $services) {
            $null = Read-ServiceProcess $service
            $listener = @(Get-NetTCPConnection -State Listen -LocalPort $service.Port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $service.Process.Id })
            if (-not $listener.Count) { $ready = $false; continue }
            try {
                $response = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $service.Port + $service.Path) -UseBasicParsing -TimeoutSec 2 -MaximumRedirection 0
                if ($response.StatusCode -ne 200) { throw 'HTTP response was not 200.' }
                if ($service.Name -eq 'backend') {
                    $health = $response.Content | ConvertFrom-Json
                    if ($health.status -ne 'ok' -or $health.service -ne 'device-debugger-backend' -or $health.product -ne 'device-debugger') { throw 'Backend health check is not ready.' }
                }
            } catch { $ready = $false; $lastReason = $_.Exception.Message }
        }
        if ($ready) { break }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $ready) { throw "Services did not become ready in $TimeoutSeconds seconds. $lastReason" }
    foreach ($service in $services) { $null = Read-ServiceProcess $service }
    $url = 'http://127.0.0.1:' + $(if ($Mode -eq 'Release') { $BackendPort } else { $FrontendPort }) + '/'
    Write-Host "[info] Startup successful. Services are running in the background. $url"
    Write-Host "[info] Access mode: $AccessMode"
    if ($AccessMode -eq 'Lan') {
        $pagePort = if ($Mode -eq 'Release') { $BackendPort } else { $FrontendPort }
        $lanAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
            $_.AddressState -eq 'Preferred' -and ($_.IPAddress -match '^10\.' -or $_.IPAddress -match '^192\.168\.' -or $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[01])\.')
        } | Select-Object -ExpandProperty IPAddress -Unique)
        foreach ($address in $lanAddresses) { Write-Host "[info] LAN access: http://${address}:$pagePort/" }
        if (-not $lanAddresses.Count) { Write-Host '[warn] No private IPv4 address found. Connect to the LAN and restart.' }
    }
    Write-Host "[info] Use stop.bat / the packaged stop script to stop this project's services. Logs: $logs"
    if (-not $NoBrowser -and $env:TT_SKIP_BROWSER -ne '1') {
        try { Start-Process -FilePath $url -ErrorAction Stop | Out-Null }
        catch { Write-Host "[warn] Could not open the browser; visit $url manually." }
    }
    exit 0
} catch {
    Write-Host ("[ERROR] Startup failed: " + $_.Exception.Message)
    Stop-NewServices
    foreach ($service in $started) {
        foreach ($logFile in @($service.OutputLog, $service.ErrorLog)) {
            if ($logFile -and (Test-Path -LiteralPath $logFile)) {
                Write-Host "[info] Diagnostic log: $logFile"
                Get-Content -LiteralPath $logFile -Tail 12 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
            }
        }
    }
    exit 1
} finally {
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
