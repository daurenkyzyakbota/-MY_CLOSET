@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1" %*
set "MYCLOSET_EXIT=%ERRORLEVEL%"
if not "%MYCLOSET_EXIT%"=="0" (
  echo.
  echo MyCloset could not start. See the error and log path above.
  pause
)
exit /b %MYCLOSET_EXIT%
