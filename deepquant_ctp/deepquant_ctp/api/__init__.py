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
# Multi-backend loader: import backend-specific .so files on demand.
# Each gateway type (CTP, TTS) can use a different set of native libraries.
# ---------------------------------------------------------------------------
_here = os.path.dirname(__file__)
_backend_cache: dict[str, dict] = {}


def load_backend(name: str = "") -> dict:
    """Load (or return cached) the CTP API symbols for a specific backend.

    Returns dict with keys: MdApi, TdApi, constants_module.
    If name is empty, uses the current _BACKEND setting.
    """
    name = name or _BACKEND
    if name in _backend_cache:
        return _backend_cache[name]

    backend_dir = os.path.join(_here, "backends", name)
    if not os.path.isdir(backend_dir):
        raise ImportError(f"CTP backend '{name}' not found at {backend_dir}")

    import importlib
    import importlib.util

    # Load MdApi and TdApi from the backend-specific .so
    pyver = f"cpython-{sys.version_info.major}{sys.version_info.minor}-darwin"
    md_path = os.path.join(backend_dir, f"vnctpmd.{pyver}.so")
    td_path = os.path.join(backend_dir, f"vnctptd.{pyver}.so")

    if not os.path.isfile(md_path) or not os.path.isfile(td_path):
        raise ImportError(
            f"CTP backend '{name}' libraries not found. "
            f"Expected {md_path} and {td_path}"
        )

    spec_md = importlib.util.spec_from_file_location(f"deepquant_ctp.api.backends.{name}.vnctpmd", md_path)
    spec_td = importlib.util.spec_from_file_location(f"deepquant_ctp.api.backends.{name}.vnctptd", td_path)
    mod_md = importlib.util.module_from_spec(spec_md)
    mod_td = importlib.util.module_from_spec(spec_td)
    spec_md.loader.exec_module(mod_md)
    spec_td.loader.exec_module(mod_td)

    result = {
        "MdApi": getattr(mod_md, "MdApi", None),
        "TdApi": getattr(mod_td, "TdApi", None),
    }
    _backend_cache[name] = result
    print(f"[CTP API] 后端 '{name}' 已加载: MdApi={result['MdApi']}, TdApi={result['TdApi']}")
    return result


# Load default backend at import time (backward compatibility)
_default = load_backend(_BACKEND)
MdApi = _default["MdApi"]
TdApi = _default["TdApi"]
from .ctp_constant import *     # noqa: E402,F401  (constants are backend-independent)

_LOADED = True
