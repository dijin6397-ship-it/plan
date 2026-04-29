@echo off
chcp 65001 >nul
echo ========================================
echo    生产自动排程系统 启动脚本
echo ========================================
echo.

echo 正在检查Python环境...
set "PY_CMD="
where python >nul 2>&1
if %errorlevel% equ 0 (
    set "PY_CMD=python"
) else (
    where py >nul 2>&1
    if %errorlevel% equ 0 (
        set "PY_CMD=py -3"
    )
)

if "%PY_CMD%"=="" (
    echo [错误] 未找到Python，请先安装Python 3.8+
    echo 下载地址: https://www.python.org/downloads/
    echo 安装时请勾选: Add python.exe to PATH
    pause
    exit /b 1
)

echo 正在安装依赖...
%PY_CMD% -m pip install --upgrade pip -q
%PY_CMD% -m pip install -r requirements.txt -q

echo.
echo 正在启动服务器...
echo 请在浏览器中访问: http://localhost:5000
echo 按 Ctrl+C 停止服务器
echo.
echo ========================================

%PY_CMD% app.py

pause
