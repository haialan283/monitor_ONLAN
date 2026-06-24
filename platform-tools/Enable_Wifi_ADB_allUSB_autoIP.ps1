$ErrorActionPreference = 'Stop'

# ------------------------------------------
# ALAN MONITOR - Enable WiFi ADB for ALL USB devices
# and auto-discover each device current IPv4 (so you don't pass WIFI_IP manually).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\Enable_Wifi_ADB_allUSB_autoIP.ps1
# ------------------------------------------

function Get-ADBPath {
    if (Test-Path (Join-Path $PSScriptRoot 'adb.exe')) { return (Join-Path $PSScriptRoot 'adb.exe') }
    # fallback: try local SDK common locations
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
    throw "adb.exe not found. Put this script next to platform-tools\\adb.exe or add adb to PATH."
}

function Get-UsbSerials {
    param([string]$ADB)
    $raw = & $ADB devices 2>&1
    $lines = $raw -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 }
    $serials = @()

    foreach ($line in $lines) {
        if ($line -match '^\s*List of devices' ) { continue }
        # Format: SERIAL<TAB>state
        $m = [regex]::Match($line, '^\s*(\S+)\s+(device|unauthorized|offline)\s*$')
        if ($m.Success) {
            $serial = $m.Groups[1].Value
            $state = $m.Groups[2].Value
            if ($state -ne 'device') { continue }

            # USB serial shouldn't look like IP:port or IP-ish values.
            if ($serial -match ':') { continue }
            if ($serial -match '\.') { continue }

            $serials += $serial
        }
    }

    return $serials | Select-Object -Unique
}

function ExtractFirstIPv4FromText {
    param([string]$Text)

    $regex = '(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)'
    $ips = [regex]::Matches($Text, $regex) | ForEach-Object { $_.Value } | Select-Object -Unique

    foreach ($ip in $ips) {
        if ($ip -like '127.*') { continue }
        if ($ip -like '169.254.*') { continue }
        if ($ip -eq '0.0.0.0') { continue }
        return $ip
    }
    return $null
}

$adb = Get-ADBPath
Write-Host "[ALAN] adb path: $adb" -ForegroundColor Cyan
Write-Host "[ALAN] Current adb devices:"
& $adb devices | Write-Host

$usbSerials = Get-UsbSerials -ADB $adb
if (-not $usbSerials -or $usbSerials.Count -eq 0) {
    throw "No USB devices detected. Plug at least one phone via USB and ensure adb recognizes it."
}

Write-Host "[ALAN] USB serials detected ($($usbSerials.Count)):" -ForegroundColor Cyan
$usbSerials | ForEach-Object { Write-Host " - $_" }

foreach ($s in $usbSerials) {
    Write-Host "[ALAN] [$s] enabling tcpip:5555 ..." -ForegroundColor Yellow
    & $adb -s $s tcpip 5555 | Out-Null

    # Discover current IPv4 from device (best effort).
    $ip = $null
    try {
        $ipOut = & $adb -s $s shell "ip -4 addr show" 2>&1
        $ip = ExtractFirstIPv4FromText -Text ($ipOut | Out-String)
    } catch {
        # ignore, fallback below
    }

    if (-not $ip) {
        try {
            $ipOut2 = & $adb -s $s shell "ifconfig" 2>&1
            $ip = ExtractFirstIPv4FromText -Text ($ipOut2 | Out-String)
        } catch {
            # ignore
        }
    }

    if (-not $ip) {
        Write-Host "[ALAN] [$s] Could not auto-discover IPv4 from device. Please find IP and run adb connect manually." -ForegroundColor Red
        continue
    }

    Write-Host "[ALAN] [$s] discovered IP: $ip" -ForegroundColor Green
    Write-Host "[ALAN] [$s] connecting to $ip:5555 ..." -ForegroundColor Yellow
    & $adb connect "$ip:5555" | Out-Null

    # Wait briefly for state.
    for ($i=0; $i -lt 10; $i++) {
        $state = (& $adb -s "$ip:5555" get-state 2>&1 | Out-String).Trim()
        if ($state -eq 'device') { break }
        Start-Sleep -Seconds 1
    }
}

Write-Host "[ALAN] Done. Final adb devices:" -ForegroundColor Cyan
& $adb devices | Write-Host

