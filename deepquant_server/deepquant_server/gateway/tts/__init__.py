"""TTS gateway — CTP-compatible simulation (OpenCTP / Tick Trading System)."""

TtsGateway = None  # type: ignore[assignment]

# TTS uses the same CTP protocol — reuse CtpGateway class
try:
    from deepquant_ctp.gateway.ctp_gateway import CtpGateway as _Ctp  # noqa: F401
    TtsGateway = _Ctp
except ImportError:
    try:
        from vnpy_ctp import CtpGateway as _Ctp  # noqa: F401
        TtsGateway = _Ctp
    except ImportError:
        pass
