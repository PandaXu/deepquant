# Gateway Microservice Implementation Plan

> **For agentic workers:** Use subagent-driven-development to implement task-by-task.

**Goal:** Split Gateway into independent process (:8889) communicating with Server (:8888) via HTTP + WS.

**Architecture:** Server deletes all direct gateway imports. New `deepquant_gateway` runs standalone FastAPI with own MainEngine. Server communicates via REST (control) + WS (data) to Gateway.

**Tech Stack:** FastAPI, uvicorn, websockets, deepquant core lib

## Global Constraints

- Gateway 服务完全独立，可单独部署、重启
- Server 启动时 Gateway 不可用不阻塞（延迟连接）
- Gateway WS 断线自动重连
- Web 前端零改动

## File Structure

```
deepquant_gateway/              → New: standalone gateway service
├── pyproject.toml
├── run.py                      → Entry point (:8889)
└── deepquant_gateway/
    ├── __init__.py
    └── server.py               → FastAPI app, REST + WS

deepquant_server/deepquant_server/
├── server.py                   → Modify: remove gateway imports, add GatewayClient
└── gateway_client.py           → New: HTTP + WS client to Gateway
```

---

### Task 1: Create deepquant_gateway project skeleton

**Files:**
- Create: `deepquant_gateway/pyproject.toml`
- Create: `deepquant_gateway/run.py`
- Create: `deepquant_gateway/deepquant_gateway/__init__.py`
- Create: `deepquant_gateway/deepquant_gateway/server.py`

**Interfaces:**
- Produces: Gateway service on :8889 with REST + WS

- [ ] **Step 1: Create pyproject.toml**

```toml
[project]
name = "deepquant_gateway"
version = "0.0.1"
requires-python = ">=3.10"
dependencies = ["deepquant>=4.0.0", "fastapi", "uvicorn", "loguru"]
```

- [ ] **Step 2: Create run.py**

```python
"""DeepQuant Gateway — standalone CTP/TTS microservice."""
import sys
import uvicorn

def main():
    host = "0.0.0.0"
    port = 8889
    for i, arg in enumerate(sys.argv[1:]):
        if arg == "--port" and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
    print(f"🚀 DeepQuant Gateway → http://{host}:{port}")
    uvicorn.run("deepquant_gateway.server:app", host=host, port=port, log_level="info")

if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Create server.py — standalone gateway engine**

```python
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
try:
    from deepquant_ctp.gateway.ctp_gateway import CtpGateway
    HAS_CTP = True
except ImportError:
    CtpGateway = None
    HAS_CTP = False

GATEWAYS = {}
if CtpGateway:
    GATEWAYS["CTP"] = CtpGateway
    GATEWAYS["TTS"] = CtpGateway  # TTS uses same CTP protocol

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
    body = await request if isinstance(request, dict) else request
    if isinstance(body, str): body = json.loads(body)
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
```

- [ ] **Step 4: Test Gateway starts and responds**

```bash
PYTHONPATH="deepquant:deepquant_gateway:deepquant_ctp" deepquant/.venv/bin/python deepquant_gateway/run.py &
sleep 4
curl -s http://127.0.0.1:8889/status
# Expected: {"status":"online","gateways":[],...}
```

- [ ] **Step 5: Commit**

```bash
git add deepquant_gateway/
git commit -m "feat: deepquant_gateway standalone microservice"
```

---

### Task 2: Create GatewayClient in Server

**Files:**
- Create: `deepquant_server/deepquant_server/gateway_client.py`

**Interfaces:**
- Consumes: Gateway on :8889 (Task 1)
- Produces: `GatewayClient` class with `request(action, payload)`, `connect()`, `disconnect()`

- [ ] **Step 1: Create gateway_client.py**

```python
"""GatewayClient — HTTP + WebSocket client to deepquant_gateway."""
import asyncio
import json
import logging
import aiohttp

logger = logging.getLogger(__name__)

GATEWAY_URL = "http://127.0.0.1:8889"
GATEWAY_WS_URL = "ws://127.0.0.1:8889/ws"

class GatewayClient:
    def __init__(self, on_event=None):
        self._session = None
        self._ws = None
        self._connected = False
        self._on_event = on_event  # callback(gateway_event_dict)

    async def start(self):
        self._session = aiohttp.ClientSession()
        asyncio.create_task(self._ws_connect_loop())

    async def stop(self):
        if self._ws: await self._ws.close()
        if self._session: await self._session.close()

    async def _ws_connect_loop(self):
        while True:
            try:
                async with self._session.ws_connect(GATEWAY_WS_URL) as ws:
                    self._ws = ws
                    self._connected = True
                    logger.info("GatewayClient WS connected")
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            if self._on_event:
                                self._on_event(data)
                    self._connected = False
            except Exception as e:
                logger.warning(f"GatewayClient WS: {e}, retry in 3s")
            await asyncio.sleep(3)

    async def request(self, method: str, path: str, body: dict = None) -> dict:
        """Send REST request to Gateway."""
        if not self._session:
            self._session = aiohttp.ClientSession()
        url = f"{GATEWAY_URL}{path}"
        try:
            if method == "GET":
                async with self._session.get(url) as resp:
                    return await resp.json()
            elif method == "POST":
                async with self._session.post(url, json=body) as resp:
                    return await resp.json()
        except Exception as e:
            logger.error(f"GatewayClient request {method} {path}: {e}")
            return {"error": str(e)}

    async def connect_gateway(self, gateway_type: str, setting: dict) -> dict:
        return await self.request("POST", "/connect", {"gateway_type": gateway_type, "setting": setting})

    async def disconnect_gateway(self, gateway_type: str) -> dict:
        return await self.request("POST", "/disconnect", {"gateway_type": gateway_type})

    async def subscribe(self, symbol: str, exchange: str, gateway: str = "") -> dict:
        return await self.request("POST", "/subscribe", {"symbol": symbol, "exchange": exchange, "gateway": gateway})

    async def get_status(self) -> dict:
        return await self.request("GET", "/status")

    @property
    def is_connected(self) -> bool:
        return self._connected
```

- [ ] **Step 2: Test GatewayClient connects to Gateway**

```bash
PYTHONPATH="deepquant:deepquant_server:deepquant_ctp" deepquant/.venv/bin/python -c "
import asyncio
from deepquant_server.gateway_client import GatewayClient
async def test():
    client = GatewayClient()
    await client.start()
    await asyncio.sleep(2)
    status = await client.get_status()
    print('Gateway status:', status)
    await client.stop()
asyncio.run(test())
"
```

- [ ] **Step 3: Commit**

```bash
git add deepquant_server/deepquant_server/gateway_client.py
git commit -m "feat: GatewayClient — HTTP+WS client to deepquant_gateway"
```

---

### Task 3: Refactor Server to use GatewayClient

**Files:**
- Modify: `deepquant_server/deepquant_server/server.py`

**Interfaces:**
- Consumes: `GatewayClient` (Task 2), Gateway on :8889 (Task 1)
- Produces: Server on :8888 with zero direct gateway imports

- [ ] **Step 1: Remove all direct gateway imports and constants**

Replace lines 31-33:
```python
# REMOVE these lines:
from .gateway import CtpGateway, get_available as get_available_gateways
HAS_CTP = CtpGateway is not None

# ADD this instead:
from .gateway_client import GatewayClient

gateway_client: GatewayClient = None
```

- [ ] **Step 2: Replace connect_account handler**

Replace the connect_account elif block (lines 268-291) with:
```python
        elif action == "connect_account":
            account_id = int(payload.get("account_id", 0))
            acct = get_account(account_id)
            if not acct:
                await ws.send_text(json.dumps({"type": "error", "msg": "账户不存在"}))
                return
            gw_name = acct.get("gateway", "CTP")
            global _active_account_name
            _active_account_name = acct["alias"]
            result = await gateway_client.connect_gateway(gw_name, acct["setting"])
            if "error" in result:
                await ws.send_text(json.dumps({"type": "error", "msg": result["error"]}))
                return
            main_engine.write_log(f"账户已连接: {acct['alias']} ({gw_name})")
            await ws.send_text(json.dumps({"type": "log", "data": {"msg": f"账户已连接: {acct['alias']} ({gw_name})", "gateway_name": gw_name}}))
```

- [ ] **Step 3: Replace disconnect_account handler**

Replace disconnect_account with:
```python
        elif action == "disconnect_account":
            account_id = int(payload.get("account_id", 0))
            acct = get_account(account_id)
            if acct:
                gw_name = acct.get("gateway", "CTP")
                global _active_account_name
                _active_account_name = ""
                await gateway_client.disconnect_gateway(gw_name)
                main_engine.write_log(f"账户已断开: {acct['alias']} ({gw_name})")
                await ws.send_text(json.dumps({"type": "log", "data": {"msg": f"账户已断开: {acct['alias']}", "gateway_name": gw_name}}))
```

- [ ] **Step 4: Replace subscribe handler**

Replace the subscribe elif block with:
```python
        elif action == "subscribe":
            await gateway_client.subscribe(
                symbol=payload["symbol"],
                exchange=payload.get("exchange", ""),
                gateway=payload.get("gateway", "")
            )
```

- [ ] **Step 5: Start GatewayClient in on_startup**

In the `on_startup` function, add after `_main_loop = asyncio.get_running_loop()`:
```python
    global gateway_client
    gateway_client = GatewayClient(on_event=_on_gateway_event)
    await gateway_client.start()
```

- [ ] **Step 6: Add Gateway event forwarder**

Add this function before `on_startup`:
```python
def _on_gateway_event(data: dict):
    """Forward Gateway WS events to Server event engine."""
    event_type = data.get("type", "")
    if not main_engine or not event_engine: return
    event = Event(type=event_type, data=data.get("data", {}))
    event_engine.put(event)
```

- [ ] **Step 7: Replace auto-connect in start_engine**

Replace the auto-connect block (lines 875-884):
```python
    # Auto-connect moved to Gateway service — Server only polls status
    logger.info("Gateway client will handle gateway connections")
```

- [ ] **Step 8: Update REST /api/gateways to include gateway status**

```python
@app.get("/api/gateways")
async def api_gateways():
    result = [
        {"name": "CTP", "default_setting": {"用户名":"","密码":"","经纪商代码":"","交易服务器":"","行情服务器":"","产品名称":"","授权编码":"","柜台环境":["实盘","测试"]}},
        {"name": "TTS", "default_setting": {"用户名":"","密码":"","经纪商代码":"","交易服务器":"tcp://trading.openctp.cn:30001","行情服务器":"tcp://trading.openctp.cn:30011","产品名称":"","授权编码":"","柜台环境":["测试"]}},
    ]
    if gateway_client:
        status = await gateway_client.get_status()
        for name in status.get("gateways", []):
            if name not in {r["name"] for r in result}:
                result.append({"name": name, "default_setting": {}})
    return result
```

- [ ] **Step 9: Update REST api_status with Gateway data**

Add to `api_status` return dict:
```python
    "gateways": (await gateway_client.get_status()).get("gateways", []) if gateway_client else [],
```

- [ ] **Step 10: Remove unused imports and constants**

Remove unused references to `CtpGateway`, `HAS_CTP`, `HAS_PAPER` (if only used for gateway). Keep PaperAccount/CTA imports that don't involve gateway.

- [ ] **Step 11: Verify Server starts without Gateway**

```bash
PYTHONPATH="deepquant:deepquant_server:deepquant_ctp" deepquant/.venv/bin/python deepquant_server/run.py &
sleep 4
curl -s http://127.0.0.1:8888/api/status
# Expected: {"status":"online","gateways":[],...} — should NOT crash even if Gateway is down
```

- [ ] **Step 12: Commit**

```bash
git add deepquant_server/deepquant_server/server.py
git commit -m "refactor: server uses GatewayClient HTTP, zero direct gateway imports"
```

---

### Task 4: Integration — end-to-end test

**Files:** None new

- [ ] **Step 1: Start Gateway first, then Server**

```bash
pkill -f "uvicorn\|deepquant" 2>/dev/null; sleep 2
PYTHONPATH="deepquant:deepquant_gateway:deepquant_ctp" deepquant/.venv/bin/python deepquant_gateway/run.py &
sleep 4
PYTHONPATH="deepquant:deepquant_server:deepquant_ctp" deepquant/.venv/bin/python deepquant_server/run.py &
sleep 4
```

- [ ] **Step 2: Connect CTP via Server → Gateway**

```bash
deepquant/.venv/bin/python -c "
import asyncio, json, websockets
async def t():
    async with websockets.connect('ws://127.0.0.1:8888/ws') as ws:
        await ws.send(json.dumps({'action':'connect_account','payload':{'account_id':3}}))
        async for msg in ws:
            d = json.loads(msg)
            if d['type'] == 'log': print('LOG:', d['data']['msg'][:120])
            if d['type'] == 'status': print('GW:', d.get('gateways')); break
asyncio.run(t())
"
```

- [ ] **Step 3: Verify tick data flows through both layers**

```bash
# Subscribe to a contract
deepquant/.venv/bin/python -c "
import asyncio, json, websockets
async def t():
    async with websockets.connect('ws://127.0.0.1:8888/ws') as ws:
        await ws.send(json.dumps({'action':'subscribe','payload':{'symbol':'rb2510','exchange':'SHFE','gateway':'CTP'}}))
        ticks = 0
        try:
            async for msg in ws:
                d = json.loads(msg)
                if d['type'] == 'tick':
                    ticks += 1
                    if ticks <= 2:
                        print(f'TICK via Server: {d[\"data\"][\"vt_symbol\"]} @ {d[\"data\"][\"last_price\"]}')
        except asyncio.TimeoutError:
            pass
        print(f'{ticks} ticks received')
asyncio.run(t())
" 2>&1
```

- [ ] **Step 4: Verify Web frontend still works**

```bash
deepquant/.venv/bin/python deepquant_web/run.py &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/index.html
# Expected: 200
```

- [ ] **Step 5: Commit final state**

```bash
git add -A && git commit -m "test: end-to-end gateway microservice integration"
```
