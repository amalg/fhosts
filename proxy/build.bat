@echo off
echo Building fhosts-proxy...

cd /d "%~dp0"

:: Build for Windows
go build -ldflags="-s -w" -o fhosts-proxy.exe .

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Build successful!
    echo Output: %~dp0fhosts-proxy.exe
    echo.
    for %%A in (fhosts-proxy.exe) do echo Size: %%~zA bytes
) else (
    echo.
    echo Build failed!
)

pause
