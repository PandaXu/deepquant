// ===== K 线 / 分时图表引擎 =====

const CHART_INTERVAL_API = { tick: 'tick', '1m': '1m', '5m': '1m', '15m': '1m', '1h': '1h', d: 'd' };
const AGGREGATE_N = { '5m': 5, '15m': 15 };

function $isLightTheme() {
  return document.body.classList.contains('theme-light');
}

function $echartsThemeName() {
  return $isLightTheme() ? undefined : 'dark';
}

function $echartsInit(dom) {
  return echarts.init(dom, $echartsThemeName());
}

function $chartColors() {
  if ($isLightTheme()) {
    return {
      bg: '#ffffff',
      grid: '#e4e4e7',
      text: '#71717a',
      markRef: '#a1a1aa',
      line: '#2563eb',
      area: 'rgba(37,99,235,0.10)',
      avg: '#d97706',
      volBar: '#3b82f6',
      up: '#ef4444',
      down: '#22c55e',
      ma5: '#d97706',
      ma10: '#7c3aed',
      ma20: '#0284c7',
      markLive: '#2563eb',
    };
  }
  return {
    bg: '#0f1117',
    grid: '#2a2d38',
    text: '#9ca3af',
    markRef: '#6b7080',
    line: '#60a5fa',
    area: 'rgba(96,165,250,0.12)',
    avg: '#f59e0b',
    volBar: '#3b82f6',
    up: '#ef4444',
    down: '#22c55e',
    ma5: '#fbbf24',
    ma10: '#a78bfa',
    ma20: '#38bdf8',
    markLive: '#60a5fa',
  };
}

/** 各交易所分时时段时间段 [startH, startM, endH, endM] */
const TIMESHARE_SESSIONS = {
  CFFEX: [[9, 30, 11, 30], [13, 0, 15, 0]],
  DEFAULT: [[9, 0, 10, 15], [10, 30, 11, 30], [13, 30, 15, 0]],
  SHFE: [[9, 0, 10, 15], [10, 30, 11, 30], [13, 30, 15, 0], [21, 0, 23, 0]],
  DCE: [[9, 0, 10, 15], [10, 30, 11, 30], [13, 30, 15, 0], [21, 0, 23, 0]],
  CZCE: [[9, 0, 10, 15], [10, 30, 11, 30], [13, 30, 15, 0], [21, 0, 23, 0]],
  INE: [[9, 0, 10, 15], [10, 30, 11, 30], [13, 30, 15, 0], [21, 0, 23, 30]],
  GFEX: [[9, 0, 10, 15], [10, 30, 11, 30], [13, 30, 15, 0]],
};

function $chartBaseOption(mode) {
  const isLine = mode === 'timeshare';
  const c = $chartColors();
  const axisLabel = { fontSize: 10, color: c.text };
  return {
    backgroundColor: c.bg,
    animation: false,
    title: isLine ? {
      text: '', left: 8, top: 2,
      textStyle: { fontSize: 11, color: c.text, fontWeight: 'normal' },
    } : undefined,
    grid: [
      { left: '8%', right: isLine ? '10%' : '4%', top: isLine ? '14%' : '10%', height: isLine ? '58%' : '48%' },
      { left: '8%', right: isLine ? '10%' : '4%', top: isLine ? '76%' : '66%', height: '16%' },
    ],
    xAxis: [
      {
        type: 'category', gridIndex: 0, boundaryGap: false,
        axisLabel: { ...axisLabel, show: isLine, interval: isLine ? 'auto' : 'auto' },
        axisLine: { lineStyle: { color: c.grid } },
        data: [],
      },
      {
        type: 'category', gridIndex: 1, boundaryGap: true,
        axisLabel, axisLine: { lineStyle: { color: c.grid } }, data: [],
      },
    ],
    yAxis: isLine ? [
      {
        type: 'value', gridIndex: 0, scale: true, splitNumber: 4,
        splitLine: { lineStyle: { color: c.grid } },
        axisLabel,
      },
      {
        type: 'value', gridIndex: 0, scale: true, position: 'right', splitNumber: 4,
        splitLine: { show: false },
        axisLabel,
      },
      { type: 'value', gridIndex: 1, scale: true, splitLine: { show: false }, axisLabel: { show: false } },
    ] : [
      {
        type: 'value', gridIndex: 0, scale: true,
        splitLine: { lineStyle: { color: c.grid } },
        axisLabel,
      },
      {
        type: 'value', gridIndex: 1, scale: true, splitLine: { show: false },
        axisLabel: { show: false },
      },
    ],
    series: isLine ? [
      {
        name: '分时', type: 'line', xAxisIndex: 0, yAxisIndex: 0, showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.5, color: c.line },
        areaStyle: { color: c.area },
        data: [],
      },
      {
        name: '均价', type: 'line', xAxisIndex: 0, yAxisIndex: 0, showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1, color: c.avg, type: 'dashed' },
        data: [],
      },
      {
        name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 2, data: [],
        itemStyle: { color: c.volBar },
      },
    ] : [
      { name: 'K线', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0, z: 2, data: [],
        markLine: { symbol: 'none', silent: true, data: [] },
        itemStyle: { color: c.up, color0: c.down, borderColor: c.up, borderColor0: c.down } },
      { name: 'MA5', type: 'line', xAxisIndex: 0, yAxisIndex: 0, z: 10, showSymbol: false, symbol: 'none',
        lineStyle: { width: 1.5, color: c.ma5 }, data: [] },
      { name: 'MA10', type: 'line', xAxisIndex: 0, yAxisIndex: 0, z: 11, showSymbol: false, symbol: 'none',
        lineStyle: { width: 1.5, color: c.ma10 }, data: [] },
      { name: 'MA20', type: 'line', xAxisIndex: 0, yAxisIndex: 0, z: 12, showSymbol: false, symbol: 'none',
        lineStyle: { width: 1.5, color: c.ma20 }, data: [] },
      { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, z: 1, data: [],
        itemStyle: { color: p => (p.data[2] > 0 ? c.down : c.up) } },
    ],
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'cross' },
      formatter: isLine ? undefined : undefined,
    },
    legend: isLine ? undefined : {
      show: true, top: 4, right: 8, itemWidth: 14, itemHeight: 8,
      textStyle: { fontSize: 10, color: c.text },
      data: ['MA5', 'MA10', 'MA20'],
    },
    dataZoom: isLine ? [] : [
      { type: 'inside', xAxisIndex: [0, 1] },
      { type: 'slider', xAxisIndex: [0, 1], bottom: '2%', height: 16 },
    ],
  };
}

function $aggregateBars(bars, n) {
  if (!n || n <= 1) return bars;
  const out = [];
  for (let i = 0; i < bars.length; i += n) {
    const chunk = bars.slice(i, i + n);
    if (!chunk.length) continue;
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    out.push({
      datetime: first.datetime,
      open: first.open ?? first.open_price,
      close: last.close ?? last.close_price,
      high: Math.max(...chunk.map(b => b.high ?? b.high_price ?? 0)),
      low: Math.min(...chunk.map(b => b.low ?? b.low_price ?? 0)),
      volume: chunk.reduce((s, b) => s + (b.volume || 0), 0),
    });
  }
  return out;
}

function $calcMA(closes, period) {
  return closes.map((_, i) => {
    if (i < period - 1) return '-';
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += closes[j];
    return +(s / period).toFixed(4);
  });
}

function $barsToChartData(bars) {
  const dates = bars.map(d => $fmtChartTime(d.datetime));
  const closes = bars.map(d => d.close ?? d.close_price ?? 0);
  const candleData = bars.map(d => [
    d.open ?? d.open_price ?? 0,
    d.close ?? d.close_price ?? 0,
    d.low ?? d.low_price ?? 0,
    d.high ?? d.high_price ?? 0,
  ]);
  const volData = bars.map(d => [
    $fmtChartTime(d.datetime),
    d.volume || 0,
    (d.open ?? d.open_price ?? 0) > (d.close ?? d.close_price ?? 0) ? 1 : -1,
  ]);
  return { dates, candleData, volData, ma5: $calcMA(closes, 5), ma10: $calcMA(closes, 10), ma20: $calcMA(closes, 20) };
}

function $fmtChartTime(dt) {
  if (!dt) return '';
  const s = typeof dt === 'string' ? dt : new Date(dt).toISOString();
  return s.length > 16 ? s.slice(5, 16).replace('T', ' ') : s.slice(-8);
}

function $parseChartDate(dt) {
  if (!dt) return null;
  const d = typeof dt === 'string' ? new Date(dt) : new Date(dt);
  if (Number.isNaN(d.getTime())) return null;
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    label: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    ts: d.getTime(),
  };
}

function $todayKey() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function $daysAgoKey(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function $labelToMinutes(label) {
  if (!label) return null;
  const [h, m] = String(label).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function $minutesToLabel(minutes) {
  const cur = Math.max(0, Math.min(24 * 60 - 1, minutes));
  return `${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`;
}

function $genSessionLabels(exchange) {
  const segs = TIMESHARE_SESSIONS[exchange] || TIMESHARE_SESSIONS.DEFAULT;
  const labels = [];
  const seen = new Set();
  for (const [h1, m1, h2, m2] of segs) {
    let cur = h1 * 60 + m1;
    const end = h2 * 60 + m2;
    while (cur <= end) {
      const label = $minutesToLabel(cur);
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
      cur += 1;
    }
  }
  return labels;
}

/** SimNow 7x24 等：当日 K 线不在固定交易时段内时，按实际成交分钟生成 X 轴 */
function $genDynamicSessionLabels(dayBars, tick, dayKey) {
  let minM = Infinity;
  let maxM = -Infinity;
  const consider = (dt) => {
    const p = $parseChartDate(dt);
    if (!p || (dayKey && p.date !== dayKey)) return;
    const m = $labelToMinutes(p.label);
    if (m == null) return;
    minM = Math.min(minM, m);
    maxM = Math.max(maxM, m);
  };
  for (const b of dayBars || []) consider(b.datetime);
  if (tick) consider(tick.datetime || tick.time);
  if (!Number.isFinite(minM)) return [];
  minM = Math.max(0, minM - 10);
  maxM = Math.min(24 * 60 - 1, maxM + 10);
  const labels = [];
  for (let cur = minM; cur <= maxM; cur++) labels.push($minutesToLabel(cur));
  return labels;
}

function $fillTimeshareSlots(labels, dayBars) {
  const labelIndex = {};
  labels.forEach((lb, i) => { labelIndex[lb] = i; });
  const slots = labels.map(() => ({ price: null, volume: 0, hasData: false }));
  for (const b of dayBars || []) {
    const p = $parseChartDate(b.datetime);
    if (!p) continue;
    const idx = labelIndex[p.label];
    if (idx == null) continue;
    const close = b.close ?? b.close_price ?? 0;
    if (!close) continue;
    slots[idx].price = close;
    slots[idx].volume += b.volume || 0;
    slots[idx].hasData = true;
  }
  return { slots, labelIndex, sessionLabels: labels };
}

function $ensureTimeshareLabel(state, label) {
  if (!state || !label) return -1;
  let idx = state.sessionLabels.indexOf(label);
  if (idx >= 0) return idx;
  const m = $labelToMinutes(label);
  if (m == null) return -1;
  const firstM = $labelToMinutes(state.sessionLabels[0]);
  const lastM = $labelToMinutes(state.sessionLabels[state.sessionLabels.length - 1]);
  if (firstM == null || lastM == null) return -1;
  const newMin = Math.min(firstM, m);
  const newMax = Math.max(lastM, m);
  const oldSlots = state.slots;
  const labels = [];
  for (let cur = newMin; cur <= newMax; cur++) labels.push($minutesToLabel(cur));
  const slots = labels.map((lb) => {
    const oldIdx = state.sessionLabels.indexOf(lb);
    return oldIdx >= 0
      ? { ...oldSlots[oldIdx] }
      : { price: null, volume: 0, hasData: false };
  });
  state.sessionLabels = labels;
  state.slots = slots;
  state.dynamicSession = true;
  return labels.indexOf(label);
}

function $filterBarsToDay(bars, dayKey) {
  return (bars || []).filter(b => {
    const p = $parseChartDate(b.datetime);
    return p && p.date === dayKey;
  });
}

function $pickLatestDayKey(bars) {
  let latest = '';
  for (const b of bars || []) {
    const p = $parseChartDate(b.datetime);
    if (p && p.date > latest) latest = p.date;
  }
  return latest;
}

function $tickVolumeDelta(tick, prevCumVol) {
  const lv = tick.last_volume;
  if (lv != null && lv > 0) return lv;
  const cum = tick.volume;
  if (cum != null && prevCumVol != null && cum >= prevCumVol) return cum - prevCumVol;
  return 0;
}

function $recalcTimeshareSeries(state) {
  const n = state.sessionLabels.length;
  state.prices = new Array(n).fill(null);
  state.avg = new Array(n).fill(null);
  state.vols = new Array(n).fill(0);
  let sumPV = 0;
  let sumV = 0;
  let lastPrice = null;
  for (let i = 0; i < n; i++) {
    const slot = state.slots[i];
    if (!slot || !slot.hasData) continue;
    state.prices[i] = slot.price;
    state.vols[i] = slot.volume || 0;
    sumPV += slot.price * (slot.volume || 0);
    sumV += slot.volume || 0;
    state.avg[i] = sumV > 0 ? +(sumPV / sumV).toFixed(4) : slot.price;
    lastPrice = slot.price;
  }
  state.lastPrice = lastPrice;
  const validPrices = state.prices.filter(v => v != null && v > 0);
  state.priceMin = validPrices.length ? Math.min(...validPrices) : state.preClose;
  state.priceMax = validPrices.length ? Math.max(...validPrices) : state.preClose;
}

/**
 * 从 1m K 线 + 可选 tick 构建分时会话状态。
 * @returns {object|null}
 */
function $buildTimeshareState(bars, exchange, preClose, tick, vtSymbol) {
  let dayKey = $todayKey();
  let dayBars = $filterBarsToDay(bars, dayKey);
  if (!dayBars.length && bars?.length) {
    dayKey = $pickLatestDayKey(bars) || dayKey;
    dayBars = $filterBarsToDay(bars, dayKey);
  }

  let labels = $genSessionLabels(exchange);
  let filled = $fillTimeshareSlots(labels, dayBars);
  const hasSessionData = filled.slots.some(s => s.hasData);
  let dynamicSession = false;
  if (dayBars.length && !hasSessionData) {
    labels = $genDynamicSessionLabels(dayBars, tick, dayKey);
    if (labels.length) {
      filled = $fillTimeshareSlots(labels, dayBars);
      dynamicSession = true;
    }
  }
  if (!labels.length) return null;

  const pc = preClose || dayBars[0]?.open || dayBars[0]?.open_price || tick?.pre_close || tick?.open_price || null;
  const state = {
    vtSymbol: vtSymbol || '',
    exchange,
    preClose: pc,
    sessionDate: dayKey,
    sessionLabels: filled.sessionLabels,
    slots: filled.slots,
    dayBars,
    dynamicSession,
    lastCumVolume: tick?.volume ?? null,
    lastTickMinute: '',
  };
  $recalcTimeshareSeries(state);

  if (tick?.last_price) $applyTickToTimeshareState(state, tick);
  state.hasAnyData = state.slots.some(s => s.hasData) || !!state.lastPrice;
  if (!state.hasAnyData && !state.preClose) return null;
  if (!state.lastPrice && state.preClose) {
    state.priceMin = state.preClose * 0.998;
    state.priceMax = state.preClose * 1.002;
  }
  return state;
}

function $applyTickToTimeshareState(state, tick) {
  if (!state || !tick?.last_price) return false;
  const p = $parseChartDate(tick.datetime || tick.time);
  if (!p) return false;
  if (state.sessionDate && p.date !== state.sessionDate) return false;

  let idx = state.sessionLabels.indexOf(p.label);
  if (idx < 0) {
    if (!state.dynamicSession && !state.slots.some(s => s.hasData)) {
      const dynLabels = $genDynamicSessionLabels(state.dayBars || [], tick, state.sessionDate);
      if (!dynLabels.length) return false;
      const filled = $fillTimeshareSlots(dynLabels, state.dayBars || []);
      state.sessionLabels = filled.sessionLabels;
      state.slots = filled.slots;
      state.dynamicSession = true;
      idx = state.sessionLabels.indexOf(p.label);
    } else {
      idx = $ensureTimeshareLabel(state, p.label);
    }
    if (idx < 0) return false;
  }

  const volDelta = $tickVolumeDelta(tick, state.lastCumVolume);
  if (tick.volume != null) state.lastCumVolume = tick.volume;

  const slot = state.slots[idx];
  const sameMinute = state.lastTickMinute === p.label;
  if (sameMinute && slot.hasData) {
    slot.price = tick.last_price;
    slot.volume += volDelta;
  } else {
    slot.price = tick.last_price;
    slot.volume = (slot.hasData ? slot.volume : 0) + volDelta;
    slot.hasData = true;
  }
  state.lastTickMinute = p.label;
  $recalcTimeshareSeries(state);
  return true;
}

function $timesharePctLabel(price, preClose) {
  if (!preClose || !price) return '';
  const pct = (price - preClose) / preClose * 100;
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
}

function $timeshareMarkLines(state, vtSymbol) {
  const c = $chartColors();
  const lines = [];
  if (state.preClose) {
    lines.push({
      yAxis: state.preClose,
      lineStyle: { color: c.markRef, type: 'dashed' },
      label: { formatter: `昨收 ${state.preClose}`, fontSize: 9, color: c.text },
    });
  }
  if (state.lastPrice && state.lastPrice !== state.preClose) {
    lines.push({
      yAxis: state.lastPrice,
      lineStyle: { color: c.markLive, type: 'dotted' },
      label: { formatter: `现价 ${state.lastPrice}`, fontSize: 9, color: c.text },
    });
  }
  lines.push(...$buildMarkLines(vtSymbol));
  return lines;
}

function $fillTimeshareOption(state, vtSymbol) {
  const opt = $chartBaseOption('timeshare');
  const pre = state.preClose || state.lastPrice || 1;
  const pMin = state.priceMin ?? pre * 0.995;
  const pMax = state.priceMax ?? pre * 1.005;
  const pad = Math.max((pMax - pMin) * 0.08, pre * 0.002);
  const yMin = pMin - pad;
  const yMax = pMax + pad;

  const modeTag = state.dynamicSession ? ' · 扩展时段' : '';
  opt.title.text = `分时 · ${state.sessionDate || ''}${modeTag}`;
  opt.xAxis[0].data = state.sessionLabels;
  opt.xAxis[1].data = state.sessionLabels;
  opt.yAxis[0].min = yMin;
  opt.yAxis[0].max = yMax;
  opt.yAxis[1].min = yMin;
  opt.yAxis[1].max = yMax;
  opt.yAxis[1].axisLabel.formatter = v => $timesharePctLabel(v, pre);

  const volBars = state.vols.map((v, i) => [state.sessionLabels[i], v || 0, 1]);

  opt.series[0].data = state.prices;
  opt.series[0].markLine = { symbol: 'none', silent: true, data: $timeshareMarkLines(state, vtSymbol) };
  opt.series[1].data = state.avg;
  opt.series[2].data = volBars;

  opt.tooltip.formatter = params => {
    if (!params?.length) return '';
    const idx = params[0].dataIndex;
    const price = state.prices[idx];
    if (price == null) return `${state.sessionLabels[idx]}<br/>无成交`;
    const pct = $timesharePctLabel(price, pre);
    const avg = state.avg[idx];
    const vol = state.vols[idx] || 0;
    return `${state.sessionDate} ${state.sessionLabels[idx]}<br/>`
      + `价格 ${price} (${pct})<br/>`
      + `均价 ${avg ?? '-'}<br/>`
      + `成交量 ${vol}`;
  };
  return opt;
}

function $patchTimeshareChart(chart, state, vtSymbol) {
  if (!chart || !state) return;
  const pre = state.preClose || state.lastPrice || 1;
  const pMin = state.priceMin ?? pre * 0.995;
  const pMax = state.priceMax ?? pre * 1.005;
  const pad = Math.max((pMax - pMin) * 0.08, pre * 0.002);
  const yMin = pMin - pad;
  const yMax = pMax + pad;
  const volBars = state.vols.map((v, i) => [state.sessionLabels[i], v || 0, 1]);
  chart.setOption({
    title: { text: `分时 · ${state.sessionDate || ''}${state.dynamicSession ? ' · 扩展时段' : ''}` },
    xAxis: [
      { data: state.sessionLabels },
      { data: state.sessionLabels },
    ],
    yAxis: [
      { min: yMin, max: yMax },
      { min: yMin, max: yMax, axisLabel: { formatter: v => $timesharePctLabel(v, pre) } },
    ],
    series: [
      { data: state.prices, markLine: { symbol: 'none', silent: true, data: $timeshareMarkLines(state, vtSymbol) } },
      { data: state.avg },
      { data: volBars },
    ],
  }, false);
}

function $tickToSeedBar(tick) {
  if (!tick?.last_price) return null;
  const dt = tick.datetime || tick.time || new Date().toISOString();
  const o = tick.open_price || tick.pre_close || tick.last_price;
  return {
    datetime: typeof dt === 'string' ? dt : new Date(dt).toISOString(),
    open: o, high: tick.high_price || tick.last_price,
    low: tick.low_price || tick.last_price, close: tick.last_price,
    volume: tick.last_volume || 0,
  };
}

function $buildMarkLines(vtSymbol) {
  const lines = [];
  Object.values(store.position).forEach(p => {
    if ((p.vt_symbol || '') !== vtSymbol) return;
    if (p.price) {
      lines.push({
        yAxis: p.price,
        lineStyle: { color: p.direction === 'LONG' ? '#ef4444' : '#22c55e', type: 'dashed' },
        label: { formatter: `持仓${p.direction === 'LONG' ? '多' : '空'} ${p.price}`, fontSize: 10 },
      });
    }
  });
  Object.values(store.order).forEach(o => {
    if ((o.vt_symbol || '') !== vtSymbol || !$isActiveOrder(o)) return;
    if (o.price) {
      lines.push({
        yAxis: o.price,
        lineStyle: { color: '#60a5fa', type: 'dotted' },
        label: { formatter: `委托 ${o.price}`, fontSize: 10 },
      });
    }
  });
  (store.backtestMarkers || []).forEach(m => {
    if (m.vt_symbol && m.vt_symbol !== vtSymbol) return;
    lines.push({
      xAxis: $fmtChartTime(m.datetime),
      lineStyle: { color: m.side === 'BUY' ? '#ef4444' : '#22c55e' },
      label: { formatter: m.side === 'BUY' ? '买' : '卖', fontSize: 9 },
    });
  });
  return lines;
}

function $fillCandleOption(bars, vtSymbol) {
  const opt = $chartBaseOption('candle');
  const { dates, candleData, volData, ma5, ma10, ma20 } = $barsToChartData(bars);
  opt.xAxis[0].data = dates;
  opt.xAxis[1].data = dates;
  opt.series[0].data = candleData;
  opt.series[0].markLine = { symbol: 'none', silent: true, data: $buildMarkLines(vtSymbol) };
  opt.series[1].data = ma5;
  opt.series[2].data = ma10;
  opt.series[3].data = ma20;
  opt.series[4].data = volData;
  return opt;
}

function $updateChartMarkLines(chart, vtSymbol) {
  if (!chart || !vtSymbol) return;
  chart.setOption({
    series: [{
      markLine: { symbol: 'none', silent: true, data: $buildMarkLines(vtSymbol) },
    }],
  });
}

function $updateTimeshareMarkLines(chart, state, vtSymbol) {
  if (!chart || !state) return;
  chart.setOption({
    series: [{
      markLine: { symbol: 'none', silent: true, data: $timeshareMarkLines(state, vtSymbol) },
    }],
  }, false);
}

function $captureChartZoom(chart) {
  if (!chart) return null;
  const dzList = chart.getOption()?.dataZoom;
  if (!dzList?.length) return null;
  return dzList.map(dz => ({
    start: dz.start,
    end: dz.end,
    startValue: dz.startValue,
    endValue: dz.endValue,
  }));
}

function $applyCandleChart(chart, bars, vtSymbol) {
  chart.setOption($fillCandleOption(bars, vtSymbol), true);
}

/** 增量更新 K 线（保留 dataZoom 缩放/拖动状态） */
function $patchCandleChart(chart, bars, vtSymbol) {
  if (!chart || !bars?.length) return;
  const { dates, candleData, volData, ma5, ma10, ma20 } = $barsToChartData(bars);
  const opt = {
    xAxis: [{ data: dates }, { data: dates }],
    series: [
      { data: candleData, markLine: { symbol: 'none', silent: true, data: $buildMarkLines(vtSymbol) } },
      { data: ma5 },
      { data: ma10 },
      { data: ma20 },
      { data: volData },
    ],
  };
  const zoom = $captureChartZoom(chart);
  if (zoom) opt.dataZoom = zoom;
  chart.setOption(opt, false);
}

function $applyTimeshareChart(chart, state, vtSymbol) {
  chart.setOption($fillTimeshareOption(state, vtSymbol), true);
}

function $clearChart(chart) {
  if (!chart) return;
  try { chart.clear(); } catch (e) { /* ignore */ }
}

/** 拉取当日（或近几日最新交易日）1 分钟 K 线 */
async function $fetchIntradayBars(symbol, exchange) {
  const today = $todayKey();
  const start = $daysAgoKey(5);
  const url = `/api/bars?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`
    + `&interval=1m&start=${start}&end=`;
  const resp = await $apiGet(url);
  const bars = Array.isArray(resp) ? resp : (resp.bars || []);
  if (!bars.length) return [];
  let dayKey = $todayKey();
  let dayBars = $filterBarsToDay(bars, dayKey);
  if (!dayBars.length) {
    dayKey = $pickLatestDayKey(bars);
    dayBars = $filterBarsToDay(bars, dayKey);
  }
  return dayBars;
}
