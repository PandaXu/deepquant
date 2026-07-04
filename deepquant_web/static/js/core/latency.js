// ===== 行情延迟检测 =====

function $recordTickLatency(tick) {
  if (!tick) return;
  let ts = tick.datetime || tick.time;
  if (!ts) return;
  const tickMs = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(tickMs)) return;
  store.tickLatencyMs = Math.max(0, Date.now() - tickMs);
}

function $latencyLabel() {
  const ms = store.tickLatencyMs;
  if (ms == null) return '—';
  if (ms < 500) return ms + 'ms';
  if (ms < 3000) return ms + 'ms';
  return ms + 'ms ⚠';
}

function $latencyClass() {
  const ms = store.tickLatencyMs;
  if (ms == null) return '';
  if (ms < 500) return 'lat-ok';
  if (ms < 3000) return 'lat-warn';
  return 'lat-bad';
}
