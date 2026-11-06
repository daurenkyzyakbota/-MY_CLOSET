[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [ValidateRange(1024, 65535)]
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localDirectory = Join-Path $projectRoot '.local'
$stateFile = Join-Path $localDirectory 'local-server.json'
$dependencyFile = Join-Path $localDirectory 'dependencies.sha256'
$serverLog = $null
$serverErrorLog = $null
$startupLock = $null
$ownsLock = $false

function Test-PortOpen([int]$SitePort) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connection = $client.ConnectAsync('127.0.0.1', $SitePort)
    return $connection.Wait(300) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Get-LocalServerProcess([int]$SitePort) {
  $listenerIds = @()
  try {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $SitePort -ErrorAction Stop)
    foreach ($listener in $listeners) {
      if ($listener.OwningProcess -gt 0) { $listenerIds += [int]$listener.OwningProcess }
    }
  } catch {
    # Some Windows network providers omit loopback listeners in this cmdlet.
  }
  if (-not $listenerIds.Count) {
    try {
      $connections = & netstat.exe -ano -p tcp
      foreach ($line in $connections) {
        $fields = $line.Trim() -split '\s+'
        if (
          $fields.Count -eq 5 -and
          $fields[0] -ceq 'TCP' -and
          $fields[1] -match ":$SitePort`$" -and
          $fields[2] -match ':0$' -and
          $fields[4] -match '^\d+$'
        ) {
          $listenerIds += [int]$fields[4]
        }
      }
    } catch {
      # No privileged access or process termination is attempted.
    }
  }
  # Next 16 writes its verified dev-server PID and port into a shared lockfile.
  # This also works when Windows' loopback bridge hides a listener from netstat.
  $devLockPath = Join-Path $projectRoot '.next\dev\lock'
  $lockStream = $null
  $lockReader = $null
  try {
    if (Test-Path -LiteralPath $devLockPath) {
      $lockStream = [System.IO.File]::Open(
        $devLockPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
        ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
      )
      if ($lockStream.Length -le 4096) {
        $lockReader = New-Object System.IO.StreamReader($lockStream, [System.Text.Encoding]::UTF8)
        $devInfo = $lockReader.ReadToEnd() | ConvertFrom-Json
        if ($devInfo.port -eq $SitePort -and $devInfo.pid -gt 0) {
          $listenerIds += [int]$devInfo.pid
        }
      }
    }
  } catch {
    # Stale, locked or malformed metadata is ignored; the PID is still checked below.
  } finally {
    if ($lockReader) { $lockReader.Dispose() }
    elseif ($lockStream) { $lockStream.Dispose() }
  }
  foreach ($listenerId in ($listenerIds | Select-Object -Unique)) {
    try {
      $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerId" -ErrorAction Stop
      if (
        $processInfo.Name -ieq 'node.exe' -and
        $processInfo.CommandLine -and
        $processInfo.CommandLine.Replace('/', '\').IndexOf($projectRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $processInfo.CommandLine -match 'next[\\/]dist[\\/]'
      ) {
        return $processInfo
      }
    } catch {
      # An inaccessible or unrelated process is never trusted or terminated.
    }
  }
  return $null
}

function Test-MyClosetServer([int]$SitePort) {
  $address = "http://localhost:$SitePort"
  try {
    $healthResponse = Invoke-WebRequest -UseBasicParsing -Uri "$address/api/health" -TimeoutSec 3 -MaximumRedirection 0
    if ($healthResponse.StatusCode -ne 200) { return $false }
    $healthContent = $healthResponse.Content
    if ($healthContent -is [byte[]]) {
      $healthContent = [System.Text.Encoding]::UTF8.GetString($healthContent)
    }
    $health = $healthContent | ConvertFrom-Json
    if ($health.status -ne 'ok') { return $false }
    $manifestResponse = Invoke-WebRequest -UseBasicParsing -Uri "$address/manifest.webmanifest" -TimeoutSec 3 -MaximumRedirection 0
    if ($manifestResponse.StatusCode -ne 200) { return $false }
    $manifestContent = $manifestResponse.Content
    if ($manifestContent -is [byte[]]) {
      # Windows PowerShell treats application/manifest+json as binary.
      $manifestContent = [System.Text.Encoding]::UTF8.GetString($manifestContent)
    }
    $manifest = $manifestContent | ConvertFrom-Json
    return (
      $manifest.short_name -ceq 'MyCloset' -and
      $manifest.name -match 'MyCloset' -and
      $manifest.start_url -ceq '/' -and
      $manifest.scope -ceq '/'
    )
  } catch {
    return $false
  }
}

function Save-ServerState([int]$SitePort) {
  $processInfo = Get-LocalServerProcess $SitePort
  if (-not $processInfo) {
    throw 'The listening server could not be verified as this MyCloset folder.'
  }
  @{
    project = $projectRoot
    port = $SitePort
    processId = [int]$processInfo.ProcessId
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
}

function Open-MyCloset([int]$SitePort) {
  $address = "http://localhost:$SitePort"
  Write-Host "MyCloset is ready: $address" -ForegroundColor Green
  Write-Host 'The local server keeps running in the background until this computer is restarted.'
  if (-not $NoBrowser) {
    try {
      Start-Process -FilePath $address
    } catch {
      throw "The site is running, but Windows could not open the browser. Open $address manually."
    }
  }
}

try {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'package.json'))) {
    throw 'Keep this launcher inside the complete MyCloset project folder.'
  }
  New-Item -ItemType Directory -Path $localDirectory -Force | Out-Null
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $rootBytes = [System.Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant())
    $lockName = 'Local\MyClosetLauncher_' + ([System.BitConverter]::ToString($sha.ComputeHash($rootBytes))).Replace('-', '')
  } finally {
    $sha.Dispose()
  }
  $startupLock = New-Object System.Threading.Mutex($false, $lockName)
  try {
    $ownsLock = $startupLock.WaitOne(30000)
  } catch [System.Threading.AbandonedMutexException] {
    $ownsLock = $true
  }
  if (-not $ownsLock) {
    throw 'Another launcher is already preparing this folder. Wait for it, then try again.'
  }

  $preferredPort = $Port
  if (-not $PSBoundParameters.ContainsKey('Port') -and (Test-Path -LiteralPath $stateFile)) {
    try {
      $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
      if ($saved.project -ieq $projectRoot -and $saved.port -ge 1024 -and $saved.port -le 65535) {
        # Keeping the last chosen origin also keeps this browser's local wardrobe.
        $preferredPort = [int]$saved.port
      }
    } catch {
      # An incomplete state file is harmless; use the requested/default port.
    }
  }

  $selectedPort = $null
  $lastPort = [Math]::Min(65535, $preferredPort + 20)
  for ($candidate = $preferredPort; $candidate -le $lastPort; $candidate++) {
    if (-not (Test-PortOpen $candidate)) {
      $selectedPort = $candidate
      break
    }
    $existing = Get-LocalServerProcess $candidate
    if ($existing) {
      Write-Host "Checking the running MyCloset server on port $candidate..."
      $existingDeadline = (Get-Date).AddSeconds(30)
      do {
        if (Test-MyClosetServer $candidate) {
          Save-ServerState $candidate
          Open-MyCloset $candidate
          exit 0
        }
        Start-Sleep -Milliseconds 500
      } while ((Get-Date) -lt $existingDeadline -and (Test-PortOpen $candidate))
      throw "MyCloset is already using port $candidate, but it is not responding. Check its server logs or restart this computer."
    }
    Write-Host "Port $candidate belongs to another program; leaving it running."
  }
  if ($null -eq $selectedPort) {
    throw "No free port was found between $preferredPort and $lastPort. Use -Port with a different starting port."
  }
  if ($selectedPort -ne $Port) {
    Write-Host "Using port $selectedPort. Different site addresses have separate local browser data."
  }

  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $nodeCommand -or -not $npmCommand) {
    throw 'Install Node.js 24 from https://nodejs.org/, then open this launcher again.'
  }
  $nodeVersion = & $nodeCommand.Source --version
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') {
    throw 'This project requires Node.js 24. Install that version, then open this launcher again.'
  }
  $nextBinary = Join-Path $projectRoot 'node_modules\next\dist\bin\next'
  $lockFile = Join-Path $projectRoot 'package-lock.json'
  if (-not (Test-Path -LiteralPath $lockFile)) {
    throw 'package-lock.json is missing. Restore the complete MyCloset project folder.'
  }
  $dependencyHash = (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash + ':' +
    (Get-FileHash -LiteralPath (Join-Path $projectRoot 'package.json') -Algorithm SHA256).Hash
  $savedDependencyHash = ''
  if (Test-Path -LiteralPath $dependencyFile) {
    $savedDependencyHash = (Get-Content -LiteralPath $dependencyFile -Raw).Trim()
  }
  $needsInstall = -not (Test-Path -LiteralPath $nextBinary) -or
    -not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\react\package.json')) -or
    -not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\@neondatabase\auth\package.json')) -or
    ($savedDependencyHash -and $savedDependencyHash -ne $dependencyHash)
  if ($needsInstall) {
    $installLog = Join-Path $localDirectory 'install.log'
    Write-Host 'Installing the project dependencies. The first launch needs an internet connection...'
    Push-Location -LiteralPath $projectRoot
    try {
      $previousErrorPreference = $ErrorActionPreference
      try {
        # Windows PowerShell 5 must not treat npm's ordinary stderr warnings
        # as a terminating error. The command's exit code decides success.
        $ErrorActionPreference = 'Continue'
        & $npmCommand.Source ci *> $installLog
        $installExitCode = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $previousErrorPreference
      }
      if ($installExitCode -ne 0) {
        throw "Dependency installation failed. See $installLog"
      }
    } finally {
      Pop-Location
    }
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $serverLog = Join-Path $localDirectory "server-$selectedPort-$stamp.log"
  $serverErrorLog = Join-Path $localDirectory "server-$selectedPort-$stamp.error.log"
  Write-Host "Starting MyCloset on http://localhost:$selectedPort ..."
  $server = Start-Process -FilePath $nodeCommand.Source -ArgumentList @(
    "`"$nextBinary`"", 'dev', '--hostname', '0.0.0.0', '--port', "$selectedPort"
  ) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrorLog -PassThru
  $deadline = (Get-Date).AddSeconds(120)
  do {
    if (Test-MyClosetServer $selectedPort) {
      Save-ServerState $selectedPort
      Set-Content -LiteralPath $dependencyFile -Value $dependencyHash -Encoding ASCII
      Open-MyCloset $selectedPort
      exit 0
    }
    $server.Refresh()
    if ($server.HasExited) {
      throw 'The local server stopped during startup.'
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw 'The server did not become ready within two minutes. It was left running; check the logs before trying again.'
} catch {
  Write-Host ''
  Write-Host ('MyCloset: ' + $_.Exception.Message) -ForegroundColor Red
  if ($serverLog) { Write-Host "Server log: $serverLog" }
  if ($serverErrorLog) { Write-Host "Error log: $serverErrorLog" }
  Write-Host "Local state and logs: $localDirectory"
  exit 1
} finally {
  if ($ownsLock -and $startupLock) { $startupLock.ReleaseMutex() }
  if ($startupLock) { $startupLock.Dispose() }
}
