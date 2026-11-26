@echo off
rem Dev helper: run all tests with portable Node and write summary to tools\summary.txt
setlocal
set "ROOT=%~dp0.."
set "PATH=%ROOT%\.tools\node-v22.23.5-win-x64;%PATH%"
cd /d "%ROOT%"
call node --disable-warning=ExperimentalWarning --test --test-concurrency=1 tests/core.test.js tests/save.test.js tests/server.test.js tests/account.test.js > "%ROOT%\tools\last.log" 2>&1
call node tools\summary.js
echo FINISHED %TIME% >> "%ROOT%\tools\summary.txt"
endlocal
