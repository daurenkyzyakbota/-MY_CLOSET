@echo off
chcp 65001 >nul
setlocal
set "MYCLOSET_NODE="
for %%N in (node.exe) do set "MYCLOSET_NODE=%%~$PATH:N"
if not defined MYCLOSET_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "MYCLOSET_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined MYCLOSET_NODE (
  echo Node.js was not found. Install Node.js 20 or newer and try again.
  pause
  exit /b 1
)
"%MYCLOSET_NODE%" "%~dp0site\server.mjs" --open --lan
if errorlevel 1 pause
endlocal
