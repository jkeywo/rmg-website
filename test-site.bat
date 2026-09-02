@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js 20 or newer is required.
  echo Download it from https://nodejs.org/ and run this file again.
  exit /b 1
)

for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 20 (
  echo ERROR: Node.js 20 or newer is required. Found version:
  node --version
  exit /b 1
)

set "GAME_SOURCE=%~1"
if "%GAME_SOURCE%"=="" set "GAME_SOURCE=games.neon"
if not exist "%GAME_SOURCE%" (
  echo ERROR: Game source not found: %GAME_SOURCE%
  exit /b 1
)

node -e "import('sharp').then(function(){process.exit(0)}).catch(function(){process.exit(1)})" >nul 2>nul
if errorlevel 1 (
  echo Installing pinned build tools. This is only needed on first use...
  call npm ci --cache .cache\npm --no-audit --no-fund
  if errorlevel 1 (
    echo ERROR: Could not install the build tools.
    exit /b 1
  )
)

echo Building local site from %GAME_SOURCE%...
node tools\build-site.mjs --source "%GAME_SOURCE%" --output .local-site --base-url http://127.0.0.1:4173/ --environment local
if errorlevel 1 (
  echo ERROR: The site build failed. The browser was not opened.
  exit /b 1
)

node tools\check-site.mjs .local-site
if errorlevel 1 (
  echo ERROR: The generated site failed validation. The browser was not opened.
  exit /b 1
)

node tools\serve-site.mjs --root .local-site --port 4173 --open true
exit /b %errorlevel%
