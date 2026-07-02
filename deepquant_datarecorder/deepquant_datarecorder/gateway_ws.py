"""Gateway WS client — receive tick/order/trade events from Gateway."""
import asyncio
import json
import logging
import aiohttp

logger = logging.getLogger(__name__)


class GatewayWSClient:
    """Connect to a Gateway's WS endpoint and forward events to registered handlers."""

    def __init__(self, gateway_url: str):
        self._ws_url = gateway_url.rstrip("/") + "/ws"
        self._session = None
        self._handlers: dict[str, list] = {}

    def on(self, event_type: str, handler):
        """Register a handler for a specific event type (e.g., 'tick', 'order')."""
        self._handlers.setdefault(event_type, []).append(handler)

    async def start(self):
        self._session = aiohttp.ClientSession()
        asyncio.create_task(self._connect_loop())

    async def stop(self):
        if self._session:
            await self._session.close()

    async def _connect_loop(self):
        while True:
            try:
                async with self._session.ws_connect(self._ws_url) as ws:
                    logger.info(f"DataRecorder WS connected: {self._ws_url}")
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            self._dispatch(msg.data)
                    logger.warning("DataRecorder WS disconnected")
            except Exception as e:
                logger.error(f"DataRecorder WS error: {e}, retry in 3s")
            await asyncio.sleep(3)

    def _dispatch(self, raw: str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return
        event_type = data.get("type", "")
        for handler in self._handlers.get(event_type, []):
            try:
                handler(data)
            except Exception:
                pass
