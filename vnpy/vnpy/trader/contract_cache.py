"""
Public contract data cache — preloaded by backend timer task.
Queries akshare for futures contract listings on startup and daily refresh.
Data persisted to disk for instant startup on subsequent runs.
"""
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import pandas as pd

from vnpy.trader.constant import Exchange
from vnpy.trader.utility import get_folder_path

# Disk cache path
_CACHE_FILE = str(get_folder_path(".").joinpath("contract_cache.parquet"))

# akshare exchange name → VeighNa Exchange enum
_AKSHARE_EXCHANGE_MAP: dict[str, Exchange] = {
    "上海期货交易所": Exchange.SHFE,
    "大连商品交易所": Exchange.DCE,
    "郑州商品交易所": Exchange.CZCE,
    "中国金融期货交易所": Exchange.CFFEX,
    "上海国际能源交易中心": Exchange.INE,
    "广州期货交易所": Exchange.GFEX,
    "上海证券交易所": Exchange.SSE,
    "深圳证券交易所": Exchange.SZSE,
    "北京证券交易所": Exchange.BSE,
}

# Global cache
_contract_cache: Optional[pd.DataFrame] = None
_cache_ts: Optional[datetime] = None
_cache_lock = threading.Lock()
_loading = False


def _load_from_disk() -> Optional[pd.DataFrame]:
    """Try loading cached data from disk (instant)."""
    try:
        p = Path(_CACHE_FILE)
        if p.exists():
            df = pd.read_parquet(p)
            print(f"[ContractCache] Loaded {len(df)} contracts from disk")
            return df
    except Exception as e:
        print(f"[ContractCache] Disk load failed: {e}")
    return None


def _save_to_disk(df: pd.DataFrame) -> None:
    """Persist cache to disk."""
    try:
        Path(_CACHE_FILE).parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(_CACHE_FILE, index=False)
    except Exception as e:
        print(f"[ContractCache] Disk save failed: {e}")


def _do_load() -> Optional[pd.DataFrame]:
    """Load from akshare + generate options, persist to disk."""
    global _loading
    if _loading:
        return None
    _loading = True
    try:
        import akshare as ak
        df = ak.futures_comm_info()

        # Generate CFFEX stock index options (not in akshare)
        options_data = _generate_index_options("MO", "中证1000股指期权", 8600, 50, 30)
        options_data += _generate_index_options("HO", "沪深300股指期权", 4870, 50, 30)
        options_data += _generate_index_options("IO", "上证50股指期权", 2900, 30, 25)

        opt_df = pd.DataFrame(options_data)
        df = pd.concat([df, opt_df], ignore_index=True)

        _save_to_disk(df)
        return df
    except Exception as e:
        print(f"[ContractCache] Network load failed: {e}")
        return _load_from_disk()
    finally:
        _loading = False


def _generate_index_options(
    product: str, name: str, current_price: float,
    strike_step: int, strike_count: int,
) -> list[dict]:
    """Generate stock index option contracts with strike prices."""
    now = datetime.now()
    year, month = now.year, now.month
    option_months = []
    for i in range(4):
        m = month + i
        y = year
        if m > 12:
            m -= 12
            y += 1
        option_months.append(f"{y % 100:02d}{m:02d}")

    base_strike = int(current_price / strike_step) * strike_step
    half = strike_count // 2
    strikes = [base_strike + (i - half) * strike_step for i in range(strike_count)]

    results = []
    for mon in option_months:
        for cp in [("C", "看涨"), ("P", "看跌")]:
            for strike in strikes:
                results.append({
                    "交易所名称": "中国金融期货交易所",
                    "合约名称": f"{name}{cp[1]}{strike}",
                    "合约代码": f"{product}{mon}-{cp[0]}-{strike}",
                })
    return results


def refresh_cache() -> bool:
    """Force refresh the contract cache. Returns True on success."""
    global _contract_cache, _cache_ts
    df = _do_load()
    if df is not None and not df.empty:
        with _cache_lock:
            _contract_cache = df
            _cache_ts = datetime.now()
        print(f"[ContractCache] Loaded {len(df)} contracts at {_cache_ts}")
        return True
    return False


def init_cache() -> None:
    """Initialize cache: load from disk first (instant), then background refresh."""
    global _contract_cache, _cache_ts
    # First try disk (instant)
    df = _load_from_disk()
    if df is not None and not df.empty:
        with _cache_lock:
            _contract_cache = df
            _cache_ts = datetime.now()
        print(f"[ContractCache] Disk cache ready: {len(df)} contracts")
        # Background refresh from network
        t = threading.Thread(target=refresh_cache, daemon=True)
        t.start()
    else:
        print("[ContractCache] No disk cache, loading from network...")
        # Synchronous first load (takes ~3s)
        refresh_cache()


def get_cache() -> Optional[pd.DataFrame]:
    """Get the current cached dataframe (thread-safe)."""
    with _cache_lock:
        return _contract_cache


def get_cache_age() -> Optional[datetime]:
    """Get cache timestamp."""
    with _cache_lock:
        return _cache_ts


# Product family: selecting a futures product also shows its options
_PRODUCT_FAMILY: dict[str, list[str]] = {
    "IF": ["IO"], "IO": ["IF"],
    "IM": ["MO"], "MO": ["IM"],
    "IH": ["HO"], "HO": ["IH"],
}


def get_related_products(product: str) -> list[str]:
    """Get related product prefixes (e.g., futures ↔ options)."""
    related = _PRODUCT_FAMILY.get(product.upper(), [])
    return [product] + related


def query_contracts(exchange: Exchange, keyword: str = "") -> list[dict]:
    """Query contracts for a specific exchange from cache."""
    df = get_cache()
    if df is None or df.empty:
        return []

    reverse_map = {v: k for k, v in _AKSHARE_EXCHANGE_MAP.items()}
    exchange_name = reverse_map.get(exchange, "")

    if exchange_name:
        filtered = df[df["交易所名称"] == exchange_name]
    else:
        filtered = df

    if keyword:
        kw = keyword.upper()
        filtered = filtered[
            filtered["合约代码"].str.upper().str.contains(kw, na=False)
            | filtered["合约名称"].str.upper().str.contains(kw, na=False)
        ]

    results: list[dict] = []
    for _, row in filtered.iterrows():
        code = str(row["合约代码"]).upper()
        name = str(row["合约名称"])
        results.append({
            "symbol": code,
            "name": name,
            "exchange_code": exchange.value,
            "vt_symbol": f"{code}.{exchange.value}",
        })
    return results


def get_contract_name(code: str) -> str:
    """Look up a contract's display name from the cache."""
    df = get_cache()
    if df is None or df.empty:
        return ""
    matches = df[df["合约代码"].str.upper() == code.upper()]
    if not matches.empty:
        return str(matches.iloc[0]["合约名称"])
    return ""
