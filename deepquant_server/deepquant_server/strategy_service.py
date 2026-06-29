"""
CTA Strategy service — encapsulates the CTA engine behind a clean API.

All strategy data (settings, runtime variables, logs) is persisted to SQLite.
The web frontend communicates exclusively through this service.
"""
import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from loguru import logger

_DB_PATH = str(Path.home() / ".vntrader" / "gateway_accounts.db")
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def _get_db() -> sqlite3.Connection:
    Path(_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS strategy_configs (
            strategy_name TEXT PRIMARY KEY,
            class_name TEXT NOT NULL,
            vt_symbol TEXT NOT NULL,
            params_json TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'stopped',
            created_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS strategy_variables (
            strategy_name TEXT NOT NULL,
            var_name TEXT NOT NULL,
            var_value TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (strategy_name, var_name)
        );
        CREATE TABLE IF NOT EXISTS strategy_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_name TEXT NOT NULL DEFAULT '',
            level TEXT NOT NULL DEFAULT 'INFO',
            message TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_strategy_logs_name ON strategy_logs(strategy_name);
        CREATE INDEX IF NOT EXISTS idx_strategy_logs_time ON strategy_logs(created_at);
    """)


# ---------------------------------------------------------------------------
# Strategy config CRUD
# ---------------------------------------------------------------------------
def save_config(strategy_name: str, class_name: str, vt_symbol: str, params: dict) -> None:
    now = datetime.now().isoformat()
    with _lock:
        conn = _get_db()
        _init_tables(conn)
        conn.execute(
            "INSERT OR REPLACE INTO strategy_configs (strategy_name, class_name, vt_symbol, params_json, updated_at, created_at) VALUES (?,?,?,?,?, COALESCE((SELECT created_at FROM strategy_configs WHERE strategy_name=?),?))",
            (strategy_name, class_name, vt_symbol, json.dumps(params, ensure_ascii=False), now, strategy_name, now),
        )
        conn.commit()
        conn.close()


def load_configs() -> list[dict]:
    with _lock:
        conn = _get_db()
        _init_tables(conn)
        rows = conn.execute("SELECT * FROM strategy_configs ORDER BY strategy_name").fetchall()
        conn.close()
    result = []
    for r in rows:
        d = dict(r)
        try:
            d["params"] = json.loads(d.get("params_json", "{}"))
        except json.JSONDecodeError:
            d["params"] = {}
        result.append(d)
    return result


def delete_config(strategy_name: str) -> bool:
    with _lock:
        conn = _get_db()
        _init_tables(conn)
        conn.execute("DELETE FROM strategy_configs WHERE strategy_name=?", (strategy_name,))
        conn.execute("DELETE FROM strategy_variables WHERE strategy_name=?", (strategy_name,))
        conn.commit()
        ok = conn.total_changes > 0
        conn.close()
    return ok


def update_config_status(strategy_name: str, status: str) -> None:
    with _lock:
        conn = _get_db()
        conn.execute("UPDATE strategy_configs SET status=?, updated_at=? WHERE strategy_name=?",
                     (status, datetime.now().isoformat(), strategy_name))
        conn.commit()
        conn.close()


# ---------------------------------------------------------------------------
# Strategy variables (runtime state)
# ---------------------------------------------------------------------------
def save_variables(strategy_name: str, variables: dict) -> None:
    now = datetime.now().isoformat()
    with _lock:
        conn = _get_db()
        _init_tables(conn)
        for k, v in variables.items():
            conn.execute(
                "INSERT OR REPLACE INTO strategy_variables (strategy_name, var_name, var_value, updated_at) VALUES (?,?,?,?)",
                (strategy_name, k, str(v), now),
            )
        conn.commit()
        conn.close()


def load_variables(strategy_name: str) -> dict:
    with _lock:
        conn = _get_db()
        _init_tables(conn)
        rows = conn.execute(
            "SELECT var_name, var_value FROM strategy_variables WHERE strategy_name=?",
            (strategy_name,),
        ).fetchall()
        conn.close()
    return {r["var_name"]: _parse_value(r["var_value"]) for r in rows}


def _parse_value(v: str) -> Any:
    if v == "True": return True
    if v == "False": return False
    if v == "None": return None
    try: return int(v)
    except ValueError:
        try: return float(v)
        except ValueError:
            return v


# ---------------------------------------------------------------------------
# Strategy logs
# ---------------------------------------------------------------------------
def append_log(strategy_name: str, level: str, message: str) -> None:
    with _lock:
        conn = _get_db()
        _init_tables(conn)
        conn.execute(
            "INSERT INTO strategy_logs (strategy_name, level, message, created_at) VALUES (?,?,?,?)",
            (strategy_name, level, message, datetime.now().isoformat()),
        )
        # Keep max 1000 logs per strategy
        conn.execute("""
            DELETE FROM strategy_logs WHERE strategy_name=? AND id NOT IN (
                SELECT id FROM strategy_logs WHERE strategy_name=? ORDER BY id DESC LIMIT 1000
            )
        """, (strategy_name, strategy_name))
        conn.commit()
        conn.close()


def get_logs(strategy_name: str = "", limit: int = 100) -> list[dict]:
    with _lock:
        conn = _get_db()
        _init_tables(conn)
        if strategy_name:
            rows = conn.execute(
                "SELECT * FROM strategy_logs WHERE strategy_name=? ORDER BY id DESC LIMIT ?",
                (strategy_name, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM strategy_logs ORDER BY id DESC LIMIT ?", (limit,),
            ).fetchall()
        conn.close()
    return [dict(r) for r in reversed(rows)]


def clear_logs(strategy_name: str = "") -> None:
    with _lock:
        conn = _get_db()
        _init_tables(conn)
        if strategy_name:
            conn.execute("DELETE FROM strategy_logs WHERE strategy_name=?", (strategy_name,))
        else:
            conn.execute("DELETE FROM strategy_logs")
        conn.commit()
        conn.close()


# ---------------------------------------------------------------------------
# Service API — wraps CTA engine
# ---------------------------------------------------------------------------
class StrategyService:
    """Encapsulates the CTA engine behind a clean service interface."""

    def __init__(self, main_engine, event_engine) -> None:
        self._me = main_engine
        self._ee = event_engine
        self._engine = None  # CTA engine, lazy loaded

    def _ensure_engine(self):
        if self._engine is not None:
            return self._engine
        try:
            from vnpy_ctastrategy import CtaStrategyApp
            self._engine = self._me.add_app(CtaStrategyApp)
            self._engine.load_strategy_class()
            # Restore persisted strategies
            for cfg in load_configs():
                self._engine.add_strategy(
                    cfg["class_name"], cfg["strategy_name"],
                    cfg["vt_symbol"], cfg["params"],
                )
                logger.info(f"Strategy restored: {cfg['strategy_name']}")
        except ImportError:
            self._engine = False  # type: ignore[assignment]
        return self._engine

    @property
    def available(self) -> bool:
        return self._engine is not None and self._engine is not False

    @property
    def engine(self):
        return self._ensure_engine()

    # ---- Strategy CRUD ----

    def list_classes(self) -> list[str]:
        eng = self._ensure_engine()
        if not eng: return []
        names = sorted(eng.classes.keys())
        return names

    def get_params(self, class_name: str) -> dict:
        eng = self._ensure_engine()
        if not eng or class_name not in eng.classes:
            return {}
        params = eng.get_strategy_class_parameters(class_name)
        # Always include meta fields for the UI form
        result = {"strategy_name": "", "vt_symbol": ""}
        result.update(params)
        return result

    def add(self, class_name: str, strategy_name: str, vt_symbol: str, params: dict) -> dict:
        eng = self._ensure_engine()
        if not eng:
            return {"error": "CTA engine not available"}
        strategy_params = {k: v for k, v in params.items() if k not in ("strategy_name", "vt_symbol")}
        eng.add_strategy(class_name, strategy_name, vt_symbol, strategy_params)
        save_config(strategy_name, class_name, vt_symbol, strategy_params)
        return self._strategy_info(strategy_name)

    def remove(self, strategy_name: str) -> dict:
        eng = self._ensure_engine()
        if not eng: return {"error": "CTA engine not available"}
        if strategy_name in eng.strategies:
            eng.remove_strategy(strategy_name)
        delete_config(strategy_name)
        return {"removed": strategy_name}

    def edit(self, strategy_name: str, params: dict) -> dict:
        eng = self._ensure_engine()
        if not eng: return {"error": "CTA engine not available"}
        eng.edit_strategy(strategy_name, params)
        strategy_params = {k: v for k, v in params.items() if k not in ("strategy_name", "vt_symbol")}
        s = eng.strategies.get(strategy_name)
        if s:
            save_config(strategy_name, type(s).__name__, s.vt_symbol, strategy_params)
        return self._strategy_info(strategy_name)

    def init(self, strategy_name: str) -> dict:
        eng = self._ensure_engine()
        if not eng: return {"error": "CTA engine not available"}
        if strategy_name not in eng.strategies:
            return {"error": f"策略 {strategy_name} 不存在"}

        strategy = eng.strategies[strategy_name]
        if strategy.inited:
            return {"error": "策略已初始化，禁止重复操作"}

        future = eng.init_strategy(strategy_name)
        try:
            future.result(timeout=30)
        except Exception as e:
            append_log(strategy_name, "ERROR", f"初始化异常: {e}")
            update_config_status(strategy_name, "stopped")
            return {"error": f"初始化失败: {e}"}

        # Validate: check if historical data was actually loaded
        am = getattr(strategy, "am", None)
        data_loaded = am is not None and getattr(am, "inited", False)

        if strategy.inited and data_loaded:
            update_config_status(strategy_name, "inited")
            append_log(strategy_name, "INFO",
                       f"初始化成功 (已加载历史数据, size={am.count})" if am else "初始化成功")
            return {"status": "inited", "message": "初始化成功"}
        elif strategy.inited and not data_loaded:
            # Strategy on_init didn't throw but also didn't load data
            strategy.inited = False
            update_config_status(strategy_name, "stopped")
            append_log(strategy_name, "ERROR", "初始化失败：历史数据不足，请先下载合约K线数据")
            return {"error": "初始化失败：历史数据不足，请先通过数据管理下载合约K线"}
        else:
            update_config_status(strategy_name, "stopped")
            append_log(strategy_name, "ERROR", "初始化失败：策略 on_init 执行异常")
            return {"error": "初始化失败，请查看日志"}

    def start(self, strategy_name: str) -> dict:
        eng = self._ensure_engine()
        if not eng: return {"error": "CTA engine not available"}
        if strategy_name not in eng.strategies:
            return {"error": f"策略 {strategy_name} 不存在"}
        strategy = eng.strategies[strategy_name]
        if not strategy.inited:
            return {"error": "请先初始化策略"}
        if strategy.trading:
            return {"error": "策略已在运行中"}

        eng.start_strategy(strategy_name)
        update_config_status(strategy_name, "trading")
        save_variables(strategy_name, _get_vars(strategy))
        append_log(strategy_name, "INFO", "策略已启动")
        return {"status": "trading", "message": "启动成功"}

    def stop(self, strategy_name: str) -> dict:
        eng = self._ensure_engine()
        if not eng: return {"error": "CTA engine not available"}
        if strategy_name not in eng.strategies:
            return {"error": f"策略 {strategy_name} 不存在"}
        eng.stop_strategy(strategy_name)
        update_config_status(strategy_name, "stopped")
        append_log(strategy_name, "INFO", "策略已停止")
        return {"status": "stopped", "message": "停止成功"}

    def init_all(self) -> dict:
        eng = self._ensure_engine()
        if not eng: return {"error": "CTA engine not available"}
        eng.init_all_strategies()
        for name in eng.strategies:
            update_config_status(name, "inited")
        return {"status": "ok"}

    def start_all(self) -> dict:
        eng = self._ensure_engine()
        if not eng: return {"error": "CTA engine not available"}
        eng.start_all_strategies()
        for name in eng.strategies:
            update_config_status(name, "trading")
        return {"status": "ok"}

    def stop_all(self) -> dict:
        eng = self._ensure_engine()
        if not eng: return {"error": "CTA engine not available"}
        eng.stop_all_strategies()
        for name in eng.strategies:
            update_config_status(name, "stopped")
        return {"status": "ok"}

    def list_all(self) -> list[dict]:
        eng = self._ensure_engine()
        if not eng: return []
        return [self._strategy_info(name) for name in eng.strategies]

    def _strategy_info(self, strategy_name: str) -> dict:
        eng = self._ensure_engine()
        if not eng or strategy_name not in eng.strategies:
            return {}
        s = eng.strategies[strategy_name]
        cfg = load_configs()
        config = next((c for c in cfg if c["strategy_name"] == strategy_name), {})
        variables = _get_vars(s)
        save_variables(strategy_name, variables)
        return {
            "strategy_name": s.strategy_name,
            "vt_symbol": s.vt_symbol,
            "class_name": type(s).__name__,
            "status": config.get("status", "stopped"),
            "parameters": config.get("params", {}),
            "variables": variables,
            "created_at": config.get("created_at", ""),
            "updated_at": config.get("updated_at", ""),
        }

    def _strategy_class_name(self, s) -> str:
        return type(s).__name__

    def write_log(self, strategy_name: str, msg: str, level: str = "INFO") -> None:
        append_log(strategy_name, level, msg)

    def get_logs(self, strategy_name: str = "", limit: int = 100) -> list[dict]:
        return get_logs(strategy_name, limit)

    def clear_logs(self, strategy_name: str = "") -> None:
        clear_logs(strategy_name)


def _get_vars(strategy) -> dict:
    """Extract public numeric/string variables from a strategy instance."""
    import numbers
    result = {}
    for attr in dir(strategy):
        if attr.startswith("_"):
            continue
        try:
            val = getattr(strategy, attr)
            if callable(val):
                continue
            if isinstance(val, (bool, str, numbers.Number)):
                result[attr] = val
        except Exception:
            pass
    # Always include key trading indicators
    for key in ("trading", "pos", "inited"):
        if hasattr(strategy, key):
            result[key] = getattr(strategy, key)
    return result
