// ===== K 线 / 分时图表引擎 =====

const CHART_INTERVAL_API = { tick: 'tick', '1m': '1m', '5m': '1m', '15m': '1m', '1h': '1h', d: 'd' };
const AGGREGATE_N = { '5m': 5, '15m': 15 };

function $chartBaseOption(mode) {
  const isLine = mode === 'timeshare';
  return {
    backgroundColor: '#0f1117',
    animation: false,
    grid: [
      { left: '8%', right: '4%', top: '10%', height: isLine ? '62%' : '48%' },
      { left: '8%', right: '4%', top: isLine ? '78%' : '66%', height: '16%' },
    ],
    xAxis: [
      { type: 'category', gridIndex: 0, axisLabel: { show: isLine, fontSize: 10 }, data: [] },
      { type: 'category', gridIndex: 1, axisLabel: { fontSize: 10 }, data: [] },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, scale: true, splitLine: { lineStyle: { color: '#2a2d38' } } },
      { type: 'value', gridIndex: 1, scale: true, splitLine: { show: false } },
    ],
    series: isLine ? [
      { name: '分时', type: 'line', xAxisIndex: 0, yAxisIndex: 0, showSymbol: false,
        lineStyle: { width: 1.5, color: '#60a5fa' }, areaStyle: { color: 'rgba(96,165,250,0.12)' }, data: [] },
      { name: '均价', type: 'line', xAxisIndex: 0, yAxisIndex: 0, showSymbol: false,
        lineStyle: { width: 1, color: '#f59e0b', type: 'dashed' }, data: [] },
      { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: [],
        itemStyle: { color: '#3b82f6' } },
    ] : [
      { name: 'K线', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0, z: 2, data: [],
        markLine: { symbol: 'none', silent: true, data: [] },
        itemStyle: { color: '#ef4444', color0: '#22c55e', borderColor: '#ef4444', borderColor0: '#22c55e' } },
      { name: 'MA5', type: 'line', xAxisIndex: 0, yAxisIndex: 0, z: 10, showSymbol: false, symbol: 'none',
        lineStyle: { width: 1.5, color: '#fbbf24' }, data: [] },
      { name: 'MA10', type: 'line', xAxisIndex: 0, yAxisIndex: 0, z: 11, showSymbol: false, symbol: 'none',
        lineStyle: { width: 1.5, color: '#a78bfa' }, data: [] },
      { name: 'MA20', type: 'line', xAxisIndex: 0, yAxisIndex: 0, z: 12, showSymbol: false, symbol: 'none',
        lineStyle: { width: 1.5, color: '#38bdf8' }, data: [] },
      { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, z: 1, data: [],
        itemStyle: { color: p => (p.data[2] > 0 ? '#22c55e' : '#ef4444') } },
    ],
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: isLine ? undefined : {
      show: true, top: 4, right: 8, itemWidth: 14, itemHeight: 8,
      textStyle: { fontSize: 10, color: '#9ca3af' },
      data: ['MA5', 'MA10', 'MA20'],
    },
    dataZoom: [
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

function $tickToSeedBar(tick) {
  if (!tick?.last_price) return null;
  const dt = tick.datetime || tick.time || new Date().toISOString();
  const o = tick.open_price || tick.pre_close || tick.last_price;
  return {
    datetime: typeof dt === 'string' ? dt : new Date(dt).toISOString(),
    open: o, high: tick.high_price || tick.last_price,
    low: tick.low_price || tick.last_price, close: tick.last_price,
    volume: tick.volume || 0,
  };
}

function $ticksToTimeshare(ticks, preClose) {
  if (!ticks?.length) return null;
  const dates = [];
  const prices = [];
  const avg = [];
  const vols = [];
  let sumPV = 0;
  let sumV = 0;
  ticks.forEach(t => {
    const label = $fmtChartTime(t.time || t.datetime);
    dates.push(label);
    prices.push(t.last_price);
    sumPV += (t.last_price || 0) * (t.volume || 1);
    sumV += (t.volume || 1);
    avg.push(sumV ? +(sumPV / sumV).toFixed(4) : t.last_price);
    vols.push([label, t.volume || 0, 1]);
  });
  return { dates, prices, avg, vols, preClose: preClose || prices[0] };
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

function $fillTimeshareOption(tickData, vtSymbol) {
  const opt = $chartBaseOption('timeshare');
  const pre = tickData.preClose || tickData.prices[0];
  opt.xAxis[0].data = tickData.dates;
  opt.xAxis[1].data = tickData.dates;
  opt.series[0].data = tickData.prices;
  opt.series[0].markLine = {
    symbol: 'none', silent: true,
    data: [
      { yAxis: pre, lineStyle: { color: '#6b7080', type: 'dashed' }, label: { formatter: '昨收', fontSize: 9 } },
      ...$buildMarkLines(vtSymbol),
    ],
  };
  opt.series[1].data = tickData.avg;
  opt.series[2].data = tickData.vols;
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

function $applyCandleChart(chart, bars, vtSymbol) {
  chart.setOption($fillCandleOption(bars, vtSymbol), true);
}

function $applyTimeshareChart(chart, tickData, vtSymbol) {
  chart.setOption($fillTimeshareOption(tickData, vtSymbol), true);
}

function $clearChart(chart) {
  if (!chart) return;
  try { chart.clear(); } catch (e) { /* ignore */ }
}
