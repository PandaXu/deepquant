"""DeepQuant DataManager — historical bar/tick download and local DB management."""

from pathlib import Path

from deepquant.trader.app import BaseApp

from .engine import APP_NAME, ManagerEngine

__all__ = [
    "APP_NAME",
    "ManagerEngine",
    "DataManagerApp",
]

__version__ = "1.0.0"


class DataManagerApp(BaseApp):
    """Historical data management application."""

    app_name: str = APP_NAME
    app_module: str = __module__
    app_path: Path = Path(__file__).parent
    display_name: str = "数据管理"
    engine_class: type[ManagerEngine] = ManagerEngine
    widget_name: str = "ManagerWidget"
    icon_name: str = str(app_path.joinpath("ui", "manager.ico"))
