"""
Public datafeed using akshare/Sina — free historical bar data.
Supports DAILY (futures_zh_daily_sina) and MINUTE/HOUR (futures_zh_minute_sina).
CFFEX index options (IO/HO/MO) daily via option_cffex_*_daily_sina.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Callable

import pandas as pd

from deepquant.trader.datafeed import BaseDatafeed
from deepquant.trader.object import BarData, TickData, HistoryRequest
from deepquant.trader.constant import Exchange, Interval

_CFFEX_INDEX_OPTION_PRODUCTS = frozenset({"IO", "HO", "MO"})
_CFFEX_OPTION_DAILY_FN = {
    "IO": "option_cffex_hs300_daily_sina",
    "HO": "option_cffex_sz50_daily_sina",
    "MO": "option_cffex_zz1000_daily_sina",
}
_CTP_OPTION_SYMBOL = re.compile(r"^([A-Za-z]+)(\d{4})-([CP])-(\d+)$", re.I)


def ctp_option_to_sina(symbol: str) -> tuple[str, str] | None:
    """HO2607-C-2900 → ('HO', 'ho2607C2900') for akshare option daily API."""
    m = _CTP_OPTION_SYMBOL.match((symbol or "").strip())
    if not m:
        return None
    product = m.group(1).upper()
    if product not in _CFFEX_INDEX_OPTION_PRODUCTS:
        return None
    yymm, cp, strike = m.group(2), m.group(3).upper(), m.group(4)
    return product, f"{product.lower()}{yymm}{cp}{strike}"


def _bars_from_dataframe(
    df: pd.DataFrame,
    req: HistoryRequest,
    interval: Interval,
    start: datetime,
    end: datetime,
) -> list[BarData]:
    col_map = {
        "date": "datetime", "open": "open", "high": "high", "low": "low",
        "close": "close", "volume": "volume", "hold": "oi",
    }
    df = df.rename(columns=col_map)
    if "datetime" not in df.columns:
        df["datetime"] = pd.to_datetime(df.index)
    df["datetime"] = pd.to_datetime(df["datetime"]).dt.tz_localize(None)

    if interval == Interval.HOUR:
        df = df.set_index("datetime").resample("1h").agg({
            "open": "first", "high": "max", "low": "min",
            "close": "last", "volume": "sum", "oi": "last",
        }).dropna().reset_index()

    s = pd.Timestamp(start).tz_localize(None)
    e = pd.Timestamp(end).tz_localize(None)
    df = df[(df["datetime"] >= s) & (df["datetime"] <= e)]

    bars: list[BarData] = []
    for _, row in df.iterrows():
        bars.append(BarData(
            symbol=req.symbol,
            exchange=req.exchange,
            datetime=row["datetime"].to_pydatetime(),
            interval=interval,
            open_price=float(row.get("open", 0) or 0),
            high_price=float(row.get("high", 0) or 0),
            low_price=float(row.get("low", 0) or 0),
            close_price=float(row.get("close", 0) or 0),
            volume=float(row.get("volume", 0) or 0),
            open_interest=float(row.get("oi", 0) or 0),
            gateway_name="PUBLIC",
        ))
    return bars


class PublicDatafeed(BaseDatafeed):
    """Free datafeed backed by akshare/Sina finance."""

    def init(self, output: Callable = print) -> bool:
        output("PublicDatafeed (akshare/Sina) 已就绪")
        return True

    def query_bar_history(self, req: HistoryRequest, output: Callable = print) -> list[BarData]:
        """Download bar history. DAILY→futures_zh_daily_sina, MINUTE→futures_zh_minute_sina."""
        symbol = req.symbol.upper()
        exchange = req.exchange
        interval = req.interval
        start = req.start
        end = req.end or datetime.now()

        P = "[PublicDatafeed]"
        output(f"{P} 下载: {symbol}.{exchange.value} {interval.value} {start.date()}~{end.date()}")

        try:
            import akshare as ak

            if "-" in symbol:
                return self._query_cffex_option_bars(req, symbol, interval, start, end, output)

            if interval == Interval.DAILY:
                try:
                    df = ak.futures_zh_daily_sina(symbol=symbol)
                except Exception:
                    output(f"{P} Sina不支持该合约: {symbol}")
                    return []
            elif interval in (Interval.MINUTE, Interval.HOUR):
                try:
                    df = ak.futures_zh_minute_sina(symbol=symbol, period="1")
                except Exception:
                    output(f"{P} Sina不支持该合约的分钟数据: {symbol}")
                    return []
            else:
                output(f"{P} 不支持的周期: {interval.value}")
                return []

            if df is None or df.empty:
                output(f"{P} 无数据: {symbol}")
                return []

            bars = _bars_from_dataframe(df, req, interval, start, end)
            output(f"{P} 完成: {symbol}.{exchange.value} → {len(bars)}条")
            return bars

        except Exception as e:
            import traceback
            err = f"{P} 失败: {symbol}.{exchange.value} → {e}\n{traceback.format_exc()}"
            output(err)
            print(err)
            return []

    def _query_cffex_option_bars(
        self,
        req: HistoryRequest,
        symbol: str,
        interval: Interval,
        start: datetime,
        end: datetime,
        output: Callable,
    ) -> list[BarData]:
        P = "[PublicDatafeed]"
        parsed = ctp_option_to_sina(symbol)
        if not parsed:
            output(f"{P} 跳过期权合约（暂仅支持 CFFEX 股指期权 IO/HO/MO 日线）: {symbol}")
            return []
        product, sina_sym = parsed
        if interval != Interval.DAILY:
            output(f"{P} 股指期权 {symbol} 仅支持日线，当前请求 {interval.value}")
            return []

        import akshare as ak

        fn_name = _CFFEX_OPTION_DAILY_FN[product]
        output(f"{P} 股指期权日线: {symbol} → {sina_sym} ({fn_name})")
        try:
            df = getattr(ak, fn_name)(symbol=sina_sym)
        except Exception as e:
            output(f"{P} 期权日线拉取失败: {symbol} → {e}")
            return []

        if df is None or df.empty:
            output(f"{P} 无期权日线数据: {symbol}")
            return []

        bars = _bars_from_dataframe(df, req, interval, start, end)
        output(f"{P} 完成: {symbol}.{req.exchange.value} → {len(bars)}条")
        return bars

    def query_tick_history(self, req: HistoryRequest, output: Callable = print) -> list[TickData]:
        output("[PublicDatafeed] 不支持 Tick 数据")
        return []
