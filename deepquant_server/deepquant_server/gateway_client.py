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
        self._ws_task = asyncio.create_task(self._ws_connect_loop())

    async def stop(self):
        if hasattr(self, '_ws_task') and self._ws_task:
            self._ws_task.cancel()
            try: await self._ws_task
            except asyncio.CancelledError: pass
        if self._ws: await self._ws.close()
        if self._session: await self._session.close()
        self._connected = False

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
