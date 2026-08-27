[CmdletBinding()]
param(
    [string]$ProjectRoot = '',
    [string]$PortList = '11422,18766'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}

$resolvedRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\', '/')
$ports = @(
    foreach ($value in $PortList.Split(',')) {
        $parsed = 0
        if ([int]::TryParse($value.Trim(), [ref]$parsed) -and $parsed -gt 0 -and $parsed -le 65535) {
            $parsed
        }
    }
)

if ($ports.Count -eq 0) {
    throw 'No valid local development ports were supplied.'
}

function Get-ProcessSnapshot {
    $snapshot = @{}
    foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        $snapshot[[int]$process.ProcessId] = $process
    }
    return $snapshot
}

function Test-DevProcess {
    param([object]$Process)

    if ($null -eq $Process) { return $false }
    $name = [string]$Process.Name
    if ($name -notin @('cmd.exe', 'node.exe', 'electron.exe')) { return $false }
    $command = [string]$Process.CommandLine
    if ([string]::IsNullOrWhiteSpace($command)) { return $false }

    return $command -match '(?i)npm(?:-cli\.js)?["'']?\s+(?:run\s+)?dev:(?:backend|vite)' -or
        $command -match '(?i)backend[\\/]src[\\/]server\.js' -or
        $command -match '(?i)vite(?:\.js)?(?:"|\s).*vite\.config\.ts'
}

function Test-ProjectDevSeed {
    param([object]$Process)

    if (-not (Test-DevProcess $Process)) { return $false }
    $command = [string]$Process.CommandLine
    return $command.IndexOf($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Test-LauncherShell {
    param([object]$Process)

    if ($null -eq $Process -or [string]$Process.Name -ne 'cmd.exe') { return $false }
    $command = [string]$Process.CommandLine
    return $command -match '(?i)^cmd\s+/d\s+/k\s+"chcp 65001 >nul && npm run dev:(?:backend|vite)"$'
}

function Get-RootDevProcessId {
    param(
        [int]$SeedId,
        [hashtable]$Snapshot
    )

    if (-not $Snapshot.ContainsKey($SeedId)) { return $SeedId }
    $current = $Snapshot[$SeedId]
    $rootId = [int]$current.ProcessId
    $visited = [System.Collections.Generic.HashSet[int]]::new()
    [void]$visited.Add($rootId)

    while ($true) {
        $parentId = [int]$current.ParentProcessId
        if ($parentId -le 0 -or $visited.Contains($parentId) -or -not $Snapshot.ContainsKey($parentId)) { break }
        $parent = $Snapshot[$parentId]
        if (-not (Test-DevProcess $parent)) { break }
        $rootId = $parentId
        $current = $parent
        [void]$visited.Add($parentId)
    }

    return $rootId
}

$reported = [System.Collections.Generic.HashSet[int]]::new()

for ($pass = 0; $pass -lt 2; $pass += 1) {
    $snapshot = Get-ProcessSnapshot
    $seedIds = [System.Collections.Generic.HashSet[int]]::new()

    foreach ($process in $snapshot.Values) {
        if ((Test-ProjectDevSeed $process) -or (Test-LauncherShell $process)) {
            [void]$seedIds.Add([int]$process.ProcessId)
        }
    }

    foreach ($connection in @(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue)) {
        $owner = [int]$connection.OwningProcess
        if ($owner -gt 0 -and $owner -ne $PID) {
            [void]$seedIds.Add($owner)
        }
    }

    $rootIds = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($seedId in $seedIds) {
        [void]$rootIds.Add((Get-RootDevProcessId -SeedId $seedId -Snapshot $snapshot))
    }

    foreach ($rootId in $rootIds) {
        if ($rootId -le 0 -or $rootId -eq $PID) { continue }
        if ($reported.Add($rootId)) {
            Write-Output " - stopping previous development process tree PID=$rootId"
        }
        $previousErrorPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'SilentlyContinue'
            & taskkill.exe /F /T /PID $rootId 2> $null | Out-Null
        } finally {
            $ErrorActionPreference = $previousErrorPreference
        }
    }

    if ($rootIds.Count -eq 0) { break }
    Start-Sleep -Milliseconds 350
}

exit 0
