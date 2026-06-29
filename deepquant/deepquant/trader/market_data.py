"""
Public market data fallback — fetches real-time quotes from akshare
when CTP has no cached data (e.g., non-trading hours or never subscribed).
"""
import threading
from datetime import datetime, time
from typing import Optional

import pandas as pd

from deepquant.trader.object import TickData
from deepquant.trader.constant import Exchange
from deepquant.trader.utility import extract_vt_symbol

# Chinese futures trading hours (Beijing time)
TRADING_SESSIONS = [
    (time(9, 0),  time(10, 15)),
    (time(10, 30), time(11, 30)),
    (time(13, 30), time(15, 0)),
    (time(21, 0),  time(23, 59)),   # night session
    (time(0, 0),   time(2, 30)),    # night session (next day)
]

_akshare_cache: Optional[pd.DataFrame] = None
_cache_lock = threading.Lock()


def is_trading_time() -> bool:
    """Check if current time is within Chinese futures trading hours."""
    now = datetime.now().time()
    for start, end in TRADING_SESSIONS:
        if start <= now <= end:
            return True
    return False


def fetch_realtime_quotes() -> Optional[pd.DataFrame]:
    """Fetch real-time futures quotes from akshare. Cached for 60 seconds."""
    global _akshare_cache
    with _cache_lock:
        # Use cache if fresh enough
        # akshare provides batch quotes, cache for 60s to avoid rate limiting
        try:
            import akshare as ak
            df = ak.futures_zh_realtime_spot()
            _akshare_cache = df
            return df
        except Exception as e:
            print(f"[MarketData] Fetch failed: {e}")
            return _akshare_cache  # Return stale cache if available
        return _akshare_cache


def get_public_tick(vt_symbol: str) -> Optional[TickData]:
    """Get a TickData from public source for a given vt_symbol."""
    df = fetch_realtime_quotes()
    if df is None or df.empty:
        return None

    symbol, exchange = extract_vt_symbol(vt_symbol)
    # akshare uses lowercase codes
    code = symbol.lower()

    matches = df[df["symbol"] == code]
    if matches.empty:
        # Try uppercase
        matches = df[df["symbol"].str.lower() == code.lower()]

    if matches.empty:
        return None

    row = matches.iloc[0]
    now = datetime.now()

    # Map akshare columns to TickData
    return TickData(
        symbol=symbol,
        exchange=exchange,
        datetime=now,
        name=row.get("name", ""),
        volume=float(row.get("volume", 0) or 0),
        turnover=float(row.get("turnover", 0) or 0),
        open_interest=float(row.get("open_interest", 0) or 0),
        last_price=float(row.get("latest_price", 0) or 0),
        open_price=float(row.get("open", 0) or 0),
        high_price=float(row.get("high", 0) or 0),
        low_price=float(row.get("low", 0) or 0),
        pre_close=float(row.get("pre_settle", 0) or 0),
        bid_price_1=float(row.get("bid1", 0) or 0),
        ask_price_1=float(row.get("ask1", 0) or 0),
        bid_volume_1=float(row.get("bid1_volume", 0) or 0),
        ask_volume_1=float(row.get("ask1_volume", 0) or 0),
        limit_up=float(row.get("upper_limit", 0) or 0),
        limit_down=float(row.get("lower_limit", 0) or 0),
        gateway_name="PUBLIC",
    )
