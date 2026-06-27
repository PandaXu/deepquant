"""
Public contract data cache — queries akshare for futures contract listings.
Provides contract names/codes even without a live CTP connection.
"""
from typing import Optional
import pandas as pd

from vnpy.trader.constant import Exchange

# akshare exchange name → VeighNa Exchange enum mapping
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


def load_contract_cache(force: bool = False) -> pd.DataFrame:
    """Load futures contract info from akshare (cached)."""
    global _contract_cache
    if _contract_cache is not None and not force:
        return _contract_cache
    try:
        import akshare as ak
        df = ak.futures_comm_info()
        _contract_cache = df
        return df
    except Exception as e:
        print(f"[ContractCache] Failed to load: {e}")
        return pd.DataFrame()


def query_contracts(exchange: Exchange, keyword: str = "") -> list[dict]:
    """Query contracts for a specific exchange.
    Returns list of {symbol, name, exchange_code, vt_symbol}
    """
    df = load_contract_cache()
    if df.empty:
        return []

    # Map Exchange enum → akshare name
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


def get_contract_name(code: str, exchange: Optional[Exchange] = None) -> str:
    """Look up a contract's display name from the cache."""
    df = load_contract_cache()
    if df.empty:
        return ""
    code_upper = code.upper()
    matches = df[df["合约代码"].str.upper() == code_upper]
    if not matches.empty:
        return str(matches.iloc[0]["合约名称"])
    return ""
