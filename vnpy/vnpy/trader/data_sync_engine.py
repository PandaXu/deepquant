"""
Background data sync engine — auto-fills historical data for all contracts.
Uses public data (akshare/Sina) to download missing daily + minute bars.
Runs on startup, then daily refresh via EVENT_TIMER.
"""
import json
import threading
from datetime import datetime, timedelta
from pathlib import Path

from vnpy.event import Event, EventEngine
from vnpy.trader.engine import BaseEngine, MainEngine
from vnpy.trader.constant import Exchange, Interval
from vnpy.trader.object import HistoryRequest, BarData
from vnpy.trader.event import EVENT_TIMER
from vnpy.trader.database import get_database, BarOverview, DB_TZ
from vnpy.trader.utility import get_file_path
from vnpy.trader.contract_cache import get_cache, query_contracts, refresh_cache

APP_NAME = "DataSync"
CONFIG_FILE = "data_sync_config.json"

# CFFEX futures products to sync (skip options — Sina doesn't support them)
CFFEX_PRODUCTS = ["IF", "IC", "IH", "IM", "T", "TF", "TS", "TL"]


class DataSyncEngine(BaseEngine):
    """Auto-sync historical data for all contracts."""

    def __init__(self, main_engine: MainEngine, event_engine: EventEngine) -> None:
        super().__init__(main_engine, event_engine, APP_NAME)
        self.database = get_database()
        self._active = False
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._progress_cb = None

        # Load config
        self.config = self._load_config()
        # Default: 3 years lookback
        self.config.setdefault("lookback_years", 3)
        self.config.setdefault("auto_sync", True)
        self.config.setdefault("sync_exchanges", ["CFFEX"])
        self.config.setdefault("sync_minute", True)
        self._save_config()

    def _load_config(self) -> dict:
        path = get_file_path(CONFIG_FILE)
        try:
            with open(path, encoding="UTF-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_config(self) -> None:
        path = get_file_path(CONFIG_FILE)
        with open(path, "w", encoding="UTF-8") as f:
            json.dump(self.config, f, indent=2, ensure_ascii=False)

    def set_progress_callback(self, cb) -> None:
        self._progress_cb = cb

    def _log(self, msg: str) -> None:
        self.main_engine.write_log(f"[DataSync] {msg}")
        if self._progress_cb:
            self._progress_cb(msg)

    def start_sync(self, blocking: bool = False) -> None:
        """Start background sync."""
        if self._active:
            self._log("同步任务已在运行中")
            return

        self._active = True
        self._log(f"开始数据同步 (回溯{self.config['lookback_years']}年)...")

        def _run():
            try:
                self._do_sync()
            except Exception as e:
                self._log(f"同步异常: {e}")
            finally:
                self._active = False
                self._log("数据同步完成")

        if blocking:
            _run()
        else:
            self._thread = threading.Thread(target=_run, daemon=True)
            self._thread.start()

    def _do_sync(self) -> None:
        """Main sync logic."""
        from vnpy.trader.public_datafeed import PublicDatafeed
        datafeed = PublicDatafeed()
        lookback = self.config["lookback_years"]
        start = datetime.now(DB_TZ) - timedelta(days=lookback * 365)
        end = datetime.now(DB_TZ)

        # Get existing data overview
        existing = {(o.symbol, o.exchange.value, o.interval.value)
                    for o in self.database.get_bar_overview()}

        total_synced = 0
        for ex_code in self.config["sync_exchanges"]:
            try:
                exchange = Exchange(ex_code)
            except ValueError:
                continue

            self._log(f"检查 {ex_code}({exchange.display_name})...")

            # Get contracts from cache (ensure loaded)
            contracts = query_contracts(exchange)
            if not contracts:
                self._log(f"  {ex_code} 无合约数据，跳过")
                continue

            # Filter: skip options
            futures = [c for c in contracts if "-" not in c["symbol"]]
            self._log(f"  {ex_code}: {len(futures)} 个期货合约")

            for contract in futures:
                symbol = contract["symbol"]
                vt_key_daily = (symbol, ex_code, "d")
                vt_key_minute = (symbol, ex_code, "1m")

                # Daily data
                if vt_key_daily not in existing:
                    try:
                        count = self._download(datafeed, symbol, exchange, Interval.DAILY, start, end)
                        if count > 0:
                            existing.add(vt_key_daily)
                            total_synced += count
                            self._log(f"  ✅ {symbol}.{ex_code} 日线 → {count}条")
                    except Exception as e:
                        self._log(f"  ❌ {symbol}.{ex_code} 日线失败: {e}")

                # Minute data
                if self.config["sync_minute"] and vt_key_minute not in existing:
                    try:
                        count = self._download(datafeed, symbol, exchange, Interval.MINUTE,
                                              datetime.now(DB_TZ) - timedelta(days=7), end)
                        if count > 0:
                            existing.add(vt_key_minute)
                            total_synced += count
                    except Exception:
                        pass  # Minute sync is best-effort

        self._log(f"同步完成: 新增 {total_synced} 条数据")

    def _download(self, datafeed, symbol: str, exchange: Exchange,
                  interval: Interval, start: datetime, end: datetime) -> int:
        """Download and save bar data."""
        req = HistoryRequest(
            symbol=symbol, exchange=exchange, interval=interval,
            start=start, end=end
        )
        bars = datafeed.query_bar_history(req, output=lambda msg: None)
        if bars:
            self.database.save_bar_data(bars)
        return len(bars)

    def get_status(self) -> dict:
        """Return sync status summary."""
        overviews = self.database.get_bar_overview()
        by_exchange: dict[str, int] = {}
        for o in overviews:
            by_exchange[o.exchange.value] = by_exchange.get(o.exchange.value, 0) + 1
        return {
            "active": self._active,
            "config": self.config,
            "total_contracts": len(overviews),
            "by_exchange": by_exchange,
        }

    def close(self) -> None:
        self._active = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
