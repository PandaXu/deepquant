"""Backward-compatible re-exports. Gateway code now lives in deepquant_gateway."""
try:
    from deepquant_gateway.gateway import CtpGateway, TtsGateway
except ImportError:
    CtpGateway = None
    TtsGateway = None

__all__ = ["CtpGateway", "TtsGateway"]
