$ErrorActionPreference = 'Stop'

# ------------------------------------------
# ALAN MONITOR - watch for USB cable
# When a new USB device appears, run:
#   adb -s <serial> tcpip 5555
#
# This script is designed to be launched by Task Scheduler.
# ------------------------------------------

$port = 5555
$intervalSec = 3
$debounceSec = 30

$adbPath = $env:ADB_PATH
if ([string]::IsNullOrWhiteSpace($adbPath)) { $adbPath = 'adb' }

function Get-UsbDeviceSerials {
    $out = & $adbPath devices 2>&1
    $lines = $out -split "`r?`n"
    $serials = @()
    foreach ($line in $lines) {
        if ($line -match '^\s*List of devices') { continue }
        if ($line -match '^\s*$') { continue }

        # Expected format: SERIAL <state>
        $m = [regex]::Match($line, '^\s*(\S+)\s+(device|unauthorized|offline)\s*$')
        if ($m.Success) {
            $serial = $m.Groups[1].Value
            $state = $m.Groups[2].Value
            if ($state -ne 'device') { continue }

            # Skip WiFi serials/IP-like values: contain ':' and/or '.'.
            if ($serial -match ':') { continue }
            if ($serial -match '\.') { continue }

            $serials += $serial
        }
    }
    return $serials | Select-Object -Unique
}

$lastEnabled = @{} # serial -> timestamp

while ($true) {
    try {
        $serials = Get-UsbDeviceSerials
        foreach ($s in $serials) {
            $now = Get-Date
            if ($lastEnabled.ContainsKey($s)) {
                $elapsed = ($now - $lastEnabled[$s]).TotalSeconds
                if ($elapsed -lt $debounceSec) { continue }
            }

            Write-Host "[ALAN] USB device detected: $s -> enabling tcpip:$port"
            & $adbPath -s $s tcpip $port | Out-Host
            $lastEnabled[$s] = $now
        }
    } catch {
        Write-Host "[ALAN] Watch error: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $intervalSec
}

