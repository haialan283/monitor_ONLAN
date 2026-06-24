@echo off
setlocal EnableDelayedExpansion

rem ------------------------------------------
rem ALAN MONITOR - Enable WiFi ADB for ONE device
rem Usage:
rem   Enable_Wifi_ADB_to_IP.bat <WIFI_IP>
rem   Enable_Wifi_ADB_to_IP.bat <WIFI_IP> <USB_SERIAL>   (optional)
rem ------------------------------------------

if "%~1"=="" (
  echo [ALAN] Usage: Enable_Wifi_ADB_to_IP.bat ^<WIFI_IP^> [USB_SERIAL]
  exit /b 1
)

set "WIFI_IP=%~1"
set "USB_SERIAL_ARG=%~2"

rem Resolve adb.exe (works when this bat is placed into platform-tools folder)
set "ADB_PATH=%~dp0adb.exe"
if not exist "%ADB_PATH%" (
  set "ADB_PATH="
)

if "%ADB_PATH%"=="" (
  if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
    set "ADB_PATH=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
  ) else if exist "%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools\adb.exe" (
    set "ADB_PATH=%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools\adb.exe"
  ) else (
    set "ADB_PATH=adb"
  )
)

"%ADB_PATH%" version >nul 2>&1
if errorlevel 1 (
  echo [ALAN] Cannot run adb.exe. Set ADB_PATH correctly.
  exit /b 2
)

echo [ALAN] Current adb devices:
"%ADB_PATH%" devices

set "USB_SERIAL="
if not "%USB_SERIAL_ARG%"=="" (
  set "USB_SERIAL=%USB_SERIAL_ARG%"
  echo [ALAN] Using USB serial from argument: %USB_SERIAL%
) else (
  rem Auto-select first USB serial that is NOT an IP (no ':' and no '.')
  set "USB_SERIAL="
  for /f "tokens=1,2" %%S in ('"%ADB_PATH%" devices ^| findstr /v "List of devices"') do (
    set "SER=%%S"
    set "STATE=%%T"
    if /i "!STATE!"=="device" (
      echo !SER! | findstr ":" >nul
      if errorlevel 1 (
        echo !SER! | findstr "." >nul
        if errorlevel 1 (
          set "USB_SERIAL=!SER!"
          goto got_usb
        )
      )
    )
  )

  :got_usb
  if "%USB_SERIAL%"=="" (
    echo [ALAN] Could not auto-detect USB_SERIAL.
    echo         Please pass it explicitly as second argument.
    echo         Example:
    echo           Enable_Wifi_ADB_to_IP.bat %WIFI_IP% <USB_SERIAL>
    exit /b 3
  )
)

echo [ALAN] Enabling tcpip:5555 on USB device %USB_SERIAL% ...
"%ADB_PATH%" -s "%USB_SERIAL%" tcpip 5555 >nul 2>&1

echo [ALAN] Connecting to WiFi device %WIFI_IP%:5555 ...
"%ADB_PATH%" connect %WIFI_IP%:5555 >nul 2>&1

rem Wait until get-state becomes "device"
set "STATE="
for /l %%i in (1,1,20) do (
  for /f "usebackq delims=" %%S in (`"%ADB_PATH%" -s %WIFI_IP%:5555 get-state 2^>nul`) do set "STATE=%%S"
  if /i "%STATE%"=="device" (
    goto connected
  )
  timeout /t 1 /nobreak >nul
)

echo [ALAN] Still not connected to %WIFI_IP%:5555 after timeout.
echo [ALAN] adb devices now:
"%ADB_PATH%" devices
exit /b 4

:connected
echo [ALAN] Connected state: %STATE%
echo [ALAN] devices for WiFi target:
"%ADB_PATH%" -s %WIFI_IP%:5555 devices

exit /b 0

