"""Gateway WS client — receive tick/order/trade events from Gateway."""
import asyncio
import json
import logging

import aiohttp

logger = logging.getLogger(__name__)


class GatewayWSClient:
    """连接 Gateway WS，按事件类型/前缀分发。"""

    def __init__(self, gateway_url: str):
        self._ws_url = gateway_url.rstrip("/").replace("http://", "ws://").replace("https://", "wss://") + "/ws"
        self._session = None
        self._handlers: dict[str, list] = {}
        self._prefix_handlers: dict[str, list] = {}
        self.connected = False
        self.msg_count = 0

    def on(self, event_type: str, handler, prefix: bool = False):
        """注册 handler；prefix=True 时匹配 event_type 前缀（如 eTick.）。"""
        bucket = self._prefix_handlers if prefix else self._handlers
        bucket.setdefault(event_type, []).append(handler)

    async def start(self):
        self._session = aiohttp.ClientSession()
        asyncio.create_task(self._connect_loop())

    async def stop(self):
        self.connected = False
        if self._session:
            await self._session.close()

    async def _connect_loop(self):
        while True:
            try:
                async with self._session.ws_connect(self._ws_url) as ws:
                    self.connected = True
                    logger.info("DataRecorder WS connected: %s", self._ws_url)
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            self._dispatch(msg.data)
                    self.connected = False
                    logger.warning("DataRecorder WS disconnected")
            except Exception as e:
                self.connected = False
                logger.error("DataRecorder WS error: %s, retry in 3s", e)
            await asyncio.sleep(3)

    def _dispatch(self, raw: str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return
        event_type = data.get("type", "")
        self.msg_count += 1
        handlers = list(self._handlers.get(event_type, []))
        for prefix, hlist in self._prefix_handlers.items():
            if event_type.startswith(prefix):
                handlers.extend(hlist)
        for handler in handlers:
            try:
                handler(data)
            except Exception as e:
                logger.exception("handler error: %s", e)
