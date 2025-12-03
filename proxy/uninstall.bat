@echo off
echo Uninstalling fhosts native messaging host...

:: Remove registry key
reg delete "HKEY_CURRENT_USER\Software\Mozilla\NativeMessagingHosts\fhosts_proxy" /f

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Uninstallation successful!
) else (
    echo.
    echo Uninstallation failed or key did not exist.
)

pause
