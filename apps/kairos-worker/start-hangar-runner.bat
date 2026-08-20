@echo off
REM ── AI Hangar mission runner ──────────────────────────────────────────────
REM Start this on ANY machine that should execute missions. The runner dials
REM OUT to Aeon (no inbound ports, NAT/corp-network friendly) and runs agents
REM in the repos listed in repos.local.yaml on THIS machine.
REM
REM One-time setup on a new machine:
REM   1. copy repos.local.yaml.example -> repos.local.yaml, set THIS machine's
REM      repo paths (gitignored — never leaves the box).
REM   2. copy runner.env.example.bat -> runner.env.bat and put the Aeon API
REM      key in it (gitignored).
REM   3. double-click this file (or run it from a terminal to keep the log
REM      in front of you).
REM ─────────────────────────────────────────────────────────────────────────

cd /d "%~dp0"

if exist runner.env.bat (
  call runner.env.bat
) else (
  echo [runner] runner.env.bat not found — copy runner.env.example.bat and set the key.
  pause
  exit /b 1
)

if "%KAIROS_AEON_API_KEY%"=="" (
  echo [runner] KAIROS_AEON_API_KEY is empty — set it in runner.env.bat.
  pause
  exit /b 1
)

if "%AEON_BASE_URL%"=="" (
  echo [runner] AEON_BASE_URL is empty — set it in runner.env.bat ^(e.g. http://localhost:3000 or the prod URL^).
  pause
  exit /b 1
)
if "%KAIROS_MODE%"=="" set KAIROS_MODE=poll
if "%KAIROS_WORKER_PORT%"=="" set KAIROS_WORKER_PORT=8790
if "%KAIROS_POLL_INTERVAL_MS%"=="" set KAIROS_POLL_INTERVAL_MS=15000

echo [runner] mode=%KAIROS_MODE%  aeon=%AEON_BASE_URL%  port=%KAIROS_WORKER_PORT%
echo [runner] health: http://localhost:%KAIROS_WORKER_PORT%/health
echo [runner] Ctrl+C stops the runner. Missions in flight are killed cleanly.

npm run start
pause
