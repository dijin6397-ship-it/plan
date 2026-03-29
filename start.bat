@echo off
chcp 65001 >nul
echo ========================================
echo    生产自动排程系统 启动脚本
echo ========================================
echo.

echo 正在检查Python环境...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到Python，请先安装Python 3.8+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo 正在安装依赖...
pip install flask flask-cors pandas openpyxl python-dateutil -q

echo.
echo 正在启动服务器...
echo 请在浏览器中访问: http://localhost:5000
echo 按 Ctrl+C 停止服务器
echo.
echo ========================================

python app.py

pause
