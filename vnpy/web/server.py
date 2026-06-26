"""
VeighNa Web Trader — FastAPI backend
Starts the trading engine and bridges events to WebSocket clients.
"""
import asyncio
import json
import logging
import threading
import time
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles

from vnpy.event import EventEngine, Event
from vnpy.trader.engine import MainEngine
from vnpy.trader.event import (
    EVENT_TICK, EVENT_ORDER, EVENT_TRADE,
    EVENT_POSITION, EVENT_ACCOUNT, EVENT_LOG,
    EVENT_CONTRACT, EVENT_QUOTE
)
from vnpy.trader.object import (
    OrderRequest, SubscribeRequest, CancelRequest
)
from vnpy.trader.constant import Direction, Exchange, Offset, OrderType
from vnpy.trader.setting import SETTINGS
from vnpy.trader.utility import TRADER_DIR

# Fix macOS font
SETTINGS["font.family"] = "PingFang SC"

# Ensure correct MIME types for WebAssembly
import mimetypes
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/wasm", ".so")
mimetypes.add_type("text/javascript", ".js")

# Load available modules
try:
    from vnpy_ctp import CtpGateway
    HAS_CTP = True
except ImportError:
    HAS_CTP = False
    print("⚠️  CTP gateway not available")

try:
    from vnpy_paperaccount import PaperAccountApp
    HAS_PAPER = True
except ImportError:
    HAS_PAPER = False

try:
    from vnpy_ctastrategy import CtaStrategyApp
    HAS_CTA = True
except ImportError:
    HAS_CTA = False

try:
    from vnpy_ctabacktester import CtaBacktesterApp
    HAS_BACKTESTER = True
except ImportError:
    HAS_BACKTESTER = False

try:
    from vnpy_datamanager import DataManagerApp
    HAS_DATAMANAGER = True
except ImportError:
    HAS_DATAMANAGER = False

# ---------------------------------------------------------------------------
# Web app
# ---------------------------------------------------------------------------
app = FastAPI(title="VeighNa Web Trader", version="4.4.0")

# Mount static files with correct MIME types
wasm_dist = Path(__file__).parent / "wasm-dist"
if wasm_dist.exists():
    app.mount("/wasm-dist", StaticFiles(directory=str(wasm_dist), html=True), name="wasm_dist")

# Also serve plugins and libs at root level for Qt6 WASM dynamic loading
plugins_dist = wasm_dist / "plugins"
libs_dist = wasm_dist
if plugins_dist.exists():
    app.mount("/plugins", StaticFiles(directory=str(plugins_dist)), name="qt_plugins")
# Mount individual .so files at root level too (Qt6 loads them as dynamic libs)
# We'll route them through wasm-dist

# Global state
event_engine: EventEngine | None = None
main_engine: MainEngine | None = None
ws_clients: list[WebSocket] = []
_main_loop: asyncio.AbstractEventLoop | None = None


def json_dumps(obj: Any) -> str:
    """Custom JSON encoder for VeighNa objects."""

    def convert(o: Any) -> Any:
        if hasattr(o, "__dict__"):
            result = {}
            for k, v in o.__dict__.items():
                if k.startswith("_"):
                    continue
                if isinstance(v, datetime):
                    result[k] = v.isoformat()
                elif isinstance(v, Enum):
                    result[k] = v.value
                elif hasattr(v, "__dict__"):
                    result[k] = convert(v)
                else:
                    result[k] = v
            return result
        elif isinstance(o, datetime):
            return o.isoformat()
        elif isinstance(o, Enum):
            return o.value
        return o

    return json.dumps(obj, default=convert, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Event → WebSocket bridge
# ---------------------------------------------------------------------------
def bridge_event(event: Event) -> None:
    """Forward VeighNa events to all connected WebSocket clients."""
    if not ws_clients:
        return

    data = event.data
    payload = json_dumps({
        "type": event.type,
        "data": data,
        "time": datetime.now().isoformat(),
    })

    async def broadcast():
        dead: list[WebSocket] = []
        for ws in ws_clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            _remove_client(ws)

    if _main_loop and _main_loop.is_running():
        asyncio.run_coroutine_threadsafe(broadcast(), _main_loop)


def _remove_client(ws: WebSocket) -> None:
    if ws in ws_clients:
        ws_clients.remove(ws)


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    ws_clients.append(ws)
    print(f"🔗 WebSocket client connected ({len(ws_clients)} total)")
    try:
        while True:
            msg = await ws.receive_text()
            await handle_ws_message(ws, msg)
    except WebSocketDisconnect:
        _remove_client(ws)
        print(f"🔌 WebSocket client disconnected ({len(ws_clients)} total)")
    except Exception:
        _remove_client(ws)


async def handle_ws_message(ws: WebSocket, msg: str) -> None:
    """Handle incoming WebSocket commands from the frontend."""
    global main_engine, event_engine
    if not main_engine or not event_engine:
        await ws.send_text(json.dumps({"type": "error", "msg": "Engine not ready"}))
        return

    try:
        cmd = json.loads(msg)
        action = cmd.get("action", "")
        payload = cmd.get("payload", {})

        if action == "get_status":
            await send_status(ws)

        elif action == "connect_gateway":
            gateway_name = payload.get("gateway", "")
            setting = payload.get("setting", {})
            if gateway_name:
                main_engine.connect(setting, gateway_name)
                main_engine.write_log(f"Web: 连接 {gateway_name}")

        elif action == "send_order":
            req = OrderRequest(
                symbol=payload["symbol"],
                exchange=Exchange(payload["exchange"]),
                direction=Direction(payload["direction"]),
                type=OrderType(payload.get("order_type", "LIMIT")),
                volume=float(payload["volume"]),
                price=float(payload.get("price", 0)),
                offset=Offset(payload.get("offset", "OPEN")),
                reference=payload.get("reference", ""),
            )
            vt_orderid = main_engine.send_order(req, payload.get("gateway", ""))
            await ws.send_text(json.dumps({
                "type": "order_sent",
                "vt_orderid": vt_orderid,
            }))

        elif action == "cancel_order":
            req = CancelRequest(
                orderid=payload["orderid"],
                symbol=payload["symbol"],
                exchange=Exchange(payload["exchange"]),
            )
            main_engine.cancel_order(req, payload.get("gateway", ""))

        elif action == "subscribe":
            req = SubscribeRequest(
                symbol=payload["symbol"],
                exchange=Exchange(payload["exchange"]),
            )
            main_engine.subscribe(req, payload.get("gateway", ""))

        elif action == "query_account":
            gw_name = payload.get("gateway", "")
            gw = main_engine.get_gateway(gw_name)
            if gw:
                gw.query_account()

        elif action == "query_position":
            gw_name = payload.get("gateway", "")
            gw = main_engine.get_gateway(gw_name)
            if gw:
                gw.query_position()

    except Exception as e:
        await ws.send_text(json.dumps({"type": "error", "msg": str(e)}))


async def send_status(ws: WebSocket) -> None:
    """Send current engine state to a client."""
    global main_engine
    if not main_engine:
        return

    status = {
        "type": "status",
        "gateways": main_engine.get_all_gateway_names(),
        "exchanges": [e.value for e in main_engine.get_all_exchanges()],
        "ticks": len(main_engine.get_all_ticks()) if hasattr(main_engine, "get_all_ticks") else 0,
        "orders": len(main_engine.get_all_orders()),
        "trades": len(main_engine.get_all_trades()),
        "positions": len(main_engine.get_all_positions()),
        "accounts": json.loads(json_dumps(main_engine.get_all_accounts())),
    }
    await ws.send_text(json.dumps(status, default=str))


# ---------------------------------------------------------------------------
# REST API
# ---------------------------------------------------------------------------
@app.get("/api/status")
def api_status():
    if not main_engine:
        return {"status": "offline"}
    return {
        "status": "online",
        "version": "4.4.0",
        "gateways": main_engine.get_all_gateway_names(),
        "exchanges": [e.value for e in main_engine.get_all_exchanges()],
    }


@app.get("/api/gateways")
def api_gateways():
    if not main_engine:
        return []
    result = []
    for name in main_engine.get_all_gateway_names():
        gw = main_engine.get_gateway(name)
        setting = gw.get_default_setting() if gw else {}
        result.append({"name": name, "default_setting": setting})
    return result


@app.get("/api/data")
def api_data():
    """Get all cached data (tick/order/trade/position/account)."""
    if not main_engine:
        return {}
    _parse = lambda s: json.loads(s)
    return {
        "ticks": [_parse(json_dumps(t)) for t in main_engine.get_all_ticks()],
        "orders": [_parse(json_dumps(o)) for o in main_engine.get_all_orders()],
        "trades": [_parse(json_dumps(t)) for t in main_engine.get_all_trades()],
        "positions": [_parse(json_dumps(p)) for p in main_engine.get_all_positions()],
        "accounts": [_parse(json_dumps(a)) for a in main_engine.get_all_accounts()],
        "active_orders": [_parse(json_dumps(o)) for o in main_engine.get_all_active_orders()],
    }


# ---------------------------------------------------------------------------
# Main page
# ---------------------------------------------------------------------------
@app.get("/")
def index():
    html_path = Path(__file__).parent / "index.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


@app.get("/wasm")
def wasm_index():
    html_path = Path(__file__).parent / "wasm-dist" / "index.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


@app.get("/qt")
def qt_wasm():
    html_path = Path(__file__).parent / "wasm-dist" / "qt.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


@app.get("/pyodide")
def pyodide_wasm():
    html_path = Path(__file__).parent / "wasm-dist" / "pyodide.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


@app.get("/qt6", include_in_schema=False)
def qt6_wasm():
    return HTMLResponse("""<!doctype html>
<html><head><meta charset=utf-8><title>VeighNa Qt6</title>
<style>html,body{padding:0;margin:0;overflow:hidden;height:100vh;background:#1e1e1e}
#screen{width:100%;height:100%}
#status{position:fixed;top:10px;left:10px;color:#0f0;font-family:monospace;font-size:12px;z-index:99;background:rgba(0,0,0,0.8);padding:8px}</style></head><body>
<div id="status">Loading...</div>
<div id="screen"></div>
<script src="/wasm-dist/hello_qt.js"></script>
<script>
var st = document.getElementById('status');
var Module = {
    locateFile: function(path) { return '/wasm-dist/' + path; },
    canvas: (function() {
        var c = document.createElement('canvas');
        c.id = 'qt-canvas';
        c.width = window.innerWidth * window.devicePixelRatio;
        c.height = window.innerHeight * window.devicePixelRatio;
        c.style.cssText = 'display:block;width:100vw;height:100vh;';
        document.getElementById('screen').appendChild(c);
        return c;
    })(),
    setStatus: function(t) { st.textContent = t; },
    preRun: [function() {
        // Set canvas size before Qt initializes
        var c = Module.canvas;
        _emscripten_set_canvas_element_size('#qt-canvas', c.width, c.height);
    }],
    print: function(t) { console.log('[Qt]',t); },
    printErr: function(t) { console.error('[Qt]',t); }
};
window.hello_qt_entry(Module).then(function() {
    st.textContent = 'App started!';
}).catch(function(e) {
    st.textContent = 'Error: ' + (e.message || e);
    console.error(e);
});
</script>
</body></html>""")


# Serve WASM files with correct MIME types
@app.get("/wasm-dist/{filename}")
async def wasm_static(filename: str):
    from fastapi.responses import FileResponse
    file_path = Path(__file__).parent / "wasm-dist" / filename
    if not file_path.exists():
        return {"error": "not found"}
    if filename.endswith(".wasm"):
        media_type = "application/wasm"
    elif filename.endswith(".js"):
        media_type = "text/javascript"
    elif filename.endswith(".so"):
        media_type = "application/wasm"
    else:
        media_type = None
    return FileResponse(file_path, media_type=media_type)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
def start_engine() -> None:
    """Initialize VeighNa trading engine (runs in background thread)."""
    global event_engine, main_engine

    print("🚀 Starting VeighNa engine...")
    event_engine = EventEngine()
    # MainEngine.__init__ will start the event_engine, so don't start it here
    main_engine = MainEngine(event_engine)

    # Register available gateways
    if HAS_CTP:
        main_engine.add_gateway(CtpGateway)
        print("  ✅ CTP Gateway")

    # Register available apps
    if HAS_PAPER:
        main_engine.add_app(PaperAccountApp)
        print("  ✅ Paper Account")
    if HAS_CTA:
        main_engine.add_app(CtaStrategyApp)
        print("  ✅ CTA Strategy")
    if HAS_BACKTESTER:
        main_engine.add_app(CtaBacktesterApp)
        print("  ✅ CTA Backtester")
    if HAS_DATAMANAGER:
        main_engine.add_app(DataManagerApp)
        print("  ✅ Data Manager")

    # Register event bridge
    event_engine.register_general(bridge_event)
    main_engine.write_log("Web Trader engine started")

    print(f"✅ Engine ready — {len(main_engine.get_all_gateway_names())} gateways")


@app.on_event("startup")
async def on_startup():
    """Start VeighNa engine when FastAPI starts."""
    global _main_loop
    _main_loop = asyncio.get_running_loop()
    t = threading.Thread(target=start_engine, daemon=True)
    t.start()
    # Wait for engine to be ready
    for _ in range(50):
        if main_engine is not None:
            break
        await asyncio.sleep(0.1)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8888, log_level="info")
