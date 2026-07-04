"""Unified data update planner, queue, materialization, and coverage checks."""
from __future__ import annotations

import heapq
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable

from deepquant.trader.constant import Exchange, Interval
from deepquant.trader.database import DB_TZ, get_database

DEFAULT_LOOKBACK = {
    "1m": 60,
    "1h": 180,
    "d": 1095,
    "w": 1825,
}

INTERVAL_STEPS = {
    "1m": timedelta(minutes=1),
    "1h": timedelta(hours=1),
    "d": timedelta(days=1),
    "w": timedelta(weeks=1),
}

PRIORITY_MAP = {
    "high": 0,
    "normal": 5,
    "scheduled": 8,
    "low": 10,
}


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    s = raw.replace("Z", "+00:00")
    if "T" not in s and len(s) >= 10:
        s = s[:10] + "T00:00:00"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        try:
            return datetime.strptime(raw[:10], "%Y-%m-%d")
        except ValueError:
            return None


def _strip_tz(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt


def _now() -> datetime:
    return _strip_tz(datetime.now(DB_TZ))


def interval_step(interval: str) -> timedelta:
    return INTERVAL_STEPS.get(interval, timedelta(days=1))


def default_lookback_days(interval: str) -> int:
    return DEFAULT_LOOKBACK.get(interval, 60)


def get_last_bar_datetime(main_engine, symbol: str, exchange: str, interval: str) -> datetime | None:
    """Return the datetime of the last stored bar (precise, not overview day truncation)."""
    ex = Exchange(exchange)
    itv = Interval(interval)
    end = _now()
    start = end - timedelta(days=default_lookback_days(interval) + 30)
    try:
        engine = main_engine.get_engine("DataManager") if main_engine else None
        if engine:
            bars = engine.load_bar_data(symbol, ex, itv, start, end)
        else:
            bars = get_database().load_bar_data(symbol, ex, itv, start, end) or []
        if bars:
            return _strip_tz(bars[-1].datetime)
    except Exception:
        pass
    return None


def plan_download_range(
    main_engine,
    symbol: str,
    exchange: str,
    interval: str,
    *,
    incremental: bool = True,
    user_start: str | None = None,
    user_end: str | None = None,
) -> tuple[datetime | None, datetime | None, str]:
    """
    Compute download [start, end]. Returns (start, end, reason).
    start/end are None when already up-to-date.
    """
    now = _now()
    if user_end:
        end = _parse_dt(user_end) or now
        if len(user_end) <= 10:
            end = end.replace(hour=23, minute=59, second=59)
    else:
        end = now

    default_start = now - timedelta(days=default_lookback_days(interval))
    if user_start:
        start = _parse_dt(user_start) or default_start
    elif incremental:
        last = get_last_bar_datetime(main_engine, symbol, exchange, interval)
        if last:
            start = last + interval_step(interval)
        else:
            start = default_start
    else:
        start = default_start

    start = _strip_tz(start)
    end = _strip_tz(end)

    if start >= end:
        return None, None, "already_up_to_date"
    return start, end, "ok"


def materialize_ticks_to_bars(
    main_engine,
    symbol: str,
    exchange: str,
    interval: str = "1m",
    on_log: Callable[[str], None] | None = None,
) -> int:
    """Aggregate recorded ticks into bars and persist to DB."""
    if interval != "1m":
        return 0
    from .bar_merge import aggregate_ticks_to_bars

    db = get_database()
    ex = Exchange(exchange)
    itv = Interval.MINUTE
    end = _now()
    start = end - timedelta(days=7)

    tick_rows = db.get_tick_overview() or []
    tick_end = None
    for o in tick_rows:
        if o.symbol == symbol and o.exchange == ex:
            tick_end = o.end
            start = (o.start or start).replace(tzinfo=None) if o.start else start
            break
    if not tick_end:
        return 0

    try:
        ticks = db.load_tick_data(symbol, ex, start, end + timedelta(minutes=1)) or []
    except Exception:
        return 0
    if not ticks:
        return 0

    bars = aggregate_ticks_to_bars(ticks)
    if not bars:
        return 0
    db.save_bar_data(bars)
    if on_log:
        on_log(f"[DataManager] 物化 Tick→1m: {symbol}.{exchange} → {len(bars)} 条")
    return len(bars)


def enrich_bar_overview(row: dict, tick_by_symbol: dict[str, dict]) -> dict:
    """Add effective_end / sources for UI freshness."""
    key = f"{row.get('symbol')}.{row.get('exchange')}"
    tick = tick_by_symbol.get(key)
    stored_end = row.get("end") or ""
    effective_end = stored_end
    sources: list[str] = []
    if row.get("count", 0) > 0:
        sources.append("stored")
    if tick and tick.get("count", 0) > 0:
        sources.append("recorded")
        tick_end = tick.get("end") or ""
        if tick_end and (not effective_end or tick_end > effective_end):
            effective_end = tick_end
    out = dict(row)
    out["stored_end"] = stored_end
    out["effective_end"] = effective_end
    out["sources"] = sources
    return out


def _is_weekday(dt: datetime) -> bool:
    return dt.weekday() < 5


def _expected_daily_bars(start: datetime, end: datetime) -> int:
    """Rough weekday count for daily gap estimation."""
    if start >= end:
        return 0
    n = 0
    cur = start.date()
    end_d = end.date()
    while cur <= end_d:
        if cur.weekday() < 5:
            n += 1
        cur += timedelta(days=1)
    return max(n, 1)


def detect_bar_gaps(
    bars: list,
    interval: str,
    req_start: datetime,
    req_end: datetime,
) -> tuple[list[dict], float]:
    """Return missing_ranges and coverage_pct (0-100)."""
    if not bars:
        return [{"start": req_start.isoformat(), "end": req_end.isoformat()}], 0.0

    gaps: list[dict] = []
    first_dt = bars[0].datetime
    last_dt = bars[-1].datetime

    lead_thresh = interval_step(interval) * 2
    if first_dt > req_start + lead_thresh:
        gaps.append({"start": req_start.isoformat(), "end": first_dt.isoformat()})

    trail_thresh = interval_step(interval) * 3
    if last_dt < req_end - trail_thresh:
        gaps.append({"start": last_dt.isoformat(), "end": req_end.isoformat()})

    if interval == "d":
        expected = _expected_daily_bars(req_start, req_end)
        actual = len([b for b in bars if _is_weekday(b.datetime)])
        coverage = min(100.0, (actual / expected) * 100) if expected else 100.0
    elif interval == "1m":
        span_min = max(1, int((req_end - req_start).total_seconds() / 60))
        expected = min(span_min, span_min // 3)
        coverage = min(100.0, (len(bars) / max(expected, 1)) * 100)
    else:
        coverage = 100.0 if not gaps else max(30.0, 100.0 - len(gaps) * 15)

    return gaps, round(coverage, 1)


def check_item_coverage(
    main_engine,
    item: dict,
    bar_rows: dict,
    tick_rows: dict,
) -> dict:
    """Enhanced per-item coverage with effective range and gap detection."""
    vt = item.get("vt_symbol", "")
    symbol = item.get("symbol", "")
    exchange = item.get("exchange", "")
    if vt and (not symbol or not exchange) and "." in vt:
        symbol, exchange = vt.split(".", 1)
    interval = item.get("interval", "1m")
    req_start_s = item.get("start", "")
    req_end_s = item.get("end", "")

    now = _now()
    req_end = _parse_dt(req_end_s) or now
    req_start = _parse_dt(req_start_s) or (now - timedelta(days=default_lookback_days(interval)))

    key = f"{symbol}.{exchange}:{interval}"
    row = bar_rows.get(key)
    tick_row = tick_rows.get(f"{symbol}.{exchange}")

    enriched = enrich_bar_overview(row or {}, tick_rows) if row else None
    effective_end = (enriched or {}).get("effective_end") or (tick_row or {}).get("end") or ""
    stored_end = (row or {}).get("end") or ""

    status = "missing"
    detail = "无本地 K 线"
    missing_ranges: list[dict] = []
    coverage_pct = 0.0

    if row and row.get("count", 0) > 0:
        status = "ok"
        detail = f"{row['count']} 条"
        if req_start_s and row.get("start") and row["start"][:10] > req_start_s[:10]:
            status = "partial"
            detail = f"起始偏晚 ({row['start'][:10]})"
        eff_day = (effective_end or stored_end)[:10]
        req_end_day = req_end_s[:10] if req_end_s else now.strftime("%Y-%m-%d")
        if eff_day and eff_day < req_end_day:
            stale_days = (now.date() - datetime.fromisoformat(eff_day).date()).days
            if stale_days > 1:
                status = "stale" if status == "ok" else status
                detail = f"有效结束 {eff_day}（距请求结束 {req_end_day}）"

        try:
            from . import data_api
            bars = data_api.load_bars_for_export(
                main_engine, symbol, exchange, interval, req_start, req_end
            )
            missing_ranges, coverage_pct = detect_bar_gaps(bars, interval, req_start, req_end)
            if missing_ranges and status == "ok":
                status = "partial"
                detail = f"覆盖率 {coverage_pct}%"
        except Exception:
            pass

    elif tick_row and tick_row.get("count", 0) > 0 and interval in ("1m", "tick"):
        status = "tick_only"
        detail = f"仅 Tick 录制 {tick_row['count']} 条，建议物化"
        effective_end = tick_row.get("end") or ""
        coverage_pct = 40.0
    else:
        missing_ranges = [{"start": req_start.isoformat(), "end": req_end.isoformat()}]

    return {
        "vt_symbol": f"{symbol}.{exchange}",
        "symbol": symbol,
        "exchange": exchange,
        "interval": interval,
        "status": status,
        "detail": detail,
        "count": (row or tick_row or {}).get("count", 0),
        "start": (row or tick_row or {}).get("start", ""),
        "end": stored_end,
        "effective_end": effective_end,
        "stored_end": stored_end,
        "sources": (enriched or {}).get("sources", []),
        "missing_ranges": missing_ranges,
        "coverage_pct": coverage_pct,
    }


@dataclass(order=True)
class _QueuedJob:
    sort_key: tuple = field(compare=True)
    job_id: str = field(compare=False)
    task_id: str = field(compare=False)
    action: str = field(compare=False)
    symbol: str = field(compare=False)
    exchange: str = field(compare=False)
    interval: str = field(compare=False)
    incremental: bool = field(compare=False, default=True)
    user_start: str = field(compare=False, default="")
    user_end: str = field(compare=False, default="")
    materialize_first: bool = field(compare=False, default=False)
    label: str = field(compare=False, default="")


class DataUpdateQueue:
    """Priority queue with concurrency limit, rate limiting, and cancel support."""

    def __init__(
        self,
        main_engine_ref: Callable,
        emit_task: Callable,
        push_overviews: Callable,
        on_log: Callable[[str], None],
        *,
        concurrency: int = 2,
        rate_delay: float = 1.0,
    ) -> None:
        self._main_engine_ref = main_engine_ref
        self._emit = emit_task
        self._push_overviews = push_overviews
        self._on_log = on_log
        self._concurrency = max(1, concurrency)
        self._rate_delay = max(0.0, rate_delay)
        self._heap: list[_QueuedJob] = []
        self._lock = threading.Lock()
        self._cancelled: set[str] = set()
        self._running_ids: set[str] = set()
        self._active = 0
        self._seq = 0
        self._worker_started = False
        self._last_download_at = 0.0
        self._scheduled_symbols: list[dict] = []
        self._batch_state: dict[str, dict[str, int]] = {}

    def _init_batch(self, task_id: str, total: int, label: str = "") -> None:
        self._batch_state[task_id] = {"total": total, "done": 0, "ok": 0, "label": label or f"批量任务 ({total})"}

    def _emit_batch_progress(
        self, job: _QueuedJob, message: str, *, done_override: int | None = None,
    ) -> None:
        st = self._batch_state.get(job.task_id)
        if not st:
            return
        done = done_override if done_override is not None else st["done"]
        batch_label = st.get("label") or f"批量任务 ({st['total']})"
        detail = f"{job.label} — {message}" if message else job.label
        self._emit(
            job.task_id, job.action, "running", batch_label, detail,
            done, st["total"],
        )

    def _finish_batch_item(self, task_id: str, success: bool) -> None:
        st = self._batch_state.get(task_id)
        if not st:
            return
        st["done"] += 1
        if success:
            st["ok"] += 1
        if st["done"] >= st["total"]:
            batch_label = st.get("label") or f"批量任务 ({st['total']})"
            self._emit(
                task_id, "batch_download_bar_data", "success",
                batch_label,
                f"完成 {st['ok']}/{st['total']}",
                st["done"], st["total"],
            )
            self._batch_state.pop(task_id, None)
            self._push_overviews()

    def set_scheduled_symbols(self, items: list[dict]) -> None:
        with self._lock:
            self._scheduled_symbols = list(items)

    def get_scheduled_symbols(self) -> list[dict]:
        with self._lock:
            return list(self._scheduled_symbols)

    def _ensure_worker(self) -> None:
        if self._worker_started:
            return
        self._worker_started = True
        threading.Thread(target=self._dispatch_loop, daemon=True).start()

    def enqueue(
        self,
        *,
        action: str,
        symbol: str = "",
        exchange: str = "",
        interval: str = "d",
        incremental: bool = True,
        user_start: str = "",
        user_end: str = "",
        materialize_first: bool = False,
        priority: str = "normal",
        task_id: str = "",
        label: str = "",
        batch_items: list[dict] | None = None,
    ) -> str:
        task_id = task_id or str(uuid.uuid4())[:8]
        pri = PRIORITY_MAP.get(priority, 5)

        if batch_items:
            self._ensure_worker()
            with self._lock:
                self._seq += 1
                batch_label = label or f"批量更新 ({len(batch_items)} 项)"
                self._init_batch(task_id, len(batch_items), batch_label)
                self._emit(task_id, action, "running", batch_label, f"排队 0/{len(batch_items)}", 0, len(batch_items))
                for i, item in enumerate(batch_items):
                    self._seq += 1
                    jid = f"{task_id}-{i}"
                    sym = item.get("symbol", "")
                    ex = item.get("exchange", "")
                    itv = item.get("interval") or interval
                    job = _QueuedJob(
                        sort_key=(pri, self._seq),
                        job_id=jid,
                        task_id=task_id,
                        action=action,
                        symbol=sym,
                        exchange=ex,
                        interval=itv,
                        incremental=incremental,
                        user_start=user_start or item.get("start", ""),
                        user_end=user_end or item.get("end", ""),
                        materialize_first=materialize_first or item.get("materialize_first", False),
                        label=f"{sym}.{ex} {itv}",
                    )
                    heapq.heappush(self._heap, job)
            return task_id

        self._ensure_worker()
        with self._lock:
            self._seq += 1
            job = _QueuedJob(
                sort_key=(pri, self._seq),
                job_id=task_id,
                task_id=task_id,
                action=action,
                symbol=symbol,
                exchange=exchange,
                interval=interval,
                incremental=incremental,
                user_start=user_start,
                user_end=user_end,
                materialize_first=materialize_first,
                label=label or f"{symbol}.{exchange} {interval}",
            )
            heapq.heappush(self._heap, job)
        vt_label = label or f"{symbol}.{exchange} {interval}"
        self._emit(task_id, action, "running", vt_label, "排队中…")
        return task_id

    def cancel(self, task_id: str) -> bool:
        with self._lock:
            self._cancelled.add(task_id)
            before = len(self._heap)
            self._heap = [j for j in self._heap if not j.task_id.startswith(task_id) and j.task_id != task_id]
            heapq.heapify(self._heap)
            removed = before - len(self._heap)
        if removed or task_id in self._running_ids:
            self._emit(task_id, "cancel", "error", task_id, "已取消")
            return True
        return removed > 0

    def run_scheduled_watchlist_update(self) -> str | None:
        items = self.get_scheduled_symbols()
        if not items:
            return None
        task_id = f"sched-{uuid.uuid4().hex[:6]}"
        batch = []
        for it in items:
            vt = it.get("vt_symbol", "")
            sym = it.get("symbol", "")
            ex = it.get("exchange", "")
            if vt and not sym:
                sym, ex = vt.split(".", 1)
            for itv in it.get("intervals") or ["1m", "d"]:
                batch.append({"symbol": sym, "exchange": ex, "interval": itv})
        if not batch:
            return None
        return self.enqueue(
            action="scheduled_update",
            batch_items=batch,
            incremental=True,
            priority="scheduled",
            task_id=task_id,
            label=f"定时更新 {len(batch)} 项",
        )

    def _dispatch_loop(self) -> None:
        while True:
            job = None
            with self._lock:
                if self._active >= self._concurrency or not self._heap:
                    pass
                else:
                    job = heapq.heappop(self._heap)
                    if job.task_id in self._cancelled or job.job_id in self._cancelled:
                        job = None
                    else:
                        self._active += 1
                        self._running_ids.add(job.task_id)

            if not job:
                time.sleep(0.2)
                continue

            try:
                self._execute_job(job)
            finally:
                with self._lock:
                    self._active -= 1
                    self._running_ids.discard(job.task_id)

    def _rate_wait(self) -> None:
        if self._rate_delay <= 0:
            return
        elapsed = time.time() - self._last_download_at
        if elapsed < self._rate_delay:
            time.sleep(self._rate_delay - elapsed)
        self._last_download_at = time.time()

    def _execute_job(self, job: _QueuedJob) -> None:
        if job.task_id in self._cancelled:
            return
        main_engine = self._main_engine_ref()
        if not main_engine:
            self._emit(job.task_id, job.action, "error", job.label, "引擎未就绪")
            return

        from . import data_api

        if job.action == "sync_minute_data":
            engine = main_engine.get_engine("DataManager")
            if not engine:
                self._emit(job.task_id, job.action, "error", "同步分钟", "DataManager 未加载")
                return
            try:
                count = engine.sync_minute_data(self._on_log)
                self._emit(job.task_id, job.action, "success", "同步分钟数据", f"同步 {count} 个合约")
                self._push_overviews()
            except Exception as e:
                self._emit(job.task_id, job.action, "error", "同步分钟数据", str(e))
            return

        if job.action == "delete_bar_data":
            engine = main_engine.get_engine("DataManager")
            if not engine:
                self._emit(job.task_id, job.action, "error", job.label, "DataManager 未加载")
                return
            self._emit(job.task_id, job.action, "running", job.label, "删除中…")
            try:
                count = engine.delete_bar_data(job.symbol, Exchange(job.exchange), Interval(job.interval))
                self._on_log(f"[DataManager] 已删除 {job.label} 共 {count} 条")
                self._emit(job.task_id, job.action, "success", job.label, f"已删除 {count} 条")
                self._push_overviews()
            except Exception as e:
                self._emit(job.task_id, job.action, "error", job.label, str(e))
            return

        if job.action == "materialize_bar_data":
            try:
                n = materialize_ticks_to_bars(
                    main_engine, job.symbol, job.exchange, job.interval, self._on_log
                )
                msg = f"物化 {n} 条" if n else "无可物化 Tick"
                self._emit(job.task_id, job.action, "success", job.label, msg)
                self._push_overviews()
            except Exception as e:
                self._emit(job.task_id, job.action, "error", job.label, str(e))
            return

        incremental = job.action in ("update_bar_data", "scheduled_update", "auto_update")
        if job.materialize_first and job.interval == "1m":
            materialize_ticks_to_bars(main_engine, job.symbol, job.exchange, "1m", self._on_log)

        start, end, reason = plan_download_range(
            main_engine,
            job.symbol,
            job.exchange,
            job.interval,
            incremental=incremental,
            user_start=job.user_start,
            user_end=job.user_end,
        )

        if reason == "already_up_to_date":
            st = self._batch_state.get(job.task_id)
            if st:
                self._finish_batch_item(job.task_id, True)
                if job.task_id in self._batch_state:
                    self._emit_batch_progress(job, "已是最新", done_override=st["done"])
            else:
                self._emit(job.task_id, job.action, "success", job.label, "已是最新")
            return

        st = self._batch_state.get(job.task_id)
        if st:
            self._emit_batch_progress(
                job,
                f"下载 {start.strftime('%Y-%m-%d %H:%M') if start else ''} → {end.strftime('%Y-%m-%d') if end else ''}",
            )
        else:
            self._emit(
                job.task_id, job.action, "running", job.label,
                f"下载 {start.strftime('%Y-%m-%d %H:%M') if start else ''} → {end.strftime('%Y-%m-%d') if end else ''}",
            )
        self._rate_wait()
        status, count = data_api.run_download_bar(
            main_engine,
            job.symbol,
            job.exchange,
            job.interval,
            start,
            end,
            self._on_log,
        )
        if status == "success":
            msg = f"下载完成 {count} 条" if count else "下载完成（无新数据）"
            self._on_log(f"[DataManager] {msg}: {job.label}")
            st = self._batch_state.get(job.task_id)
            if st:
                self._finish_batch_item(job.task_id, True)
                if job.task_id in self._batch_state:
                    self._emit_batch_progress(job, msg, done_override=st["done"])
            else:
                self._emit(job.task_id, job.action, "success", job.label, msg)
                self._push_overviews()
        else:
            st = self._batch_state.get(job.task_id)
            if st:
                batch_label = st.get("label") or job.label
                self._finish_batch_item(job.task_id, False)
                if job.task_id in self._batch_state:
                    self._emit_batch_progress(job, "下载失败，见日志", done_override=st["done"])
                else:
                    self._emit(job.task_id, job.action, "error", batch_label, f"{job.label} 失败")
            else:
                self._emit(job.task_id, job.action, "error", job.label, "下载失败，见日志")


# Module-level singleton
_update_queue: DataUpdateQueue | None = None


def get_update_queue(
    main_engine_ref: Callable | None = None,
    emit_task: Callable | None = None,
    push_overviews: Callable | None = None,
    on_log: Callable | None = None,
) -> DataUpdateQueue | None:
    global _update_queue
    if _update_queue is None and all([main_engine_ref, emit_task, push_overviews, on_log]):
        _update_queue = DataUpdateQueue(main_engine_ref, emit_task, push_overviews, on_log)
    return _update_queue
