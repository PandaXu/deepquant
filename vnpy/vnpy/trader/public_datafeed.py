"""
Public datafeed using akshare/Sina — free historical bar data.
"""
from datetime import datetime
from typing import Callable

from vnpy.trader.datafeed import BaseDatafeed
from vnpy.trader.object import BarData, TickData, HistoryRequest
from vnpy.trader.constant import Exchange, Interval


class PublicDatafeed(BaseDatafeed):
    """Free datafeed backed by akshare/Sina finance."""

    def init(self, output: Callable = print) -> bool:
        output("PublicDatafeed (akshare/Sina) 已就绪")
        return True

    def query_bar_history(self, req: HistoryRequest, output: Callable = print) -> list[BarData]:
        """Download bar history from akshare futures_zh_daily_sina."""
        symbol = req.symbol
        exchange = req.exchange
        interval = req.interval
        start = req.start
        end = req.end or datetime.now()

        prefix = "[PublicDatafeed]"
        msg = f"{prefix} 下载请求: {symbol}.{exchange.value} {interval.value} {start.date()}~{end.date()}"
        output(msg)
        print(msg)

        if interval != Interval.DAILY:
            warn = f"{prefix} ⚠️ 仅支持日线数据 (请求={interval.value}), 请选择日线"
            output(warn)
            print(warn)
            return []

        try:
            import akshare as ak
            import pandas as pd

            # Use futures_zh_daily_sina for daily data
            akshare_symbol = symbol.upper()
            df = ak.futures_zh_daily_sina(symbol=akshare_symbol)

            if df is None or df.empty:
                output(f"[PublicDatafeed] akshare 返回空: {akshare_symbol}")
                return []

            # Standardize columns
            df = df.rename(columns={
                "date": "datetime",
                "open": "open_price",
                "high": "high_price",
                "low": "low_price",
                "close": "close_price",
                "volume": "volume",
                "hold": "open_interest",
            })

            df["datetime"] = pd.to_datetime(df["datetime"])

            # Filter date range
            mask = (df["datetime"] >= pd.Timestamp(start)) & (df["datetime"] <= pd.Timestamp(end))
            df = df[mask]

            bars: list[BarData] = []
            for _, row in df.iterrows():
                bar = BarData(
                    symbol=symbol,
                    exchange=exchange,
                    datetime=row["datetime"].to_pydatetime(),
                    interval=interval,
                    open_price=float(row.get("open_price", 0) or 0),
                    high_price=float(row.get("high_price", 0) or 0),
                    low_price=float(row.get("low_price", 0) or 0),
                    close_price=float(row.get("close_price", 0) or 0),
                    volume=float(row.get("volume", 0) or 0),
                    open_interest=float(row.get("open_interest", 0) or 0),
                    gateway_name="PUBLIC",
                )
                bars.append(bar)

            output(f"[PublicDatafeed] 下载完成: {symbol}.{exchange.value} → {len(bars)}条")
            return bars

        except Exception as e:
            output(f"[PublicDatafeed] 下载失败: {symbol}.{exchange.value} → {e}")
            import traceback
            traceback.print_exc()
            return []

    def query_tick_history(self, req: HistoryRequest, output: Callable = print) -> list[TickData]:
        output("[PublicDatafeed] 不支持 Tick 数据下载")
        return []
