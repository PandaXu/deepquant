"""
Public datafeed using akshare/Sina — free historical bar data.
Replaces commercial datafeeds (rqdata, tqsdk) with open data.
"""
from datetime import datetime, timedelta
from typing import Callable

from vnpy.trader.datafeed import BaseDatafeed
from vnpy.trader.object import BarData, TickData, HistoryRequest
from vnpy.trader.constant import Exchange, Interval
from vnpy.trader.utility import extract_vt_symbol


# Exchange → akshare symbol suffix mapping
EXCHANGE_SUFFIX = {
    Exchange.CFFEX: "cffex",
    Exchange.SHFE: "shfe",
    Exchange.DCE: "dce",
    Exchange.CZCE: "czce",
    Exchange.INE: "ine",
    Exchange.GFEX: "gfex",
}


class PublicDatafeed(BaseDatafeed):
    """Free datafeed backed by akshare/Sina finance."""

    def init(self, output: Callable = print) -> bool:
        output("PublicDatafeed (akshare/Sina) 已就绪")
        return True

    def query_bar_history(self, req: HistoryRequest, output: Callable = print) -> list[BarData]:
        """Download bar history from akshare."""
        symbol = req.symbol
        exchange = req.exchange
        interval = req.interval
        start = req.start
        end = req.end or datetime.now()

        output(f"下载 {symbol}.{exchange.value} {interval.value} {start}~{end}")

        try:
            import akshare as ak
            import pandas as pd

            # Map interval to akshare period
            period = "daily"
            if interval == Interval.MINUTE:
                period = "1m"
            elif interval == Interval.HOUR:
                period = "60m"
            elif interval == Interval.DAILY:
                period = "daily"

            # Try akshare futures daily
            suffix = EXCHANGE_SUFFIX.get(exchange, "")
            akshare_symbol = f"{symbol.upper()}.{suffix}" if suffix else symbol.upper()

            df = ak.futures_main_sina(symbol=akshare_symbol)

            if df is None or df.empty:
                # Fallback: try akshare futures_daily
                df = ak.futures_daily_sina(symbol=akshare_symbol)

            if df is None or df.empty:
                output(f"akshare 返回空数据: {akshare_symbol}")
                return []

            # Rename columns to standard format
            df = df.rename(columns={
                "日期": "datetime",
                "date": "datetime",
                "开盘价": "open",
                "open": "open",
                "最高价": "high",
                "high": "high",
                "最低价": "low",
                "low": "low",
                "收盘价": "close",
                "close": "close",
                "成交量": "volume",
                "volume": "volume",
                "成交额": "turnover",
                "持仓量": "open_interest",
                "hold": "open_interest",
            })

            # Parse datetime
            if "datetime" in df.columns:
                df["datetime"] = pd.to_datetime(df["datetime"])
            elif df.index.name is None and len(df) > 0:
                df = df.reset_index()
                df["datetime"] = pd.to_datetime(df.iloc[:, 0])

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
                    open_price=float(row.get("open", 0) or 0),
                    high_price=float(row.get("high", 0) or 0),
                    low_price=float(row.get("low", 0) or 0),
                    close_price=float(row.get("close", 0) or 0),
                    volume=float(row.get("volume", 0) or 0),
                    turnover=float(row.get("turnover", 0) or 0),
                    open_interest=float(row.get("open_interest", 0) or 0),
                    gateway_name="PUBLIC",
                )
                bars.append(bar)

            output(f"下载完成: {len(bars)} 条")
            return bars

        except Exception as e:
            output(f"下载失败: {e}")
            return []

    def query_tick_history(self, req: HistoryRequest, output: Callable = print) -> list[TickData]:
        """Tick history not supported by akshare."""
        output("akshare 不支持 Tick 数据下载")
        return []
