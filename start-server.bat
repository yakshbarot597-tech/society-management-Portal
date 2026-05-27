@echo off
title Society Management Server
cd /d "%~dp0"
cd backend

echo ========================================
echo   Society Management Pro - Server
echo ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

:: --- Ensure PostgreSQL is running ---
echo Checking PostgreSQL service...
sc query postgresql-x64-18 >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=4" %%s in ('sc query postgresql-x64-18 ^| findstr "STATE"') do set PG_STATE=%%s
    if not "%PG_STATE%"=="RUNNING" (
        echo Starting postgresql-x64-18 service...
        net start postgresql-x64-18 >nul 2>&1
        timeout /t 3 /nobreak >nul
    )
) else (
    sc query postgresql-x64-13 >nul 2>&1
    if %errorlevel% equ 0 (
        for /f "tokens=4" %%s in ('sc query postgresql-x64-13 ^| findstr "STATE"') do set PG_STATE=%%s
        if not "%PG_STATE%"=="RUNNING" (
            echo Starting postgresql-x64-13 service...
            net start postgresql-x64-13 >nul 2>&1
            timeout /t 3 /nobreak >nul
        )
    )
)
echo PostgreSQL check done.
echo.

:: Check if port 5000 is already in use
netstat -ano | findstr ":5000" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo Server is already running on port 5000.
    echo Opening the application...
    start http://localhost:5000
    timeout /t 2
    exit /b 0
)

:: Install dependencies if node_modules doesn't exist
if not exist "node_modules\" (
    echo Installing dependencies...
    npm install
    echo.
)

echo Starting server on port 5000...
echo Press Ctrl+C to stop the server.
echo.
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5000"
node server.js

pause
