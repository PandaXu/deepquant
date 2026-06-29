"""
Gateway account storage — SQLite-backed persistence for trading accounts.

Stores CTP (and future gateway) connection settings so users can
save multiple accounts and switch between them at runtime.
"""
import base64
import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path


_DB_PATH = str(Path.home() / ".vntrader" / "gateway_accounts.db")
_lock = threading.Lock()


def _get_db() -> sqlite3.Connection:
    Path(_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS gateway_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alias TEXT NOT NULL,
            gateway TEXT NOT NULL DEFAULT 'CTP',
            setting_json TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        )
    """)


# ---- internal helpers ----

def _encrypt_password(setting: dict) -> dict:
    """Simple password obfuscation (base64)."""
    s = dict(setting)
    for k in ("密码", "password"):
        if k in s and s[k]:
            s[k] = base64.b64encode(s[k].encode()).decode()
    return s


def _decrypt_password(setting: dict) -> dict:
    s = dict(setting)
    for k in ("密码", "password"):
        if k in s and s[k]:
            try:
                s[k] = base64.b64decode(s[k].encode()).decode()
            except Exception:
                pass
    return s


# ---- public API ----

def add_account(alias: str, setting: dict, gateway: str = "CTP", is_default: bool = False) -> dict:
    """Save a new account and return it with id."""
    now = datetime.now().isoformat()
    encrypted = _encrypt_password(setting)
    with _lock:
        conn = _get_db()
        _init_table(conn)
        if is_default:
            conn.execute("UPDATE gateway_accounts SET is_default=0")
        cur = conn.execute(
            "INSERT INTO gateway_accounts (alias, gateway, setting_json, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (alias, gateway, json.dumps(encrypted, ensure_ascii=False), 1 if is_default else 0, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM gateway_accounts WHERE id=?", (cur.lastrowid,)).fetchone()
        conn.close()
    return _row_to_dict(row)


def get_accounts() -> list[dict]:
    """Return all saved accounts with decrypted settings."""
    with _lock:
        conn = _get_db()
        _init_table(conn)
        rows = conn.execute("SELECT * FROM gateway_accounts ORDER BY id").fetchall()
        conn.close()
    return [_row_to_dict(r) for r in rows]


def get_account(account_id: int) -> dict | None:
    with _lock:
        conn = _get_db()
        _init_table(conn)
        row = conn.execute("SELECT * FROM gateway_accounts WHERE id=?", (account_id,)).fetchone()
        conn.close()
    return _row_to_dict(row) if row else None


def update_account(account_id: int, alias: str = "", setting: dict | None = None, is_default: bool | None = None) -> dict | None:
    existing = get_account(account_id)
    if not existing:
        return None
    now = datetime.now().isoformat()
    new_alias = alias or existing["alias"]
    new_setting = _encrypt_password(setting) if setting else json.loads(existing["setting_json"])
    with _lock:
        conn = _get_db()
        _init_table(conn)
        if is_default:
            conn.execute("UPDATE gateway_accounts SET is_default=0")
        conn.execute(
            "UPDATE gateway_accounts SET alias=?, setting_json=?, is_default=?, updated_at=? WHERE id=?",
            (new_alias, json.dumps(new_setting, ensure_ascii=False), 1 if is_default else 0, now, account_id),
        )
        conn.commit()
        conn.close()
    return get_account(account_id)


def delete_account(account_id: int) -> bool:
    with _lock:
        conn = _get_db()
        _init_table(conn)
        conn.execute("DELETE FROM gateway_accounts WHERE id=?", (account_id,))
        conn.commit()
        affected = conn.total_changes
        conn.close()
    return affected > 0


def get_default_account() -> dict | None:
    with _lock:
        conn = _get_db()
        _init_table(conn)
        row = conn.execute("SELECT * FROM gateway_accounts WHERE is_default=1 LIMIT 1").fetchone()
        conn.close()
    return _row_to_dict(row) if row else None


# ---------------------------------------------------------------------------
# Strategy settings persistence
# ---------------------------------------------------------------------------
def save_strategy_setting(strategy_name: str, class_name: str, vt_symbol: str, setting: dict) -> None:
    """Persist a strategy's configuration to the database."""
    now = datetime.now().isoformat()
    s = json.dumps(setting, ensure_ascii=False)
    with _lock:
        conn = _get_db()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS strategy_settings (
                strategy_name TEXT PRIMARY KEY,
                class_name TEXT NOT NULL,
                vt_symbol TEXT NOT NULL,
                setting_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            )
        """)
        conn.execute(
            "INSERT OR REPLACE INTO strategy_settings (strategy_name, class_name, vt_symbol, setting_json, updated_at, created_at) VALUES (?,?,?,?,?, COALESCE((SELECT created_at FROM strategy_settings WHERE strategy_name=?),?))",
            (strategy_name, class_name, vt_symbol, s, now, strategy_name, now),
        )
        conn.commit()
        conn.close()


def load_strategy_settings() -> dict:
    """Load all saved strategy configurations."""
    with _lock:
        conn = _get_db()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS strategy_settings (
                strategy_name TEXT PRIMARY KEY, class_name TEXT NOT NULL,
                vt_symbol TEXT NOT NULL, setting_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
            )
        """)
        rows = conn.execute("SELECT * FROM strategy_settings ORDER BY strategy_name").fetchall()
        conn.close()
    result = {}
    for r in rows:
        d = dict(r)
        try:
            d["setting"] = json.loads(d.get("setting_json", "{}"))
        except json.JSONDecodeError:
            d["setting"] = {}
        result[d["strategy_name"]] = d
    return result


def delete_strategy_setting(strategy_name: str) -> bool:
    """Remove a saved strategy configuration."""
    with _lock:
        conn = _get_db()
        conn.execute("CREATE TABLE IF NOT EXISTS strategy_settings (strategy_name TEXT PRIMARY KEY)")
        conn.execute("DELETE FROM strategy_settings WHERE strategy_name=?", (strategy_name,))
        conn.commit()
        affected = conn.total_changes
        conn.close()
    return affected > 0


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    try:
        setting = json.loads(d.get("setting_json", "{}"))
    except json.JSONDecodeError:
        setting = {}
    d["setting"] = _decrypt_password(setting)
    # Keep setting_json for raw access
    return d
