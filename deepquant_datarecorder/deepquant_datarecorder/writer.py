"""DatabaseWriter — persist tick/bar data to SQLite."""
import sqlite3
import os
from pathlib import Path
from datetime import datetime
import asyncio


class DatabaseWriter:
    """Write tick and bar data to a SQLite database."""

    def __init__(self, db_path: str = ""):
        self._db_path = db_path or str(Path.home() / ".vntrader" / "database.db")
        os.makedirs(os.path.dirname(self._db_path), exist_ok=True)
        self._ensure_tables()

    def _get_conn(self):
        return sqlite3.connect(self._db_path)

    def _ensure_tables(self):
        conn = self._get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dbbardata (
                vt_symbol TEXT, symbol TEXT, exchange TEXT,
                datetime TEXT, interval TEXT,
                open_price REAL, high_price REAL, low_price REAL, close_price REAL,
                volume REAL, open_interest REAL,
                gateway_name TEXT,
                PRIMARY KEY (vt_symbol, datetime, interval)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dbtickdata (
                vt_symbol TEXT, symbol TEXT, exchange TEXT,
                datetime TEXT,
                last_price REAL, volume REAL, open_interest REAL,
                bid_price_1 REAL, bid_volume_1 REAL,
                ask_price_1 REAL, ask_volume_1 REAL,
                gateway_name TEXT,
                PRIMARY KEY (vt_symbol, datetime)
            )
        """)
        conn.commit()
        conn.close()

    async def save_ticks(self, vt_symbol: str, ticks: list[dict]):
        """Batch insert ticks."""
        await asyncio.to_thread(self._save_ticks_sync, vt_symbol, ticks)

    def _save_ticks_sync(self, vt_symbol: str, ticks: list[dict]):
        conn = self._get_conn()
        for t in ticks:
            try:
                conn.execute("""
                    INSERT OR REPLACE INTO dbtickdata
                    (vt_symbol, symbol, exchange, datetime, last_price, volume, open_interest,
                     bid_price_1, bid_volume_1, ask_price_1, ask_volume_1, gateway_name)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    t.get("vt_symbol", vt_symbol),
                    t.get("symbol", ""),
                    t.get("exchange", ""),
                    t.get("datetime", datetime.now().isoformat()),
                    t.get("last_price", 0),
                    t.get("volume", 0),
                    t.get("open_interest", 0),
                    t.get("bid_price_1", 0), t.get("bid_volume_1", 0),
                    t.get("ask_price_1", 0), t.get("ask_volume_1", 0),
                    t.get("gateway_name", ""),
                ))
            except Exception:
                pass
        conn.commit()
        conn.close()

    async def save_bars(self, vt_symbol: str, bars: list[dict]):
        """Batch insert bars."""
        await asyncio.to_thread(self._save_bars_sync, vt_symbol, bars)

    def _save_bars_sync(self, vt_symbol: str, bars: list[dict]):
        conn = self._get_conn()
        for b in bars:
            try:
                conn.execute("""
                    INSERT OR REPLACE INTO dbbardata
                    (vt_symbol, symbol, exchange, datetime, interval,
                     open_price, high_price, low_price, close_price,
                     volume, open_interest, gateway_name)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    b.get("vt_symbol", vt_symbol),
                    b.get("symbol", ""),
                    b.get("exchange", ""),
                    b.get("datetime", datetime.now().isoformat()),
                    b.get("interval", "1m"),
                    b.get("open_price", 0), b.get("high_price", 0),
                    b.get("low_price", 0), b.get("close_price", 0),
                    b.get("volume", 0), b.get("open_interest", 0),
                    b.get("gateway_name", ""),
                ))
            except Exception:
                pass
        conn.commit()
        conn.close()
