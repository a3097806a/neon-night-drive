@echo off
rem Dev helper: install Capacitor and generate the Android Gradle project (no Android SDK needed for this step)
setlocal
set "ROOT=%~dp0.."
set "PATH=%ROOT%\.tools\node-v22.23.5-win-x64;%PATH%"
set "NND_SERVER_URL=https://example.invalid"
cd /d "%ROOT%\mobile"
call npm install --no-audit --no-fund > "%ROOT%\tools\cap.log" 2>&1
call node prepare-www.js >> "%ROOT%\tools\cap.log" 2>&1
call npx cap add android >> "%ROOT%\tools\cap.log" 2>&1
echo DONE >> "%ROOT%\tools\cap.log"
where java >> "%ROOT%\tools\cap.log" 2>&1
endlocal
