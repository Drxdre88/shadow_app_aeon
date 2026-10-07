@echo off
rem Weekly "my coding year" refresh for Windows Task Scheduler: rolling 365-day
rem extract + PR history + report into %USERPROFILE%\.aeon\git-stats\year\.
rem Optional first argument: a fixed --since date (YYYY-MM-DD).
setlocal
set "SCRIPT_DIR=%~dp0"
set "BASE=%USERPROFILE%\.aeon\git-stats"
set "OUT=%BASE%\year"
set "LOG_FILE=%BASE%\report.log"
if not exist "%OUT%" mkdir "%OUT%"
if exist "%LOG_FILE%" for %%A in ("%LOG_FILE%") do if %%~zA GTR 2000000 move /y "%LOG_FILE%" "%LOG_FILE%.1" >nul
set "SINCE=%~1"
if "%SINCE%"=="" for /f %%d in ('node -e "console.log(new Date(Date.now()-365*864e5).toISOString().slice(0,10))"') do set "SINCE=%%d"
cd /d "%SCRIPT_DIR%"
echo ==== %DATE% %TIME% run-report since %SINCE% >> "%LOG_FILE%"
call node "%SCRIPT_DIR%prs.mjs" --since %SINCE% --out "%OUT%\prs" >> "%LOG_FILE%" 2>&1 || goto :fail
call node "%SCRIPT_DIR%extract.mjs" --since %SINCE% --prs-dir "%OUT%\prs" --out "%OUT%\raw" >> "%LOG_FILE%" 2>&1 || goto :fail
call node "%SCRIPT_DIR%report.mjs" --raw "%OUT%\raw" --prs "%OUT%\prs" --out "%OUT%\report" >> "%LOG_FILE%" 2>&1 || goto :fail
echo ==== exit 0 >> "%LOG_FILE%"
endlocal & exit /b 0
:fail
set "RC=%ERRORLEVEL%"
echo ==== exit %RC% >> "%LOG_FILE%"
endlocal & exit /b %RC%
