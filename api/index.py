import sys
from pathlib import Path

# 将项目根目录加入Python路径
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# 导入Flask应用
from app import app

# Vercel Python运行时需要这个变量名
app_name = "app"  # 告诉Vercel WSGI应用在哪里

# 为了兼容，也提供handler
def handler(environ, start_response):
    return app(environ, start_response)
