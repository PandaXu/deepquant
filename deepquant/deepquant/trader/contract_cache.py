"""
Public contract data cache — preloaded by backend timer task.
Queries akshare for futures contract listings on startup and daily refresh.
Data persisted to disk for instant startup on subsequent runs.
"""
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional
import pandas as pd

from deepquant.trader.constant import Exchange
from deepquant.trader.utility import get_folder_path

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

# 品种前缀 → 中文名（避免从合约名反推错误）
_PRODUCT_CN: dict[str, str] = {
    "IF": "沪深300指数", "IH": "上证50指数", "IC": "中证500指数", "IM": "中证1000指数",
    "IO": "沪深300股指期权", "HO": "上证50股指期权", "MO": "中证1000股指期权",
    "T": "10年期国债", "TF": "5年期国债", "TS": "2年期国债", "TL": "30年期国债",
}

# CFFEX 股指期权 akshare 接口
_CFFEX_OPTION_SPECS: list[tuple[str, str, str, str]] = [
    ("IO", "沪深300", "option_cffex_hs300_list_sina", "option_cffex_hs300_spot_sina"),
    ("HO", "上证50", "option_cffex_sz50_list_sina", "option_cffex_sz50_spot_sina"),
    ("MO", "中证1000", "option_cffex_zz1000_list_sina", "option_cffex_zz1000_spot_sina"),
]

_SINA_OPTION_ID = re.compile(r"^([A-Za-z]+)(\d{4})([CP])(\d+)$", re.I)

# Global cache
_contract_cache: Optional[pd.DataFrame] = None
_cache_ts: Optional[datetime] = None
_product_cache: dict[str, dict[str, str]] = {}  # exchange_value → {prefix → chinese_name}
_cache_lock = threading.Lock()
_loading = False


def _load_from_disk() -> Optional[pd.DataFrame]:
    """Try loading cached data from disk (instant)."""
    t0 = datetime.now()
    try:
        p = Path(_CACHE_FILE)
        if p.exists():
            df = pd.read_parquet(p)
            if "数据来源" not in df.columns:
                df["数据来源"] = "akshare"
            elapsed = (datetime.now() - t0).total_seconds()
            print(f"[ContractCache] ✅ 磁盘加载成功: {len(df)}条, 耗时{elapsed:.2f}s, 文件={_CACHE_FILE}")
            return df
        else:
            print(f"[ContractCache] ⚠️ 磁盘缓存不存在: {_CACHE_FILE}")
    except Exception as e:
        print(f"[ContractCache] ❌ 磁盘加载失败: {e}")
    return None


def _save_to_disk(df: pd.DataFrame) -> None:
    """Persist cache to disk."""
    try:
        Path(_CACHE_FILE).parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(_CACHE_FILE, index=False)
        print(f"[ContractCache] 💾 已保存到磁盘: {_CACHE_FILE} ({len(df)}条, {Path(_CACHE_FILE).stat().st_size/1024:.0f}KB)")
    except Exception as e:
        print(f"[ContractCache] ❌ 磁盘保存失败: {e}")


def _do_load() -> Optional[pd.DataFrame]:
    """Load from akshare + generate options, persist to disk."""
    global _loading
    if _loading:
        print(f"[ContractCache] ⏳ 已有加载任务进行中，跳过")
        return None
    _loading = True
    t0 = datetime.now()
    try:
        print(f"[ContractCache] 🌐 开始从 akshare 拉取合约数据...")
        import akshare as ak
        df = ak.futures_comm_info()
        t1 = datetime.now()
        print(f"[ContractCache] ✅ akshare 返回 {len(df)} 条期货合约 (耗时{(t1-t0).total_seconds():.1f}s)")
        if "数据来源" not in df.columns:
            df["数据来源"] = "akshare"

        # CFFEX 股指期权：优先 akshare 真实挂牌，失败时回退合成
        print(f"[ContractCache] 📐 加载股指期权（akshare 真实挂牌）...")
        options_data = _load_cffex_index_options_from_akshare()
        if not options_data:
            print(f"[ContractCache] ⚠️ akshare 期权为空，回退合成数据（仅供搜索，可能无法订阅）")
            options_data = _generate_index_options("MO", "中证1000股指期权", 8600, 50, 30, synthetic=True)
            options_data += _generate_index_options("IO", "沪深300股指期权", 4870, 50, 30, synthetic=True)
            options_data += _generate_index_options("HO", "上证50股指期权", 2900, 50, 30, synthetic=True)
        print(f"[ContractCache] ✅ 股指期权 {len(options_data)} 条")

        opt_df = pd.DataFrame(options_data)
        df = pd.concat([df, opt_df], ignore_index=True)
        t2 = datetime.now()
        print(f"[ContractCache] ✅ 合并完成: {len(df)} 条 (期货+期权), 总耗时{(t2-t0).total_seconds():.1f}s")

        _save_to_disk(df)
        return df
    except Exception as e:
        print(f"[ContractCache] ❌ 网络加载失败: {e}")
        print(f"[ContractCache] 🔄 回退读取磁盘缓存...")
        return _load_from_disk()
    finally:
        _loading = False


def _sina_option_id_to_code(sid: str) -> str:
    """Sina 标识 io2607C4200 → CTP 格式 IO2607-C-4200。"""
    m = _SINA_OPTION_ID.match((sid or "").strip())
    if not m:
        return (sid or "").upper()
    return f"{m.group(1).upper()}{m.group(2)}-{m.group(3).upper()}-{m.group(4)}"


def _option_display_name(underlying_cn: str, cp_cn: str, yymm: str) -> str:
    """生成期权展示名称。"""
    return f"{underlying_cn}{cp_cn}期权{yymm}"


def _load_cffex_index_options_from_akshare() -> list[dict]:
    """从 akshare 拉取 CFFEX 股指期权真实挂牌（月份 + 行权价）。"""
    import akshare as ak

    results: list[dict] = []
    for product, underlying_cn, list_fn, spot_fn in _CFFEX_OPTION_SPECS:
        try:
            raw = getattr(ak, list_fn)()
            months: list[str] = []
            if isinstance(raw, dict):
                for v in raw.values():
                    months.extend(v)
            months = sorted({m.lower() for m in months if m})
        except Exception as e:
            print(f"[ContractCache] ⚠️ {product} 月份列表失败: {e}")
            continue

        for mon in months:
            try:
                spot_df = getattr(ak, spot_fn)(symbol=mon)
            except Exception as e:
                print(f"[ContractCache] ⚠️ {product} {mon} 行权价失败: {e}")
                continue
            if spot_df is None or spot_df.empty:
                continue
            yymm = mon[-4:].upper() if len(mon) >= 4 else mon.upper()
            for _, row in spot_df.iterrows():
                for col, cp_cn in [("看涨合约-标识", "看涨"), ("看跌合约-标识", "看跌")]:
                    sid = str(row.get(col, "") or "").strip()
                    if not sid or sid.lower() == "nan":
                        continue
                    code = _sina_option_id_to_code(sid)
                    results.append({
                        "交易所名称": "中国金融期货交易所",
                        "合约名称": _option_display_name(underlying_cn, cp_cn, yymm),
                        "合约代码": code,
                        "数据来源": "akshare",
                    })
    return results


def _generate_index_options(
    product: str, name: str, current_price: float,
    strike_step: int, strike_count: int,
    synthetic: bool = False,
) -> list[dict]:
    """合成股指期权（仅 akshare 不可用时的回退）。"""
    underlying = {"IO": "沪深300", "HO": "上证50", "MO": "中证1000"}.get(product, name.replace("股指期权", ""))
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
                    "合约名称": f"{underlying}{cp[1]}期权{mon}",
                    "合约代码": f"{product}{mon}-{cp[0]}-{strike}",
                    "数据来源": "synthetic" if synthetic else "akshare",
                })
    return results


def symbol_product_prefix(symbol: str) -> str:
    """提取合约品种前缀（字母部分）。"""
    m = re.match(r"^([A-Za-z]+)", (symbol or "").upper())
    return m.group(1) if m else ""


def filter_by_products(contracts: list[dict], product: str) -> list[dict]:
    """按品种前缀过滤，含期货↔期权关联品种。"""
    related = {p.upper() for p in get_related_products(product)}
    return [c for c in contracts if symbol_product_prefix(c.get("symbol", "")) in related]


def _infer_product_name(code: str, raw_name: str) -> str:
    """从合约名推断品种中文名（兜底）。"""
    p = symbol_product_prefix(code)
    if p in _PRODUCT_CN:
        return _PRODUCT_CN[p]
    cn = re.sub(r"\d+$", "", raw_name).strip()
    cn = re.sub(r"(看涨|看跌)$", "", cn).strip()
    cn = re.sub(r"期权\d+$", "期权", cn).strip()
    return cn or p


def _build_product_cache(df: pd.DataFrame) -> dict[str, dict[str, str]]:
    """Precompute product info per exchange: {exchange_value: {prefix → chinese_name}}."""
    products: dict[str, dict[str, str]] = {}
    for akshare_name, ex_enum in _AKSHARE_EXCHANGE_MAP.items():
        ex_df = df[df["交易所名称"] == akshare_name]
        prods: dict[str, str] = {}
        for _, row in ex_df.iterrows():
            code = str(row["合约代码"]).upper()
            name = str(row["合约名称"])
            p = symbol_product_prefix(code)
            if p and p not in prods:
                prods[p] = _infer_product_name(code, name)
        for p, cn in _PRODUCT_CN.items():
            if p in prods or any(symbol_product_prefix(str(r["合约代码"])) == p for _, r in ex_df.iterrows()):
                prods[p] = cn
        if prods:
            products[ex_enum.value] = dict(sorted(prods.items()))
    return products


def get_products(exchange_code: str) -> dict[str, str]:
    """Get precomputed product map for an exchange (instant)."""
    with _cache_lock:
        return _product_cache.get(exchange_code, {})


def refresh_cache() -> bool:
    """Force refresh the contract cache. Returns True on success."""
    global _contract_cache, _cache_ts, _product_cache
    print(f"[ContractCache] 🔄 refresh_cache() 被调用")
    df = _do_load()
    if df is not None and not df.empty:
        products = _build_product_cache(df)
        with _cache_lock:
            _contract_cache = df
            _product_cache = products
            _cache_ts = datetime.now()
        total_prods = sum(len(v) for v in products.values())
        print(f"[ContractCache] ✅ 缓存已更新: {len(df)}条合约, {total_prods}个品种 @ {_cache_ts}")
        return True
    print(f"[ContractCache] ❌ 刷新失败")
    return False


def init_cache() -> None:
    """Initialize cache: synchronous disk load (instant), async network refresh."""
    global _contract_cache, _cache_ts, _product_cache
    print(f"[ContractCache] 🚀 init_cache() 开始初始化...")
    # Disk load is synchronous and takes ~0.01s
    df = _load_from_disk()
    if df is not None and not df.empty:
        products = _build_product_cache(df)
        with _cache_lock:
            _contract_cache = df
            _product_cache = products
            _cache_ts = datetime.now()
        total_prods = sum(len(v) for v in products.values())
        print(f"[ContractCache] ✅ 磁盘缓存就绪: {len(df)}条合约, {total_prods}个品种")
        print(f"[ContractCache] 🔄 后台异步更新网络数据...")
        t = threading.Thread(target=refresh_cache, daemon=True)
        t.start()
    else:
        print(f"[ContractCache] ⚠️ 无磁盘缓存, 同步加载网络数据(约3s)...")
        refresh_cache()
        print(f"[ContractCache] ✅ 首次加载完成")


def get_cache() -> Optional[pd.DataFrame]:
    """Get the current cached dataframe (thread-safe)."""
    with _cache_lock:
        return _contract_cache


def get_cache_age() -> Optional[datetime]:
    """Get cache timestamp."""
    with _cache_lock:
        return _cache_ts


# 期货 → 关联期权（单向：选 IF 时可看到 IO，选 IO 时不混入 IF）
_PRODUCT_FAMILY: dict[str, list[str]] = {
    "IF": ["IO"],
    "IM": ["MO"],
    "IH": ["HO"],
}

# 股指期权品种前缀
_INDEX_OPTION_PREFIXES = frozenset({"IO", "HO", "MO"})


def get_related_products(product: str) -> list[str]:
    """Get related product prefixes (futures → options only)."""
    p = product.upper()
    if p in _INDEX_OPTION_PREFIXES:
        return [p]
    related = _PRODUCT_FAMILY.get(p, [])
    return [p] + related


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
        source = str(row.get("数据来源", "akshare")).lower()
        results.append({
            "symbol": code,
            "name": name,
            "exchange_code": exchange.value,
            "vt_symbol": f"{code}.{exchange.value}",
            "listed": source != "synthetic",
            "source": source,
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
