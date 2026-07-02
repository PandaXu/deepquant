"""DatabaseWriter — persist tick/bar data to SQLite (matching existing vnpy schema)."""
import sqlite3
import os
from pathlib import Path
from datetime import datetime


class DatabaseWriter:

    def __init__(self, db_path: str = ""):
        self._db_path = db_path or str(Path.home() / ".vntrader" / "database.db")
        os.makedirs(os.path.dirname(self._db_path), exist_ok=True)

    def _get_conn(self):
        return sqlite3.connect(self._db_path)

    async def save_ticks(self, vt_symbol: str, ticks: list[dict]):
        conn = self._get_conn()
        for t in ticks:
            try:
                conn.execute("""
                    INSERT INTO dbtickdata
                    (symbol, exchange, datetime, name, volume, turnover, open_interest,
                     last_price, last_volume, limit_up, limit_down,
                     open_price, high_price, low_price, pre_close,
                     bid_price_1, bid_price_2, bid_price_3, bid_price_4, bid_price_5,
                     ask_price_1, ask_price_2, ask_price_3, ask_price_4, ask_price_5,
                     bid_volume_1, bid_volume_2, bid_volume_3, bid_volume_4, bid_volume_5,
                     ask_volume_1, ask_volume_2, ask_volume_3, ask_volume_4, ask_volume_5,
                     localtime)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                            ?, ?, ?, ?, ?, ?)
                """, (
                    t.get("symbol", ""),
                    t.get("exchange", ""),
                    t.get("datetime", datetime.now().isoformat()),
                    t.get("name", ""),
                    t.get("volume", 0), t.get("turnover", 0),
                    t.get("open_interest", 0),
                    t.get("last_price", 0), t.get("last_volume", 0),
                    t.get("limit_up", 0), t.get("limit_down", 0),
                    t.get("open_price", 0), t.get("high_price", 0),
                    t.get("low_price", 0), t.get("pre_close", 0),
                    t.get("bid_price_1", 0), t.get("bid_price_2", 0),
                    t.get("bid_price_3", 0), t.get("bid_price_4", 0),
                    t.get("bid_price_5", 0),
                    t.get("ask_price_1", 0), t.get("ask_price_2", 0),
                    t.get("ask_price_3", 0), t.get("ask_price_4", 0),
                    t.get("ask_price_5", 0),
                    t.get("bid_volume_1", 0), t.get("bid_volume_2", 0),
                    t.get("bid_volume_3", 0), t.get("bid_volume_4", 0),
                    t.get("bid_volume_5", 0),
                    t.get("ask_volume_1", 0), t.get("ask_volume_2", 0),
                    t.get("ask_volume_3", 0), t.get("ask_volume_4", 0),
                    t.get("ask_volume_5", 0),
                    t.get("localtime", datetime.now().isoformat()),
                ))
            except Exception:
                pass
        conn.commit()
        conn.close()

    async def save_bars(self, vt_symbol: str, bars: list[dict]):
        pass  # bar writing not implemented yet
