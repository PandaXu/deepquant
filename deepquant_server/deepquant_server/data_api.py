"""Data management REST/WS helpers for Web UI."""
from __future__ import annotations

import csv
import io
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from deepquant.trader.constant import Exchange, Interval
from deepquant.trader.database import get_database
from deepquant.trader.object import BarData
from deepquant.trader.utility import ZoneInfo


def _iso(dt: datetime | None) -> str:
    return dt.isoformat() if dt else ""


def serialize_bar_overview(o: Any) -> dict:
    ex = o.exchange.value if o.exchange else ""
    itv = o.interval.value if o.interval else ""
    return {
        "symbol": o.symbol,
        "exchange": ex,
        "interval": itv,
        "count": o.count,
        "start": _iso(o.start),
        "end": _iso(o.end),
        "vt_symbol": f"{o.symbol}.{ex}" if ex else o.symbol,
        "kind": "bar",
    }


def serialize_tick_overview(o: Any) -> dict:
    ex = o.exchange.value if o.exchange else ""
    return {
        "symbol": o.symbol,
        "exchange": ex,
        "interval": "tick",
        "count": o.count,
        "start": _iso(o.start),
        "end": _iso(o.end),
        "vt_symbol": f"{o.symbol}.{ex}" if ex else o.symbol,
        "kind": "tick",
    }


def load_bar_overviews(main_engine) -> list[dict]:
    engine = main_engine.get_engine("DataManager") if main_engine else None
    if engine:
        try:
            return [serialize_bar_overview(o) for o in engine.get_bar_overview()]
        except Exception:
            pass
    db = get_database()
    try:
        return [serialize_bar_overview(o) for o in (db.get_bar_overview() or [])]
    except Exception:
        return []


def load_tick_overviews() -> list[dict]:
    db = get_database()
    try:
        return [serialize_tick_overview(o) for o in (db.get_tick_overview() or [])]
    except Exception:
        return []


def load_data_overview(main_engine) -> dict:
    from deepquant.trader.setting import SETTINGS
    from . import data_update_service

    db_path = SETTINGS.get("database.database") or SETTINGS.get("database.name") or "~/.vntrader/database.db"
    ticks = load_tick_overviews()
    tick_by = {f"{r['symbol']}.{r['exchange']}": r for r in ticks}
    bars = [data_update_service.enrich_bar_overview(r, tick_by) for r in load_bar_overviews(main_engine)]
    return {
        "bars": bars,
        "ticks": ticks,
        "db_path": str(db_path),
    }


def load_data_health(main_engine, has_datamanager: bool) -> dict:
    dm_engine = main_engine.get_engine("DataManager") if main_engine and has_datamanager else None
    datafeed_ok = False
    if dm_engine and hasattr(dm_engine, "datafeed"):
        datafeed_ok = dm_engine.datafeed is not None
    bars = load_bar_overviews(main_engine)
    ticks = load_tick_overviews()
    bar_count = sum(r.get("count", 0) for r in bars)
    tick_count = sum(r.get("count", 0) for r in ticks)
    db_path, db_size = _resolve_db_path_and_size()
    return {
        "datamanager": bool(dm_engine),
        "datafeed": datafeed_ok,
        "db_path": db_path,
        "db_size_bytes": db_size,
        "bar_series": len(bars),
        "tick_series": len(ticks),
        "bar_total_count": bar_count,
        "tick_total_count": tick_count,
        "recorder": {
            "tick_symbols": len(ticks),
            "bar_symbols": len(bars),
            "hint": "由 start.sh 启动 DataRecorder，连接 Gateway WS 写入本地库",
        },
    }


def _resolve_db_path_and_size() -> tuple[str, int]:
    from deepquant.trader.setting import SETTINGS
    db_path = str(SETTINGS.get("database.database") or SETTINGS.get("database.name") or "~/.vntrader/database.db")
    expanded = os.path.expanduser(db_path)
    size = 0
    try:
        p = Path(expanded)
        if p.is_file():
            size = p.stat().st_size
    except Exception:
        pass
    return db_path, size


def find_bar_overview(main_engine, symbol: str, exchange: str, interval: str) -> dict | None:
    for row in load_bar_overviews(main_engine):
        if row["symbol"] == symbol and row["exchange"] == exchange and row["interval"] == interval:
            return row
    return None


def ensure_public_datafeed(main_engine) -> None:
    """Ensure DataManager uses PublicDatafeed when no external datafeed is configured."""
    import sys
    from deepquant.trader.setting import SETTINGS
    if SETTINGS.get("datafeed.name"):
        return
    try:
        from deepquant.trader.public_datafeed import PublicDatafeed
        pf = PublicDatafeed()
        pf.init(lambda _msg: None)
        for mod_name in ("deepquant.trader.datafeed", "vnpy.trader.datafeed"):
            mod = sys.modules.get(mod_name)
            if mod is not None:
                mod.datafeed = pf
        engine = main_engine.get_engine("DataManager") if main_engine else None
        if engine:
            engine.datafeed = pf
    except Exception as e:
        if main_engine:
            main_engine.write_log(f"[DataManager] PublicDatafeed 注入失败: {e}")


def run_download_bar(
    main_engine,
    symbol: str,
    exchange: str,
    interval: str,
    start: datetime,
    end: datetime | None = None,
    on_log: Callable[[str], None] | None = None,
) -> tuple[str, int]:
    """Download bar data via DataManager. Returns (status, count)."""
    import inspect
    from deepquant.trader.constant import Exchange, Interval
    from deepquant.trader.object import HistoryRequest
    from deepquant.trader.setting import SETTINGS

    engine = main_engine.get_engine("DataManager")
    if not engine:
        return "error", 0

    ensure_public_datafeed(main_engine)
    output = on_log or (lambda msg: None)
    end_dt = end or datetime.now()
    try:
        # Use PublicDatafeed when no paid datafeed plugin is configured
        df_name = SETTINGS.get("datafeed.name") or ""
        if df_name in ("", "public"):
            from deepquant.trader.public_datafeed import PublicDatafeed
            req = HistoryRequest(
                symbol=symbol,
                exchange=Exchange(exchange),
                interval=Interval(interval),
                start=start,
                end=end_dt,
            )
            data = PublicDatafeed().query_bar_history(req, output)
            if data:
                engine.database.save_bar_data(data)
                return "success", len(data)
            return "success", 0

        kwargs: dict = {}
        sig = inspect.signature(engine.download_bar_data)
        if end is not None and "end" in sig.parameters:
            kwargs["end"] = end
        count = engine.download_bar_data(
            symbol,
            Exchange(exchange),
            interval,
            start,
            output,
            **kwargs,
        )
        if count and count > 0:
            return "success", int(count)
        return "success", 0
    except Exception as e:
        if on_log:
            on_log(f"[DataManager] 下载失败: {e}")
        return "error", 0


def load_bars_for_export(
    main_engine,
    symbol: str,
    exchange: str,
    interval: str,
    start: datetime,
    end: datetime,
) -> list[BarData]:
    engine = main_engine.get_engine("DataManager") if main_engine else None
    ex = Exchange(exchange)
    itv = Interval(interval)
    if engine:
        return engine.load_bar_data(symbol, ex, itv, start, end)
    db = get_database()
    return db.load_bar_data(symbol, ex, itv, start, end) or []


def bars_to_csv(bars: list[BarData]) -> str:
    out = io.StringIO()
    fields = [
        "symbol", "exchange", "datetime", "open", "high", "low", "close",
        "volume", "turnover", "open_interest",
    ]
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for bar in bars:
        writer.writerow({
            "symbol": bar.symbol,
            "exchange": bar.exchange.value if bar.exchange else "",
            "datetime": bar.datetime.strftime("%Y-%m-%d %H:%M:%S"),
            "open": bar.open_price,
            "high": bar.high_price,
            "low": bar.low_price,
            "close": bar.close_price,
            "volume": bar.volume,
            "turnover": bar.turnover,
            "open_interest": bar.open_interest,
        })
    return out.getvalue()


def import_bars_csv(
    main_engine,
    content: str,
    symbol: str,
    exchange: str,
    interval: str,
    mapping: dict | None = None,
) -> dict:
    """Import OHLCV CSV into database."""
    mapping = mapping or {}
    tz_name = mapping.get("tz_name", "Asia/Shanghai")
    datetime_head = mapping.get("datetime_head", "datetime")
    open_head = mapping.get("open_head", "open")
    high_head = mapping.get("high_head", "high")
    low_head = mapping.get("low_head", "low")
    close_head = mapping.get("close_head", "close")
    volume_head = mapping.get("volume_head", "volume")
    turnover_head = mapping.get("turnover_head", "turnover")
    open_interest_head = mapping.get("open_interest_head", "open_interest")
    datetime_format = mapping.get("datetime_format", "")

    engine = main_engine.get_engine("DataManager") if main_engine else None
    if engine and hasattr(engine, "import_data_from_csv"):
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as f:
                f.write(content.lstrip("\ufeff"))
                tmp_path = f.name
            start, end, count = engine.import_data_from_csv(
                tmp_path, symbol, Exchange(exchange), Interval(interval), tz_name,
                datetime_head, open_head, high_head, low_head, close_head,
                volume_head, turnover_head, open_interest_head, datetime_format,
            )
            return {"count": count, "start": _iso(start), "end": _iso(end)}
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

    tz = ZoneInfo(tz_name)
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
    bars: list[BarData] = []
    start_dt: datetime | None = None
    end_dt: datetime | None = None
    for item in reader:
        raw_dt = item.get(datetime_head, "")
        if not raw_dt:
            continue
        if datetime_format:
            dt = datetime.strptime(raw_dt, datetime_format)
        else:
            dt = datetime.fromisoformat(raw_dt.replace(" ", "T") if "T" not in raw_dt else raw_dt)
        dt = dt.replace(tzinfo=tz).replace(tzinfo=None)
        bar = BarData(
            symbol=symbol,
            exchange=Exchange(exchange),
            datetime=dt,
            interval=Interval(interval),
            volume=float(item.get(volume_head) or 0),
            open_price=float(item.get(open_head) or 0),
            high_price=float(item.get(high_head) or 0),
            low_price=float(item.get(low_head) or 0),
            close_price=float(item.get(close_head) or 0),
            turnover=float(item.get(turnover_head) or 0),
            open_interest=float(item.get(open_interest_head) or 0),
            gateway_name="DB",
        )
        bars.append(bar)
        start_dt = start_dt or dt
        end_dt = dt
    if not bars:
        return {"count": 0, "start": "", "end": "", "error": "CSV 无有效数据行"}
    get_database().save_bar_data(bars)
    return {"count": len(bars), "start": _iso(start_dt), "end": _iso(end_dt)}


def check_data_coverage(main_engine, items: list[dict]) -> list[dict]:
    """Check whether local bar/tick data covers requested ranges (with gap detection)."""
    from . import data_update_service

    bar_rows = {f"{r['symbol']}.{r['exchange']}:{r['interval']}": r for r in load_bar_overviews(main_engine)}
    tick_rows = {f"{r['symbol']}.{r['exchange']}": r for r in load_tick_overviews()}
    return [
        data_update_service.check_item_coverage(main_engine, item, bar_rows, tick_rows)
        for item in items
    ]
