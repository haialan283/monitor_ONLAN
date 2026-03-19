@echo off

set ADB_PATH=adb

echo ------------------------------------------
echo ALAN MONITOR - BAT WIFI ADB (TCP 5555)
echo ------------------------------------------

echo Dang quet thiet bi...

for /f "tokens=1" %%i in ('%ADB_PATH% devices ^| findstr /v "List" ^| findstr /v "emulator"') do (
    set DEVICE=%%i
)

echo Thiet bi duoc chon: %DEVICE%

echo Dang bat tcpip 5555...
%ADB_PATH% -s %DEVICE% tcpip 5555

echo.
echo Hoan tat.
pause