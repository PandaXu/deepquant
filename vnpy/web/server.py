"""
VeighNa Web Trader — FastAPI backend
Starts the trading engine and bridges events to WebSocket clients.
"""
import asyncio
import json
import threading
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

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

SETTINGS["font.family"] = "PingFang SC"

# Load available modules
try:
    from vnpy_ctp import CtpGateway
    HAS_CTP = True
except ImportError:
    HAS_CTP = False

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

        # ---- App: PaperAccount ----
        elif action == "get_paper_settings":
            engine = main_engine.get_engine("PaperAccount")
            if engine:
                await ws.send_text(json.dumps({"type": "paper_settings", "data": {
                    "slippage": engine.get_trade_slippage(),
                    "interval": engine.get_timer_interval(),
                    "instant": engine.get_instant_trade(),
                }}))

        elif action == "set_paper_settings":
            engine = main_engine.get_engine("PaperAccount")
            if engine:
                engine.set_trade_slippage(int(payload.get("slippage", 0)))
                engine.set_timer_interval(int(payload.get("interval", 30)))
                engine.set_instant_trade(bool(payload.get("instant", True)))
                main_engine.write_log("模拟交易设置已更新")

        elif action == "paper_clear_position":
            engine = main_engine.get_engine("PaperAccount")
            if engine:
                engine.clear_position()
                main_engine.write_log("模拟交易持仓已清空")

        # ---- App: CtaStrategy ----
        elif action == "get_cta_classes":
            engine = main_engine.get_engine("CtaStrategy")
            if engine:
                names = engine.get_all_strategy_class_names()
                names.sort()
                await ws.send_text(json.dumps({"type": "cta_classes", "data": names}))

        elif action == "get_cta_strategies":
            engine = main_engine.get_engine("CtaStrategy")
            if engine:
                strategies = engine.get_all_strategies()
                result = []
                for s in strategies:
                    result.append({
                        "strategy_name": s.strategy_name,
                        "vt_symbol": s.vt_symbol,
                        "class_name": s.class_name,
                        "parameters": engine.get_strategy_parameters(s.strategy_name),
                        "variables": engine.get_strategy_variables(s.strategy_name),
                    })
                await ws.send_text(json.dumps({"type": "cta_strategies", "data": result}))

        elif action.startswith("cta_strategy_"):
            engine = main_engine.get_engine("CtaStrategy")
            if engine:
                name = payload.get("strategy_name", "")
                act = action.replace("cta_strategy_", "")
                if act == "init":
                    engine.init_strategy(name)
                elif act == "start":
                    engine.start_strategy(name)
                elif act == "stop":
                    engine.stop_strategy(name)
                elif act == "remove":
                    engine.remove_strategy(name)
                await ws.send_text(json.dumps({"type": "cta_strategies", "data": []}))
                # Refresh strategy list
                await asyncio.sleep(0.5)

        elif action.startswith("cta_"):
            engine = main_engine.get_engine("CtaStrategy")
            if engine:
                act = action.replace("cta_", "")
                if act == "init_all":
                    engine.init_all_strategies()
                elif act == "start_all":
                    engine.start_all_strategies()
                elif act == "stop_all":
                    engine.stop_all_strategies()

        # ---- App: CtaBacktester ----
        elif action == "get_backtest_classes":
            engine = main_engine.get_engine("CtaBacktester")
            if engine:
                names = engine.get_strategy_class_names()
                names.sort()
                await ws.send_text(json.dumps({"type": "bt_classes", "data": names}))

        elif action == "start_backtesting":
            engine = main_engine.get_engine("CtaBacktester")
            if engine:
                # This runs synchronously and may take a while
                import threading
                def run_bt():
                    try:
                        engine.start_backtesting(
                            payload["class_name"],
                            payload["vt_symbol"],
                            payload["interval"],
                            payload["start"],
                            payload["end"],
                            float(payload.get("capital", 1000000)),
                            float(payload.get("rate", 0.0001)),
                            float(payload.get("slippage", 0.2)),
                            int(payload.get("size", 10)),
                            float(payload.get("pricetick", 1)),
                        )
                        result = engine.get_result_statistics()
                        # Send result via event bridge
                        event_engine.put(Event("backtestResult", result))
                    except Exception as e:
                        event_engine.put(Event("backtestError", str(e)))
                t = threading.Thread(target=run_bt, daemon=True)
                t.start()

        # ---- App: DataManager ----
        elif action == "get_data_overview":
            engine = main_engine.get_engine("DataManager")
            if engine:
                overviews = engine.get_bar_overview()
                result = [{"symbol": o.symbol, "exchange": o.exchange.value if o.exchange else "",
                           "interval": o.interval.value if o.interval else "", "count": o.count,
                           "start": o.start.isoformat() if o.start else "", "end": o.end.isoformat() if o.end else "",
                           "vt_symbol": f"{o.symbol}.{o.exchange.value}" if o.exchange else o.symbol}
                          for o in overviews]
                await ws.send_text(json.dumps({"type": "data_overview", "data": result}))

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


@app.get("/api/apps")
def api_apps():
    if not main_engine:
        return []
    return [{"name": a.app_name, "display": a.display_name, "icon": a.icon_name}
            for a in main_engine.get_all_apps()]


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
# App pages
# ---------------------------------------------------------------------------
@app.get("/app")
def app_page():
    html_path = Path(__file__).parent / "apps.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Main page
# ---------------------------------------------------------------------------
@app.get("/")
def index():
    html_path = Path(__file__).parent / "index.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
def start_engine() -> None:
    """Initialize VeighNa trading engine (runs in background thread)."""
    global event_engine, main_engine

    print("🚀 Starting VeighNa engine...")
    event_engine = EventEngine()
    main_engine = MainEngine(event_engine)

    if HAS_CTP:
        main_engine.add_gateway(CtpGateway)
        print("  ✅ CTP Gateway")

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

    # Register backtest result events
    event_engine.register("backtestResult", bridge_event)
    event_engine.register("backtestError", bridge_event)
    # Register CTA log events to forward to WebSocket
    if HAS_CTA:
        try:
            from vnpy_ctastrategy.base import EVENT_CTA_LOG
            event_engine.register(EVENT_CTA_LOG, bridge_event)
        except ImportError:
            pass
    if HAS_BACKTESTER:
        try:
            from vnpy_ctabacktester.engine import EVENT_BACKTESTER_LOG
            event_engine.register(EVENT_BACKTESTER_LOG, bridge_event)
        except ImportError:
            pass

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
    for _ in range(50):
        if main_engine is not None:
            break
        await asyncio.sleep(0.1)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8888, log_level="info")
