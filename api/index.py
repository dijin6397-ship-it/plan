import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# 导入Flask应用实例
from app import app

# Vercel Python运行时会自动识别 `app` 作为WSGI应用
# 不需要额外的handler类，直接导出app即可
