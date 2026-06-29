"""
VeighNa → DeepQuant backward-compatibility shim.

This package redirects all ``from vnpy.xxx import YYY`` imports to ``deepquant.xxx``.
Third-party packages (vnpy_ctp, vnpy_ctastrategy, etc.) that were installed from PyPI
can continue to ``from vnpy.event import EventEngine`` without changes.
"""
import sys

import deepquant  # noqa: F401

# Make 'vnpy' an alias for 'deepquant' in the module cache.
# After this, ``from vnpy.event import EventEngine`` resolves to
# ``deepquant.event.EventEngine`` transparently.
sys.modules["vnpy"] = sys.modules["deepquant"]
