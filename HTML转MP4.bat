@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "HTML_FILE=%~1"
if not defined HTML_FILE (
  for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='HTML 文件 (*.html)|*.html'; if($d.ShowDialog() -eq 'OK'){$d.FileName}"`) do set "HTML_FILE=%%I"
)
if not defined HTML_FILE exit /b 0
where node >nul 2>nul
if errorlevel 1 (
  echo 没有检测到 Node.js，请先安装 Node.js。
  pause
  exit /b 1
)
if not exist node_modules (
  echo 第一次转换，正在自动安装所需文件，请稍等……
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node tools\html-to-mp4.mjs "%HTML_FILE%"
echo.
pause
