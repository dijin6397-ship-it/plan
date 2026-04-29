from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import os
from pathlib import Path

# 创建Flask应用 - 极简版本用于测试Vercel部署
app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

app.secret_key = os.environ.get("SECRET_KEY") or "dev-secret-key-123"

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
    return jsonify({"ok": True, "version": "vercel-test", "message": "部署成功！"})

@app.route("/api/login", methods=["POST"])
def login():
    """测试登录接口"""
    data = request.get_json(force=True) or {}
    username = data.get("username")
    password = data.get("password")
    
    # 临时：接受任意登录
    if username and password:
        return jsonify({
            "ok": True,
            "user": {
                "username": username,
                "role": "admin",
                "permissions": ["admin", "data:view", "data:edit"]
            }
        })
    return jsonify({"error": "invalid credentials"}), 401

@app.route("/api/me")
def me():
    """获取当前用户"""
    return jsonify({
        "username": "test_admin",
        "role": "admin",
        "permissions": ["admin", "data:view", "data:edit"]
    })

# Vercel入口
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
