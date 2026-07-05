"""DeepQuant CTA Backtester — CTA strategy backtesting application."""

from pathlib import Path

from deepquant.trader.app import BaseApp

from .engine import BacktesterEngine, APP_NAME

__all__ = [
    "APP_NAME",
    "BacktesterEngine",
    "CtaBacktesterApp",
]

__version__ = "1.0.0"


class CtaBacktesterApp(BaseApp):
    """CTA strategy backtesting application."""

    from .locale import _

    app_name: str = APP_NAME
    app_module: str = __module__
    app_path: Path = Path(__file__).parent
    display_name: str = _("CTA回测")
    engine_class: type[BacktesterEngine] = BacktesterEngine
    widget_name: str = "BacktesterManager"
    icon_name: str = str(app_path.joinpath("ui", "backtester.ico"))
