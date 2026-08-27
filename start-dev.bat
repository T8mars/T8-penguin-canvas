@echo off
chcp 65001 >nul
setlocal

title T8-penguin-canvas Dev Launcher
echo ==================================================
echo 🐧 T8-penguin-canvas 开发启动器 v1.0.0
echo ==================================================

REM 释放端口 11422 / 18766
echo [1/2] 检查并释放端口 11422 / 18766...
REM 只清理本核心目录的旧开发进程树和本地监听者，忽略远端端口、TIME_WAIT 与 PID 0。
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-local-dev-processes.ps1" -ProjectRoot "%~dp0."
if errorlevel 1 (
    echo [启动失败] 无法安全释放本地开发端口，请关闭旧的 T8 开发窗口后重试。
    pause
    exit /b 1
)

REM 按健康状态启动开发服务，避免前端先于后端发起 API 轮询
echo [2/2] 启动后端(18766)，健康后再启动前端(11422)...
cd /d "%~dp0"
start "T8 Backend" cmd /d /k "chcp 65001 >nul && npm run dev:backend"
node scripts\wait-for-local-service.cjs "http://127.0.0.1:18766/api/status" 60000 "后端"
if errorlevel 1 (
    echo.
    echo [启动失败] 后端未能正常启动，前端不会继续启动。
    echo 请查看 "T8 Backend" 窗口中的具体原因；若提示数据库被占用，请先关闭其他 T8 开发或 Electron 实例。
    pause
    exit /b 1
)

start "T8 Frontend" cmd /d /k "chcp 65001 >nul && npm run dev:vite"
node scripts\wait-for-local-service.cjs "http://127.0.0.1:11422/" 60000 "前端"
if errorlevel 1 (
    echo.
    echo [启动失败] 前端未能正常启动，请查看 "T8 Frontend" 窗口中的具体原因。
    pause
    exit /b 1
)

echo --------------------------------------------------
echo ✅ 已在新窗口启动:
echo    前端: http://127.0.0.1:11422
echo    后端: http://127.0.0.1:18766/api/status
echo --------------------------------------------------
start "" "http://127.0.0.1:11422"

endlocal
