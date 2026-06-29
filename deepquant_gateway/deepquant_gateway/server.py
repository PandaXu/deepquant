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
from deepquant.trader.object import SubscribeRequest

# Load gateway classes
# Load gateway classes from their respective packages
GATEWAYS = {}

try:
    from deepquant_ctp.gateway.ctp_gateway import CtpGateway
    if CtpGateway is not None:
        GATEWAYS["CTP"] = CtpGateway
except ImportError:
    pass

try:
    from deepquant_ctp.gateway.tts_gateway import TtsGateway
    if TtsGateway is not None:
        GATEWAYS["TTS"] = TtsGateway
except ImportError:
    pass

app = FastAPI(title="DeepQuant Gateway", version="0.0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

event_engine: EventEngine = None
main_engine: MainEngine = None
ws_clients: list[WebSocket] = []
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
        "gateways": main_engine.get_all_gateway_names(),
        "exchanges": [e.value for e in main_engine.get_all_exchanges()],
        "ticks": len(main_engine.get_all_ticks()) if hasattr(main_engine, "get_all_ticks") else 0,
    }

@app.post("/connect")
async def connect_gateway(request: dict):
    body = request  # FastAPI already parsed as dict
    gateway_type = body.get("gateway_type", "CTP")
    setting = body.get("setting", {})
    gw_class = GATEWAYS.get(gateway_type)
    if not gw_class: return {"error": f"unsupported gateway: {gateway_type}"}
    if gateway_type in main_engine.gateways:
        return {"status": "connected", "gateway": gateway_type}
    main_engine.add_gateway(gw_class, gateway_type)
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, main_engine.connect, setting, gateway_type)
    return {"status": "connected", "gateway": gateway_type}

@app.post("/disconnect")
async def disconnect_gateway(request: dict):
    body = request
    gateway_type = body.get("gateway_type", "CTP")
    if gateway_type in main_engine.gateways:
        main_engine.remove_gateway(gateway_type)
    return {"status": "disconnected", "gateway": gateway_type}

@app.post("/subscribe")
async def subscribe(request: dict):
    body = request
    req = SubscribeRequest(
        symbol=body["symbol"],
        exchange=body["exchange"],
        gateway=body.get("gateway", "")
    )
    for name, gw in main_engine.gateways.items():
        if body.get("gateway") and name != body["gateway"]: continue
        gw.subscribe(req)
    return {"subscribed": f"{body['symbol']}.{body['exchange']}"}

@app.on_event("startup")
async def on_startup():
    global event_engine, main_engine, _main_loop
    _main_loop = asyncio.get_running_loop()
    event_engine = EventEngine()
    main_engine = MainEngine(event_engine)
    event_engine.register_general(bridge_event)
    main_engine.write_log("Gateway engine ready")
    logger.info("Gateway engine ready")
