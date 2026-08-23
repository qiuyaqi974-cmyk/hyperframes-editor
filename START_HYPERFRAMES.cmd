@echo off
if /i not "%~1"=="KEEP_OPEN" (
  start "HyperFrames Starter" cmd.exe /k call "%~f0" KEEP_OPEN
  exit /b 0
)
cd /d "%~dp0"
title HyperFrames Starter
echo ========================================
echo HyperFrames V4.0.1
echo This window will stay open if an error occurs.
echo ========================================
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Node.js was not found.
  echo Install Node.js, then double-click this file again.
  goto :END
)
if not exist node_modules (
  echo.
  echo First launch: installing required files...
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: Installation failed. Please screenshot this window.
    goto :END
  )
)
echo.
echo Starting HyperFrames...
call npm run dev -- --open
echo.
echo HyperFrames stopped. Please screenshot any error shown above.
:END
echo.
echo You can close this window after reading the message.
