@echo off
echo Installing fhosts native messaging host...

:: Add registry key for Firefox native messaging
reg add "HKEY_CURRENT_USER\Software\Mozilla\NativeMessagingHosts\fhosts_proxy" /ve /t REG_SZ /d "%~dp0fhosts_proxy.json" /f

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Installation successful!
    echo The fhosts proxy has been registered with Firefox.
    echo.
    echo Note: You may need to restart Firefox for changes to take effect.
) else (
    echo.
    echo Installation failed. Please run as administrator if needed.
)

pause
