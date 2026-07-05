"""
Gateway bridge — inject remote Gateway WS events into Server EventEngine,
and proxy orders/subscriptions via GatewayClient.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, Callable

from loguru import logger

from deepquant.event import Event, EventEngine
from deepquant.trader.constant import Direction, Exchange, Offset, OrderType, Status
from deepquant.trader.event import (
    EVENT_ACCOUNT,
    EVENT_CONTRACT,
    EVENT_ORDER,
    EVENT_POSITION,
    EVENT_TICK,
    EVENT_TRADE,
)
from deepquant.trader.gateway import BaseGateway
from deepquant.trader.object import (
    AccountData,
    CancelRequest,
    ContractData,
    OrderData,
    OrderRequest,
    PositionData,
    SubscribeRequest,
    TickData,
    TradeData,
)

_main_loop: asyncio.AbstractEventLoop | None = None
_gateway_client = None


def set_main_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _main_loop
    _main_loop = loop


def set_gateway_client(client) -> None:
    global _gateway_client
    _gateway_client = client


def _run_async(coro, timeout: float = 30):
    if _main_loop and _main_loop.is_running():
        future = asyncio.run_coroutine_threadsafe(coro, _main_loop)
        return future.result(timeout=timeout)
    return asyncio.run(coro)


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _enum(cls, value, default=None):
    if value is None:
        return default
    if isinstance(value, cls):
        return value
    try:
        return cls(value)
    except (ValueError, TypeError):
        return default


def _deserialize_tick(data: dict) -> TickData | None:
    try:
        exchange = _enum(Exchange, data.get("exchange"))
        if exchange is None:
            return None
        dt = _parse_dt(data.get("datetime")) or datetime.now()
        tick = TickData(
            gateway_name=data.get("gateway_name", "CTP"),
            symbol=data.get("symbol", ""),
            exchange=exchange,
            datetime=dt,
            name=data.get("name", ""),
            volume=float(data.get("volume", 0) or 0),
            turnover=float(data.get("turnover", 0) or 0),
            open_interest=float(data.get("open_interest", 0) or 0),
            last_price=float(data.get("last_price", 0) or 0),
            last_volume=float(data.get("last_volume", 0) or 0),
            limit_up=float(data.get("limit_up", 0) or 0),
            limit_down=float(data.get("limit_down", 0) or 0),
            open_price=float(data.get("open_price", 0) or 0),
            high_price=float(data.get("high_price", 0) or 0),
            low_price=float(data.get("low_price", 0) or 0),
            pre_close=float(data.get("pre_close", 0) or 0),
        )
        for i in range(1, 6):
            setattr(tick, f"bid_price_{i}", float(data.get(f"bid_price_{i}", 0) or 0))
            setattr(tick, f"ask_price_{i}", float(data.get(f"ask_price_{i}", 0) or 0))
            setattr(tick, f"bid_volume_{i}", float(data.get(f"bid_volume_{i}", 0) or 0))
            setattr(tick, f"ask_volume_{i}", float(data.get(f"ask_volume_{i}", 0) or 0))
        tick.vt_symbol = data.get("vt_symbol") or f"{tick.symbol}.{exchange.value}"
        return tick
    except Exception as e:
        logger.debug(f"gateway_bridge: tick deserialize failed: {e}")
        return None


def _deserialize_order(data: dict) -> OrderData | None:
    try:
        exchange = _enum(Exchange, data.get("exchange"))
        if exchange is None:
            return None
        order = OrderData(
            gateway_name=data.get("gateway_name", "CTP"),
            symbol=data.get("symbol", ""),
            exchange=exchange,
            orderid=str(data.get("orderid", "")),
            type=_enum(OrderType, data.get("type"), OrderType.LIMIT),
            direction=_enum(Direction, data.get("direction")),
            offset=_enum(Offset, data.get("offset"), Offset.NONE),
            price=float(data.get("price", 0) or 0),
            volume=float(data.get("volume", 0) or 0),
            traded=float(data.get("traded", 0) or 0),
            status=_enum(Status, data.get("status"), Status.SUBMITTING),
            datetime=_parse_dt(data.get("datetime")),
            reference=data.get("reference", ""),
        )
        order.vt_symbol = data.get("vt_symbol") or f"{order.symbol}.{exchange.value}"
        order.vt_orderid = data.get("vt_orderid") or f"{order.gateway_name}.{order.orderid}"
        return order
    except Exception as e:
        logger.debug(f"gateway_bridge: order deserialize failed: {e}")
        return None


def _deserialize_trade(data: dict) -> TradeData | None:
    try:
        exchange = _enum(Exchange, data.get("exchange"))
        if exchange is None:
            return None
        trade = TradeData(
            gateway_name=data.get("gateway_name", "CTP"),
            symbol=data.get("symbol", ""),
            exchange=exchange,
            orderid=str(data.get("orderid", "")),
            tradeid=str(data.get("tradeid", "")),
            direction=_enum(Direction, data.get("direction")),
            offset=_enum(Offset, data.get("offset"), Offset.NONE),
            price=float(data.get("price", 0) or 0),
            volume=float(data.get("volume", 0) or 0),
            datetime=_parse_dt(data.get("datetime")) or datetime.now(),
        )
        trade.vt_symbol = data.get("vt_symbol") or f"{trade.symbol}.{exchange.value}"
        trade.vt_orderid = data.get("vt_orderid") or f"{trade.gateway_name}.{trade.orderid}"
        trade.vt_tradeid = data.get("vt_tradeid") or f"{trade.gateway_name}.{trade.tradeid}"
        return trade
    except Exception as e:
        logger.debug(f"gateway_bridge: trade deserialize failed: {e}")
        return None


def _deserialize_position(data: dict) -> PositionData | None:
    try:
        exchange = _enum(Exchange, data.get("exchange"))
        if exchange is None:
            return None
        pos = PositionData(
            gateway_name=data.get("gateway_name", "CTP"),
            symbol=data.get("symbol", ""),
            exchange=exchange,
            direction=_enum(Direction, data.get("direction")),
            volume=float(data.get("volume", 0) or 0),
            frozen=float(data.get("frozen", 0) or 0),
            price=float(data.get("price", 0) or 0),
            pnl=float(data.get("pnl", 0) or 0),
            yd_volume=float(data.get("yd_volume", 0) or 0),
        )
        pos.vt_symbol = data.get("vt_symbol") or f"{pos.symbol}.{exchange.value}"
        pos.vt_positionid = data.get("vt_positionid") or f"{pos.gateway_name}.{pos.vt_symbol}.{pos.direction.value}"
        return pos
    except Exception as e:
        logger.debug(f"gateway_bridge: position deserialize failed: {e}")
        return None


def _deserialize_account(data: dict) -> AccountData | None:
    try:
        acct = AccountData(
            gateway_name=data.get("gateway_name", "CTP"),
            accountid=str(data.get("accountid", "")),
            balance=float(data.get("balance", 0) or 0),
            frozen=float(data.get("frozen", 0) or 0),
            available=float(data.get("available", 0) or 0),
        )
        acct.vt_accountid = data.get("vt_accountid") or f"{acct.gateway_name}.{acct.accountid}"
        return acct
    except Exception as e:
        logger.debug(f"gateway_bridge: account deserialize failed: {e}")
        return None


def _deserialize_contract(data: dict) -> ContractData | None:
    try:
        exchange = _enum(Exchange, data.get("exchange"))
        if exchange is None:
            return None
        contract = ContractData(
            gateway_name=data.get("gateway_name", "CTP"),
            symbol=data.get("symbol", ""),
            exchange=exchange,
            name=data.get("name", ""),
            size=float(data.get("size", 1) or 1),
            pricetick=float(data.get("pricetick", 1) or 1),
            min_volume=float(data.get("min_volume", 1) or 1),
        )
        contract.vt_symbol = data.get("vt_symbol") or f"{contract.symbol}.{exchange.value}"
        return contract
    except Exception as e:
        logger.debug(f"gateway_bridge: contract deserialize failed: {e}")
        return None


_DESERIALIZERS: dict[str, Callable[[dict], Any]] = {
    EVENT_TICK: _deserialize_tick,
    EVENT_ORDER: _deserialize_order,
    EVENT_TRADE: _deserialize_trade,
    EVENT_POSITION: _deserialize_position,
    EVENT_ACCOUNT: _deserialize_account,
    EVENT_CONTRACT: _deserialize_contract,
}


def inject_gateway_event(data: dict, event_engine: EventEngine | None) -> None:
    """Deserialize Gateway WS payload and inject into Server EventEngine for CTA/Oms."""
    if not event_engine:
        return
    event_type = data.get("type", "")
    if not event_type or event_type == "eTimer":
        return
    raw = data.get("data")
    if not isinstance(raw, dict):
        return

    base = event_type
    for prefix in _DESERIALIZERS:
        if event_type.startswith(prefix):
            base = prefix
            break

    deserializer = _DESERIALIZERS.get(base)
    if not deserializer:
        return

    obj = deserializer(raw)
    if obj is None:
        return

    event_engine.put(Event(event_type, obj))


class RemoteGateway(BaseGateway):
    """Proxy gateway — routes subscribe/order to Gateway microservice."""

    default_name = "RemoteGateway"
    default_setting: dict = {}

    def __init__(self, event_engine: EventEngine, gateway_name: str) -> None:
        super().__init__(event_engine, gateway_name)
        self._connected = False

    def connect(self, setting: dict) -> None:
        self._connected = True
        self.write_log(f"RemoteGateway {self.gateway_name} ready (via GatewayClient)")

    def close(self) -> None:
        self._connected = False

    def subscribe(self, req: SubscribeRequest) -> None:
        if not _gateway_client:
            self.write_log("GatewayClient not available for subscribe")
            return
        try:
            result = _run_async(_gateway_client.subscribe(
                req.symbol, req.exchange.value, self.gateway_name,
            ))
            if isinstance(result, dict) and result.get("error"):
                self.write_log(f"Subscribe failed: {result['error']}")
        except Exception as e:
            self.write_log(f"Subscribe error: {e}")

    def send_order(self, req: OrderRequest) -> str:
        if not _gateway_client:
            self.write_log("GatewayClient not available for send_order")
            return ""
        body = {
            "symbol": req.symbol,
            "exchange": req.exchange.value,
            "direction": req.direction.value if req.direction else "LONG",
            "order_type": req.type.value,
            "volume": req.volume,
            "price": req.price,
            "offset": req.offset.value,
            "reference": req.reference,
            "gateway": self.gateway_name,
        }
        try:
            result = _run_async(_gateway_client.send_order(body))
            if isinstance(result, dict):
                if result.get("error"):
                    self.write_log(f"Send order failed: {result['error']}")
                    return ""
                return result.get("vt_orderid", "")
        except Exception as e:
            self.write_log(f"Send order error: {e}")
        return ""

    def cancel_order(self, req: CancelRequest) -> None:
        if not _gateway_client:
            return
        try:
            _run_async(_gateway_client.cancel_order(
                req.orderid, req.symbol, req.exchange.value, self.gateway_name,
            ))
        except Exception as e:
            self.write_log(f"Cancel order error: {e}")

    def query_account(self) -> None:
        if not _gateway_client:
            return
        try:
            _run_async(_gateway_client.query_account(self.gateway_name))
        except Exception as e:
            self.write_log(f"Query account error: {e}")

    def query_position(self) -> None:
        if not _gateway_client:
            return
        try:
            _run_async(_gateway_client.query_position(self.gateway_name))
        except Exception as e:
            self.write_log(f"Query position error: {e}")


def register_remote_gateways(main_engine) -> None:
    """Register proxy gateways so CTA engine can subscribe and send orders."""
    for name in ("CTP", "TTS"):
        if name not in main_engine.gateways:
            gw = main_engine.add_gateway(RemoteGateway, name)
            gw.connect({})
            logger.info(f"RemoteGateway registered: {name}")
