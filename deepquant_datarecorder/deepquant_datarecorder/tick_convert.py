"""Tick/Bar 字典 ↔ VeighNa 对象转换。"""
from datetime import datetime

from deepquant.trader.constant import Exchange
from deepquant.trader.object import TickData, BarData


def _parse_dt(v):
    if v is None:
        return datetime.now()
    if isinstance(v, datetime):
        return v.replace(tzinfo=None) if v.tzinfo else v
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v)
    s = str(v).replace("Z", "").split("+")[0]
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return datetime.now()


def _parse_exchange(ex):
    if isinstance(ex, Exchange):
        return ex
    if not ex:
        return Exchange.LOCAL
    return Exchange(str(ex))


def dict_to_tick(d: dict) -> TickData | None:
    if not d:
        return None
    symbol = d.get("symbol") or (d.get("vt_symbol") or "").split(".")[0]
    exchange = d.get("exchange") or (d.get("vt_symbol") or "").split(".")[-1]
    if not symbol or not exchange:
        return None
    try:
        ex = _parse_exchange(exchange)
    except ValueError:
        return None
    return TickData(
        symbol=symbol,
        exchange=ex,
        datetime=_parse_dt(d.get("datetime") or d.get("time")),
        name=d.get("name", ""),
        volume=float(d.get("volume") or 0),
        turnover=float(d.get("turnover") or 0),
        open_interest=float(d.get("open_interest") or 0),
        last_price=float(d.get("last_price") or 0),
        last_volume=float(d.get("last_volume") or 0),
        limit_up=float(d.get("limit_up") or 0),
        limit_down=float(d.get("limit_down") or 0),
        open_price=float(d.get("open_price") or 0),
        high_price=float(d.get("high_price") or 0),
        low_price=float(d.get("low_price") or 0),
        pre_close=float(d.get("pre_close") or 0),
        bid_price_1=float(d.get("bid_price_1") or 0),
        ask_price_1=float(d.get("ask_price_1") or 0),
        bid_volume_1=float(d.get("bid_volume_1") or 0),
        ask_volume_1=float(d.get("ask_volume_1") or 0),
        gateway_name=d.get("gateway_name", "CTP"),
    )
