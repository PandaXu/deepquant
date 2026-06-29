"""
DeepQuant CTP API — backend-aware loader.

Supports multiple CTP API backends:
  - official: Official CTP 6.7.11 (real brokers, SimNow)
  - tts:      TTS CTP-compatible (OpenCTP 7x24, XTP, QDP, etc.)

Switch via:
  - Environment:  DEEPQUANT_CTP_BACKEND=tts
  - Programmatic: set_ctp_backend("tts")
  - CLI flag:     --backend tts

Default: "official"
"""
import os
import sys

_BACKEND: str = os.environ.get("DEEPQUANT_CTP_BACKEND", "official")
_LOADED: bool = False


def get_backend() -> str:
    """Return currently configured backend name."""
    return _BACKEND


def set_ctp_backend(name: str) -> None:
    """Switch CTP API backend. Must be called BEFORE importing the gateway."""
    global _BACKEND
    name = name.lower()
    if name not in ("official", "tts"):
        raise ValueError(f"Unknown backend: '{name}'. Choose 'official' or 'tts'")
    if _LOADED:
        raise RuntimeError(
            f"Cannot switch to '{name}': CTP API already loaded. "
            "Call set_ctp_backend() before any gateway imports."
        )
    _BACKEND = name
    os.environ["DEEPQUANT_CTP_BACKEND"] = name
    print(f"[CTP API] 后端已切换为: {name}")


def available_backends() -> list[str]:
    """List backends that have compiled libraries available."""
    here = os.path.dirname(__file__)
    result = []
    for name in ("official", "tts"):
        d = os.path.join(here, "backends", name)
        pyver = f"cpython-{sys.version_info.major}{sys.version_info.minor}-darwin"
        md = os.path.join(d, f"vnctpmd.{pyver}.so")
        td = os.path.join(d, f"vnctptd.{pyver}.so")
        if os.path.isfile(md) and os.path.isfile(td):
            result.append(name)
    return result


# ---------------------------------------------------------------------------
# Prepend backend directory to this package's __path__
# so that `from .vnctpmd import MdApi` finds the correct .so
# ---------------------------------------------------------------------------
_here = os.path.dirname(__file__)
_backend_dir = os.path.join(_here, "backends", _BACKEND)

# Insert backend dir at front of package search path
if os.path.isdir(_backend_dir):
    __path__.insert(0, _backend_dir)       # type: ignore[name-defined]  # noqa: F821
else:
    import warnings
    warnings.warn(
        f"CTP backend '{_BACKEND}' not available at {_backend_dir}. "
        f"Falling back to default. Available: {available_backends()}"
    )

# Now do the imports — Python searches __path__[0] (backend dir) first
from .vnctpmd import MdApi      # noqa: E402,F401
from .vnctptd import TdApi      # noqa: E402,F401
from .ctp_constant import *     # noqa: E402,F401

_LOADED = True
