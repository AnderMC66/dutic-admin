@echo off
setlocal
set "ROOT=%~dp0.."
set "LOG=%USERPROFILE%\.dutic-wacon-bridge\listener-crash.log"

:loop
node "%ROOT%\src\interfaces\daemon\reminder-listener.mjs" >> "%LOG%" 2>&1
echo [%date% %time%] node salio (restart-loop), reintentando en 5s >> "%LOG%"
timeout /t 5 /nobreak >nul
goto loop
