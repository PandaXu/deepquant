"""
Trading panel display settings — persists which exchanges/products to show.
"""
import json
from vnpy.trader.constant import Exchange
from vnpy.trader.utility import get_file_path

SETTINGS_FILE = "panel_settings.json"

# Default: show all 6 Chinese futures exchanges
DEFAULT_EXCHANGES = ["CFFEX", "SHFE", "DCE", "CZCE", "INE", "GFEX"]


def _load_raw() -> dict:
    path = get_file_path(SETTINGS_FILE)
    try:
        with open(path, encoding="UTF-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_raw(data: dict) -> None:
    path = get_file_path(SETTINGS_FILE)
    with open(path, "w", encoding="UTF-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def get_exchanges() -> list[str]:
    """Get list of visible exchange codes."""
    data = _load_raw()
    return data.get("exchanges", DEFAULT_EXCHANGES)


def set_exchanges(exchanges: list[str]) -> None:
    """Save visible exchange codes."""
    data = _load_raw()
    data["exchanges"] = exchanges
    _save_raw(data)


def get_exchange_names() -> dict[str, str]:
    """Get exchange code → display name mapping."""
    return {
        "CFFEX": "中金所",
        "SHFE": "上期所",
        "DCE": "大商所",
        "CZCE": "郑商所",
        "INE": "上能源",
        "GFEX": "广期所",
        "SSE": "上交所",
        "SZSE": "深交所",
        "BSE": "北交所",
        "SGE": "上金所",
    }
