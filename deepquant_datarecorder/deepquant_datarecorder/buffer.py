"""TickBuffer — 缓存 tick、合成 1m K 线并批量刷盘。"""
import asyncio
import logging
import time
from collections import defaultdict

from deepquant.trader.object import BarData
from deepquant.trader.utility import BarGenerator

from .tick_convert import dict_to_tick

logger = logging.getLogger(__name__)


class TickBuffer:
    """按合约缓冲 tick，BarGenerator 合成 1 分钟 K 线，定时写入数据库。"""

    def __init__(self, writer, interval: float = 10.0, max_size: int = 200):
        self._writer = writer
        self._interval = interval
        self._max_size = max_size
        self._ticks: defaultdict[str, list[dict]] = defaultdict(list)
        self._bars: defaultdict[str, list[BarData]] = defaultdict(list)
        self._generators: dict[str, BarGenerator] = {}
        self._count = 0
        self._last_flush = time.time()
        self._lock = asyncio.Lock()
        self.stats = {"ticks_in": 0, "bars_in": 0, "flushes": 0}

    def _get_generator(self, vt_symbol: str) -> BarGenerator:
        if vt_symbol not in self._generators:
            def on_bar(bar: BarData):
                self._bars[bar.vt_symbol].append(bar)
                self._count += 1
                self.stats["bars_in"] += 1

            self._generators[vt_symbol] = BarGenerator(on_bar)
        return self._generators[vt_symbol]

    def add_tick(self, tick: dict):
        """接收 Gateway tick 事件。"""
        obj = dict_to_tick(tick)
        if not obj or not obj.vt_symbol:
            return
        vt = obj.vt_symbol
        self._ticks[vt].append(tick)
        self._get_generator(vt).update_tick(obj)
        self._count += 1
        self.stats["ticks_in"] += 1

    async def should_flush(self) -> bool:
        return self._count >= self._max_size or (time.time() - self._last_flush) >= self._interval

    async def flush(self):
        async with self._lock:
            for vt_symbol, ticks in list(self._ticks.items()):
                if ticks:
                    await self._writer.save_ticks(ticks)
                self._ticks[vt_symbol].clear()
            for vt_symbol, bars in list(self._bars.items()):
                if bars:
                    await self._writer.save_bars(bars)
                self._bars[vt_symbol].clear()
            self._count = 0
            self._last_flush = time.time()
            self.stats["flushes"] += 1

    async def flush_loop(self):
        logger.info("TickBuffer flush_loop started (interval=%ss, batch=%s)", self._interval, self._max_size)
        while True:
            await asyncio.sleep(1)
            try:
                if await self.should_flush():
                    await self.flush()
            except Exception as e:
                logger.exception("flush error: %s", e)
