"""Gateway multi-instance configuration reader."""
import os
import sys

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib  # type: ignore


def _default_path() -> str:
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), "gateways.toml")


def load_config(path: str = "") -> list[dict]:
    """Load gateway instances from TOML config. Returns list of instance dicts."""
    path = path or _default_path()
    if not os.path.isfile(path):
        return [_default_instance()]

    with open(path, "rb") as f:
        data = tomllib.load(f)

    instances = data.get("gateways", [])
    if not instances:
        return [_default_instance()]

    return instances


def get_instance(instance_id: str, path: str = "") -> dict | None:
    """Get a specific gateway instance by ID."""
    for inst in load_config(path):
        if inst.get("id") == instance_id:
            return inst
    return None


def _default_instance() -> dict:
    return {
        "id": "default",
        "port": 8889,
        "backend": "official",
        "accounts": [],
    }
