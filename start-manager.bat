@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js が見つかりません。Node.js をインストールしてから再実行してください。
    pause
    exit /b 1
)
node tools\manager.js
pause
