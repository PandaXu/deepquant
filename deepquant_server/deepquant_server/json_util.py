"""JSON helpers for VeighNa / backtest payloads (numpy, pandas, date, dataclass)."""
from __future__ import annotations

import json
from datetime import date, datetime
from enum import Enum
from typing import Any


def json_safe(obj: Any) -> Any:
    """Recursively convert objects to JSON-native types."""
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, Enum):
        return obj.value
    try:
        import numpy as np
        if isinstance(obj, np.generic):
            return json_safe(obj.item())
        if isinstance(obj, np.ndarray):
            return json_safe(obj.tolist())
    except ImportError:
        pass
    try:
        from pandas import Timestamp
        if isinstance(obj, Timestamp):
            return obj.isoformat()
    except ImportError:
        pass
    if isinstance(obj, dict):
        return {str(k): json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    if hasattr(obj, "__dict__") and not isinstance(obj, type):
        return json_safe({
            k: v for k, v in obj.__dict__.items()
            if not k.startswith("_")
        })
    return str(obj)


def json_dumps(obj: Any) -> str:
    return json.dumps(json_safe(obj), ensure_ascii=False)
