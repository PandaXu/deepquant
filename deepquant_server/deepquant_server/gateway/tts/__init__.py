"""TTS gateway — Tick Trading System (CTP-compatible simulation)."""

TtsGateway = None  # type: ignore[assignment]

try:
    from deepquant_gateway.gateway import TtsGateway as _Tts  # noqa: F401
    TtsGateway = _Tts
except ImportError:
    pass
