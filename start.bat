@echo off
cd /d "%~dp0"
title Aeon Dev Server

echo.
echo  =============================
echo    AEON - Project Timelines
echo  =============================
echo.

if not exist "node_modules\" (
    echo  [*] node_modules not found - installing dependencies...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo  [FAIL] npm install failed. Check Node.js is installed.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Dependencies installed.
    echo.
) else (
    echo  [OK] Dependencies found.
)

if not exist ".env.local" (
    echo.
    echo  =============================================
    echo   WARNING: .env.local not found!
    echo  =============================================
    echo.
    echo   Copy .env.example to .env.local and fill in:
    echo.
    echo     DATABASE_URL=postgresql://...
    echo     AUTH_SECRET=(generate: openssl rand -base64 32)
    echo     AUTH_GOOGLE_ID=your-google-client-id
    echo     AUTH_GOOGLE_SECRET=your-google-secret
    echo     ADMIN_EMAILS=your@gmail.com
    echo.
    echo   Auth will NOT work without these.
    echo  =============================================
    echo.
    pause
)

echo  [*] Starting dev server...
echo  [*] http://localhost:3000
echo.

call npm run dev
