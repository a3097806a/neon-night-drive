@echo off
rem Dev helper: run a command with the portable Node in .tools, log to tools\last.log
setlocal
set "ROOT=%~dp0.."
set "PATH=%ROOT%\.tools\node-v22.23.5-win-x64;%PATH%"
cd /d "%ROOT%"
call %* > "%ROOT%\tools\last.log" 2>&1
echo EXIT=%ERRORLEVEL%>> "%ROOT%\tools\last.log"
endlocal
