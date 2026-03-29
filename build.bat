@echo off
chcp 65001 >nul
echo ========================================
echo    生产自动排程系统 - 打包脚本
echo ========================================
echo.

echo 正在检查Python环境...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到Python，请先安装Python 3.8+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo 正在安装PyInstaller...
pip install pyinstaller -q

echo 正在打包应用...
echo 这可能需要几分钟时间，请耐心等待...

pyinstaller --onefile --add-data "static;static" app.py

echo.
echo 打包完成！
echo 可执行文件位于: dist\app.exe
echo.
echo 你可以直接运行 dist\app.exe 来启动系统
echo.
echo ========================================

pause
