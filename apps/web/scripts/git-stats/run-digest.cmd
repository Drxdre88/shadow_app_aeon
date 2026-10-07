@echo off
rem Nightly git digest for Windows Task Scheduler. Appends to %USERPROFILE%\.aeon\git-stats\digest.log (rotated at ~2 MB).
setlocal
set "SCRIPT_DIR=%~dp0"
set "LOG_DIR=%USERPROFILE%\.aeon\git-stats"
set "LOG_FILE=%LOG_DIR%\digest.log"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if exist "%LOG_FILE%" for %%A in ("%LOG_FILE%") do if %%~zA GTR 2000000 move /y "%LOG_FILE%" "%LOG_FILE%.1" >nul
cd /d "%SCRIPT_DIR%"
echo ==== %DATE% %TIME% run-digest %* >> "%LOG_FILE%"
call node "%SCRIPT_DIR%digest.mjs" %* >> "%LOG_FILE%" 2>&1
set "RC=%ERRORLEVEL%"
echo ==== exit %RC% >> "%LOG_FILE%"
endlocal & exit /b %RC%
