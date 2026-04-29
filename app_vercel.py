from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import os
from pathlib import Path

# 创建Flask应用
app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

# 配置
app.secret_key = os.environ.get("SECRET_KEY") or "dev-secret-key"

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

@app.route("/")
def index():
    """提供前端页面"""
    return send_from_directory(str(STATIC_DIR), "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    """提供静态文件"""
    return send_from_directory(str(STATIC_DIR), filename)

@app.route("/api/health")
def health():
    """健康检查"""
    return jsonify({"ok": True, "version": "vercel-optimized"})

@app.route("/api/login", methods=["POST"])
def login():
    """简化登录接口 - 先不连接数据库"""
    data = request.get_json(force=True) or {}
    username = data.get("username")
    password = data.get("password")
    
    # 临时：接受任意用户名密码，先让登录工作
    if username and password:
        return jsonify({
            "ok": True,
            "user": {
                "username": username,
                "role": "admin",
                "permissions": ["admin"]
            }
        })
    return jsonify({"error": "invalid credentials"}), 401

@app.route("/api/me")
def me():
    """获取当前用户信息"""
    return jsonify({
        "username": "test_user",
        "role": "admin",
        "permissions": ["admin"]
    })

# Vercel需要这个
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
