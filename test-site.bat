@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js 20 or newer is required.
  exit /b 1
)
for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 20 (
  echo ERROR: Node.js 20 or newer is required.
  exit /b 1
)
set "GAME_SOURCE=%~1"
if "%GAME_SOURCE%"=="" set "GAME_SOURCE=games.neon"
node tools\serve-site.mjs --source "%GAME_SOURCE%" --port 4173 --open true
exit /b %errorlevel%
