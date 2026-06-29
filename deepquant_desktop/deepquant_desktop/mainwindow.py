"""
Implements main window of the trading platform.
"""

from types import ModuleType
import webbrowser
from functools import partial
from importlib import import_module
from typing import TypeVar, cast
from collections.abc import Callable

import deepquant

from deepquant_desktop.qt import QtCore, QtGui, QtWidgets
from deepquant_desktop.widget import (
    BaseMonitor,
    TickMonitor,
    OrderMonitor,
    TradeMonitor,
    PositionMonitor,
    AccountMonitor,
    LogMonitor,
    ActiveOrderMonitor,
    ConnectDialog,
    ContractManager,
    TradingWidget,
    AboutDialog,
    GlobalDialog,
)
from deepquant.trader.utility import get_icon_path, TRADER_DIR
from deepquant.trader.locale import _


WidgetType = TypeVar("WidgetType", bound="QtWidgets.QWidget")


class MainWindow(QtWidgets.QMainWindow):
    """
    Main window of the trading platform.
    """

    def __init__(self, api: "ApiClient") -> None:  # noqa: F821
        """"""
        super().__init__()

        self.api = api

        self.window_title: str = _("DeepQuant Trader - {}   [{}]").format(deepquant.__version__, TRADER_DIR)

        self.widgets: dict[str, QtWidgets.QWidget] = {}
        self.monitors: dict[str, BaseMonitor] = {}

        self.init_ui()

    def init_ui(self) -> None:
        """"""
        self.setWindowTitle(self.window_title)
        self.init_dock()
        self.init_toolbar()
        self.init_menu()
        self.load_window_setting("custom")

    def init_dock(self) -> None:
        """"""
        self.trading_widget, trading_dock = self.create_dock(
            TradingWidget, _("交易"), QtCore.Qt.DockWidgetArea.LeftDockWidgetArea
        )
        tick_widget, tick_dock = self.create_dock(
            TickMonitor, _("行情"), QtCore.Qt.DockWidgetArea.RightDockWidgetArea
        )
        order_widget, order_dock = self.create_dock(
            OrderMonitor, _("委托"), QtCore.Qt.DockWidgetArea.RightDockWidgetArea
        )
        active_widget, active_dock = self.create_dock(
            ActiveOrderMonitor, _("活动"), QtCore.Qt.DockWidgetArea.RightDockWidgetArea
        )
        trade_widget, trade_dock = self.create_dock(
            TradeMonitor, _("成交"), QtCore.Qt.DockWidgetArea.RightDockWidgetArea
        )
        log_widget, log_dock = self.create_dock(
            LogMonitor, _("日志"), QtCore.Qt.DockWidgetArea.BottomDockWidgetArea
        )
        account_widget, account_dock = self.create_dock(
            AccountMonitor, _("资金"), QtCore.Qt.DockWidgetArea.BottomDockWidgetArea
        )
        position_widget, position_dock = self.create_dock(
            PositionMonitor, _("持仓"), QtCore.Qt.DockWidgetArea.BottomDockWidgetArea
        )

        # K-line chart dock
        try:
            from deepquant_desktop.chart.kline_widget import KLineChartWidget
            self.chart_widget = KLineChartWidget(self.api)
            chart_dock = QtWidgets.QDockWidget("📈 K线图")
            chart_dock.setWidget(self.chart_widget)
            self.addDockWidget(QtCore.Qt.DockWidgetArea.RightDockWidgetArea, chart_dock)
            self.tabifyDockWidget(chart_dock, tick_dock)
            # Link to trading widget for auto-chart on contract select
            self.trading_widget.set_chart_widget(self.chart_widget)
        except ImportError:
            pass

        self.tabifyDockWidget(active_dock, order_dock)

        self.save_window_setting("default")

        tick_widget.itemDoubleClicked.connect(self.trading_widget.update_with_cell)
        position_widget.itemDoubleClicked.connect(self.trading_widget.update_with_cell)
        # Connect tick double-click to load chart data
        tick_widget.itemDoubleClicked.connect(lambda cell: self._load_chart_data(cell))
        position_widget.itemDoubleClicked.connect(lambda cell: self._load_chart_data(cell))

    def init_menu(self) -> None:
        """"""
        bar: QtWidgets.QMenuBar = self.menuBar()
        bar.setNativeMenuBar(False)     # for mac and linux

        # System menu
        sys_menu: QtWidgets.QMenu = bar.addMenu(_("系统"))

        gateway_names: list = self.api.get_all_gateway_names()
        for name in gateway_names:
            func: Callable = partial(self.connect_gateway, name)
            self.add_action(
                sys_menu,
                _("连接{}").format(name),
                get_icon_path(__file__, "connect.ico"),
                func
            )

        sys_menu.addSeparator()

        self.add_action(
            sys_menu,
            _("退出"),
            get_icon_path(__file__, "exit.ico"),
            self.close
        )

        # App menu
        app_menu: QtWidgets.QMenu = bar.addMenu(_("功能"))

        all_apps = self.api.get_all_apps()
        for app in all_apps:
            try:
                ui_module: ModuleType = import_module(app.app_module + ".ui")
                widget_class: type[QtWidgets.QWidget] = getattr(ui_module, app.widget_name)
                func = partial(self.open_widget, widget_class, app.app_name)
                self.add_action(app_menu, app.display_name, app.icon_name, func, True)
            except Exception:
                pass  # Skip apps whose UI module is not installed

        # Global setting editor
        setting_action: QtGui.QAction = QtGui.QAction(_("配置"), self)
        setting_action.triggered.connect(self.edit_global_setting)
        bar.addAction(setting_action)

        # Wechat notification
        wechat_action: QtGui.QAction = QtGui.QAction(_("微信"), self)
        wechat_action.triggered.connect(self.open_wechat_dialog)
        bar.addAction(wechat_action)

        # Help menu
        help_menu: QtWidgets.QMenu = bar.addMenu(_("帮助"))

        self.add_action(
            help_menu,
            _("查询合约"),
            get_icon_path(__file__, "contract.ico"),
            partial(self.open_widget, ContractManager, "contract"),
            True
        )

        self.add_action(
            help_menu,
            _("还原窗口"),
            get_icon_path(__file__, "restore.ico"),
            self.restore_window_setting
        )

        self.add_action(
            help_menu,
            _("测试邮件"),
            get_icon_path(__file__, "email.ico"),
            self.send_test_email
        )

        self.add_action(
            help_menu,
            _("关于"),
            get_icon_path(__file__, "about.ico"),
            partial(self.open_widget, AboutDialog, "about"),
        )

    def init_toolbar(self) -> None:
        """"""
        self.toolbar: QtWidgets.QToolBar = QtWidgets.QToolBar(self)
        self.toolbar.setObjectName(_("工具栏"))
        self.toolbar.setFloatable(False)
        self.toolbar.setMovable(False)

        # Set button size
        w: int = 40
        size = QtCore.QSize(w, w)
        self.toolbar.setIconSize(size)

        # Set button spacing
        layout: QtWidgets.QLayout | None = self.toolbar.layout()
        if layout:
            layout.setSpacing(10)

        self.addToolBar(QtCore.Qt.ToolBarArea.LeftToolBarArea, self.toolbar)

    def add_action(
        self,
        menu: QtWidgets.QMenu,
        action_name: str,
        icon_name: str,
        func: Callable,
        toolbar: bool = False
    ) -> None:
        """"""
        icon: QtGui.QIcon = QtGui.QIcon(icon_name)

        action: QtGui.QAction = QtGui.QAction(action_name, self)
        action.triggered.connect(func)
        action.setIcon(icon)

        menu.addAction(action)

        if toolbar:
            self.toolbar.addAction(action)

    def create_dock(
        self,
        widget_class: type[WidgetType],
        name: str,
        area: QtCore.Qt.DockWidgetArea
    ) -> tuple[WidgetType, QtWidgets.QDockWidget]:
        """
        Initialize a dock widget.
        """
        widget: WidgetType = widget_class(self.api, self.api)      # type: ignore
        if isinstance(widget, BaseMonitor):
            self.monitors[name] = widget

        dock: QtWidgets.QDockWidget = QtWidgets.QDockWidget(name)
        dock.setWidget(widget)
        dock.setObjectName(name)
        dock.setFeatures(dock.DockWidgetFeature.DockWidgetFloatable | dock.DockWidgetFeature.DockWidgetMovable)
        self.addDockWidget(area, dock)
        return widget, dock

    def connect_gateway(self, gateway_name: str) -> None:
        """
        Open connect dialog for gateway connection.
        """
        dialog: ConnectDialog = ConnectDialog(self.api, gateway_name)
        dialog.exec()

    def closeEvent(self, event: QtGui.QCloseEvent) -> None:
        """
        Call main engine close function before exit.
        """
        reply = QtWidgets.QMessageBox.question(
            self,
            _("退出"),
            _("确认退出？"),
            QtWidgets.QMessageBox.StandardButton.Yes | QtWidgets.QMessageBox.StandardButton.No,
            QtWidgets.QMessageBox.StandardButton.No,
        )

        if reply == QtWidgets.QMessageBox.StandardButton.Yes:
            for widget in self.widgets.values():
                widget.close()

            for monitor in self.monitors.values():
                monitor.save_setting()

            self.save_window_setting("custom")

            self.api.disconnect_from_server()

            event.accept()
        else:
            event.ignore()

    def open_widget(self, widget_class: type[QtWidgets.QWidget], name: str) -> None:
        """
        Open contract manager.
        """
        widget: QtWidgets.QWidget | None = self.widgets.get(name, None)
        if not widget:
            try:
                widget = widget_class(self.api, self.api)      # type: ignore
                self.widgets[name] = widget
            except Exception:
                from PySide6.QtWidgets import QMessageBox
                QMessageBox.information(self, name, f"{name} 功能需通过 Web 端使用")
                return

        if isinstance(widget, QtWidgets.QDialog):
            widget.exec()
        else:
            widget.show()

    def save_window_setting(self, name: str) -> None:
        """
        Save current window size and state by trader path and setting name.
        """
        settings: QtCore.QSettings = QtCore.QSettings(self.window_title, name)
        settings.setValue("state", self.saveState())
        settings.setValue("geometry", self.saveGeometry())

    def load_window_setting(self, name: str) -> None:
        """
        Load previous window size and state by trader path and setting name.
        """
        settings: QtCore.QSettings = QtCore.QSettings(self.window_title, name)
        state = settings.value("state")
        geometry = settings.value("geometry")

        if isinstance(state, QtCore.QByteArray):
            self.restoreState(state)
            self.restoreGeometry(geometry)

    def _load_chart_data(self, cell) -> None:
        """Load bar data into the K-line chart when a tick cell is double-clicked."""
        if not hasattr(self, 'chart_widget'):
            return
        data = cell.get_data()
        vt_symbol = data.vt_symbol
        symbol, exchange = vt_symbol.rsplit(".", 1)
        self.chart_widget.set_symbol(vt_symbol)

        # Load bars via API
        bars_data = self.api.get_bars(symbol, exchange, "1m", 30)
        if bars_data:
            bars = [_dict_to_bar(b) for b in bars_data]
            self.chart_widget.load_bars(bars, f"{vt_symbol} 分钟K线")
        else:
            bars_data = self.api.get_bars(symbol, exchange, "d", 365)
            if bars_data:
                bars = [_dict_to_bar(b) for b in bars_data]
                self.chart_widget.load_bars(bars, f"{vt_symbol} 日K线")

    def restore_window_setting(self) -> None:
        """
        Restore window to default setting.
        """
        self.load_window_setting("default")
        self.showMaximized()

    def send_test_email(self) -> None:
        """
        Sending a test email.
        """
        email_engine: EmailEngine = cast(EmailEngine, self.api.get_engine("email"))
        email_engine.send_email("DeepQuant Trader", "testing")

    def edit_global_setting(self) -> None:
        """
        """
        dialog: GlobalDialog = GlobalDialog()
        dialog.exec()

    def open_wechat_dialog(self) -> None:
        """
        Open WeChat notification dialog.
        """
        from deepquant_desktop.widget import WechatDialog
        dialog: WechatDialog = WechatDialog(self.api, self.api)
        dialog.exec()


def _dict_to_bar(d: dict):
    """Convert API bar dict to a simple object for chart widgets."""
    from datetime import datetime
    bar = type("Bar", (), {})()
    bar.datetime = datetime.fromisoformat(d["datetime"])
    bar.open_price = d["open"]
    bar.high_price = d["high"]
    bar.low_price = d["low"]
    bar.close_price = d["close"]
    bar.volume = d["volume"]
    bar.interval = None
    return bar
