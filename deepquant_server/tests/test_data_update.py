#!/usr/bin/env python3
"""Smoke tests for data update planner and coverage (no network)."""
from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deepquant"))
sys.path.insert(0, str(ROOT / "deepquant_server"))

from deepquant_server import data_update_service as svc  # noqa: E402


class _FakeBar:
    def __init__(self, dt: datetime):
        self.datetime = dt


def test_interval_step():
    assert svc.interval_step("1m") == timedelta(minutes=1)
    assert svc.interval_step("d") == timedelta(days=1)
    print("OK test_interval_step")


def test_plan_incremental_already_up_to_date():
    class FakeEngine:
        def get_engine(self, name):
            return self

        def load_bar_data(self, symbol, exchange, interval, start, end):
            return [_FakeBar(datetime(2026, 7, 4, 15, 0, 0))]

    now = datetime(2026, 7, 4, 15, 0, 0)
    start, end, reason = svc.plan_download_range(
        FakeEngine(), "IF2509", "CFFEX", "1m",
        incremental=True, user_end=now.isoformat(),
    )
    assert reason == "already_up_to_date"
    assert start is None
    print("OK test_plan_incremental_already_up_to_date")


def test_plan_incremental_from_last_bar():
    class FakeEngine:
        def get_engine(self, name):
            return self

        def load_bar_data(self, symbol, exchange, interval, start, end):
            return [_FakeBar(datetime(2026, 7, 1, 9, 30, 0))]

    start, end, reason = svc.plan_download_range(
        FakeEngine(), "IF2509", "CFFEX", "1m", incremental=True,
    )
    assert reason == "ok"
    assert start == datetime(2026, 7, 1, 9, 31, 0)
    print("OK test_plan_incremental_from_last_bar")


def test_enrich_overview():
    row = {"symbol": "IF2509", "exchange": "CFFEX", "interval": "1m", "count": 100,
           "end": "2026-07-01T15:00:00"}
    tick = {"IF2509.CFFEX": {"count": 50, "end": "2026-07-04T10:00:00"}}
    out = svc.enrich_bar_overview(row, tick)
    assert out["effective_end"] == "2026-07-04T10:00:00"
    assert "stored" in out["sources"] and "recorded" in out["sources"]
    print("OK test_enrich_overview")


def test_detect_gaps():
    bars = [_FakeBar(datetime(2026, 6, 1)), _FakeBar(datetime(2026, 6, 30))]
    gaps, pct = svc.detect_bar_gaps(
        bars, "d", datetime(2026, 6, 1), datetime(2026, 7, 1),
    )
    assert isinstance(gaps, list)
    assert 0 <= pct <= 100
    print("OK test_detect_gaps")


def test_queue_cancel():
    emitted = []

    def emit(*args, **kwargs):
        emitted.append(args)

    q = svc.DataUpdateQueue(lambda: None, emit, lambda: None, lambda m: None)
    tid = q.enqueue(action="auto_update", symbol="X", exchange="CFFEX", interval="d", task_id="t1")
    assert q.cancel("t1")
    print("OK test_queue_cancel")


if __name__ == "__main__":
    test_interval_step()
    test_plan_incremental_already_up_to_date()
    test_plan_incremental_from_last_bar()
    test_enrich_overview()
    test_detect_gaps()
    test_queue_cancel()
    print("\nAll data update tests passed.")
