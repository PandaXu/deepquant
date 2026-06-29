"""CTP gateway — CFFEX, SHFE, DCE, CZCE, INE, GFEX."""

CtpGateway = None  # type: ignore[assignment]

# Try importing from the local deepquant_ctp project
try:
    from deepquant_ctp.gateway.ctp_gateway import CtpGateway as _Ctp  # noqa: F401
    CtpGateway = _Ctp
except ImportError:
    # Fallback: try the legacy vnpy_ctp package
    try:
        from vnpy_ctp import CtpGateway as _Ctp  # noqa: F401
        CtpGateway = _Ctp
    except ImportError:
        pass
