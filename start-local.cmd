@echo off
setlocal
cd /d "%~dp0"
set "ACL_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%ACL_NODE%" goto run
set "ACL_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Please install it or open this project in Codex.
  pause
  exit /b 1
)
:run
"%ACL_NODE%" start-local.cjs
if errorlevel 1 pause
endlocal
