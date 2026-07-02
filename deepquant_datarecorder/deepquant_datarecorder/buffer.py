"""TickBuffer — cache ticks by symbol, flush in batches."""
import time
import asyncio
from collections import defaultdict


class TickBuffer:
    """Buffer incoming ticks and flush them to a writer in batches."""

    def __init__(self, writer, interval: float = 10.0, max_size: int = 200):
        self._writer = writer
        self._interval = interval
        self._max_size = max_size
        self._ticks: defaultdict[str, list[dict]] = defaultdict(list)
        self._bars: defaultdict[str, list[dict]] = defaultdict(list)
        self._count = 0
        self._last_flush = time.time()
        self._lock = asyncio.Lock()

    def add_tick(self, tick: dict):
        """Add a tick to the buffer."""
        vt_symbol = tick.get("vt_symbol", "unknown")
        self._ticks[vt_symbol].append(tick)
        self._count += 1

    def add_bar(self, bar: dict):
        """Add a bar to the buffer."""
        vt_symbol = bar.get("vt_symbol", "unknown")
        self._bars[vt_symbol].append(bar)
        self._count += 1

    async def should_flush(self) -> bool:
        return self._count >= self._max_size or (time.time() - self._last_flush) >= self._interval

    async def flush(self):
        """Flush all buffered data to the writer."""
        async with self._lock:
            if self._ticks:
                for vt_symbol, ticks in self._ticks.items():
                    await self._writer.save_ticks(vt_symbol, ticks)
                self._ticks.clear()
            if self._bars:
                for vt_symbol, bars in self._bars.items():
                    await self._writer.save_bars(vt_symbol, bars)
                self._bars.clear()
            self._count = 0
            self._last_flush = time.time()

    async def flush_loop(self):
        """Periodically flush buffered data."""
        while True:
            await asyncio.sleep(1)
            if await self.should_flush():
                await self.flush()
