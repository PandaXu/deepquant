"""DeepQuant Gateway — FastAPI app with own MainEngine."""
import asyncio
import json
import threading
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from deepquant.event import EventEngine, Event
from deepquant.trader.engine import MainEngine
from deepquant.trader.event import (
    EVENT_TICK, EVENT_ORDER, EVENT_TRADE,
    EVENT_POSITION, EVENT_ACCOUNT, EVENT_LOG,
    EVENT_CONTRACT, EVENT_QUOTE
)
from deepquant.trader.object import SubscribeRequest, OrderRequest, CancelRequest
from deepquant.trader.constant import Direction, Exchange, Offset, OrderType

# Lazy gateway loaders — each backend must be loaded AFTER set_ctp_backend()
_GATEWAY_LOADERS = {
    "CTP": lambda: _load_gateway("official", "ctp_gateway", "CtpGateway"),
    "TTS": lambda: _load_gateway("tts", "tts_gateway", "TtsGateway"),
}

def _load_gateway(backend: str, module_name: str, class_name: str):
    """Import a gateway class, loading the correct CTP API backend first."""
    import sys
    import importlib
    import deepquant_ctp.api as api_mod

    # 1. Load the backend-specific .so files (or get from cache)
    be = api_mod.load_backend(backend)

    # 2. Swap module-level MdApi/TdApi so new imports bind to the right backend
    api_mod.MdApi = be["MdApi"]
    api_mod.TdApi = be["TdApi"]
    logger.info(f"Switched CTP API to '{backend}': MdApi={be['MdApi']} TdApi={be['TdApi']}")

    # 3. Force-reload ctp_gateway so CtpMdApi/CtpTdApi bind to the swapped MdApi/TdApi
    ctp_mod_name = "deepquant_gateway.gateway.ctp_gateway"
    if ctp_mod_name in sys.modules:
        importlib.reload(sys.modules[ctp_mod_name])
        logger.info(f"Reloaded {ctp_mod_name} with '{backend}' backend")

    # 4. Now import the target gateway module
    mod = importlib.import_module(f"deepquant_gateway.gateway.{module_name}")
    gw_class = getattr(mod, class_name, None)
    if gw_class is None:
        raise RuntimeError(f"Gateway class '{class_name}' not found in deepquant_ctp.gateway.{module_name}")
    return gw_class

def _get_gateway(gateway_type: str):
    """Get gateway class, loading it with correct backend if not yet loaded."""
    loader = _GATEWAY_LOADERS.get(gateway_type)
    if not loader:
        return None
    return loader()

app = FastAPI(title="DeepQuant Gateway", version="0.0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

event_engine: EventEngine = None
main_engine: MainEngine = None
ws_clients: list[WebSocket] = []
_disconnected: set = set()  # gateway types that have been disconnected via /disconnect
_main_loop = None

def json_dumps(obj):
    def convert(o):
        if hasattr(o, "__dict__"):
            return {k: convert(v) for k, v in o.__dict__.items() if not k.startswith("_")}
        if isinstance(o, datetime): return o.isoformat()
        if hasattr(o, "value"): return o.value
        return o
    return json.dumps(obj, default=convert, ensure_ascii=False)

def bridge_event(event: Event):
    if not ws_clients: return
    payload = json_dumps({"type": event.type, "data": event.data, "time": datetime.now().isoformat()})
    async def broadcast():
        dead = []
        for ws in ws_clients:
            try: await ws.send_text(payload)
            except: dead.append(ws)
        for ws in dead: ws_clients.remove(ws)
    if _main_loop and _main_loop.is_running():
        asyncio.run_coroutine_threadsafe(broadcast(), _main_loop)

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    ws_clients.append(ws)
    logger.info(f"Server client connected ({len(ws_clients)} total)")
    try:
        while True:
            await ws.receive_text()  # keep-alive
    except WebSocketDisconnect:
        ws_clients.remove(ws)

@app.get("/status")
def get_status():
    if not main_engine: return {"status": "offline"}
    return {
        "status": "online",
        "gateways": [g for g in main_engine.get_all_gateway_names() if g not in _disconnected],
        "exchanges": [e.value for e in main_engine.get_all_exchanges()],
        "ticks": len(main_engine.get_all_ticks()) if hasattr(main_engine, "get_all_ticks") else 0,
    }

@app.post("/connect")
async def connect_gateway(request: dict):
    body = request  # FastAPI already parsed as dict
    gateway_type = body.get("gateway_type", "CTP")
    setting = body.get("setting", {})

    # Load gateway class with correct CTP API backend (official vs tts)
    try:
        gw_class = _get_gateway(gateway_type)
    except Exception as e:
        return {"error": f"Failed to load gateway '{gateway_type}': {e}"}
    if not gw_class:
        return {"error": f"unsupported gateway: {gateway_type}"}

    if gateway_type in main_engine.gateways:
        _disconnected.discard(gateway_type)
        return {"status": "connected", "gateway": gateway_type}

    main_engine.add_gateway(gw_class, gateway_type)
    _disconnected.discard(gateway_type)
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, main_engine.connect, setting, gateway_type)
    return {"status": "connected", "gateway": gateway_type}

@app.post("/disconnect")
async def disconnect_gateway(request: dict):
    body = request
    gateway_type = body.get("gateway_type", "CTP")
    # CTP native library crashes on remove_gateway (SIGSEGV) — mark as disconnected instead
    _disconnected.add(gateway_type)
    main_engine.write_log(f"账户已断开 ({gateway_type})")
    return {"status": "disconnected", "gateway": gateway_type}

@app.post("/subscribe")
async def subscribe(request: dict):
    try:
        body = request
        symbol = body.get("symbol", "")
        exchange = body.get("exchange", "")
        gateway = body.get("gateway", "")
        if not symbol or not exchange:
            return {"error": "symbol and exchange are required"}

        active = {k: v for k, v in main_engine.gateways.items() if k not in _disconnected}
        if not active:
            return {"error": "no active gateway"}

        from deepquant.trader.constant import Exchange
        try:
            ex = Exchange(exchange)
        except ValueError:
            return {"error": f"invalid exchange: {exchange}"}

        req = SubscribeRequest(symbol=symbol, exchange=ex)
        for name, gw in active.items():
            if gateway and name != gateway:
                continue
            try:
                gw.subscribe(req)
            except Exception as e:
                return {"error": f"subscribe failed on {name}: {e}"}
        return {"subscribed": f"{symbol}.{exchange}"}
    except Exception as e:
        return {"error": f"internal: {e}"}

@app.post("/send_order")
async def send_order(request: dict):
    body = request
    req = OrderRequest(
        symbol=body["symbol"],
        exchange=Exchange(body["exchange"]),
        direction=Direction(body["direction"]),
        type=OrderType(body.get("order_type", "LIMIT")),
        volume=float(body["volume"]),
        price=float(body.get("price", 0)),
        offset=Offset(body.get("offset", "OPEN")),
        reference=body.get("reference", ""),
    )
    gateway = body.get("gateway", "")
    vt_orderid = main_engine.send_order(req, gateway)
    return {"vt_orderid": vt_orderid, "status": "sent"}

@app.post("/cancel_order")
async def cancel_order(request: dict):
    body = request
    req = CancelRequest(
        orderid=body["orderid"],
        symbol=body["symbol"],
        exchange=Exchange(body["exchange"]),
    )
    main_engine.cancel_order(req, body.get("gateway", ""))
    return {"status": "cancelled"}

@app.on_event("startup")
async def on_startup():
    global event_engine, main_engine, _main_loop
    _main_loop = asyncio.get_running_loop()
    event_engine = EventEngine()
    main_engine = MainEngine(event_engine)
    event_engine.register_general(bridge_event)
    main_engine.write_log("Gateway engine ready")
    logger.info("Gateway engine ready")
