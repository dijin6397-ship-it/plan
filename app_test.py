from flask import Flask, jsonify
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)

@app.route("/")
def index():
    return {
        "message": "测试应用部署成功！",
        "env_check": {
            "has_database_url": bool(os.environ.get("DATABASE_URL")),
            "has_postgres_url": bool(os.environ.get("POSTGRES_URL")),
        }
    }

@app.route("/health")
def health():
    return jsonify({"ok": True, "timestamp": "2026-04-29"})

@app.route("/test-db")
def test_db():
    """测试数据库连接"""
    try:
        import psycopg2
        db_url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
        if not db_url:
            return jsonify({"error": "No database URL configured"}), 500
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            result = cur.fetchone()
        conn.close()
        return jsonify({"ok": True, "db_connected": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
