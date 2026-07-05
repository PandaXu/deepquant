"""
API client — communicates with deepquant_server via REST + WebSocket.

Replaces all direct MainEngine / EventEngine / get_database() calls
with HTTP requests and WebSocket messages.
"""
import json
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Callable
from urllib.request import Request, urlopen
from urllib.error import URLError

from PySide6.QtCore import QUrl, Signal
from PySide6.QtWebSockets import QWebSocket


class _DictObj:
    """Wrap a dict so attributes are accessible as obj.key (for widget compat)."""
    def __init__(self, d: dict):
        self.__dict__ = {k: _DictObj(v) if isinstance(v, dict) else v for k, v in d.items()}

    def __repr__(self):
        return repr(self.__dict__)

    def __getattr__(self, name):
        if name == '__dict__':
            return super().__getattribute__('__dict__')
        return None


class _Event:
    """Lightweight Event-compatible object for widget backward compat."""
    def __init__(self, type: str, data: Any):
        self.type = type
        self.data = _DictObj(data) if isinstance(data, dict) else data


# Server event types → local handler names
SERVER_EVENTS = [
    "eTick", "eOrder", "eTrade", "ePosition", "eAccount",
    "eLog", "eContract", "eQuote",
]


class ApiClient(QWebSocket):
    """Communicates with the backend server over HTTP + WebSocket.

    Use ``signal_event`` (Qt Signal) to route incoming server events
    to the main thread — connect your handlers to it.
    """

    signal_event: Signal = Signal(str, object)

    def __init__(self, base_url: str = "http://127.0.0.1:8888") -> None:
        super().__init__()
        self._base = base_url.rstrip("/")
        self._ws_url = self._base.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
        self._ready = False

        self.textMessageReceived.connect(self._on_ws_message)
        self.connected.connect(lambda: setattr(self, "_ready", True))
        self.errorOccurred.connect(lambda e: print(f"[ApiClient] WS error: {e}"))

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------
    def connect_to_server(self) -> None:
        """Open WebSocket (non-blocking — Qt event loop must be running)."""
        self.open(QUrl(self._ws_url))

    def disconnect_from_server(self) -> None:
        self.close()

    # ------------------------------------------------------------------
    # WebSocket event handling
    # ------------------------------------------------------------------
    def _on_ws_message(self, raw: str) -> None:
        try:
            msg: dict = json.loads(raw)
        except json.JSONDecodeError:
            return
        event_type: str = msg.get("type", "")
        data: Any = msg.get("data", {})
        self.signal_event.emit(event_type, data)

    # ------------------------------------------------------------------
    # WebSocket command helpers
    # ------------------------------------------------------------------
    def _send_ws(self, action: str, payload: dict | None = None) -> None:
        self.sendTextMessage(json.dumps({"action": action, "payload": payload or {}}))

    # ------------------------------------------------------------------
    # REST helpers
    # ------------------------------------------------------------------
    def _get(self, path: str) -> dict | list:
        req = Request(f"{self._base}{path}")
        req.add_header("Accept", "application/json")
        try:
            with urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode())
        except URLError as e:
            print(f"[ApiClient] GET {path} failed: {e}")
            return {}

    def _post(self, path: str, body: dict) -> dict:
        data = json.dumps(body).encode()
        req = Request(f"{self._base}{path}", data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        try:
            with urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode())
        except URLError as e:
            print(f"[ApiClient] POST {path} failed: {e}")
            return {}

    # ------------------------------------------------------------------
    # Trading commands → WebSocket
    # ------------------------------------------------------------------
    def send_order(
        self, symbol: str, exchange: str, direction: str,
        offset: str = "OPEN", price: float = 0, volume: float = 0,
        order_type: str = "LIMIT", reference: str = "", gateway: str = "",
    ) -> str:
        """Place an order. Returns vt_orderid."""
        self._send_ws("send_order", {
            "symbol": symbol, "exchange": exchange, "direction": direction,
            "offset": offset, "price": price, "volume": volume,
            "order_type": order_type, "reference": reference, "gateway": gateway,
        })
        return ""

    def cancel_order(self, orderid: str, symbol: str, exchange: str, gateway: str = "") -> None:
        self._send_ws("cancel_order", {
            "orderid": orderid, "symbol": symbol, "exchange": exchange,
            "gateway": gateway,
        })

    def cancel_quote(self, orderid: str, symbol: str, exchange: str, gateway: str = "") -> None:
        self._send_ws("cancel_quote", {
            "orderid": orderid, "symbol": symbol, "exchange": exchange,
            "gateway": gateway,
        })

    def subscribe(self, symbol: str | object, exchange: str = "", gateway: str = "") -> None:
        # Support legacy: subscribe(req: SubscribeRequest, gateway_name: str)
        if hasattr(symbol, 'symbol'):
            req = symbol
            exchange_str = req.exchange.value if hasattr(req.exchange, 'value') else str(req.exchange)
            gw = exchange  # second arg is gateway_name in legacy signature
            self._send_ws("subscribe", {
                "symbol": str(req.symbol), "exchange": exchange_str, "gateway": gw or "",
            })
        else:
            self._send_ws("subscribe", {
                "symbol": str(symbol), "exchange": str(exchange), "gateway": str(gateway),
            })

    def connect_gateway(self, gateway: str, setting: dict) -> None:
        self._send_ws("connect_gateway", {"gateway": gateway, "setting": setting})

    # ------------------------------------------------------------------
    # Query commands → REST
    # ------------------------------------------------------------------
    def get_status(self) -> dict:
        return self._get("/api/status")  # type: ignore[return-value]

    def get_gateways(self) -> list:
        return self._get("/api/gateways")  # type: ignore[return-value]

    def get_contracts(self, filter_str: str = "") -> list:
        params = f"?filter={filter_str}" if filter_str else ""
        return self._get(f"/api/contracts{params}")  # type: ignore[return-value]

    def get_contract(self, vt_symbol: str) -> dict:
        """Return single contract dict, or empty dict."""
        contracts = self.get_contracts(vt_symbol)
        for c in contracts:
            if c.get("vt_symbol") == vt_symbol:
                return c
        return {}

    def get_exchanges(self) -> list:
        from deepquant.trader.constant import Exchange
        return [Exchange.CFFEX, Exchange.SHFE, Exchange.DCE,
                Exchange.CZCE, Exchange.INE, Exchange.GFEX]

    def get_gateway_names(self) -> list:
        gateways = self.get_gateways()
        return [g["name"] for g in gateways if isinstance(g, dict)]

    def get_settings(self) -> dict:
        return self._get("/api/settings")  # type: ignore[return-value]

    def save_settings(self, data: dict) -> None:
        self._post("/api/settings", data)

    def get_data(self) -> dict:
        """Return cached ticks/orders/trades/positions/accounts."""
        return self._get("/api/data")  # type: ignore[return-value]

    def get_bars(
        self, symbol: str, exchange: str,
        interval: str = "1m", days: int = 60,
    ) -> list:
        """Load historical K-line bars from the server."""
        end = datetime.now()
        start = end - timedelta(days=days)
        params = (
            f"?symbol={symbol}&exchange={exchange}&interval={interval}"
            f"&start={start.strftime('%Y-%m-%d')}&end={end.strftime('%Y-%m-%d')}"
        )
        resp = self._get(f"/api/bars{params}")
        return resp.get("bars", []) if isinstance(resp, dict) else []

    def get_products(self, exchange: str) -> list:
        resp = self._get(f"/api/contracts/products?exchange={exchange}")
        return resp.get("products", []) if isinstance(resp, dict) else []

    def get_public_contracts(self, exchange: str, product: str = "") -> list:
        all_contracts: list = []
        offset = 0
        limit = 100
        while True:
            params = f"?offset={offset}&limit={limit}"
            if exchange:
                params += f"&exchange={exchange}"
            if product:
                params += f"&product={product}"
            resp = self._get(f"/api/contracts/public{params}")
            batch = resp.get("contracts", []) if isinstance(resp, dict) else []
            all_contracts.extend(batch)
            if not isinstance(resp, dict) or not resp.get("has_more") or not batch:
                break
            offset += len(batch)
        return all_contracts

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------
    def is_online(self) -> bool:
        s = self.get_status()
        return s.get("status") == "online"

    def get_default_setting(self, gateway_name: str) -> dict:
        gateways = self.get_gateways()
        for g in gateways:
            if g.get("name") == gateway_name:
                return g.get("default_setting", {})
        return {}

    # ------------------------------------------------------------------
    # Backward-compat adapters — make ApiClient quack like MainEngine + EventEngine
    # so existing widget code works with minimal changes.
    # ------------------------------------------------------------------

    # --- MainEngine-compatible methods ---
    get_all_exchanges = get_exchanges
    get_all_gateway_names = get_gateway_names
    get_all_contracts = get_contracts       # call without filter → all contracts
    get_all_active_orders = lambda self: ApiClient.get_data(self).get("active_orders", [])
    get_all_positions = lambda self: ApiClient.get_data(self).get("positions", [])
    def get_all_apps(self) -> list:
        """Return app info as objects with app_name/display_name/icon_name/widget_name/app_module."""
        raw = self._get("/api/apps")
        if not isinstance(raw, list):
            return []
        result = []
        for a in raw:
            name = a.get("name", "")
            # Map known apps to their module/widget info
            info = {
                "CtaStrategy": ("vnpy_ctastrategy", "CtaManager"),
                "CtaBacktester": ("deepquant_ctabacktester", "BacktesterManager"),
                "PaperAccount": ("vnpy_paperaccount", "PaperManager"),
            }.get(name, ("", ""))
            obj = type("App", (), {
                "app_name": name,
                "display_name": a.get("display", name),
                "icon_name": a.get("icon", ""),
                "app_module": info[0],
                "widget_name": info[1],
            })()
            result.append(obj)
        return result
    get_tick = lambda self, vt_symbol: (
        next((t for t in ApiClient.get_data(self).get("ticks", [])
              if t.get("vt_symbol") == vt_symbol), None)
    )

    def get_engine(self, name: str):
        """Stub — engine access. Returns None for most engines."""
        return None  # Engines live on server; desktop just sends WS commands

    def write_log(self, msg: str, source: str = "") -> None:
        pass  # Server handles logging

    # --- EventEngine-compatible methods ---
    def register(self, event_type: str, handler: Callable) -> None:
        """Register a handler for a server event type.

        Wraps data dict in an _Event object so widgets that expect
        ``event.type`` / ``event.data`` work unchanged.
        """
        self.signal_event.connect(
            lambda et, d, _et=event_type, _h=handler: (
                _h(_Event(_et, d)) if et == _et else None
            )
        )

    def put(self, event) -> None:
        pass  # Not supported via API

