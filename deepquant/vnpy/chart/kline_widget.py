"""
K-line chart widget — ECharts via QWebEngineView.
Communicates with JS via page().runJavaScript() — no QWebChannel needed.
"""
import json
from pathlib import Path

from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtCore import QUrl, Signal, QTimer, Qt

from vnpy.trader.object import TickData, BarData
from vnpy.event import Event, EventEngine
from vnpy.trader.event import EVENT_TICK


class KLineChartWidget(QWebEngineView):
    """ECharts K-line chart embedded in Qt."""

    _tick_signal: Signal = Signal(dict)

    def __init__(self, event_engine: EventEngine | None = None) -> None:
        super().__init__()
        self._event_engine = event_engine
        self._vt_symbol: str = ""
        self._loaded = False

        html_path = Path(__file__).parent / "kline_chart.html"
        self.load(QUrl.fromLocalFile(str(html_path)))
        self.loadFinished.connect(self._on_load)

        # Route ticks through a signal so runJavaScript always runs on
        # the main thread (EventEngine dispatches from a background thread).
        self._tick_signal.connect(self._apply_tick, Qt.ConnectionType.QueuedConnection)

        if event_engine:
            event_engine.register(EVENT_TICK, self._on_tick)

    def _on_load(self, ok: bool) -> None:
        self._loaded = ok
        if ok and hasattr(self, '_pending_js'):
            for js in self._pending_js:
                self.page().runJavaScript(js)
            self._pending_js.clear()

    def _run_js(self, js: str) -> None:
        if self._loaded:
            self.page().runJavaScript(js)
        else:
            # Page not yet loaded — queue JS until loadFinished fires
            if not hasattr(self, '_pending_js'):
                self._pending_js = []
            self._pending_js.append(js)

    def _on_tick(self, event: Event) -> None:
        """Called from EventEngine background thread — marshal to main thread."""
        tick: TickData = event.data
        if self._vt_symbol and tick.vt_symbol != self._vt_symbol:
            return
        d = {
            "dt": tick.datetime.strftime("%H:%M:%S") if tick.datetime else "",
            "lp": tick.last_price, "op": tick.open_price,
            "hi": tick.high_price, "lo": tick.low_price, "v": tick.volume,
        }
        self._tick_signal.emit(d)

    def _apply_tick(self, d: dict) -> None:
        """Runs on main thread — safe to call runJavaScript."""
        self._run_js(f"addTick({json.dumps(d)})")

    def set_symbol(self, vt_symbol: str) -> None:
        self._vt_symbol = vt_symbol

    def load_bars(self, bars: list[BarData], title: str = "") -> None:
        data = []
        for b in bars:
            data.append({
                "dt": b.datetime.strftime("%m-%d %H:%M") if b.interval and b.interval.value != "d"
                     else b.datetime.strftime("%Y-%m-%d"),
                "op": b.open_price, "cl": b.close_price,
                "lo": b.low_price, "hi": b.high_price, "v": b.volume,
            })
        js = f"updateBarChart('{title}', {json.dumps(data)})"
        self._run_js(js)

    def clear(self) -> None:
        self._run_js("clearChart()")
