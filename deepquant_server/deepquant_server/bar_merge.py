"""K 线合并：历史 bar + DataRecorder 录制的 bar/tick 补全。"""
from __future__ import annotations

from datetime import datetime, timedelta

from deepquant.trader.constant import Interval
from deepquant.trader.object import BarData, TickData
from deepquant.trader.utility import BarGenerator


def bar_to_dict(b: BarData) -> dict:
    return {
        "datetime": b.datetime.isoformat(),
        "open": b.open_price,
        "high": b.high_price,
        "low": b.low_price,
        "close": b.close_price,
        "volume": b.volume,
        "open_interest": getattr(b, "open_interest", 0),
    }


def _bar_key(dt: datetime) -> str:
    return dt.replace(second=0, microsecond=0).isoformat()


def merge_bars(primary: list[BarData], secondary: list[BarData]) -> list[BarData]:
    """按分钟去重合并，secondary 覆盖 primary 同时间 bar。"""
    merged: dict[str, BarData] = {}
    for b in primary or []:
        if b and b.datetime:
            merged[_bar_key(b.datetime)] = b
    for b in secondary or []:
        if b and b.datetime:
            merged[_bar_key(b.datetime)] = b
    return sorted(merged.values(), key=lambda x: x.datetime)


def aggregate_ticks_to_bars(ticks: list[TickData]) -> list[BarData]:
    """将 tick 列表聚合为 1 分钟 K 线。"""
    if not ticks:
        return []
    bars: list[BarData] = []
    bg = BarGenerator(lambda bar: bars.append(bar))
    for t in sorted(ticks, key=lambda x: x.datetime):
        bg.update_tick(t)
    return bars


def enrich_bars_with_recorded_data(db, symbol: str, exchange, interval: Interval,
                                   bars: list[BarData], end_dt: datetime) -> list[BarData]:
    """
    合并 DataRecorder 写入的 K 线，并用 tick 补全最后一根 bar 之后的缺口。
    仅对 1 分钟周期生效。
    """
    if interval != Interval.MINUTE:
        return bars or []

    merged = list(bars or [])
    last_dt = merged[-1].datetime if merged else end_dt - timedelta(days=7)

    # 1) 合并录制 K 线（与历史重叠部分以录制为准）
    try:
        recorded = db.load_bar_data(symbol, exchange, interval, last_dt, end_dt + timedelta(days=1))
        merged = merge_bars(merged, recorded or [])
    except Exception:
        pass

    last_dt = merged[-1].datetime if merged else end_dt - timedelta(days=1)

    # 2) 用 tick 补全 last_dt 之后到 end_dt 的 1m bar
    try:
        tick_start = last_dt - timedelta(minutes=1)
        ticks = db.load_tick_data(symbol, exchange, tick_start, end_dt + timedelta(minutes=1))
        tick_bars = aggregate_ticks_to_bars(ticks or [])
        merged = merge_bars(merged, tick_bars)
    except Exception:
        pass

    return merged
