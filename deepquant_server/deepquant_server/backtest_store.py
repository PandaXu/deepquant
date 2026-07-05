"""
Backtest run persistence — Active Gate, archive, detail files, retention.

Phase 1–3: gate semantics, status tags, dedup, external detail, retention settings.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from .json_util import json_dumps as _json_dumps_safe

_DB_PATH = str(Path.home() / ".vntrader" / "gateway_accounts.db")
_DETAIL_ROOT = Path.home() / ".deepquant" / "backtests"
_SETTINGS_PATH = Path.home() / ".deepquant" / "backtest_settings.json"
_lock = threading.Lock()

_DEFAULT_SETTINGS = {
    "max_saves_per_strategy": 20,
    "retention_days": 0,
    "auto_archive_loss": True,
}


def get_settings() -> dict:
    try:
        if _SETTINGS_PATH.exists():
            data = json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
            return {**_DEFAULT_SETTINGS, **data}
    except (OSError, json.JSONDecodeError):
        pass
    return dict(_DEFAULT_SETTINGS)


def save_settings(settings: dict) -> dict:
    merged = {**_DEFAULT_SETTINGS, **(settings or {})}
    _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_PATH.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return merged


def _get_db() -> sqlite3.Connection:
    Path(_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_backtest_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS strategy_backtest_saves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_name TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            result_json TEXT NOT NULL DEFAULT '{}',
            meta_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT '',
            is_active INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'draft',
            config_hash TEXT NOT NULL DEFAULT '',
            instance_hash TEXT NOT NULL DEFAULT '',
            stats_fingerprint TEXT NOT NULL DEFAULT '',
            detail_path TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_bt_saves_name ON strategy_backtest_saves(strategy_name);
        CREATE INDEX IF NOT EXISTS idx_bt_saves_config ON strategy_backtest_saves(strategy_name, config_hash);
        CREATE INDEX IF NOT EXISTS idx_bt_saves_active ON strategy_backtest_saves(strategy_name, is_active);
    """)
    for col, ddl in (
        ("is_active", "INTEGER NOT NULL DEFAULT 0"),
        ("status", "TEXT NOT NULL DEFAULT 'draft'"),
        ("config_hash", "TEXT NOT NULL DEFAULT ''"),
        ("instance_hash", "TEXT NOT NULL DEFAULT ''"),
        ("stats_fingerprint", "TEXT NOT NULL DEFAULT ''"),
        ("detail_path", "TEXT NOT NULL DEFAULT ''"),
    ):
        try:
            conn.execute(f"ALTER TABLE strategy_backtest_saves ADD COLUMN {col} {ddl}")
        except sqlite3.OperationalError:
            pass
    try:
        conn.execute(
            "ALTER TABLE strategy_configs ADD COLUMN active_backtest_id INTEGER NOT NULL DEFAULT 0"
        )
    except sqlite3.OperationalError:
        pass


def instance_config_hash(class_name: str, vt_symbol: str, params: dict) -> str:
    payload = json.dumps({
        "class_name": class_name or "",
        "vt_symbol": vt_symbol or "",
        "parameters": params or {},
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def backtest_config_hash(
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
    payload = json.dumps({
        "class_name": class_name or "",
        "vt_symbol": vt_symbol or "",
        "parameters": params or {},
        "interval": interval or "",
        "rate": rate,
        "slippage": slippage,
        "size": size,
        "pricetick": pricetick,
        "capital": capital,
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def fmt_return_pct(v) -> str:
    if v is None:
        return "—"
    try:
        return f"{float(v):+.2f}%"
    except (TypeError, ValueError):
        return "—"


def backtest_is_profitable(meta: dict) -> bool:
    if not meta:
        return False
    tr = meta.get("total_return")
    if tr is None:
        return False
    try:
        return float(tr) >= 0
    except (TypeError, ValueError):
        return False


def build_save_meta(result: dict) -> dict:
    params = result.get("parameters") or {}
    class_name = result.get("class_name", "")
    vt_symbol = result.get("vt_symbol", "")
    interval = result.get("interval", "1m")
    rate = float(result.get("rate", 0.0001))
    slippage = float(result.get("slippage", 0.2))
    size = int(result.get("size", 10))
    pricetick = float(result.get("pricetick", 1))
    capital = float(result.get("capital", 1000000))
    ih = instance_config_hash(class_name, vt_symbol, params)
    bh = backtest_config_hash(
        class_name, vt_symbol, params, interval, rate, slippage, size, pricetick, capital,
    )
    return {
        "total_return": result.get("total_return"),
        "sharpe_ratio": result.get("sharpe_ratio"),
        "max_drawdown": result.get("max_drawdown"),
        "total_trades": result.get("total_trades"),
        "vt_symbol": vt_symbol,
        "class_name": class_name,
        "interval": interval,
        "start": result.get("start"),
        "end": result.get("end"),
        "rate": rate,
        "slippage": slippage,
        "size": size,
        "pricetick": pricetick,
        "capital": capital,
        "instance_hash": ih,
        "config_hash": bh,
    }


def stats_fingerprint(meta: dict) -> str:
    payload = json.dumps({
        "config_hash": meta.get("config_hash", ""),
        "total_return": meta.get("total_return"),
        "sharpe_ratio": meta.get("sharpe_ratio"),
        "max_drawdown": meta.get("max_drawdown"),
        "total_trades": meta.get("total_trades"),
    }, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def compute_run_status(config: dict, meta: dict) -> str:
    if not meta:
        return "draft"
    ih = instance_config_hash(
        config.get("class_name", ""),
        config.get("vt_symbol", ""),
        config.get("params", {}),
    )
    if meta.get("instance_hash") != ih:
        return "stale"
    if not backtest_is_profitable(meta):
        return "loss"
    return "passed"


def _default_label(result: dict, created_at: str) -> str:
    ret = result.get("total_return")
    try:
        ret_s = f"{float(ret):+.2f}%" if ret is not None else "—"
    except (TypeError, ValueError):
        ret_s = "—"
    sym = result.get("vt_symbol") or ""
    start = str(result.get("start") or "")[:10]
    end = str(result.get("end") or "")[:10]
    ts = created_at[:16].replace("T", " ")
    range_s = f"{start}~{end}" if start and end else (start or end or "")
    parts = [ts, ret_s]
    if sym:
        parts.append(sym)
    if range_s:
        parts.append(f"({range_s})")
    return " · ".join(parts)


def _detail_path(strategy_name: str, save_id: int) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in strategy_name)
    d = _DETAIL_ROOT / safe
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{save_id}.json"


def _write_detail(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_json_dumps_safe(payload), encoding="utf-8")


def _read_detail(path: str) -> dict | None:
    if not path:
        return None
    p = Path(path)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _delete_detail(path: str) -> None:
    if not path:
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def _slim_gate_snapshot(meta: dict, save_id: int = 0, run_at: str = "") -> dict:
    slim = dict(meta)
    slim["run_at"] = run_at or meta.get("run_at") or datetime.now().isoformat()
    if save_id:
        slim["save_id"] = save_id
    return slim


def _sync_gate_cache(conn: sqlite3.Connection, strategy_name: str, save_id: int, meta: dict) -> None:
    now = datetime.now().isoformat()
    slim = _slim_gate_snapshot(meta, save_id, now)
    conn.execute(
        """UPDATE strategy_configs
           SET last_backtest_json=?, active_backtest_id=?, updated_at=?
           WHERE strategy_name=?""",
        (_json_dumps_safe(slim), save_id, now, strategy_name),
    )


def clear_active_gate(strategy_name: str) -> None:
    with _lock:
        conn = _get_db()
        ensure_backtest_schema(conn)
        conn.execute(
            """UPDATE strategy_configs
               SET last_backtest_json='', active_backtest_id=0, updated_at=?
               WHERE strategy_name=?""",
            (datetime.now().isoformat(), strategy_name),
        )
        conn.execute(
            "UPDATE strategy_backtest_saves SET is_active=0 WHERE strategy_name=?",
            (strategy_name,),
        )
        conn.commit()
        conn.close()


def load_active_snapshot(config: dict) -> dict | None:
    active_id = int(config.get("active_backtest_id") or 0)
    if active_id:
        row = _fetch_save_row(config.get("strategy_name", ""), active_id)
        if row:
            try:
                meta = json.loads(row["meta_json"] or "{}")
            except json.JSONDecodeError:
                meta = {}
            if meta:
                meta = dict(meta)
                meta["save_id"] = active_id
                meta["run_at"] = meta.get("run_at") or row["created_at"]
                return meta
    raw = config.get("last_backtest_json") or ""
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
    return None


def validate_backtest_snapshot(config: dict) -> tuple[bool, str]:
    snap = load_active_snapshot(config)
    if not snap:
        return False, "未回测"
    ih = instance_config_hash(
        config.get("class_name", ""),
        config.get("vt_symbol", ""),
        config.get("params", {}),
    )
    if snap.get("instance_hash") != ih:
        return False, "参数或合约已变更，请重跑回测"
    if not backtest_is_profitable(snap):
        return False, f"回测亏损（收益 {fmt_return_pct(snap.get('total_return'))}），请调整参数后重跑"
    return True, "ok"


def _fetch_save_row(strategy_name: str, save_id: int) -> sqlite3.Row | None:
    with _lock:
        conn = _get_db()
        ensure_backtest_schema(conn)
        row = conn.execute(
            """SELECT * FROM strategy_backtest_saves
               WHERE id=? AND strategy_name=?""",
            (save_id, strategy_name),
        ).fetchone()
        conn.close()
    return row


def _promote_active_gate(conn: sqlite3.Connection, strategy_name: str, config: dict) -> int:
    ih = instance_config_hash(
        config.get("class_name", ""),
        config.get("vt_symbol", ""),
        config.get("params", {}),
    )
    row = conn.execute(
        """SELECT id, meta_json, created_at FROM strategy_backtest_saves
           WHERE strategy_name=? AND instance_hash=? AND status='passed'
           ORDER BY id DESC LIMIT 1""",
        (strategy_name, ih),
    ).fetchone()
    conn.execute(
        "UPDATE strategy_backtest_saves SET is_active=0 WHERE strategy_name=?",
        (strategy_name,),
    )
    if not row:
        conn.execute(
            """UPDATE strategy_configs
               SET last_backtest_json='', active_backtest_id=0, updated_at=?
               WHERE strategy_name=?""",
            (datetime.now().isoformat(), strategy_name),
        )
        return 0
    save_id = row["id"]
    try:
        meta = json.loads(row["meta_json"] or "{}")
    except json.JSONDecodeError:
        meta = {}
    conn.execute(
        "UPDATE strategy_backtest_saves SET is_active=1 WHERE id=?",
        (save_id,),
    )
    _sync_gate_cache(conn, strategy_name, save_id, meta)
    return save_id


def set_active_gate(strategy_name: str, save_id: int, config: dict) -> dict:
    row = _fetch_save_row(strategy_name, save_id)
    if not row:
        return {"error": "记录不存在", "save_id": save_id}
    try:
        meta = json.loads(row["meta_json"] or "{}")
    except json.JSONDecodeError:
        meta = {}
    status = compute_run_status(config, meta)
    if status == "stale":
        return {"error": "该记录与当前实例参数不一致，不能设为验证基准", "save_id": save_id}
    if status == "loss":
        return {"error": "亏损回测不能设为验证基准", "save_id": save_id}
    with _lock:
        conn = _get_db()
        ensure_backtest_schema(conn)
        conn.execute(
            "UPDATE strategy_backtest_saves SET is_active=0 WHERE strategy_name=?",
            (strategy_name,),
        )
        conn.execute(
            "UPDATE strategy_backtest_saves SET is_active=1, status=? WHERE id=?",
            (status, save_id),
        )
        _sync_gate_cache(conn, strategy_name, save_id, meta)
        conn.commit()
        conn.close()
    return {"active_backtest_id": save_id, "status": status, **meta}


def persist_backtest_run(
    strategy_name: str,
    result: dict,
    config: dict,
    *,
    auto: bool = True,
    set_active_on_pass: bool = True,
    manual: bool = False,
) -> dict:
    """Save run to archive; update Active Gate only when passed (Phase 1)."""
    settings = get_settings()
    now = datetime.now().isoformat()
    meta = build_save_meta(result)
    status = compute_run_status(config, meta)
    fp = stats_fingerprint(meta)

    if not manual and status == "loss" and not settings.get("auto_archive_loss", True):
        return {"skipped": True, "reason": "loss_not_archived", "status": status, **meta}

    with _lock:
        conn = _get_db()
        ensure_backtest_schema(conn)

        dup = conn.execute(
            """SELECT id FROM strategy_backtest_saves
               WHERE strategy_name=? AND config_hash=? AND stats_fingerprint=?
               ORDER BY id DESC LIMIT 1""",
            (strategy_name, meta.get("config_hash", ""), fp),
        ).fetchone()
        if dup and auto and not manual:
            save_id = dup["id"]
            item = {"id": save_id, "deduped": True, "status": status, **meta}
            if status == "passed" and set_active_on_pass:
                conn.execute(
                    "UPDATE strategy_backtest_saves SET is_active=0 WHERE strategy_name=?",
                    (strategy_name,),
                )
                conn.execute(
                    "UPDATE strategy_backtest_saves SET is_active=1, status=? WHERE id=?",
                    (status, save_id),
                )
                _sync_gate_cache(conn, strategy_name, save_id, meta)
            conn.commit()
            conn.close()
            return item

        label = (result.get("save_label") or "").strip()
        if not label:
            label = _default_label({**result, **meta}, now)

        payload = {**result, **meta, "run_at": now}
        cur = conn.execute(
            """INSERT INTO strategy_backtest_saves
               (strategy_name, label, result_json, meta_json, created_at,
                is_active, status, config_hash, instance_hash, stats_fingerprint, detail_path)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                strategy_name,
                label,
                "{}",
                _json_dumps_safe(meta),
                now,
                0,
                status,
                meta.get("config_hash", ""),
                meta.get("instance_hash", ""),
                fp,
                "",
            ),
        )
        save_id = cur.lastrowid
        detail = _detail_path(strategy_name, save_id)
        _write_detail(detail, payload)
        conn.execute(
            "UPDATE strategy_backtest_saves SET detail_path=? WHERE id=?",
            (str(detail), save_id),
        )

        if status == "passed" and set_active_on_pass:
            conn.execute(
                "UPDATE strategy_backtest_saves SET is_active=0 WHERE strategy_name=?",
                (strategy_name,),
            )
            conn.execute(
                "UPDATE strategy_backtest_saves SET is_active=1 WHERE id=?",
                (save_id,),
            )
            _sync_gate_cache(conn, strategy_name, save_id, meta)

        conn.commit()
        _apply_retention_locked(conn, strategy_name, settings)
        conn.commit()
        conn.close()

    return {
        "id": save_id,
        "label": label,
        "created_at": now,
        "status": status,
        "is_active": status == "passed" and set_active_on_pass,
        **meta,
    }


def save_backtest_save(
    strategy_name: str,
    result: dict,
    config: dict,
    label: str = "",
    set_active: bool = False,
) -> dict:
    if label.strip():
        result = {**result, "save_label": label.strip()}
    item = persist_backtest_run(
        strategy_name,
        result,
        config,
        auto=False,
        set_active_on_pass=set_active,
        manual=True,
    )
    if set_active and not item.get("error") and item.get("status") == "passed":
        set_active_gate(strategy_name, item["id"], config)
    return item


def list_backtest_saves(strategy_name: str, config: dict | None = None) -> list[dict]:
    cfg = config or {}
    active_id = int(cfg.get("active_backtest_id") or 0)
    with _lock:
        conn = _get_db()
        ensure_backtest_schema(conn)
        if not active_id and cfg.get("strategy_name"):
            row = conn.execute(
                "SELECT active_backtest_id FROM strategy_configs WHERE strategy_name=?",
                (strategy_name,),
            ).fetchone()
            if row:
                active_id = int(row["active_backtest_id"] or 0)
        rows = conn.execute(
            """SELECT id, strategy_name, label, meta_json, created_at,
                      is_active, status, config_hash, instance_hash
               FROM strategy_backtest_saves
               WHERE strategy_name=?
               ORDER BY id DESC""",
            (strategy_name,),
        ).fetchall()
        conn.close()

    out: list[dict] = []
    for row in rows:
        item = {
            "id": row["id"],
            "strategy_name": row["strategy_name"],
            "label": row["label"],
            "created_at": row["created_at"],
            "is_active": bool(row["is_active"]),
            "status": row["status"] or "draft",
        }
        try:
            meta = json.loads(row["meta_json"] or "{}")
            item.update(meta)
        except json.JSONDecodeError:
            meta = {}
        if cfg:
            item["status"] = compute_run_status(cfg, meta)
        status_labels = {
            "passed": "通过",
            "loss": "亏损",
            "stale": "已过期",
            "draft": "草稿",
        }
        item["status_label"] = status_labels.get(item["status"], item["status"])
        if item["is_active"]:
            item["label_display"] = f"[验证基准] {item['label']}"
        else:
            item["label_display"] = f"[{item['status_label']}] {item['label']}"
        out.append(item)
    return out


def get_backtest_save(
    strategy_name: str,
    save_id: int,
    *,
    include_detail: bool = True,
) -> dict | None:
    row = _fetch_save_row(strategy_name, save_id)
    if not row:
        return None
    try:
        meta = json.loads(row["meta_json"] or "{}")
    except json.JSONDecodeError:
        meta = {}
    result = dict(meta)
    if include_detail:
        detail = _read_detail(row["detail_path"] or "")
        if not detail:
            try:
                detail = json.loads(row["result_json"] or "{}")
            except json.JSONDecodeError:
                detail = {}
        if detail:
            result = {**detail, **meta}
    result["save_id"] = row["id"]
    result["save_label"] = row["label"]
    result["strategy_name"] = row["strategy_name"]
    result["saved_at"] = row["created_at"]
    result["is_active"] = bool(row["is_active"])
    result["status"] = row["status"] or "draft"
    return result


def get_backtest_save_detail(strategy_name: str, save_id: int) -> dict | None:
    return get_backtest_save(strategy_name, save_id, include_detail=True)


def delete_backtest_save(strategy_name: str, save_id: int, config: dict) -> dict:
    with _lock:
        conn = _get_db()
        ensure_backtest_schema(conn)
        row = conn.execute(
            "SELECT id, is_active, detail_path FROM strategy_backtest_saves WHERE id=? AND strategy_name=?",
            (save_id, strategy_name),
        ).fetchone()
        if not row:
            conn.close()
            return {"error": "记录不存在", "save_id": save_id}
        was_active = bool(row["is_active"])
        _delete_detail(row["detail_path"] or "")
        conn.execute(
            "DELETE FROM strategy_backtest_saves WHERE id=? AND strategy_name=?",
            (save_id, strategy_name),
        )
        new_active = 0
        if was_active:
            new_active = _promote_active_gate(conn, strategy_name, config)
        conn.commit()
        conn.close()
    return {
        "deleted": save_id,
        "strategy_name": strategy_name,
        "promoted_active_id": new_active,
    }


def delete_backtest_saves_for_strategy(strategy_name: str) -> None:
    with _lock:
        conn = _get_db()
        ensure_backtest_schema(conn)
        rows = conn.execute(
            "SELECT detail_path FROM strategy_backtest_saves WHERE strategy_name=?",
            (strategy_name,),
        ).fetchall()
        for row in rows:
            _delete_detail(row["detail_path"] or "")
        conn.execute(
            "DELETE FROM strategy_backtest_saves WHERE strategy_name=?",
            (strategy_name,),
        )
        conn.commit()
        conn.close()


def export_backtest_save(strategy_name: str, save_id: int) -> dict | None:
    data = get_backtest_save(strategy_name, save_id, include_detail=True)
    if not data:
        return None
    trades = data.get("trades") or []
    return {
        "exported_at": datetime.now().isoformat(),
        "strategy_name": strategy_name,
        "save_id": save_id,
        "label": data.get("save_label"),
        "status": data.get("status"),
        "is_active": data.get("is_active"),
        "stats": {
            k: data.get(k)
            for k in (
                "total_return", "sharpe_ratio", "max_drawdown", "annual_return",
                "total_trades", "start", "end", "interval", "vt_symbol", "class_name",
                "config_hash", "instance_hash",
            )
        },
        "trades": trades[:500],
        "trade_count": len(trades),
    }


def latest_run_summary(strategy_name: str, config: dict) -> dict | None:
    """Most recent save for current instance (any status)."""
    ih = instance_config_hash(
        config.get("class_name", ""),
        config.get("vt_symbol", ""),
        config.get("params", {}),
    )
    with _lock:
        conn = _get_db()
        ensure_backtest_schema(conn)
        row = conn.execute(
            """SELECT id, meta_json, created_at, status FROM strategy_backtest_saves
               WHERE strategy_name=? AND instance_hash=?
               ORDER BY id DESC LIMIT 1""",
            (strategy_name, ih),
        ).fetchone()
        conn.close()
    if not row:
        return None
    try:
        meta = json.loads(row["meta_json"] or "{}")
    except json.JSONDecodeError:
        meta = {}
    return {
        "save_id": row["id"],
        "created_at": row["created_at"],
        "status": compute_run_status(config, meta),
        **meta,
    }


def _apply_retention_locked(
    conn: sqlite3.Connection,
    strategy_name: str,
    settings: dict | None = None,
) -> None:
    settings = settings or get_settings()
    max_n = int(settings.get("max_saves_per_strategy") or 0)
    retention_days = int(settings.get("retention_days") or 0)
    cutoff = ""
    if retention_days > 0:
        cutoff = (datetime.now() - timedelta(days=retention_days)).isoformat()

    rows = conn.execute(
        """SELECT id, is_active, detail_path, created_at FROM strategy_backtest_saves
           WHERE strategy_name=? ORDER BY id ASC""",
        (strategy_name,),
    ).fetchall()
    to_delete: list[sqlite3.Row] = []
    if max_n > 0:
        active_count = sum(1 for r in rows if r["is_active"])
        while len(rows) - len(to_delete) > max_n:
            removed = False
            for r in rows:
                if r in to_delete or r["is_active"]:
                    continue
                to_delete.append(r)
                removed = True
                break
            if not removed:
                break
    if cutoff:
        for r in rows:
            if r["is_active"] or r in to_delete:
                continue
            if r["created_at"] < cutoff:
                to_delete.append(r)
    seen: set[int] = set()
    for r in to_delete:
        if r["id"] in seen or r["is_active"]:
            continue
        seen.add(r["id"])
        _delete_detail(r["detail_path"] or "")
        conn.execute(
            "DELETE FROM strategy_backtest_saves WHERE id=?",
            (r["id"],),
        )


def migrate_legacy_gates(conn: sqlite3.Connection | None = None) -> None:
    """Link active_backtest_id from last_backtest_json when missing."""
    own_conn = conn is None
    if own_conn:
        conn = _get_db()
        ensure_backtest_schema(conn)
    rows = conn.execute(
        """SELECT strategy_name, last_backtest_json, active_backtest_id,
                  class_name, vt_symbol, params_json
           FROM strategy_configs WHERE last_backtest_json != ''"""
    ).fetchall()
    for row in rows:
        if int(row["active_backtest_id"] or 0):
            continue
        try:
            snap = json.loads(row["last_backtest_json"] or "{}")
        except json.JSONDecodeError:
            continue
        try:
            params = json.loads(row["params_json"] or "{}")
        except json.JSONDecodeError:
            params = {}
        config = {
            "strategy_name": row["strategy_name"],
            "class_name": row["class_name"],
            "vt_symbol": row["vt_symbol"],
            "params": params,
        }
        bh = snap.get("config_hash", "")
        match = None
        if bh:
            match = conn.execute(
                """SELECT id FROM strategy_backtest_saves
                   WHERE strategy_name=? AND config_hash=? ORDER BY id DESC LIMIT 1""",
                (row["strategy_name"], bh),
            ).fetchone()
        if match:
            conn.execute(
                "UPDATE strategy_configs SET active_backtest_id=? WHERE strategy_name=?",
                (match["id"], row["strategy_name"]),
            )
            conn.execute(
                "UPDATE strategy_backtest_saves SET is_active=1 WHERE id=?",
                (match["id"],),
            )
        elif backtest_is_profitable(snap):
            conn.execute(
                "UPDATE strategy_configs SET active_backtest_id=0 WHERE strategy_name=?",
                (row["strategy_name"],),
            )
    if own_conn:
        conn.commit()
        conn.close()


# Legacy aliases used by strategy_service imports
clear_backtest_snapshot = clear_active_gate


def save_backtest_snapshot(strategy_name: str, snapshot: dict) -> None:
    """Deprecated direct gate write — use persist_backtest_run instead."""
    config_row = None
    with _lock:
        conn = _get_db()
        ensure_backtest_schema(conn)
        row = conn.execute(
            "SELECT * FROM strategy_configs WHERE strategy_name=?",
            (strategy_name,),
        ).fetchone()
        conn.close()
    if not row:
        return
    config = dict(row)
    try:
        config["params"] = json.loads(config.get("params_json") or "{}")
    except json.JSONDecodeError:
        config["params"] = {}
    if not backtest_is_profitable(snapshot):
        return
    meta = build_save_meta(snapshot)
    with _lock:
        conn = _get_db()
        ensure_backtest_schema(conn)
        _sync_gate_cache(conn, strategy_name, int(config.get("active_backtest_id") or 0), meta)
        conn.commit()
        conn.close()
