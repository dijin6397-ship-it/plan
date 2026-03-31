from datetime import datetime
from pathlib import Path
from functools import wraps
import os
import json
import base64
import hashlib
import hmac
import secrets
import time
import psycopg2
from psycopg2.extras import RealDictCursor
from threading import Lock
import urllib.request
import urllib.error

from flask import Flask, jsonify, request, send_from_directory, session
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

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
SECRET_KEY = os.environ.get("SECRET_KEY")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"

app = Flask(__name__)
app.secret_key = SECRET_KEY or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=COOKIE_SECURE,
)
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
    if not _current_user():
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(force=True) or {}
    phases = data.get("phases", [])
    start_time_str = data.get("startTime")
    if not start_time_str:
        return jsonify({"error": "startTime is required"}), 400
    start_time = datetime.fromisoformat(start_time_str)
    result = Scheduler().schedule(phases, start_time)
    return jsonify(result)

def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")

def _b64url_decode(s: str) -> bytes:
    s = (s or "").strip()
    pad = "=" * ((4 - (len(s) % 4)) % 4)
    return base64.urlsafe_b64decode((s + pad).encode("utf-8"))

def _hmac_sign(payload: bytes) -> str:
    key = (SECRET_KEY or app.secret_key).encode("utf-8")
    return _b64url_encode(hmac.new(key, payload, hashlib.sha256).digest())

def _captcha_svg(text: str) -> str:
    w = 160
    h = 54
    a = secrets.randbelow(9) + 1
    b = secrets.randbelow(9) + 1
    noise = f"M 0 {a*5} L {w} {b*6}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
        f'<rect width="{w}" height="{h}" rx="8" ry="8" fill="#f7fafc"/>'
        f'<path d="{noise}" stroke="#cbd5e0" stroke-width="2" fill="none" opacity="0.7"/>'
        f'<text x="16" y="36" font-size="24" font-family="Arial" fill="#2d3748">{text}</text>'
        "</svg>"
    )

@app.get("/api/captcha")
def api_captcha():
    a = secrets.randbelow(9) + 1
    b = secrets.randbelow(9) + 1
    op = "+"
    exp = int(time.time()) + 180
    payload_obj = {"a": a, "b": b, "op": op, "exp": exp}
    payload = json.dumps(payload_obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    token = _b64url_encode(payload) + "." + _hmac_sign(payload)
    svg = _captcha_svg(f"{a} {op} {b} = ?")
    return jsonify({"token": token, "svg": svg})

def _verify_captcha(token: str, answer: str) -> bool:
    try:
        parts = (token or "").split(".")
        if len(parts) != 2:
            return False
        payload_b64, sig = parts
        payload = _b64url_decode(payload_b64)
        if not hmac.compare_digest(_hmac_sign(payload), sig):
            return False
        obj = json.loads(payload.decode("utf-8"))
        if int(obj.get("exp") or 0) < int(time.time()):
            return False
        a = int(obj.get("a"))
        b = int(obj.get("b"))
        op = obj.get("op")
        expected = a + b if op == "+" else a - b
        return str(expected) == str(int(answer))
    except Exception:
        return False

def _current_user():
    u = session.get("user")
    if isinstance(u, str) and u.strip():
        return u
    return None

def _require_login(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not _current_user():
            return jsonify({"error": "unauthorized"}), 401
        return fn(*args, **kwargs)
    return wrapper

def _require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        username = _current_user()
        if not username:
            return jsonify({"error": "unauthorized"}), 401
        user = _get_user(username)
        if not user or user.get("role") != "admin":
            return jsonify({"error": "forbidden"}), 403
        return fn(*args, **kwargs)
    return wrapper

def _has_permission(username: str, perm: str) -> bool:
    user = _get_user(username)
    if not user:
        return False
    if user.get("role") == "admin":
        return True
    perms = user.get("permissions") or []
    return isinstance(perms, list) and perm in perms

def _json_user(user: dict) -> dict:
    return {
        "username": user.get("username"),
        "role": user.get("role") or "user",
        "permissions": user.get("permissions") if isinstance(user.get("permissions"), list) else [],
        "active": bool(user.get("active", True)),
        "updatedAt": user.get("updated_at") or user.get("updatedAt"),
        "createdAt": user.get("created_at") or user.get("createdAt"),
    }

def _use_auth_pg():
    return _use_postgres()

def _init_auth_db():
    if not _use_auth_pg():
        return
    with _get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS app_users (
                    username VARCHAR(80) PRIMARY KEY,
                    password_hash VARCHAR(255) NOT NULL,
                    role VARCHAR(20) NOT NULL,
                    permissions JSONB NOT NULL,
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at VARCHAR(100) NOT NULL,
                    updated_at VARCHAR(100) NOT NULL
                )
            """)
            cur.execute("SELECT username FROM app_users WHERE username = %s", (ADMIN_USERNAME,))
            exists = cur.fetchone()
            now = datetime.utcnow().isoformat()
            admin_perms = ["state:write", "admin", "data:view", "data:edit", "schedule:edit", "plan:view", "plan:edit", "plan:export", "details:view", "details:export"]
            if not exists:
                if ADMIN_PASSWORD:
                    cur.execute(
                        """
                        INSERT INTO app_users (username, password_hash, role, permissions, active, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            ADMIN_USERNAME,
                            generate_password_hash(ADMIN_PASSWORD),
                            "admin",
                            json.dumps(admin_perms),
                            True,
                            now,
                            now,
                        ),
                    )
            else:
                cur.execute(
                    """
                    UPDATE app_users
                    SET role = %s, permissions = %s, active = %s, updated_at = %s
                    WHERE username = %s
                    """,
                    ("admin", json.dumps(admin_perms), True, now, ADMIN_USERNAME),
                )
                if ADMIN_PASSWORD:
                    cur.execute(
                        "UPDATE app_users SET password_hash = %s, updated_at = %s WHERE username = %s",
                        (generate_password_hash(ADMIN_PASSWORD), now, ADMIN_USERNAME),
                    )
        conn.commit()


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
try:
    _init_auth_db()
except Exception as e:
    print(f"Error initializing auth DB: {e}")

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
    if not _current_user():
        return jsonify({"error": "unauthorized"}), 401
    with _state_lock:
        return jsonify(_load_state())


@app.put("/api/state")
def api_put_state():
    username = _current_user()
    if not username:
        return jsonify({"error": "unauthorized"}), 401
    if not _has_permission(username, "state:write"):
        return jsonify({"error": "forbidden"}), 403
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


def _get_user(username: str):
    u = (username or "").strip()
    if not u:
        return None
    if _use_auth_pg():
        try:
            with _get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT * FROM app_users WHERE username = %s", (u,))
                    row = cur.fetchone()
                    if not row:
                        return None
                    if isinstance(row.get("permissions"), str):
                        try:
                            row["permissions"] = json.loads(row["permissions"])
                        except Exception:
                            row["permissions"] = []
                    return row
        except Exception:
            return None
    return None

def _list_users():
    if not _use_auth_pg():
        return []
    with _get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM app_users ORDER BY username ASC")
            rows = cur.fetchall() or []
            out = []
            for row in rows:
                if isinstance(row.get("permissions"), str):
                    try:
                        row["permissions"] = json.loads(row["permissions"])
                    except Exception:
                        row["permissions"] = []
                out.append(row)
            return out

def _create_user(username: str, password: str, role: str, permissions, active: bool = True):
    if not _use_auth_pg():
        raise RuntimeError("auth storage not configured")
    u = (username or "").strip()
    if not u:
        raise ValueError("username required")
    if not password:
        raise ValueError("password required")
    r = role if role in ("admin", "user") else "user"
    perms = permissions if isinstance(permissions, list) else []
    now = datetime.utcnow().isoformat()
    with _get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT username FROM app_users WHERE username = %s", (u,))
            if cur.fetchone():
                raise ValueError("user exists")
            cur.execute(
                """
                INSERT INTO app_users (username, password_hash, role, permissions, active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (u, generate_password_hash(password), r, json.dumps(perms), bool(active), now, now),
            )
        conn.commit()

def _update_user(username: str, updates: dict):
    if not _use_auth_pg():
        raise RuntimeError("auth storage not configured")
    u = (username or "").strip()
    if not u:
        raise ValueError("username required")
    now = datetime.utcnow().isoformat()
    if u == ADMIN_USERNAME:
        sets = []
        params = []
        if "password" in updates and updates["password"]:
            sets.append("password_hash = %s")
            params.append(generate_password_hash(updates["password"]))
        sets.append("role = %s")
        params.append("admin")
        sets.append("permissions = %s")
        params.append(json.dumps(["state:write", "admin", "data:view", "data:edit", "schedule:edit", "plan:view", "plan:edit", "plan:export", "details:view", "details:export"]))
        sets.append("active = %s")
        params.append(True)
        sets.append("updated_at = %s")
        params.append(now)
        params.append(u)
        with _get_pg_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"UPDATE app_users SET {', '.join(sets)} WHERE username = %s", tuple(params))
            conn.commit()
        return
    sets = []
    params = []
    if "password" in updates and updates["password"]:
        sets.append("password_hash = %s")
        params.append(generate_password_hash(updates["password"]))
    if "role" in updates and updates["role"] in ("admin", "user"):
        sets.append("role = %s")
        params.append(updates["role"])
    if "permissions" in updates and isinstance(updates["permissions"], list):
        sets.append("permissions = %s")
        params.append(json.dumps(updates["permissions"]))
    if "active" in updates:
        sets.append("active = %s")
        params.append(bool(updates["active"]))
    sets.append("updated_at = %s")
    params.append(now)
    if not sets:
        return
    params.append(u)
    with _get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE app_users SET {', '.join(sets)} WHERE username = %s", tuple(params))
        conn.commit()

def _delete_user(username: str):
    if not _use_auth_pg():
        raise RuntimeError("auth storage not configured")
    u = (username or "").strip()
    if not u:
        raise ValueError("username required")
    if u == ADMIN_USERNAME:
        raise ValueError("cannot delete admin")
    with _get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM app_users WHERE username = %s", (u,))
        conn.commit()


@app.get("/api/me")
@_require_login
def api_me():
    user = _get_user(_current_user())
    if not user or not user.get("active", True):
        session.pop("user", None)
        return jsonify({"error": "unauthorized"}), 401
    return jsonify(_json_user(user))


@app.post("/api/login")
def api_login():
    data = request.get_json(force=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    captcha_token = data.get("captchaToken") or ""
    captcha_answer = data.get("captchaAnswer") or ""

    if not _verify_captcha(captcha_token, captcha_answer):
        return jsonify({"error": "captcha"}), 400

    if _use_auth_pg() and not _get_user(ADMIN_USERNAME) and not ADMIN_PASSWORD:
        return jsonify({"error": "admin_not_initialized"}), 503

    user = _get_user(username)
    if not user or not user.get("active", True):
        return jsonify({"error": "invalid_credentials"}), 401
    if not check_password_hash(user.get("password_hash") or "", password):
        return jsonify({"error": "invalid_credentials"}), 401

    session["user"] = username
    return jsonify(_json_user(user))


@app.post("/api/logout")
def api_logout():
    session.pop("user", None)
    return jsonify({"ok": True})


@app.get("/api/users")
@_require_admin
def api_users_list():
    users = [_json_user(u) for u in _list_users()]
    return jsonify({"users": users})


@app.post("/api/users")
@_require_admin
def api_users_create():
    data = request.get_json(force=True) or {}
    try:
        _create_user(
            data.get("username"),
            data.get("password"),
            data.get("role") or "user",
            data.get("permissions") or [],
            bool(data.get("active", True)),
        )
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception:
        return jsonify({"error": "create_failed"}), 500


@app.put("/api/users/<username>")
@_require_admin
def api_users_update(username: str):
    data = request.get_json(force=True) or {}
    try:
        _update_user(username, data)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception:
        return jsonify({"error": "update_failed"}), 500


@app.delete("/api/users/<username>")
@_require_admin
def api_users_delete(username: str):
    try:
        _delete_user(username)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception:
        return jsonify({"error": "delete_failed"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
