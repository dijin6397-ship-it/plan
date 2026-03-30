from datetime import datetime
from pathlib import Path
import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from threading import Lock
import urllib.request
import urllib.error

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from scheduler import Scheduler

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
STATE_FILE = DATA_DIR / "state.json"
_state_lock = Lock()
POSTGRES_URL = os.environ.get("POSTGRES_URL")
KV_REST_API_URL = os.environ.get("KV_REST_API_URL")

KV_REST_API_TOKEN = os.environ.get("KV_REST_API_TOKEN")
KV_STATE_KEY = os.environ.get("STATE_KV_KEY", "plan_state")

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


def _default_state():
    return {
        "revision": 0,
        "updatedAt": datetime.utcnow().isoformat(),
        "templates": {},
        "teams": [],
        "trainPlans": [],
    }

def _use_postgres():
    return bool(POSTGRES_URL)

def _get_pg_connection():
    return psycopg2.connect(POSTGRES_URL, cursor_factory=RealDictCursor)

def _init_pg_db():
    if not _use_postgres():
        return
    try:
        with _get_pg_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS app_state (
                        id VARCHAR(50) PRIMARY KEY,
                        revision INTEGER NOT NULL,
                        updated_at VARCHAR(100) NOT NULL,
                        data JSONB NOT NULL
                    )
                """)
                cur.execute("SELECT id FROM app_state WHERE id = %s", (KV_STATE_KEY,))
                if not cur.fetchone():
                    default_state_data = _default_state()
                    cur.execute("""
                        INSERT INTO app_state (id, revision, updated_at, data)
                        VALUES (%s, %s, %s, %s)
                    """, (KV_STATE_KEY, default_state_data['revision'], default_state_data['updatedAt'], json.dumps(default_state_data)))
            conn.commit()
    except Exception as e:
        print(f"Error initializing Postgres DB: {e}")

# Initialize DB on startup
_init_pg_db()

def _use_kv():
    return bool(KV_REST_API_URL and KV_REST_API_TOKEN)


def _kv_pipeline(commands):
    url = KV_REST_API_URL.rstrip("/") + "/pipeline"
    body = json.dumps(commands, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {KV_REST_API_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        payload = resp.read().decode("utf-8")
    return json.loads(payload) if payload else None


def _kv_get(key: str):
    res = _kv_pipeline([["GET", key]])
    if isinstance(res, list) and res:
        first = res[0]
        if isinstance(first, dict):
            return first.get("result")
    return None


def _kv_set(key: str, value: str):
    _kv_pipeline([["SET", key, value]])


def _load_state():
    if _use_postgres():
        try:
            with _get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT data, revision, updated_at FROM app_state WHERE id = %s", (KV_STATE_KEY,))
                    row = cur.fetchone()
                    if row:
                        data = row['data']
                        data['revision'] = row['revision']
                        data['updatedAt'] = row['updated_at']
                        return data
                    return _default_state()
        except Exception as e:
            print(f"Error loading from Postgres: {e}")
            return _default_state()
    elif _use_kv():
        try:
            raw = _kv_get(KV_STATE_KEY)
            if not raw:
                return _default_state()
            data = json.loads(raw) if isinstance(raw, str) and raw.strip() else {}
        except Exception:
            return _default_state()
    else:
        if not STATE_FILE.exists():
            return _default_state()
        try:
            raw = STATE_FILE.read_text(encoding="utf-8")
            data = json.loads(raw) if raw.strip() else {}
        except Exception:
            return _default_state()

    try:
        state = _default_state()
        if isinstance(data, dict):
            state.update({k: v for k, v in data.items() if k in state})
            if isinstance(data.get("revision"), int):
                state["revision"] = data["revision"]
            if isinstance(data.get("templates"), dict):
                state["templates"] = data["templates"]
            if isinstance(data.get("teams"), list):
                state["teams"] = data["teams"]
            if isinstance(data.get("trainPlans"), list):
                state["trainPlans"] = data["trainPlans"]
            if isinstance(data.get("updatedAt"), str):
                state["updatedAt"] = data["updatedAt"]
        return state
    except Exception:
        return _default_state()


def _save_state(state: dict):
    if _use_postgres():
        try:
            with _get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE app_state
                        SET revision = %s, updated_at = %s, data = %s
                        WHERE id = %s
                    """, (state['revision'], state['updatedAt'], json.dumps(state), KV_STATE_KEY))
                conn.commit()
            return
        except Exception as e:
            print(f"Error saving to Postgres: {e}")
            raise

    if _use_kv():
        _kv_set(KV_STATE_KEY, json.dumps(state, ensure_ascii=False))
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STATE_FILE)


@app.get("/api/state")
def api_get_state():
    with _state_lock:
        return jsonify(_load_state())


@app.put("/api/state")
def api_put_state():
    incoming = request.get_json(force=True) or {}
    if not isinstance(incoming, dict):
        return jsonify({"error": "invalid payload"}), 400

    with _state_lock:
        current = _load_state()
        incoming_revision = incoming.get("revision")
        if incoming_revision is not None and incoming_revision != current.get("revision"):
            return jsonify({"error": "revision conflict", "state": current}), 409

        if isinstance(incoming.get("templates"), dict):
            current["templates"] = incoming["templates"]
        if isinstance(incoming.get("teams"), list):
            current["teams"] = incoming["teams"]
        if isinstance(incoming.get("trainPlans"), list):
            current["trainPlans"] = incoming["trainPlans"]

        current["revision"] = int(current.get("revision") or 0) + 1
        current["updatedAt"] = datetime.utcnow().isoformat()
        try:
            _save_state(current)
            return jsonify(current)
        except Exception as e:
            return jsonify({"error": "state save failed", "detail": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
