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

:: --- Ensure MySQL is running ---
echo Checking MySQL service...
sc query MySQL80 >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=4" %%s in ('sc query MySQL80 ^| findstr "STATE"') do set MYSQL_STATE=%%s
    if not "%MYSQL_STATE%"=="RUNNING" (
        echo Starting MySQL80 service...
        net start MySQL80 >nul 2>&1
        timeout /t 3 /nobreak >nul
    )
) else (
    sc query MySQL >nul 2>&1
    if %errorlevel% equ 0 (
        for /f "tokens=4" %%s in ('sc query MySQL ^| findstr "STATE"') do set MYSQL_STATE=%%s
        if not "%MYSQL_STATE%"=="RUNNING" (
            echo Starting MySQL service...
            net start MySQL >nul 2>&1
            timeout /t 3 /nobreak >nul
        )
    )
)
echo MySQL check done.
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
