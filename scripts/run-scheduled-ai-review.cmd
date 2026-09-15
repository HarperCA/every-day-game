@echo off
chcp 65001 >nul
REM Scheduled AI competition review trigger.
REM CloudBase timer triggers do not fire in this environment
REM (see docs/admin-cloudbase.md), so a local scheduled task calls
REM the cloud function instead. Each run reviews one stale record.
REM When the queue is empty the function returns idle without
REM calling the model, so it costs no quota.

setlocal
set "PROJECT_ROOT=%~dp0.."
set "LOG_DIR=%PROJECT_ROOT%\.tmp"
set "LOG_FILE=%LOG_DIR%\ai-review.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo. >> "%LOG_FILE%"
echo ===== %date% %time% ===== >> "%LOG_FILE%"

"C:\Program Files\nodejs\node.exe" "%PROJECT_ROOT%\apps\admin\scripts\verify-admin-cloud.mjs" --scheduled-check >> "%LOG_FILE%" 2>&1

endlocal
