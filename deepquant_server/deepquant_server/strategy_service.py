"""
CTA Strategy service — encapsulates the CTA engine behind a clean API.

All strategy data (settings, runtime variables, logs) is persisted to SQLite.
The web frontend communicates exclusively through this service.
"""
import hashlib
import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from loguru import logger

from .json_util import json_dumps as _json_dumps_safe
from . import backtest_store as bt_store

_DB_PATH = str(Path.home() / ".vntrader" / "gateway_accounts.db")
_lock = threading.Lock()


def normalize_status(status: str) -> str:
    """Map legacy DB values to frontend status enum."""
    s = str(status or "stopped").lower()
    if s == "trading":
        return "running"
    return s


def live_status(strategy) -> str:
    """Derive status from strategy runtime state."""
    if getattr(strategy, "trading", False):
        return "running"
    if getattr(strategy, "inited", False):
        return "inited"
    return "stopped"


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
            account_id INTEGER NOT NULL DEFAULT 0,
            gateway TEXT NOT NULL DEFAULT 'CTP',
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
    bt_store.ensure_backtest_schema(conn)
    for col, ddl in (
        ("account_id", "INTEGER NOT NULL DEFAULT 0"),
        ("gateway", "TEXT NOT NULL DEFAULT 'CTP'"),
        ("last_backtest_json", "TEXT NOT NULL DEFAULT ''"),
        ("active_backtest_id", "INTEGER NOT NULL DEFAULT 0"),
    ):
        try:
            conn.execute(f"ALTER TABLE strategy_configs ADD COLUMN {col} {ddl}")
        except sqlite3.OperationalError:
            pass
    bt_store.migrate_legacy_gates(conn)


def _instance_config_hash(class_name: str, vt_symbol: str, params: dict) -> str:
    return bt_store.instance_config_hash(class_name, vt_symbol, params)


def _backtest_config_hash(
    class_name: str,
    vt_symbol: str,
    params: dict,
    interval: str,
    rate: float,
    slippage: float,
    size: int,
    pricetick: float,
    capital: float,
) -> str:
    return bt_store.backtest_config_hash(
        class_name, vt_symbol, params, interval, rate, slippage, size, pricetick, capital,
    )


def _fmt_return_pct(v) -> str:
    return bt_store.fmt_return_pct(v)


def _snapshot_config_matches(config: dict, snap: dict) -> bool:
    if not snap:
        return False
    ih = _instance_config_hash(
        config.get("class_name", ""),
        config.get("vt_symbol", ""),
        config.get("params", {}),
    )
    return snap.get("instance_hash") == ih


def _backtest_is_profitable(snap: dict) -> bool:
    return bt_store.backtest_is_profitable(snap)


def validate_backtest_snapshot(config: dict) -> tuple[bool, str]:
    return bt_store.validate_backtest_snapshot(config)


def clear_backtest_snapshot(strategy_name: str) -> None:
    bt_store.clear_active_gate(strategy_name)


def save_backtest_snapshot(strategy_name: str, snapshot: dict) -> None:
    bt_store.save_backtest_snapshot(strategy_name, snapshot)


def _load_backtest_snapshot(config: dict) -> dict | None:
    return bt_store.load_active_snapshot(config)


def list_backtest_saves(strategy_name: str, config: dict | None = None) -> list[dict]:
    cfg = dict(config or _config_row(strategy_name))
    cfg["strategy_name"] = strategy_name
    return bt_store.list_backtest_saves(strategy_name, cfg)


def save_backtest_save(
    strategy_name: str,
    result: dict,
    label: str = "",
    set_active: bool = False,
) -> dict:
    config = _config_row(strategy_name)
    return bt_store.save_backtest_save(strategy_name, result, config, label, set_active)


def get_backtest_save(strategy_name: str, save_id: int, include_detail: bool = True) -> dict | None:
    return bt_store.get_backtest_save(strategy_name, save_id, include_detail=include_detail)


def delete_backtest_save(strategy_name: str, save_id: int) -> dict:
    config = _config_row(strategy_name)
    return bt_store.delete_backtest_save(strategy_name, save_id, config)


def delete_backtest_saves_for_strategy(strategy_name: str) -> None:
    bt_store.delete_backtest_saves_for_strategy(strategy_name)


def persist_backtest_run(strategy_name: str, result: dict) -> dict:
    config = _config_row(strategy_name)
    return bt_store.persist_backtest_run(strategy_name, result, config, auto=True, set_active_on_pass=True)


def set_active_backtest_gate(strategy_name: str, save_id: int) -> dict:
    config = _config_row(strategy_name)
    return bt_store.set_active_gate(strategy_name, save_id, config)


def export_backtest_save(strategy_name: str, save_id: int) -> dict | None:
    return bt_store.export_backtest_save(strategy_name, save_id)


def get_backtest_settings() -> dict:
    return bt_store.get_settings()


def save_backtest_settings(settings: dict) -> dict:
    return bt_store.save_settings(settings)


def _config_row(strategy_name: str) -> dict:
    with _lock:
        conn = _get_db()
        _init_tables(conn)
        row = conn.execute(
            "SELECT * FROM strategy_configs WHERE strategy_name=?", (strategy_name,),
        ).fetchone()
        conn.close()
    if not row:
        return {}
    d = dict(row)
    try:
        d["params"] = json.loads(d.get("params_json", "{}"))
    except json.JSONDecodeError:
        d["params"] = {}
    return d


# ---------------------------------------------------------------------------
# Strategy config CRUD
# ---------------------------------------------------------------------------
def save_config(
    strategy_name: str,
    class_name: str,
    vt_symbol: str,
    params: dict,
    account_id: int = 0,
    gateway: str = "CTP",
) -> None:
    now = datetime.now().isoformat()
    with _lock:
        conn = _get_db()
        _init_tables(conn)
        conn.execute(
            """INSERT OR REPLACE INTO strategy_configs
               (strategy_name, class_name, vt_symbol, params_json, account_id, gateway,
                updated_at, created_at)
               VALUES (?,?,?,?,?,?,?,
                       COALESCE((SELECT created_at FROM strategy_configs WHERE strategy_name=?),?))""",
            (
                strategy_name, class_name, vt_symbol,
                json.dumps(params, ensure_ascii=False),
                account_id, gateway or "CTP",
                now, strategy_name, now,
            ),
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
        conn.execute("DELETE FROM strategy_backtest_saves WHERE strategy_name=?", (strategy_name,))
        conn.commit()
        ok = conn.total_changes > 0
        conn.close()
    return ok


def update_config_status(strategy_name: str, status: str) -> None:
    with _lock:
        conn = _get_db()
        conn.execute(
            "UPDATE strategy_configs SET status=?, updated_at=? WHERE strategy_name=?",
            (normalize_status(status), datetime.now().isoformat(), strategy_name),
        )
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
    if v == "True":
        return True
    if v == "False":
        return False
    if v == "None":
        return None
    try:
        return int(v)
    except ValueError:
        try:
            return float(v)
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
        self._engine = None
        self._conn_checker: Callable[[str], bool] | None = None
        self._account_resolver: Callable[[int], dict] | None = None

    def set_connection_checker(self, checker: Callable[[str], bool]) -> None:
        self._conn_checker = checker

    def set_account_resolver(self, resolver: Callable[[int], dict]) -> None:
        self._account_resolver = resolver

    def _ensure_engine(self):
        if self._engine is not None:
            return self._engine
        try:
            from vnpy_ctastrategy import CtaStrategyApp
            self._engine = self._me.add_app(CtaStrategyApp)
            self._engine.load_strategy_class()
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

    def _gateway_connected(self, gateway: str) -> bool:
        if not self._conn_checker:
            return True
        return self._conn_checker(gateway or "CTP")

    def _resolve_account(self, account_id: int) -> dict:
        if self._account_resolver and account_id:
            return self._account_resolver(account_id) or {}
        return {}

    # ---- Strategy CRUD ----

    def list_classes(self) -> list[str]:
        eng = self._ensure_engine()
        if not eng:
            return []
        return sorted(eng.classes.keys())

    def get_params(self, class_name: str) -> dict:
        eng = self._ensure_engine()
        if not eng or class_name not in eng.classes:
            return {}
        params = eng.get_strategy_class_parameters(class_name)
        result = {"strategy_name": "", "vt_symbol": ""}
        result.update(params)
        return result

    def add(
        self,
        class_name: str,
        strategy_name: str,
        vt_symbol: str,
        params: dict,
        account_id: int = 0,
        gateway: str = "CTP",
    ) -> dict:
        eng = self._ensure_engine()
        if not eng:
            return {"error": "CTA engine not available"}
        if not strategy_name.strip():
            return {"error": "策略名称不能为空"}
        if not vt_symbol.strip():
            return {"error": "合约不能为空"}
        if strategy_name in eng.strategies:
            return {"error": f"策略名称 {strategy_name} 已存在"}
        strategy_params = {k: v for k, v in params.items() if k not in ("strategy_name", "vt_symbol")}
        eng.add_strategy(class_name, strategy_name, vt_symbol, strategy_params)
        save_config(strategy_name, class_name, vt_symbol, strategy_params, account_id, gateway)
        append_log(strategy_name, "INFO", f"策略已添加: {class_name} @ {vt_symbol}")
        return self._strategy_info(strategy_name)

    def remove(self, strategy_name: str) -> dict:
        eng = self._ensure_engine()
        if not eng:
            return {"error": "CTA engine not available"}
        if strategy_name in eng.strategies:
            s = eng.strategies[strategy_name]
            if getattr(s, "trading", False):
                return {"error": "请先停止策略再删除"}
            eng.remove_strategy(strategy_name)
        delete_config(strategy_name)
        return {"removed": strategy_name, "strategy_name": strategy_name}

    def edit(self, strategy_name: str, params: dict) -> dict:
        eng = self._ensure_engine()
        if not eng:
            return {"error": "CTA engine not available"}
        if strategy_name not in eng.strategies:
            return {"error": f"策略 {strategy_name} 不存在"}
        s = eng.strategies[strategy_name]
        if getattr(s, "trading", False):
            return {"error": "运行中的策略不能编辑参数，请先停止"}
        eng.edit_strategy(strategy_name, params)
        clear_backtest_snapshot(strategy_name)
        strategy_params = {k: v for k, v in params.items() if k not in ("strategy_name", "vt_symbol")}
        cfg = _config_row(strategy_name)
        save_config(
            strategy_name, type(s).__name__, s.vt_symbol, strategy_params,
            cfg.get("account_id", 0), cfg.get("gateway", "CTP"),
        )
        append_log(strategy_name, "INFO", "策略参数已更新")
        return self._strategy_info(strategy_name)

    def init(self, strategy_name: str) -> dict:
        eng = self._ensure_engine()
        if not eng:
            return {"error": "CTA engine not available"}
        if strategy_name not in eng.strategies:
            return {"error": f"策略 {strategy_name} 不存在"}

        strategy = eng.strategies[strategy_name]
        if strategy.inited:
            return {"error": "策略已初始化，禁止重复操作"}

        config = _config_row(strategy_name)
        bt_ok, bt_msg = validate_backtest_snapshot(config)
        if not bt_ok:
            return {
                "error": f"无法初始化：{bt_msg}",
                "strategy_name": strategy_name,
            }

        future = eng.init_strategy(strategy_name)
        try:
            future.result(timeout=30)
        except Exception as e:
            append_log(strategy_name, "ERROR", f"初始化异常: {e}")
            update_config_status(strategy_name, "stopped")
            return {"error": f"初始化失败: {e}", "strategy_name": strategy_name}

        am = getattr(strategy, "am", None)
        data_loaded = am is not None and getattr(am, "inited", False)

        if strategy.inited and data_loaded:
            update_config_status(strategy_name, "inited")
            append_log(strategy_name, "INFO",
                       f"初始化成功 (已加载历史数据, size={am.count})" if am else "初始化成功")
            return {
                "status": "inited",
                "message": "初始化成功",
                "vt_symbol": strategy.vt_symbol,
                "strategy_name": strategy_name,
            }
        if strategy.inited and not data_loaded:
            strategy.inited = False
            update_config_status(strategy_name, "stopped")
            append_log(strategy_name, "ERROR", "初始化失败：历史数据不足，请先下载合约K线数据")
            return {
                "error": "初始化失败：历史数据不足，请先通过数据管理下载合约K线",
                "vt_symbol": strategy.vt_symbol,
                "strategy_name": strategy_name,
            }
        update_config_status(strategy_name, "stopped")
        append_log(strategy_name, "ERROR", "初始化失败：策略 on_init 执行异常")
        return {"error": "初始化失败，请查看日志", "strategy_name": strategy_name}

    def start(self, strategy_name: str) -> dict:
        eng = self._ensure_engine()
        if not eng:
            return {"error": "CTA engine not available"}
        if strategy_name not in eng.strategies:
            return {"error": f"策略 {strategy_name} 不存在"}
        strategy = eng.strategies[strategy_name]
        if not strategy.inited:
            return {"error": "请先初始化策略", "strategy_name": strategy_name}
        if strategy.trading:
            return {"error": "策略已在运行中", "strategy_name": strategy_name}

        cfg = _config_row(strategy_name)
        gateway = cfg.get("gateway", "CTP")
        if not self._gateway_connected(gateway):
            return {
                "error": f"请先连接 {gateway} 交易账户后再启动策略",
                "strategy_name": strategy_name,
            }

        eng.start_strategy(strategy_name)
        update_config_status(strategy_name, "running")
        save_variables(strategy_name, _get_vars(strategy))
        append_log(strategy_name, "INFO", "策略已启动")
        return {"status": "running", "message": "启动成功", "strategy_name": strategy_name}

    def stop(self, strategy_name: str) -> dict:
        eng = self._ensure_engine()
        if not eng:
            return {"error": "CTA engine not available"}
        if strategy_name not in eng.strategies:
            return {"error": f"策略 {strategy_name} 不存在", "strategy_name": strategy_name}
        eng.stop_strategy(strategy_name)
        update_config_status(strategy_name, "stopped")
        append_log(strategy_name, "INFO", "策略已停止")
        return {"status": "stopped", "message": "停止成功", "strategy_name": strategy_name}

    def init_all(self) -> dict:
        eng = self._ensure_engine()
        if not eng:
            return {"error": "CTA engine not available"}
        results = []
        for name in list(eng.strategies.keys()):
            r = self.init(name)
            results.append({"strategy_name": name, **r})
        return {"status": "ok", "results": results}

    def start_all(self) -> dict:
        eng = self._ensure_engine()
        if not eng:
            return {"error": "CTA engine not available"}
        results = []
        for name in list(eng.strategies.keys()):
            r = self.start(name)
            results.append({"strategy_name": name, **r})
        return {"status": "ok", "results": results}

    def stop_all(self) -> dict:
        eng = self._ensure_engine()
        if not eng:
            return {"error": "CTA engine not available"}
        results = []
        for name in list(eng.strategies.keys()):
            r = self.stop(name)
            results.append({"strategy_name": name, **r})
        return {"status": "ok", "results": results}

    def list_all(self) -> list[dict]:
        eng = self._ensure_engine()
        if not eng:
            return []
        return [self._strategy_info(name) for name in eng.strategies]

    def get_one(self, strategy_name: str) -> dict:
        return self._strategy_info(strategy_name)

    def summary(self) -> dict:
        """Portfolio-level strategy overview for dashboard KPIs."""
        eng = self._ensure_engine()
        items = self.list_all() if eng else []
        running = sum(1 for s in items if s.get("status") == "running")
        inited = sum(1 for s in items if s.get("status") == "inited")
        stopped = sum(1 for s in items if s.get("status") == "stopped")
        pos_exposure = sum(abs(s.get("variables", {}).get("pos", 0) or 0) for s in items if s.get("status") == "running")
        disconnected = sum(
            1 for s in items
            if s.get("status") in ("inited", "running") and s.get("gateway_connected") is False
        )
        return {
            "total": len(items),
            "running": running,
            "inited": inited,
            "stopped": stopped,
            "pos_exposure": pos_exposure,
            "gateway_alerts": disconnected,
        }

    def preflight(self, strategy_name: str, main_engine=None) -> dict:
        """Pre-deployment checklist — gates each lifecycle transition."""
        eng = self._ensure_engine()
        if not eng:
            return {"error": "CTA engine not available"}
        if strategy_name not in eng.strategies:
            return {"error": f"策略 {strategy_name} 不存在"}

        s = eng.strategies[strategy_name]
        config = _config_row(strategy_name)
        gateway = config.get("gateway", "CTP")
        status = live_status(s)
        inited = bool(getattr(s, "inited", False))
        gw_ok = self._gateway_connected(gateway)
        last_bt = _load_backtest_snapshot(config)
        bt_valid, bt_reason = validate_backtest_snapshot(config)
        latest_run = bt_store.latest_run_summary(strategy_name, config)
        active_id = int(config.get("active_backtest_id") or 0)

        checks: list[dict] = []

        cfg_ok = bool(config.get("vt_symbol") and config.get("class_name"))
        checks.append({
            "id": "config",
            "label": "实例配置",
            "status": "ok" if cfg_ok else "fail",
            "message": config.get("vt_symbol", "") or "缺少合约",
            "required_for": ["init"],
        })

        account = self._resolve_account(config.get("account_id", 0))
        checks.append({
            "id": "account",
            "label": "绑定账户",
            "status": "ok" if account.get("alias") or config.get("account_id", 0) == 0 else "warn",
            "message": account.get("alias") or "使用默认账户",
            "required_for": ["start"],
        })

        data_st, data_msg = "warn", "未检测历史数据"
        if main_engine and config.get("vt_symbol"):
            try:
                from . import data_api
                rows = data_api.check_data_coverage(main_engine, [{
                    "vt_symbol": config["vt_symbol"],
                    "interval": "1m",
                }])
                if rows:
                    r = rows[0]
                    st = r.get("status", "missing")
                    data_st = "ok" if st == "ok" else ("warn" if st in ("partial", "stale") else "fail")
                    data_msg = r.get("detail") or st
            except Exception as exc:
                data_st, data_msg = "warn", str(exc)[:100]

        checks.append({
            "id": "history_data",
            "label": "历史数据",
            "status": data_st,
            "message": data_msg,
            "required_for": ["init"],
        })

        if bt_valid and last_bt:
            bt_msg = (
                f"验证基准 · 夏普 {float(last_bt.get('sharpe_ratio') or 0):.2f} · "
                f"收益 {_fmt_return_pct(last_bt.get('total_return'))} · "
                f"{last_bt.get('interval', '1m')}"
            )
            bt_status = "ok"
        elif latest_run and latest_run.get("status") == "loss" and not bt_valid:
            bt_msg = (
                f"最近回测亏损（收益 {_fmt_return_pct(latest_run.get('total_return'))}），"
                f"且无有效验证基准"
            )
            bt_status = "fail"
        elif latest_run and latest_run.get("status") == "loss" and bt_valid:
            bt_msg = (
                f"验证基准有效 · 最近回测亏损 "
                f"{_fmt_return_pct(latest_run.get('total_return'))}"
            )
            bt_status = "warn"
        elif last_bt and _snapshot_config_matches(config, last_bt) and not _backtest_is_profitable(last_bt):
            bt_msg = bt_reason if bt_reason != "ok" else (
                f"回测亏损（收益 {_fmt_return_pct(last_bt.get('total_return'))}），请调整参数后重跑"
            )
            bt_status = "fail"
        elif last_bt:
            bt_msg = bt_reason
            bt_status = "warn"
        else:
            bt_msg = "建议回测后再上线（非强制）"
            bt_status = "optional"

        config_match = bool(last_bt and _snapshot_config_matches(config, last_bt))
        backtest_unprofitable = bool(
            (latest_run and latest_run.get("status") == "loss" and not bt_valid)
            or (config_match and last_bt and not _backtest_is_profitable(last_bt))
        )

        checks.append({
            "id": "backtest",
            "label": "回测验证",
            "status": bt_status,
            "message": bt_msg,
            "required_for": ["init"],
        })

        checks.append({
            "id": "initialized",
            "label": "引擎预热",
            "status": "ok" if inited else "pending",
            "message": "历史 K 线已加载" if inited else "待执行初始化",
            "required_for": ["start"],
        })

        checks.append({
            "id": "gateway",
            "label": "交易网关",
            "status": "ok" if gw_ok else "fail",
            "message": f"{gateway} 在线" if gw_ok else f"{gateway} 未连接",
            "required_for": ["start"],
        })

        lifecycle_step = self._lifecycle_step(status, inited, bt_valid, data_st)
        next_action = self._next_action(status, checks, gw_ok, inited, data_st, bt_valid)

        return {
            "strategy_name": strategy_name,
            "status": status,
            "lifecycle_step": lifecycle_step,
            "checks": checks,
            "next_action": next_action,
            "last_backtest": last_bt,
            "active_backtest_id": active_id,
            "latest_backtest": latest_run,
            "backtest_valid": bt_valid,
            "backtest_stale": bool(last_bt and not _snapshot_config_matches(config, last_bt)),
            "backtest_unprofitable": backtest_unprofitable,
            "ready_to_init": cfg_ok and data_st in ("ok", "warn") and bt_valid,
            "ready_to_start": inited and gw_ok,
        }

    @staticmethod
    def _lifecycle_step(status: str, inited: bool, bt_valid: bool, data_st: str) -> str:
        if status == "running":
            return "live"
        if inited:
            return "ready"
        if bt_valid:
            return "researched"
        if data_st == "ok":
            return "data_ready"
        return "configured"

    @staticmethod
    def _next_action(
        status: str,
        checks: list[dict],
        gw_ok: bool,
        inited: bool,
        data_st: str,
        bt_valid: bool,
    ) -> dict:
        if status == "running":
            return {"id": "stop", "label": "停止实盘", "kind": "danger"}
        if inited:
            if not gw_ok:
                return {"id": "connect", "label": "连接交易账户", "kind": "primary"}
            return {"id": "start", "label": "启动实盘", "kind": "primary"}
        if data_st == "fail":
            return {"id": "download_data", "label": "补全历史数据", "kind": "primary"}
        if not bt_valid:
            if data_st in ("ok", "warn"):
                return {"id": "backtest", "label": "运行回测", "kind": "primary"}
            return {"id": "backtest", "label": "运行回测", "kind": "primary"}
        return {"id": "init", "label": "初始化引擎", "kind": "primary"}

    def _strategy_info(self, strategy_name: str) -> dict:
        eng = self._ensure_engine()
        if not eng or strategy_name not in eng.strategies:
            return {}
        s = eng.strategies[strategy_name]
        config = _config_row(strategy_name)
        variables = _get_display_vars(s)
        save_variables(strategy_name, variables)
        account = self._resolve_account(config.get("account_id", 0))
        gateway = config.get("gateway", "CTP")
        return {
            "strategy_name": s.strategy_name,
            "vt_symbol": s.vt_symbol,
            "class_name": type(s).__name__,
            "status": live_status(s),
            "parameters": config.get("params", {}),
            "variables": variables,
            "account_id": config.get("account_id", 0),
            "account_alias": account.get("alias", ""),
            "gateway": gateway,
            "gateway_connected": self._gateway_connected(gateway),
            "last_backtest": _load_backtest_snapshot(config),
            "active_backtest_id": int(config.get("active_backtest_id") or 0),
            "created_at": config.get("created_at", ""),
            "updated_at": config.get("updated_at", ""),
        }

    def write_log(self, strategy_name: str, msg: str, level: str = "INFO") -> None:
        append_log(strategy_name, level, msg)

    def get_logs(self, strategy_name: str = "", limit: int = 100) -> list[dict]:
        return get_logs(strategy_name, limit)

    def list_backtest_saves(self, strategy_name: str) -> list[dict]:
        if not strategy_name:
            return []
        cfg = _config_row(strategy_name)
        cfg["strategy_name"] = strategy_name
        return bt_store.list_backtest_saves(strategy_name, cfg)

    def save_backtest_save(
        self, strategy_name: str, result: dict, label: str = "", set_active: bool = False,
    ) -> dict:
        if not strategy_name:
            return {"error": "缺少策略实例名称"}
        if not result:
            return {"error": "缺少回测结果"}
        config = _config_row(strategy_name)
        return bt_store.save_backtest_save(strategy_name, result, config, label, set_active)

    def load_backtest_save(self, strategy_name: str, save_id: int, detail: bool = True) -> dict:
        if not strategy_name or not save_id:
            return {"error": "参数无效"}
        data = bt_store.get_backtest_save(strategy_name, save_id, include_detail=detail)
        if not data:
            return {"error": "记录不存在"}
        return data

    def delete_backtest_save(self, strategy_name: str, save_id: int) -> dict:
        if not strategy_name or not save_id:
            return {"error": "参数无效"}
        config = _config_row(strategy_name)
        return bt_store.delete_backtest_save(strategy_name, save_id, config)

    def set_active_backtest(self, strategy_name: str, save_id: int) -> dict:
        if not strategy_name or not save_id:
            return {"error": "参数无效"}
        config = _config_row(strategy_name)
        return bt_store.set_active_gate(strategy_name, save_id, config)

    def export_backtest(self, strategy_name: str, save_id: int) -> dict | None:
        return bt_store.export_backtest_save(strategy_name, save_id)

    def get_backtest_settings(self) -> dict:
        return bt_store.get_settings()

    def save_backtest_settings(self, settings: dict) -> dict:
        return bt_store.save_settings(settings)

    def persist_backtest_run(self, strategy_name: str, result: dict) -> dict:
        config = _config_row(strategy_name)
        return bt_store.persist_backtest_run(
            strategy_name, result, config, auto=True, set_active_on_pass=True,
        )

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
    for key in ("trading", "pos", "inited"):
        if hasattr(strategy, key):
            result[key] = getattr(strategy, key)
    return result


def _get_display_vars(strategy) -> dict:
    """Variables shown in UI — prefer strategy.variables list if defined."""
    raw = _get_vars(strategy)
    declared = getattr(strategy, "variables", None) or []
    if declared:
        return {k: raw[k] for k in declared if k in raw}
    skip = {"strategy_name", "vt_symbol", "inited", "trading", "pos"}
    return {k: v for k, v in raw.items() if k not in skip and not k.startswith("_")}
