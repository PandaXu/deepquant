"""CTP gateway — CFFEX, SHFE, DCE, CZCE, INE, GFEX."""

CtpGateway = None  # type: ignore[assignment]

try:
    from deepquant_gateway.gateway import CtpGateway as _Ctp  # noqa: F401
    CtpGateway = _Ctp
except ImportError:
    pass
