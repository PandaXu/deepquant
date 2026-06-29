"""
Gateway loaders — discover and provide trading service gateways.
"""
from .ctp import CtpGateway  # noqa: F401
from .tts import TtsGateway  # noqa: F401

_available: dict[str, type] = {}
if CtpGateway is not None:
    _available["CTP"] = CtpGateway
if TtsGateway is not None:
    _available["TTS"] = TtsGateway


def get_available() -> dict:
    """Return {gateway_name: GatewayClass} for all installed gateways."""
    return dict(_available)
