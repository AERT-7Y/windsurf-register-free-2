@echo off
chcp 65001 >nul

cd /d "%~dp0"

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Requesting admin privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

title Windsurf Manager

if not exist node_modules (
    echo [INFO] Installing dependencies...
    call npm install
)

echo [INFO] Starting Windsurf Manager (Admin)...
npx electron .
