@echo off
setlocal EnableDelayedExpansion

rem ------------------------------------------
rem ALAN MONITOR - Enable WiFi ADB (TCP 5555)
rem Auto-select the USB device (exclude IP:5555 wifi serials).
rem Use when you plug USB cable.
rem ------------------------------------------

set "ADB_PATH=%ADB_PATH%"
if "%ADB_PATH%"=="" set "ADB_PATH=adb"

rem Wait a moment for adb to recognize device
echo [ALAN] Waiting for adb device...
%ADB_PATH% wait-for-device >nul 2>&1

set /a COUNT=0
set "USB_DEVICE="

for /f "tokens=1,2" %%S in ('%ADB_PATH% devices ^| findstr /v "List of devices"') do (
    set "SER=%%S"
    set "STATE=%%T"
    if /i "!STATE!"=="device" (
        rem Skip wifi serials like 10.24.37.127:5555 (contain ':')
        echo !SER! | findstr ":" >nul
        if errorlevel 1 (
            rem Skip emulator/device strings containing '.' (usually wifi IP)
            echo !SER! | findstr "." >nul
            if errorlevel 1 (
                set /a COUNT+=1
                if !COUNT! EQU 1 set "USB_DEVICE=!SER!"
            )
        )
    )
)

if !COUNT! EQU 0 (
    echo [ALAN] No USB device detected (or all detected devices look like WiFi/IP serials).
    echo         Run: adb devices
    exit /b 2
)

if !COUNT! GTR 1 (
    echo [ALAN] More than one USB device detected. Please specify serial manually.
    echo         Detected candidates: %ADB_PATH% devices
    exit /b 3
)

echo [ALAN] USB device selected: !USB_DEVICE!
echo [ALAN] Enabling tcpip:5555 ...
%ADB_PATH% -s !USB_DEVICE! tcpip 5555

echo [ALAN] Done.
exit /b 0

