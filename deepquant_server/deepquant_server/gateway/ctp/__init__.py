"""CTP gateway — CFFEX, SHFE, DCE, CZCE, INE, GFEX."""

CtpGateway = None  # type: ignore[assignment]

# Try the installed deepquant_ctp package first
try:
    from deepquant_ctp import CtpGateway as _Ctp  # noqa: F401
    CtpGateway = _Ctp
except ImportError:
    # Fallback: try loading from local source (development mode)
    try:
        from vnpy_ctp import CtpGateway as _Ctp  # noqa: F401
        CtpGateway = _Ctp
    except ImportError:
        pass
