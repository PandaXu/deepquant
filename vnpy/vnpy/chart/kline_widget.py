"""
K-line chart widget — embeds ECharts via QWebEngineView.
Displays candlestick charts with volume bars, supports tick/bar data push.
"""
import json
from datetime import datetime
from pathlib import Path

from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtCore import QObject, Signal, Slot, QUrl

from vnpy.trader.object import TickData, BarData
from vnpy.event import Event, EventEngine
from vnpy.trader.event import EVENT_TICK, EVENT_BAR


class ChartBridge(QObject):
    """Bridge object for Qt ↔ JS communication."""
    dataReady = Signal(str, str)   # title, json_bars
    tickReady = Signal(str)        # json_tick

    def push_bars(self, title: str, bars: list[dict]) -> None:
        self.dataReady.emit(title, json.dumps(bars, ensure_ascii=False))

    def push_tick(self, tick: dict) -> None:
        self.tickReady.emit(json.dumps(tick, ensure_ascii=False))


class KLineChartWidget(QWebEngineView):
    """ECharts-based K-line chart embedded in Qt."""

    def __init__(self, event_engine: EventEngine | None = None) -> None:
        super().__init__()
        self._bridge = ChartBridge()
        self._event_engine = event_engine
        self._bars: list[dict] = []
        self._vt_symbol: str = ""

        # Set up QWebChannel
        channel = QWebChannel(self)
        channel.registerObject("bridge", self._bridge)
        self.page().setWebChannel(channel)

        # Load HTML
        html_path = Path(__file__).parent / "kline_chart.html"
        self.load(QUrl.fromLocalFile(str(html_path)))

        if event_engine:
            event_engine.register(EVENT_TICK, self._on_tick)

    def _on_tick(self, event: Event) -> None:
        tick: TickData = event.data
        if self._vt_symbol and tick.vt_symbol != self._vt_symbol:
            return
        self._bridge.push_tick({
            "dt": tick.datetime.strftime("%H:%M:%S") if tick.datetime else "",
            "last_price": tick.last_price,
            "open": tick.open_price,
            "high": tick.high_price,
            "low": tick.low_price,
            "volume": tick.volume,
        })

    def set_symbol(self, vt_symbol: str) -> None:
        self._vt_symbol = vt_symbol

    def load_bars(self, bars: list[BarData], title: str = "") -> None:
        """Load historical bar data into chart."""
        data = []
        for b in bars:
            data.append({
                "dt": b.datetime.strftime("%m-%d %H:%M") if b.interval and b.interval.value != "d"
                     else b.datetime.strftime("%Y-%m-%d") if b.datetime else "",
                "open": b.open_price,
                "close": b.close_price,
                "low": b.low_price,
                "high": b.high_price,
                "volume": b.volume,
            })
        self._bars = data
        self._bridge.push_bars(title, data)

    def clear(self) -> None:
        self._bars.clear()
        self._bridge.push_bars("", [])
