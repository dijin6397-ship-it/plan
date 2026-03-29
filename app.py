from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from scheduler import Scheduler

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = Flask(__name__)
CORS(app)


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.get("/")
def index():
    return send_from_directory(str(STATIC_DIR), "index.html")


@app.get("/<path:filename>")
def static_files(filename: str):
    return send_from_directory(str(STATIC_DIR), filename)


@app.post("/api/schedule")
def api_schedule():
    data = request.get_json(force=True) or {}
    phases = data.get("phases", [])
    start_time_str = data.get("startTime")
    if not start_time_str:
        return jsonify({"error": "startTime is required"}), 400
    start_time = datetime.fromisoformat(start_time_str)
    result = Scheduler().schedule(phases, start_time)
    return jsonify(result)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
