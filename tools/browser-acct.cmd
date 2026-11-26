@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"
"%ROOT%\.tools\node-v22.23.5-win-x64\node.exe" --disable-warning=ExperimentalWarning tools\browser-account.js > "%ROOT%\tools\browser-acct.log" 2>&1
echo EXIT=%ERRORLEVEL% >> "%ROOT%\tools\browser-acct.log"
endlocal
