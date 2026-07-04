"""DatabaseWriter — 通过 VeighNa Database 接口持久化 tick / 1m K 线。"""
import logging

from deepquant.trader.database import get_database
from deepquant.trader.object import BarData

from .tick_convert import dict_to_tick

logger = logging.getLogger(__name__)


class DatabaseWriter:
    """批量写入 tick 与 BarGenerator 产出的 1 分钟 K 线。"""

    def __init__(self):
        self._db = get_database()
        self.saved_ticks = 0
        self.saved_bars = 0

    async def save_ticks(self, ticks: list[dict]):
        objs = [dict_to_tick(t) for t in ticks]
        objs = [t for t in objs if t]
        if not objs:
            return
        try:
            self._db.save_tick_data(objs, stream=True)
            self.saved_ticks += len(objs)
        except Exception as e:
            logger.error("save_ticks failed: %s", e)

    async def save_bars(self, bars: list[BarData]):
        if not bars:
            return
        try:
            self._db.save_bar_data(bars, stream=True)
            self.saved_bars += len(bars)
        except Exception as e:
            logger.error("save_bars failed: %s", e)
