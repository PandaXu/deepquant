"""
VeighNa Web Trader — FastAPI backend
Starts the trading engine and bridges events to WebSocket clients.
"""
import asyncio
import json
import threading
import uuid
from datetime import datetime, timedelta
from enum import Enum
from typing import Any

from . import data_api
from . import data_update_service

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from loguru import logger

from deepquant.event import EventEngine, Event, EVENT_TIMER
from deepquant.trader.engine import MainEngine
from deepquant.trader.event import (
    EVENT_TICK, EVENT_ORDER, EVENT_TRADE,
    EVENT_POSITION, EVENT_ACCOUNT, EVENT_LOG,
    EVENT_CONTRACT, EVENT_QUOTE
)
from deepquant.trader.object import (
    OrderRequest, CancelRequest
)
from deepquant.trader.constant import Direction, Exchange, Offset, OrderType
from deepquant.trader.setting import SETTINGS

SETTINGS["font.family"] = "PingFang SC"

from .gateway_client import GatewayClient, _GW_INSTANCES

gateway_client: GatewayClient = None

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
    from deepquant_datamanager import DataManagerApp
    HAS_DATAMANAGER = True
except ImportError:
    HAS_DATAMANAGER = False

# ---------------------------------------------------------------------------
# Web app
# ---------------------------------------------------------------------------
app = FastAPI(title="DeepQuant Server", version="0.0.1")

# Allow all origins for development (web frontend on different port)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"service": "DeepQuant Server", "version": "0.0.1", "docs": "/api/status"}


# Global state
event_engine: EventEngine | None = None
main_engine: MainEngine | None = None
ws_clients: list[WebSocket] = []
_active_account_name: str = ""  # currently connected CTP account alias
_cached_gateways: list[str] = []  # polled from Gateway service in background
_main_loop: asyncio.AbstractEventLoop | None = None


def json_dumps(obj: Any) -> str:
    """Custom JSON encoder for VeighNa objects."""
    def convert(o: Any) -> Any:
        if isinstance(o, datetime): return o.isoformat()
        if isinstance(o, Enum): return o.value  # Enum — check BEFORE __dict__
        if hasattr(o, "__dict__"):
            result = {}
            for k, v in o.__dict__.items():
                if k.startswith("_"): continue
                result[k] = convert(v)
            return result
        return o
    return json.dumps(obj, default=convert, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Event → WebSocket bridge
# ---------------------------------------------------------------------------
_broadcast_queue: asyncio.Queue = asyncio.Queue()

async def _broadcast_worker():
    """Consume broadcast queue in the uvicorn event loop."""
    while True:
        payload, clients_snapshot = await _broadcast_queue.get()
        dead = []
        for ws in list(clients_snapshot):
            try:
                await ws.send_text(payload)
            except Exception:
                if ws in ws_clients:
                    dead.append(ws)
        for ws in dead:
            _remove_client(ws)


def bridge_event(event: Event) -> None:
    """Forward VeighNa events to all connected WebSocket clients."""
    # Skip timer noise — not useful for Web UI
    if event.type == EVENT_TIMER:
        return
    if not ws_clients:
        return

    try:
        payload = json_dumps({
            "type": event.type,
            "data": event.data,
            "time": datetime.now().isoformat(),
        })
    except Exception:
        return

    # Push to queue — worker runs in uvicorn event loop
    try:
        _broadcast_queue.put_nowait((payload, list(ws_clients)))
    except Exception:
        pass


def _remove_client(ws: WebSocket) -> None:
    if ws in ws_clients:
        ws_clients.remove(ws)


def _broadcast_json(payload: dict) -> None:
    """Push JSON event to all WS clients from any thread."""
    if not ws_clients:
        return
    try:
        _broadcast_queue.put_nowait((json.dumps(payload, ensure_ascii=False), list(ws_clients)))
    except Exception:
        pass


def _emit_data_task(
    task_id: str,
    action: str,
    status: str,
    label: str,
    message: str = "",
    progress_current: int = 0,
    progress_total: int = 0,
) -> None:
    now = datetime.now().isoformat()
    payload: dict[str, Any] = {
        "id": task_id,
        "action": action,
        "status": status,
        "label": label,
        "message": message,
        "started_at": now if status == "running" else "",
        "finished_at": now if status in ("success", "error", "cancelled") else "",
    }
    if progress_total > 0:
        payload["progress"] = {"current": progress_current, "total": progress_total}
    _broadcast_json({"type": "data_task", "data": payload})


def _push_data_overviews() -> None:
    if not main_engine:
        return
    overview = data_api.load_data_overview(main_engine)
    _broadcast_json({"type": "data_overview", "data": overview["bars"]})
    _broadcast_json({"type": "tick_overview", "data": overview["ticks"]})


def _get_data_queue() -> data_update_service.DataUpdateQueue | None:
    return data_update_service.get_update_queue(
        lambda: main_engine,
        _emit_data_task,
        _push_data_overviews,
        _data_manager_log,
    )


def _data_manager_log(msg: str) -> None:
    if main_engine:
        main_engine.write_log(msg)
    _broadcast_json({"type": "log", "data": {"msg": msg, "gateway_name": "DataManager"}})


# ---------------------------------------------------------------------------
# DataManager WS actions
# ---------------------------------------------------------------------------
async def _handle_data_manager_action(action: str, payload: dict, ws: WebSocket) -> None:
    global main_engine
    engine = main_engine.get_engine("DataManager") if main_engine else None
    if not engine and action not in ("cancel_data_task", "set_data_watchlist", "materialize_bar_data"):
        await ws.send_text(json.dumps({"type": "error", "msg": "DataManager 未加载，请安装 deepquant_datamanager"}))
        return

    symbol = payload.get("symbol", "")
    exchange = payload.get("exchange", "")
    interval = payload.get("interval", "d")
    task_id = payload.get("task_id") or str(uuid.uuid4())[:8]
    priority = payload.get("priority", "high" if action == "update_bar_data" else "normal")
    user_end = payload.get("end", "")

    queue = _get_data_queue()
    if not queue:
        await ws.send_text(json.dumps({"type": "error", "msg": "数据更新队列未初始化"}))
        return

    if action == "cancel_data_task":
        cancelled = queue.cancel(payload.get("task_id", task_id))
        await ws.send_text(json.dumps({"type": "data_task_cancelled", "ok": cancelled, "task_id": payload.get("task_id", task_id)}))
        return

    if action == "set_data_watchlist":
        items = payload.get("items") or []
        queue.set_scheduled_symbols(items)
        return

    if action == "materialize_bar_data":
        if not symbol or not exchange:
            await ws.send_text(json.dumps({"type": "error", "msg": "缺少 symbol/exchange"}))
            return
        queue.enqueue(
            action="materialize_bar_data",
            symbol=symbol,
            exchange=exchange,
            interval=interval or "1m",
            task_id=task_id,
            label=f"{symbol}.{exchange} 物化",
            priority="high",
        )
        return

    if action == "auto_update":
        items = payload.get("items") or []
        if not items and symbol and exchange:
            items = [{"symbol": symbol, "exchange": exchange, "interval": interval}]
        if not items:
            await ws.send_text(json.dumps({"type": "error", "msg": "无更新目标"}))
            return
        queue.enqueue(
            action="auto_update",
            batch_items=items,
            incremental=True,
            user_end=user_end,
            materialize_first=payload.get("materialize_first", True),
            priority=payload.get("priority", "normal"),
            task_id=task_id,
            label=payload.get("label", f"自动更新 {len(items)} 项"),
        )
        return

    if action == "sync_minute_data":
        queue.enqueue(
            action="sync_minute_data",
            task_id=task_id,
            label=payload.get("label", "补分钟线"),
            priority="normal",
        )
        return

    if action == "delete_bar_data":
        if not symbol or not exchange:
            await ws.send_text(json.dumps({"type": "error", "msg": "缺少 symbol/exchange"}))
            return
        queue.enqueue(
            action="delete_bar_data",
            symbol=symbol,
            exchange=exchange,
            interval=interval,
            task_id=task_id,
            label=f"{symbol}.{exchange} {interval}",
            priority="high",
        )
        return

    if action == "batch_download_bar_data":
        items = payload.get("items") or []
        if not items:
            await ws.send_text(json.dumps({"type": "error", "msg": "批量下载列表为空"}))
            return
        queue.enqueue(
            action="batch_download_bar_data",
            batch_items=items,
            interval=payload.get("interval", "d"),
            incremental=payload.get("incremental", False),
            user_start=payload.get("start", ""),
            user_end=user_end,
            materialize_first=payload.get("materialize_first", False),
            task_id=task_id,
            priority=payload.get("priority", "normal"),
        )
        return

    if not symbol or not exchange:
        await ws.send_text(json.dumps({"type": "error", "msg": "请选择合约"}))
        return

    incremental = action == "update_bar_data"
    queue.enqueue(
        action=action,
        symbol=symbol,
        exchange=exchange,
        interval=interval,
        incremental=incremental,
        user_start=payload.get("start", ""),
        user_end=user_end,
        materialize_first=payload.get("materialize_first", incremental and interval == "1m"),
        task_id=task_id,
        label=f"{symbol}.{exchange} {interval}",
        priority=priority,
    )


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    ws_clients.append(ws)
    logger.info(f"WebSocket client connected ({len(ws_clients)} total)")
    try:
        while True:
            msg = await ws.receive_text()
            await handle_ws_message(ws, msg)
    except WebSocketDisconnect:
        _remove_client(ws)
        logger.info(f"WebSocket client disconnected ({len(ws_clients)} total)")
    except Exception as e:
        logger.error(f"WebSocket error: {type(e).__name__}: {e}")
        _remove_client(ws)


async def handle_ws_message(ws: WebSocket, msg: str) -> None:
    """Handle incoming WebSocket commands from the frontend."""
    global main_engine, event_engine, _active_account_name, _cached_gateways
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
                # CTP connection is blocking — run in thread to avoid blocking event loop
                import concurrent.futures
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, main_engine.connect, setting, gateway_name)
                main_engine.write_log(f"Web: 连接 {gateway_name}")

        elif action == "send_order":
            result = await gateway_client.send_order({
                "symbol": payload["symbol"],
                "exchange": payload["exchange"],
                "direction": payload["direction"],
                "order_type": payload.get("order_type", "LIMIT"),
                "volume": float(payload["volume"]),
                "price": float(payload.get("price", 0)),
                "offset": payload.get("offset", "OPEN"),
                "reference": payload.get("reference", ""),
                "gateway": payload.get("gateway", ""),
            })
            await ws.send_text(json.dumps({
                "type": "order_sent",
                "vt_orderid": result.get("vt_orderid", ""),
            }))

        elif action == "cancel_order":
            await gateway_client.cancel_order(
                orderid=payload["orderid"],
                symbol=payload["symbol"],
                exchange=payload["exchange"],
                gateway=payload.get("gateway", ""),
            )

        elif action == "cancel_quote":
            from deepquant.trader.object import CancelRequest as QuoteCancelRequest
            req = QuoteCancelRequest(
                orderid=payload["orderid"],
                symbol=payload["symbol"],
                exchange=Exchange(payload["exchange"]),
            )
            main_engine.cancel_quote(req, payload.get("gateway", ""))

        elif action == "subscribe":
            await gateway_client.subscribe(
                symbol=payload["symbol"],
                exchange=payload.get("exchange", ""),
                gateway=payload.get("gateway", "")
            )

        elif action == "query_account":
            gw_name = payload.get("gateway", "") or (_cached_gateways[0] if _cached_gateways else "CTP")
            if gateway_client:
                await gateway_client.query_account(gw_name)

        elif action == "query_position":
            gw_name = payload.get("gateway", "") or (_cached_gateways[0] if _cached_gateways else "CTP")
            if gateway_client:
                await gateway_client.query_position(gw_name)

        elif action == "email_test":
            engine = main_engine.get_engine("email")
            if engine:
                engine.send_test_email()
                main_engine.write_log("测试邮件已发送")

        elif action == "get_gateway_accounts":
            accounts = get_accounts()
            # Use cached gateway status (never blocks)
            active_gateways = _cached_gateways
            for a in accounts:
                gw_name = a.get("gateway", "CTP")
                a["gateway_name"] = gw_name
                a["connected"] = gw_name in active_gateways
            await ws.send_text(json.dumps({"type": "gateway_accounts", "data": accounts}))

        elif action == "connect_account":
            account_id = int(payload.get("account_id", 0))
            acct = get_account(account_id)
            if not acct:
                await ws.send_text(json.dumps({"type": "error", "msg": "账户不存在"}))
                return
            gw_name = acct.get("gateway", "CTP")
            _active_account_name = acct["alias"]
            result = await gateway_client.connect_gateway(gw_name, acct["setting"])
            if "error" in result:
                await ws.send_text(json.dumps({"type": "error", "msg": result["error"]}))
                return
            main_engine.write_log(f"账户已连接: {acct['alias']} ({gw_name})")
            await gateway_client.query_account(gw_name)
            await gateway_client.query_position(gw_name)
            await ws.send_text(json.dumps({"type": "log", "data": {"msg": f"账户已连接: {acct['alias']} ({gw_name})", "gateway_name": gw_name}}))

        elif action == "disconnect_account":
            account_id = int(payload.get("account_id", 0))
            acct = get_account(account_id)
            if acct:
                gw_name = acct.get("gateway", "CTP")
                _active_account_name = ""
                _cached_gateways = []
                await gateway_client.disconnect_gateway(gw_name)
                main_engine.write_log(f"账户已断开: {acct['alias']} ({gw_name})")
                await ws.send_text(json.dumps({"type": "log", "data": {"msg": f"账户已断开: {acct['alias']}", "gateway_name": gw_name}}))

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
            if strategy_service:
                names = strategy_service.list_classes()
                await ws.send_text(json.dumps({"type": "cta_classes", "data": names}))

        elif action == "get_cta_params":
            if strategy_service:
                class_name = payload.get("class_name", "")
                params = strategy_service.get_params(class_name)
                await ws.send_text(json.dumps({"type": "cta_params", "data": params, "class_name": class_name}))

        elif action == "edit_cta_strategy":
            if strategy_service:
                result = strategy_service.edit(payload["strategy_name"], payload.get("setting", {}))
                await ws.send_text(json.dumps({"type": "cta_strategies", "data": [result]}))

        elif action == "add_cta_strategy":
            if strategy_service:
                result = strategy_service.add(
                    payload["class_name"], payload["strategy_name"],
                    payload["vt_symbol"], payload.get("parameters", {}),
                )
                await ws.send_text(json.dumps({"type": "cta_strategies", "data": [result]}))

        elif action == "get_cta_strategies":
            if strategy_service:
                data = strategy_service.list_all()
                await ws.send_text(json.dumps({"type": "cta_strategies", "data": data}))

        elif action.startswith("cta_strategy_"):
            if strategy_service:
                name = payload.get("strategy_name", "")
                act = action.replace("cta_strategy_", "")
                if act == "init":
                    result = strategy_service.init(name)
                    await ws.send_text(json.dumps({"type": "cta_init_result", "data": {"strategy_name": name, **result}}))
                elif act == "start": strategy_service.start(name)
                elif act == "stop": strategy_service.stop(name)
                elif act == "remove": strategy_service.remove(name)
                data = strategy_service.list_all()
                await ws.send_text(json.dumps({"type": "cta_strategies", "data": data}))

        elif action.startswith("cta_"):
            if strategy_service:
                act = action.replace("cta_", "")
                if act == "init_all": strategy_service.init_all()
                elif act == "start_all": strategy_service.start_all()
                elif act == "stop_all": strategy_service.stop_all()

        elif action == "get_strategy_logs":
            if strategy_service:
                name = payload.get("strategy_name", "")
                limit = int(payload.get("limit", 100))
                logs = strategy_service.get_logs(name, limit)
                await ws.send_text(json.dumps({"type": "strategy_logs", "data": logs}))

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
        elif action in (
            "download_bar_data", "update_bar_data", "delete_bar_data", "sync_minute_data",
            "batch_download_bar_data", "cancel_data_task", "set_data_watchlist",
            "auto_update", "materialize_bar_data",
        ):
            await _handle_data_manager_action(action, payload, ws)

        elif action == "get_data_overview":
            overview = data_api.load_data_overview(main_engine)
            await ws.send_text(json.dumps({"type": "data_overview", "data": overview["bars"]}))
            await ws.send_text(json.dumps({"type": "tick_overview", "data": overview["ticks"]}))

        elif action == "get_tick_overview":
            ticks = data_api.load_tick_overviews()
            await ws.send_text(json.dumps({"type": "tick_overview", "data": ticks}))

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
        "active_account": _active_account_name,
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
        "version": "0.0.1",
        "gateways": _cached_gateways,
        "exchanges": [e.value for e in main_engine.get_all_exchanges()],
        "active_account": _active_account_name,
    }


@app.get("/api/gateways")
def api_gateways():
    # Return static list immediately — never blocks on Gateway service
    return [
        {"name": "CTP", "default_setting": {"用户名":"","密码":"","经纪商代码":"","交易服务器":"","行情服务器":"","产品名称":"","授权编码":"","柜台环境":["实盘","测试"]}},
        {"name": "TTS", "default_setting": {"用户名":"","密码":"","经纪商代码":"","交易服务器":"tcp://trading.openctp.cn:30001","行情服务器":"tcp://trading.openctp.cn:30011","产品名称":"","授权编码":"","柜台环境":["测试"]}},
    ]


@app.get("/api/apps")
def api_apps():
    if not main_engine:
        return []
    return [{"name": a.app_name, "display": a.display_name, "icon": a.icon_name}
            for a in main_engine.get_all_apps()]


@app.get("/api/contracts")
async def api_contracts(filter: str = ""):
    """Contracts from Gateway TD query; fallback to Server MainEngine if any."""
    if gateway_client:
        gw_list = await gateway_client.get_contracts(filter=filter)
        if gw_list:
            return gw_list
    if not main_engine:
        return []
    contracts = main_engine.get_all_contracts()
    result = []
    for c in contracts:
        if filter and filter not in c.vt_symbol and filter not in c.exchange.value:
            continue
        result.append({
            "vt_symbol": c.vt_symbol, "symbol": c.symbol,
            "exchange": c.exchange.value, "name": c.name,
            "product": c.product.value if c.product else "",
            "size": c.size, "pricetick": c.pricetick,
            "min_volume": c.min_volume, "gateway_name": c.gateway_name,
            "option_portfolio": c.option_portfolio or "",
            "option_expiry": c.option_expiry.isoformat() if c.option_expiry else "",
            "option_strike": c.option_strike or "",
            "option_type": c.option_type.value if c.option_type else "",
        })
    return result


@app.get("/api/settings")
def api_settings():
    from deepquant.trader.setting import SETTINGS
    return {k: v for k, v in SETTINGS.items()}


@app.post("/api/settings")
async def api_save_settings(request):
    from deepquant.trader.setting import SETTINGS, SETTING_FILENAME
    from deepquant.trader.utility import save_json
    body = await request.json()
    for k, v in body.items():
        if k in SETTINGS:
            if isinstance(SETTINGS[k], bool):
                SETTINGS[k] = v if isinstance(v, bool) else v == "True"
            elif isinstance(SETTINGS[k], int):
                SETTINGS[k] = int(v)
            else:
                SETTINGS[k] = v
    save_json(SETTING_FILENAME, dict(SETTINGS))
    return {"status": "ok"}


@app.get("/api/about")
def api_about():
    import deepquant, platform
    from importlib import metadata
    return {
        "deepquant": deepquant.__version__,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "pyside6": metadata.version("pyside6"),
        "numpy": metadata.version("numpy"),
        "pandas": metadata.version("pandas"),
    }


@app.get("/api/ticks")
async def api_ticks():
    """Get cached ticks from Gateway service(s)."""
    if not gateway_client:
        return {"ticks": []}
    all_ticks = []
    seen: set[str] = set()
    for gw_key in _GW_INSTANCES:
        try:
            data = await gateway_client.request("GET", "/ticks", gateway_type=gw_key)
            for t in data.get("ticks", []):
                vt = t.get("vt_symbol") or f"{t.get('symbol', '')}.{t.get('exchange', '')}"
                if vt and vt not in seen:
                    seen.add(vt)
                    all_ticks.append(t)
        except Exception:
            pass
    return {"ticks": all_ticks}


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
# Gateway account management API
# ---------------------------------------------------------------------------
from .account_store import (
    add_account, get_accounts, get_account, get_default_account, update_account, delete_account,
)
from .strategy_service import StrategyService

# Strategy service — lazy loaded
strategy_service: StrategyService | None = None


@app.get("/api/gateway-accounts")
async def api_gateway_accounts():
    """List all saved gateway accounts with connection status."""
    accounts = get_accounts()
    # Get gateway connection status from Gateway service
    active_gateways = []
    if gateway_client and gateway_client.is_connected:
        try:
            gw_status = await gateway_client.get_status()
            active_gateways = gw_status.get("gateways", [])
        except Exception:
            pass
    for a in accounts:
        gw_name = a.get("gateway", "CTP")
        a["gateway_name"] = gw_name
        a["connected"] = gw_name in active_gateways
    return accounts


@app.post("/api/gateway-accounts")
async def api_add_gateway_account(request: Request):
    """Save a new gateway account."""
    from fastapi import Request
    body = await request.json()
    alias = body.get("alias", "")
    setting = body.get("setting", {})
    gateway = body.get("gateway", "CTP")
    if not alias:
        return {"error": "alias is required"}
    acct = add_account(alias, setting, gateway)
    return acct


@app.put("/api/gateway-accounts/{account_id}")
async def api_update_gateway_account(account_id: int, request: Request):
    body = await request.json()
    acct = update_account(
        account_id,
        alias=body.get("alias", ""),
        setting=body.get("setting"),
        is_default=body.get("is_default"),
    )
    if not acct:
        return {"error": "account not found"}
    return acct


@app.delete("/api/gateway-accounts/{account_id}")
def api_delete_gateway_account(account_id: int):
    ok = delete_account(account_id)
    return {"deleted": ok}


@app.post("/api/gateway-accounts/{account_id}/connect")
async def api_connect_gateway_account(account_id: int):
    """Connect a saved gateway account via GatewayClient."""
    global _active_account_name
    if not main_engine:
        return {"error": "engine not ready"}
    acct = get_account(account_id)
    if not acct:
        return {"error": "account not found"}

    gw_name = acct.get("gateway", "CTP")
    if gateway_client:
        result = await gateway_client.connect_gateway(gw_name, acct["setting"])
        if "error" in result:
            return {"error": result["error"]}
        _active_account_name = acct["alias"]
        main_engine.write_log(f"账户已连接: {acct['alias']} ({gw_name})")
        await gateway_client.query_account(gw_name)
        await gateway_client.query_position(gw_name)
        return {"status": "connected", "gateway_name": gw_name}
    return {"error": "gateway client not available"}


@app.post("/api/gateway-accounts/{account_id}/disconnect")
async def api_disconnect_gateway_account(account_id: int):
    """Disconnect a gateway account via GatewayClient."""
    global _active_account_name, _cached_gateways
    if not main_engine:
        return {"error": "engine not ready"}
    acct = get_account(account_id)
    if not acct:
        return {"error": "account not found"}
    gw_name = acct.get("gateway", "CTP")
    if gateway_client:
        result = await gateway_client.disconnect_gateway(gw_name)
        _active_account_name = ""
        _cached_gateways = []
        main_engine.write_log(f"账户已断开: {acct['alias']} ({gw_name})")
        return {"disconnected": "error" not in result}
    return {"error": "gateway client not available"}
    main_engine.write_log(f"账户已断开: {acct['alias']} ({gw_name})")
    return {"disconnected": True}


# ---------------------------------------------------------------------------
# Data management REST API
# ---------------------------------------------------------------------------
@app.get("/api/data/overview")
def api_data_overview():
    if not main_engine:
        return {"bars": [], "ticks": [], "db_path": ""}
    return data_api.load_data_overview(main_engine)


@app.get("/api/data/health")
def api_data_health():
    if not main_engine:
        return {"datamanager": False, "datafeed": False, "recorder": {"tick_symbols": 0, "bar_symbols": 0}}
    return data_api.load_data_health(main_engine, HAS_DATAMANAGER)


@app.get("/api/data/export")
def api_data_export(
    symbol: str = "",
    exchange: str = "",
    interval: str = "1m",
    start: str = "",
    end: str = "",
):
    if not main_engine or not symbol or not exchange:
        return Response(content="missing params", status_code=400)
    start_dt = datetime.strptime(start, "%Y-%m-%d") if start else datetime.now() - timedelta(days=365)
    end_dt = datetime.strptime(end, "%Y-%m-%d") if end else datetime.now()
    bars = data_api.load_bars_for_export(main_engine, symbol, exchange, interval, start_dt, end_dt)
    csv_text = data_api.bars_to_csv(bars)
    filename = f"{symbol}_{exchange}_{interval}.csv"
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/data/import")
async def api_data_import(
    file: UploadFile = File(...),
    symbol: str = Form(...),
    exchange: str = Form(...),
    interval: str = Form("1m"),
    tz_name: str = Form("Asia/Shanghai"),
    datetime_head: str = Form("datetime"),
    open_head: str = Form("open"),
    high_head: str = Form("high"),
    low_head: str = Form("low"),
    close_head: str = Form("close"),
    volume_head: str = Form("volume"),
    turnover_head: str = Form("turnover"),
    open_interest_head: str = Form("open_interest"),
    datetime_format: str = Form(""),
):
    if not main_engine:
        return {"error": "engine not ready"}
    raw = await file.read()
    content = raw.decode("utf-8-sig", errors="replace")
    mapping = {
        "tz_name": tz_name,
        "datetime_head": datetime_head,
        "open_head": open_head,
        "high_head": high_head,
        "low_head": low_head,
        "close_head": close_head,
        "volume_head": volume_head,
        "turnover_head": turnover_head,
        "open_interest_head": open_interest_head,
        "datetime_format": datetime_format,
    }
    result = data_api.import_bars_csv(main_engine, content, symbol, exchange, interval, mapping)
    if result.get("error"):
        return {"error": result["error"]}
    _push_data_overviews()
    return result


@app.post("/api/data/check")
async def api_data_check(request: Request):
    if not main_engine:
        return {"results": []}
    body = await request.json()
    items = body.get("items") or []
    return {"results": data_api.check_data_coverage(main_engine, items)}


# ---------------------------------------------------------------------------
# Historical bar data API (for K-line charts)
# ---------------------------------------------------------------------------
@app.get("/api/recorder/status")
def api_recorder_status():
    """DataRecorder 运行状态（检查数据库最近 tick/bar）。"""
    from deepquant.trader.database import get_database
    if not main_engine:
        return {"running": False, "error": "engine not ready"}
    db = get_database()
    tick_overview = []
    bar_overview = []
    try:
        tick_overview = db.get_tick_overview() or []
    except Exception:
        pass
    try:
        bar_overview = db.get_bar_overview() or []
    except Exception:
        pass
    return {
        "running": "unknown",
        "hint": "由 start.sh 启动，连接 Gateway WS 写入 ~/.vntrader/database.db",
        "tick_symbols": len(tick_overview),
        "bar_symbols": len(bar_overview),
        "recent_ticks": [
            {"symbol": f"{o.symbol}.{o.exchange.value if o.exchange else ''}", "count": o.count, "end": o.end.isoformat() if o.end else None}
            for o in tick_overview[:10]
        ],
        "recent_bars": [
            {"symbol": f"{o.symbol}.{o.exchange.value if o.exchange else ''}", "interval": o.interval.value if o.interval else "", "count": o.count, "end": o.end.isoformat() if o.end else None}
            for o in bar_overview[:10]
        ],
    }


@app.get("/api/bars")
def api_bars(symbol: str = "", exchange: str = "", interval: str = "1m", start: str = "", end: str = ""):
    """Load historical bar data for K-line charts."""
    from datetime import datetime, timedelta
    from deepquant.trader.database import get_database
    from deepquant.trader.constant import Exchange, Interval
    from .bar_merge import enrich_bars_with_recorded_data, bar_to_dict

    if not main_engine:
        return {"bars": []}

    db = get_database()
    try:
        ex = Exchange(exchange)
        itv = Interval(interval) if interval else Interval.MINUTE
    except ValueError:
        return {"bars": [], "error": f"Invalid exchange or interval: {exchange}/{interval}"}

    if start:
        start_dt = datetime.strptime(start, "%Y-%m-%d")
    else:
        start_dt = datetime.now() - timedelta(days=60)
    if end:
        end_dt = datetime.strptime(end, "%Y-%m-%d")
    else:
        end_dt = datetime.now()

    bars = db.load_bar_data(symbol, ex, itv, start_dt, end_dt)
    if not bars and itv == Interval.MINUTE:
        bars = db.load_bar_data(symbol, ex, Interval.DAILY, start_dt - timedelta(days=300), end_dt)

    # 合并 DataRecorder 录制的 1m K 线 + tick 补全
    if itv == Interval.MINUTE:
        bars = enrich_bars_with_recorded_data(db, symbol, ex, itv, bars or [], end_dt)

    result = []
    for b in (bars or []):
        if hasattr(b, "open_price"):
            result.append(bar_to_dict(b))
        elif isinstance(b, dict):
            result.append(b)
        else:
            result.append(bar_to_dict(b))
    return {"bars": result, "count": len(result)}


@app.post("/api/orders")
async def api_send_order(request: Request):
    """Place an order via Gateway service."""
    body = await request.json()
    result = await gateway_client.send_order(body)
    return result


@app.delete("/api/orders/{orderid}")
async def api_cancel_order(orderid: str, symbol: str = "", exchange: str = "", gateway: str = ""):
    """Cancel an order via Gateway service."""
    result = await gateway_client.cancel_order(orderid, symbol, exchange, gateway)
    return result


@app.post("/api/subscribe")
async def api_subscribe(request: Request):
    """Subscribe to market data via Gateway service."""
    body = await request.json()
    symbol = body.get("symbol", "")
    exchange = body.get("exchange", "")
    gateway = body.get("gateway", "")
    # If no specific gateway, subscribe on all available gateways
    if not gateway:
        targets = _cached_gateways if _cached_gateways else ["CTP"]
        for gw_type in targets:
            await gateway_client.subscribe(symbol, exchange, gw_type)
        return {"subscribed": f"{symbol}.{exchange}"}
    result = await gateway_client.subscribe(symbol, exchange, gateway)
    return result


# ---------------------------------------------------------------------------
# Public contract data API (backed by contract_cache)
# ---------------------------------------------------------------------------
@app.get("/api/contracts/public")
async def api_public_contracts(exchange: str = "", product: str = ""):
    """Query contracts from public cache (akshare + generated options)."""
    from deepquant.trader.contract_cache import (
        get_cache, refresh_cache, get_cache_age, query_contracts, filter_by_products,
    )
    from deepquant.trader.constant import Exchange
    import re

    df = get_cache()
    age = get_cache_age()
    # Trigger refresh if no data or stale
    if df is None or age is None or age.date() < datetime.now().date():
        import threading
        t = threading.Thread(target=refresh_cache, daemon=True)
        t.start()
        df = get_cache()

    result = []
    if exchange:
        try:
            ex = Exchange(exchange)
            contracts = query_contracts(ex)
            if product:
                contracts = filter_by_products(contracts, product)
            for c in contracts:
                opt = ""
                m = re.match(r'^[A-Z]+[0-9]+-([CP])-', c['symbol'])
                if m:
                    opt = "看涨" if m.group(1) == 'C' else "看跌"
                result.append({**c, "option_type": opt})
        except ValueError:
            pass
    return {"contracts": result, "cache_ts": age.isoformat() if age else None, "count": len(result)}


@app.get("/api/contracts/products")
async def api_contract_products(exchange: str = ""):
    """Get available product prefixes for an exchange."""
    from deepquant.trader.contract_cache import get_cache, refresh_cache, get_cache_age, get_products
    from deepquant.trader.constant import Exchange

    if not exchange:
        return {"products": []}

    try:
        Exchange(exchange)
        df = get_cache()
        age = get_cache_age()
        if df is None or age is None or age.date() < datetime.now().date():
            import threading
            t = threading.Thread(target=refresh_cache, daemon=True)
            t.start()
        prod_map = get_products(exchange)
        result = [{"prefix": k, "name": v} for k, v in sorted(prod_map.items())]
        return {"products": result}
    except Exception as e:
        logger.error(f"[/api/contracts/products] error: {type(e).__name__}: {e}")
        return {"products": []}


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
def start_engine() -> None:
    """Initialize VeighNa trading engine (runs in background thread)."""
    global event_engine, main_engine, _active_account_name

    # Configure loguru file output
    from pathlib import Path
    _log_dir = Path.home() / ".deepquant" / "logs"
    _log_dir.mkdir(parents=True, exist_ok=True)
    logger.add(
        str(_log_dir / "server_{time:YYYY-MM-DD}.log"),
        rotation="00:00", retention="30 days", level="INFO",
        format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {message}",
    )
    logger.info(f"Log file: {_log_dir}/server_YYYY-MM-DD.log")
    logger.info("Starting DeepQuant engine...")
    event_engine = EventEngine()
    main_engine = MainEngine(event_engine)

    # Gateways are created on-demand when connecting accounts
    if HAS_PAPER:
        main_engine.add_app(PaperAccountApp)
        logger.info("  Paper Account loaded")
    if HAS_CTA:
        global strategy_service
        strategy_service = StrategyService(main_engine, event_engine)
        strategy_service._ensure_engine()  # triggers restore of persisted strategies
        logger.info("  CTA Strategy loaded")
    if HAS_BACKTESTER:
        main_engine.add_app(CtaBacktesterApp)
        logger.info("  CTA Backtester loaded")
    if HAS_DATAMANAGER:
        main_engine.add_app(DataManagerApp)
        data_api.ensure_public_datafeed(main_engine)
        logger.info("  Data Manager loaded")

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

    # Auto-connect moved to Gateway service — Server only polls status
    logger.info("Gateway client will handle gateway connections")

    logger.info(f"Engine ready — {len(main_engine.get_all_gateway_names())} gateways")


def _on_gateway_event(data: dict):
    """Forward Gateway WS events directly to Web clients (bypass EventEngine)."""
    event_type = data.get("type", "")
    if event_type == EVENT_TIMER:
        return
    # Map Gateway event types to Web-compatible types (handle eTick.XXX variants)
    web_type = event_type
    for prefix, mapped in [("eTick.", "tick"), ("eOrder.", "order"), ("eTrade.", "trade"),
                           ("ePosition.", "position"), ("eAccount.", "account"), ("eLog.", "log"),
                           ("eContract.", "contract"), ("eQuote.", "quote")]:
        if event_type.startswith(prefix):
            web_type = mapped
            break
    # Push directly to WS broadcast queue — no EventEngine roundtrip
    payload = json_dumps({"type": web_type, "data": data.get("data", {}), "time": datetime.now().isoformat()})
    if ws_clients:
        try:
            _broadcast_queue.put_nowait((payload, list(ws_clients)))
        except Exception:
            pass


@app.on_event("startup")
async def on_startup():
    """Start VeighNa engine when FastAPI starts."""
    global _main_loop
    _main_loop = asyncio.get_running_loop()
    global gateway_client
    gateway_client = GatewayClient(on_event=_on_gateway_event)
    await gateway_client.start()
    # Start broadcast worker in uvicorn event loop
    asyncio.create_task(_broadcast_worker())
    # Auto-connect default account after a brief delay
    async def _auto_connect():
        await asyncio.sleep(3)
        default = get_default_account()
        if default:
            gw_name = default.get("gateway", "CTP")
            result = await gateway_client.connect_gateway(gw_name, default["setting"])
            if "error" not in result:
                global _active_account_name
                _active_account_name = default["alias"]
                main_engine.write_log(f"Auto-connected: {default['alias']} ({gw_name})")
                await gateway_client.query_account(gw_name)
                await gateway_client.query_position(gw_name)
    asyncio.create_task(_auto_connect())
    # Background: poll Gateway status every 10s, never block
    async def _poll_gw_status():
        global _cached_gateways
        while True:
            try:
                status = await asyncio.wait_for(gateway_client.get_all_status(), timeout=3.0)
                _cached_gateways = status.get("gateways", [])
            except Exception:
                pass
            await asyncio.sleep(10)
    asyncio.create_task(_poll_gw_status())

    async def _init_data_queue():
        for _ in range(100):
            if main_engine is not None:
                data_update_service.get_update_queue(
                    lambda: main_engine,
                    _emit_data_task,
                    _push_data_overviews,
                    _data_manager_log,
                )
                logger.info("Data update queue initialized")
                break
            await asyncio.sleep(0.1)
    asyncio.create_task(_init_data_queue())

    async def _scheduled_data_update():
        """Daily post-close watchlist incremental update (18:00 local)."""
        last_run_date = ""
        while True:
            try:
                now = datetime.now()
                today = now.strftime("%Y-%m-%d")
                if now.hour == 18 and now.minute < 5 and last_run_date != today:
                    q = _get_data_queue()
                    if q and q.get_scheduled_symbols():
                        tid = q.run_scheduled_watchlist_update()
                        if tid:
                            logger.info(f"Scheduled data update queued: {tid}")
                    last_run_date = today
            except Exception as e:
                logger.warning(f"Scheduled data update error: {e}")
            await asyncio.sleep(60)

    asyncio.create_task(_scheduled_data_update())

    t = threading.Thread(target=start_engine, daemon=True)
    t.start()
    for _ in range(50):
        if main_engine is not None:
            break
        await asyncio.sleep(0.1)


if __name__ == "__main__":
    import uvicorn
    logger.info("Starting VeighNa Web Trader on http://0.0.0.0:8888")
    uvicorn.run(app, host="0.0.0.0", port=8888, log_level="info")
