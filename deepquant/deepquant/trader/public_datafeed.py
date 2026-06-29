"""
Public datafeed using akshare/Sina — free historical bar data.
Supports DAILY (futures_zh_daily_sina) and MINUTE/HOUR (futures_zh_minute_sina).
"""
from datetime import datetime
from typing import Callable

import pandas as pd

from deepquant.trader.datafeed import BaseDatafeed
from deepquant.trader.object import BarData, TickData, HistoryRequest
from deepquant.trader.constant import Exchange, Interval


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

        # Skip option contracts — Sina doesn't support them
        if '-' in symbol:
            output(f"{P} 跳过期权合约: {symbol}")
            return []

        try:
            import akshare as ak

            if interval == Interval.DAILY:
                try:
                    df = ak.futures_zh_daily_sina(symbol=symbol)
                except Exception:
                    output(f"{P} Sina不支持该合约: {symbol}")
                    return []
                col_map = {"date": "datetime", "open": "open", "high": "high",
                           "low": "low", "close": "close", "volume": "volume", "hold": "oi"}
            elif interval in (Interval.MINUTE, Interval.HOUR):
                try:
                    df = ak.futures_zh_minute_sina(symbol=symbol, period="1")
                except Exception:
                    output(f"{P} Sina不支持该合约的分钟数据: {symbol}")
                    return []
                col_map = {"open": "open", "high": "high", "low": "low",
                           "close": "close", "volume": "volume", "hold": "oi"}
            else:
                output(f"{P} 不支持的周期: {interval.value}")
                return []

            if df is None or df.empty:
                output(f"{P} 无数据: {symbol}")
                return []

            df = df.rename(columns=col_map)

            if "datetime" not in df.columns:
                df["datetime"] = pd.to_datetime(df.index)
            df["datetime"] = pd.to_datetime(df["datetime"]).dt.tz_localize(None)

            # Hour resample
            if interval == Interval.HOUR:
                df = df.set_index("datetime").resample("1h").agg({
                    "open": "first", "high": "max", "low": "min",
                    "close": "last", "volume": "sum", "oi": "last"
                }).dropna().reset_index()

            # Filter date range
            s = pd.Timestamp(start).tz_localize(None)
            e = pd.Timestamp(end).tz_localize(None)
            df = df[(df["datetime"] >= s) & (df["datetime"] <= e)]

            bars: list[BarData] = []
            for _, row in df.iterrows():
                bars.append(BarData(
                    symbol=req.symbol, exchange=exchange,
                    datetime=row["datetime"].to_pydatetime(), interval=interval,
                    open_price=float(row.get("open", 0) or 0),
                    high_price=float(row.get("high", 0) or 0),
                    low_price=float(row.get("low", 0) or 0),
                    close_price=float(row.get("close", 0) or 0),
                    volume=float(row.get("volume", 0) or 0),
                    open_interest=float(row.get("oi", 0) or 0),
                    gateway_name="PUBLIC",
                ))

            output(f"{P} 完成: {symbol}.{exchange.value} → {len(bars)}条")
            return bars

        except Exception as e:
            import traceback
            err = f"{P} 失败: {symbol}.{exchange.value} → {e}\n{traceback.format_exc()}"
            output(err)
            print(err)
            return []

    def query_tick_history(self, req: HistoryRequest, output: Callable = print) -> list[TickData]:
        output("[PublicDatafeed] 不支持 Tick 数据")
        return []
