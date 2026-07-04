"""GatewayClient — multi-instance HTTP + WebSocket client to deepquant_gateway."""
import asyncio
import json
import logging
import os
import sys

import aiohttp

logger = logging.getLogger(__name__)

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib  # type: ignore


def _load_gateway_config() -> dict[str, dict]:
    """Parse gateways.toml → {gateway_type: {port, url, ws_url, backend}}."""
    config_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "deepquant_gateway", "gateways.toml"
    )
    result: dict[str, dict] = {}
    try:
        with open(config_path, "rb") as f:
            data = tomllib.load(f)
        for inst in data.get("gateways", []):
            port = inst["port"]
            result[inst.get("backend", inst["id"])] = {
                "id": inst["id"],
                "port": port,
                "url": f"http://127.0.0.1:{port}",
                "ws_url": f"ws://127.0.0.1:{port}/ws",
                "backend": inst.get("backend", "official"),
            }
    except FileNotFoundError:
        pass

    # Always have a default
    if "official" not in result:
        result["official"] = {"id": "default", "port": 8889, "url": "http://127.0.0.1:8889", "ws_url": "ws://127.0.0.1:8889/ws", "backend": "official"}
    if "tts" not in result:
        result["tts"] = {"id": "tts-default", "port": 8890, "url": "http://127.0.0.1:8890", "ws_url": "ws://127.0.0.1:8890/ws", "backend": "tts"}
    return result


_GW_INSTANCES = _load_gateway_config()

# Gateway type aliases → gateways.toml backend keys
_GW_ALIASES = {"ctp": "official", "tts": "tts"}


def _resolve_gateway_key(gateway_type: str) -> str:
    """Map account gateway name (CTP/TTS) to config instance key."""
    key = (gateway_type or "official").lower()
    return _GW_ALIASES.get(key, key)


def _url_for(gateway_type: str, path: str = "") -> str:
    """Get the URL for a specific gateway type. Case-insensitive, falls back to official."""
    key = _resolve_gateway_key(gateway_type)
    gw = _GW_INSTANCES.get(key) or _GW_INSTANCES.get("official") or next(iter(_GW_INSTANCES.values()))
    return f"{gw['url']}{path}"


def all_ws_urls() -> list[str]:
    """Return all Gateway WS URLs for event subscription."""
    return [g["ws_url"] for g in _GW_INSTANCES.values()]


class GatewayClient:
    def __init__(self, on_event=None):
        self._session = None
        self._ws_connections: dict[str, aiohttp.ClientWebSocketResponse] = {}
        self._connected = False
        self._on_event = on_event

    async def start(self):
        self._session = aiohttp.ClientSession()
        # Connect WS to all gateway instances
        for gw_id, gw in _GW_INSTANCES.items():
            asyncio.create_task(self._ws_connect_loop(gw_id, gw["ws_url"]))
        logger.info(f"GatewayClient: connected to {len(_GW_INSTANCES)} instances")

    async def stop(self):
        for ws in list(self._ws_connections.values()):
            await ws.close()
        if self._session:
            await self._session.close()
        self._connected = False

    async def _ws_connect_loop(self, gw_id: str, ws_url: str):
        while True:
            try:
                async with self._session.ws_connect(ws_url) as ws:
                    self._ws_connections[gw_id] = ws
                    self._connected = True
                    logger.info(f"GatewayClient WS: {gw_id} connected ({ws_url})")
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            if self._on_event:
                                self._on_event(data)
                    self._connected = False
            except Exception as e:
                logger.warning(f"GatewayClient WS {gw_id}: {e}, retry in 3s")
            await asyncio.sleep(3)

    async def request(self, method: str, path: str, body: dict = None, gateway_type: str = "CTP") -> dict:
        """Send REST request to the correct Gateway instance."""
        if not self._session:
            self._session = aiohttp.ClientSession()
        url = _url_for(gateway_type, path)
        try:
            if method == "GET":
                async with self._session.get(url) as resp:
                    if resp.status >= 400:
                        text = await resp.text()
                        return {"error": text[:200]}
                    return await resp.json(content_type=None)
            elif method == "POST":
                async with self._session.post(url, json=body) as resp:
                    if resp.status >= 400:
                        text = await resp.text()
                        return {"error": text[:200]}
                    return await resp.json(content_type=None)
            elif method == "DELETE":
                async with self._session.delete(url) as resp:
                    if resp.status >= 400:
                        text = await resp.text()
                        return {"error": text[:200]}
                    return await resp.json(content_type=None) if resp.status != 204 else {}
        except Exception as e:
            logger.error(f"GatewayClient request {method} {path}: {e}")
            return {"error": str(e)[:200]}

    async def connect_gateway(self, gateway_type: str, setting: dict) -> dict:
        return await self.request("POST", "/connect", {"gateway_type": gateway_type, "setting": setting}, gateway_type)

    async def disconnect_gateway(self, gateway_type: str) -> dict:
        return await self.request("POST", "/disconnect", {"gateway_type": gateway_type}, gateway_type)

    async def send_order(self, order: dict) -> dict:
        gw = order.get("gateway", "CTP")
        return await self.request("POST", "/send_order", order, gw)

    async def cancel_order(self, orderid: str, symbol: str, exchange: str, gateway: str = "CTP") -> dict:
        return await self.request("POST", "/cancel_order", {"orderid": orderid, "symbol": symbol, "exchange": exchange, "gateway": gateway}, gateway)

    async def subscribe(self, symbol: str, exchange: str, gateway: str = "CTP") -> dict:
        gw = gateway or "CTP"
        return await self.request("POST", "/subscribe", {"symbol": symbol, "exchange": exchange, "gateway": gw}, gw)

    async def query_account(self, gateway_type: str = "CTP") -> dict:
        return await self.request("POST", "/query_account", {"gateway_type": gateway_type}, gateway_type)

    async def query_position(self, gateway_type: str = "CTP") -> dict:
        return await self.request("POST", "/query_position", {"gateway_type": gateway_type}, gateway_type)

    async def get_status(self, gateway_type: str = "CTP") -> dict:
        return await self.request("GET", "/status", gateway_type=gateway_type)

    async def get_all_status(self) -> dict:
        """Get combined status from all gateway instances."""
        all_gateways = []
        for gw_id in _GW_INSTANCES:
            status = await self.get_status(gw_id)
            all_gateways.extend(status.get("gateways", []))
        return {"gateways": all_gateways}

    @property
    def is_connected(self) -> bool:
        return self._connected
