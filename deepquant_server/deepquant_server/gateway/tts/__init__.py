"""TTS gateway — Tick Trading System (CTP-compatible simulation)."""

TtsGateway = None  # type: ignore[assignment]

# Try the dedicated TtsGateway class first
try:
    from deepquant_ctp.gateway.tts_gateway import TtsGateway as _Tts  # noqa: F401
    TtsGateway = _Tts
except ImportError:
    # Fallback: try vnpy_tts package
    try:
        from vnpy_tts import TtsGateway as _Tts  # noqa: F401
        TtsGateway = _Tts
    except ImportError:
        pass
