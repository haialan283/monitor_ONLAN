$ErrorActionPreference = 'Stop'

# ------------------------------------------
# ALAN MONITOR - Reconnect WiFi ADB devices by scanning LAN port 5555
#
# This helps when IP changes after moving to stage LAN (no USB).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\Reconnect_Wifi_ADB_scanLAN.ps1
#
# It scans within your current active IPv4 subnet.
# ------------------------------------------

function Get-ADBPath {
    if (Test-Path (Join-Path $PSScriptRoot 'adb.exe')) { return (Join-Path $PSScriptRoot 'adb.exe') }
    $candidates = @(
        "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
        "$env:USERPROFILE\AppData\Local\Android\Sdk\platform-tools\adb.exe",
        'adb.exe'
    )
    foreach ($c in $candidates) {
        if ($c -eq 'adb.exe') {
            $p = (Get-Command adb -ErrorAction SilentlyContinue)
            if ($p) { return 'adb' }
        } else {
            if (Test-Path $c) { return $c }
        }
    }
    throw "adb.exe not found."
}

function Get-ActiveIPv4AndPrefix {
    # pick interface used by default route
    $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $route) {
        $ipInfo = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
            $_.IPAddress -and $_.IPAddress -notlike '127.*'
        } | Select-Object -First 1
        return @($ipInfo.IPAddress, $ipInfo.PrefixLength)
    }
    $idx = $route.InterfaceIndex
    $ipInfo = Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
        $_.IPAddress -and $_.IPAddress -notlike '127.*'
    } | Select-Object -First 1
    return @($ipInfo.IPAddress, $ipInfo.PrefixLength)
}

function Test-PortOpen {
    param(
        [string]$Ip,
        [int]$Port,
        [int]$TimeoutMs = 200
    )
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect($Ip, $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if (-not $ok) { $client.Close(); return $false }
        $client.EndConnect($iar) | Out-Null
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

function IpToUint {
    param([string]$Ip)
    $parts = $Ip.Split('.') | ForEach-Object { [int]$_ }
    return (($parts[0] -shl 24) -bor ($parts[1] -shl 16) -bor ($parts[2] -shl 8) -bor $parts[3])
}

function UintToIp {
    param([uint32]$U)
    $a = ($U -shr 24) -band 255
    $b = ($U -shr 16) -band 255
    $c = ($U -shr 8) -band 255
    $d = $U -band 255
    return "$a.$b.$c.$d"
}

$adb = Get-ADBPath
$port = 5555

Write-Host "[ALAN] adb path: $adb" -ForegroundColor Cyan
Write-Host "[ALAN] Current adb devices before scan:" -ForegroundColor Cyan
& $adb devices | Write-Host

$ipAndPrefix = Get-ActiveIPv4AndPrefix
$localIp = $ipAndPrefix[0]
$prefix = [int]$ipAndPrefix[1]

if (-not $localIp -or -not $prefix) {
    throw "Could not determine local IPv4/prefix."
}

Write-Host "[ALAN] Local IPv4: $localIp /$prefix" -ForegroundColor Cyan

$localUint = IpToUint $localIp
$mask = if ($prefix -eq 0) { [uint32]0 } else { ([uint32]::MaxValue -shl (32 - $prefix)) }
$net = $localUint -band $mask
$bcast = $net -bor (([uint32]1 -shl (32 - $prefix)) - 1)

$start = $net + 1
$end = $bcast - 1

Write-Host "[ALAN] Scanning subnet range: $(UintToIp $start) - $(UintToIp $end) (TCP $port)" -ForegroundColor Yellow

$found = New-Object System.Collections.Generic.List[string]
$u = $start
while ($u -le $end) {
    $ip = UintToIp ([uint32]$u)
    if (Test-PortOpen -Ip $ip -Port $port -TimeoutMs 200) {
        Write-Host "[ALAN] Port open on ${ip}:${port} -> adb connect" -ForegroundColor Green
        & $adb connect "${ip}:$port" 2>&1 | Out-Null
        $found.Add($ip) | Out-Null
    }
    $u++
}

Write-Host "[ALAN] Scan done. Found ${($found.Count)} candidate IP(s)." -ForegroundColor Cyan
Write-Host "[ALAN] adb devices after scan:" -ForegroundColor Cyan
& $adb devices | Write-Host

