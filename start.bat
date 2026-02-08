@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

set WEB_PORT=3000

if "%1"=="" goto menu
if "%1"=="start" goto do_start
if "%1"=="stop" goto do_stop
if "%1"=="status" goto do_status
goto menu

:menu
cls
echo.
echo ========================================
echo   Aeon - Service Manager
echo ========================================
echo.
echo   [1] Start Dev Server
echo   [2] Stop Dev Server
echo   [3] Check Status
echo   [4] Exit
echo.
echo ========================================
set /p choice="  Select option (1-4): "

if "%choice%"=="1" goto do_start
if "%choice%"=="2" goto do_stop
if "%choice%"=="3" goto do_status
if "%choice%"=="4" goto exit_clean
goto menu

:do_start
echo.
echo [INIT] Cleaning port %WEB_PORT%...
call :kill_port %WEB_PORT%
timeout /t 1 /nobreak >nul

if not exist "node_modules\" (
    echo [INIT] node_modules not found - installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [FAIL] npm install failed.
        goto back_to_menu
    )
    echo [OK] Dependencies installed.
    echo.
)

if not exist ".env.local" (
    echo.
    echo =============================================
    echo  WARNING: .env.local not found!
    echo =============================================
    echo  Copy .env.example to .env.local and fill in:
    echo    DATABASE_URL, AUTH_SECRET,
    echo    AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET
    echo =============================================
    echo.
    pause
)

echo Starting Next.js on port %WEB_PORT%...
start "Aeon-Dev" cmd /k "cd /d %~dp0 && call npx next dev --port %WEB_PORT%"

echo.
echo ========================================
echo   Aeon Started
echo ========================================
echo   Web:  http://localhost:%WEB_PORT%
echo ========================================
echo.
timeout /t 3 /nobreak >nul
start http://localhost:%WEB_PORT%
goto back_to_menu

:do_stop
echo.
echo Stopping Aeon...
call :kill_port %WEB_PORT%
taskkill /FI "WINDOWTITLE eq Aeon-Dev*" /F 2>nul
echo Done.
goto back_to_menu

:do_status
echo.
echo ========================================
echo   Port Status
echo ========================================
echo.
echo [%WEB_PORT%] Web:
call :show_status %WEB_PORT%
echo.
goto back_to_menu

:show_status
set "_p=%1"
set "_found=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%_p% " ^| findstr "LISTENING" 2^>nul') do (
    set "_found=1"
    echo   RUNNING - PID %%a
)
if "!_found!"=="0" echo   FREE
goto :eof

:kill_port
set "_p=%1"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%_p% " ^| findstr "LISTENING" 2^>nul') do (
    echo   Killing PID %%a on port %_p%...
    taskkill /PID %%a /F >nul 2>&1
)
goto :eof

:back_to_menu
echo.
pause
goto menu

:exit_clean
endlocal
exit /b 0
